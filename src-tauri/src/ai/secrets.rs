//! Encrypt AI provider API keys at rest.
//!
//! v2 values (`v2:` prefix) use a random 256-bit key stored next to the DB in
//! `ai-secrets.key` (owner-only permissions on Unix), so a copied/synced DB
//! alone does not reveal keys. Legacy values used a key derived from the DB
//! path and are still readable; they are re-encrypted the next time they are saved.
//! This protects against DB leaks, not against malware running as the user.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce};
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use rand::rngs::OsRng;
use rand::RngCore;
use sha2::{Digest, Sha256};

const V2_PREFIX: &str = "v2:";

fn legacy_device_key(db_path: &Path) -> [u8; 32] {
    let mut h = Sha256::new();
    h.update(b"autotrace-ai-key-v1");
    h.update(db_path.to_string_lossy().as_bytes());
    let out = h.finalize();
    let mut key = [0u8; 32];
    key.copy_from_slice(out.as_slice());
    key
}

fn key_file(db_path: &Path) -> PathBuf {
    db_path
        .parent()
        .unwrap_or_else(|| Path::new("."))
        .join("ai-secrets.key")
}

fn write_key_file(path: &Path, key: &[u8; 32]) -> std::io::Result<()> {
    let mut opts = fs::OpenOptions::new();
    opts.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        opts.mode(0o600);
    }
    let mut f = opts.open(path)?;
    f.write_all(key)?;
    f.sync_all()
}

/// Load the per-install key, creating it on first use.
fn install_key(db_path: &Path) -> Result<[u8; 32], String> {
    let path = key_file(db_path);
    if !path.exists() {
        let mut key = [0u8; 32];
        OsRng.fill_bytes(&mut key);
        match write_key_file(&path, &key) {
            Ok(()) => return Ok(key),
            // Another thread won the race — fall through and read theirs.
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {}
            Err(e) => return Err(format!("create ai key file: {e}")),
        }
    }
    let bytes = fs::read(&path).map_err(|e| format!("read ai key file: {e}"))?;
    <[u8; 32]>::try_from(bytes.as_slice()).map_err(|_| "corrupt ai key file".to_string())
}

fn seal(key: &[u8; 32], plaintext: &str) -> Result<String, String> {
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|e| e.to_string())?;
    let mut nonce_bytes = [0u8; 12];
    OsRng.fill_bytes(&mut nonce_bytes);
    let ct = cipher
        .encrypt(Nonce::from_slice(&nonce_bytes), plaintext.as_bytes())
        .map_err(|e| e.to_string())?;
    let mut out = Vec::with_capacity(12 + ct.len());
    out.extend_from_slice(&nonce_bytes);
    out.extend_from_slice(&ct);
    Ok(B64.encode(out))
}

fn open(key: &[u8; 32], encoded: &str) -> Result<String, String> {
    let raw = B64.decode(encoded).map_err(|e| e.to_string())?;
    if raw.len() < 13 {
        return Err("corrupt ai secret".into());
    }
    let (nonce_bytes, ct) = raw.split_at(12);
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|e| e.to_string())?;
    let pt = cipher
        .decrypt(Nonce::from_slice(nonce_bytes), ct)
        .map_err(|_| "failed to decrypt ai secret".to_string())?;
    String::from_utf8(pt).map_err(|e| e.to_string())
}

pub fn encrypt_secret(db_path: &Path, plaintext: &str) -> Result<String, String> {
    if plaintext.is_empty() {
        return Ok(String::new());
    }
    let key = install_key(db_path)?;
    Ok(format!("{V2_PREFIX}{}", seal(&key, plaintext)?))
}

pub fn decrypt_secret(db_path: &Path, encoded: &str) -> Result<String, String> {
    if encoded.is_empty() {
        return Ok(String::new());
    }
    match encoded.strip_prefix(V2_PREFIX) {
        Some(rest) => open(&install_key(db_path)?, rest),
        None => open(&legacy_device_key(db_path), encoded),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch_db() -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "autotrace-secrets-{}-{}",
            std::process::id(),
            OsRng.next_u32()
        ));
        fs::create_dir_all(&dir).unwrap();
        dir.join("autotrace.db")
    }

    #[test]
    fn v2_round_trip_uses_key_file() {
        let db = scratch_db();
        let sealed = encrypt_secret(&db, "sk-test-123").unwrap();
        assert!(sealed.starts_with(V2_PREFIX));
        assert!(key_file(&db).exists());
        assert_eq!(decrypt_secret(&db, &sealed).unwrap(), "sk-test-123");
    }

    #[test]
    fn legacy_values_still_decrypt() {
        let db = scratch_db();
        let legacy = seal(&legacy_device_key(&db), "sk-old").unwrap();
        assert_eq!(decrypt_secret(&db, &legacy).unwrap(), "sk-old");
    }

    #[test]
    fn db_copied_without_key_file_cannot_decrypt() {
        let db = scratch_db();
        let sealed = encrypt_secret(&db, "sk-test-123").unwrap();
        fs::remove_file(key_file(&db)).unwrap();
        assert!(decrypt_secret(&db, &sealed).is_err());
    }

    #[test]
    fn empty_stays_empty() {
        let db = scratch_db();
        assert_eq!(encrypt_secret(&db, "").unwrap(), "");
        assert_eq!(decrypt_secret(&db, "").unwrap(), "");
    }
}
