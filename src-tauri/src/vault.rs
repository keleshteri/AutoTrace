//! Opt-in local database encryption (AES-256-GCM + Argon2id).
//!
//! Locking encrypts the SQLite file into `<db>.db.vault` and removes the
//! plaintext; the app must have closed its connection first. On the next
//! launch the UI asks for the passphrase before the store is opened.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce};
use argon2::password_hash::{PasswordHasher, SaltString};
use argon2::Argon2;
use rand::rngs::OsRng;
use rand::RngCore;

#[derive(Debug, thiserror::Error)]
pub enum VaultError {
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    #[error("crypto: {0}")]
    Crypto(String),
    #[error("{0}")]
    Msg(String),
}

pub type Result<T> = std::result::Result<T, VaultError>;

pub const MIN_PASSPHRASE_LEN: usize = 8;
const MAGIC: &[u8; 4] = b"ATV1";
const HEADER_LEN: usize = 4 + 16 + 12;

fn vault_path(db: &Path) -> PathBuf {
    db.with_extension("db.vault")
}

fn sidecar_path(db: &Path, suffix: &str) -> PathBuf {
    PathBuf::from(format!("{}{suffix}", db.display()))
}

pub fn validate_passphrase(passphrase: &str) -> Result<()> {
    if passphrase.chars().count() < MIN_PASSPHRASE_LEN {
        return Err(VaultError::Msg(format!(
            "passphrase must be at least {MIN_PASSPHRASE_LEN} characters"
        )));
    }
    Ok(())
}

// Kept byte-for-byte compatible with vaults written by earlier builds.
fn key_from_passphrase(passphrase: &str, salt: &[u8]) -> Result<[u8; 32]> {
    let salt = SaltString::encode_b64(salt).map_err(|e| VaultError::Crypto(e.to_string()))?;
    let hash = Argon2::default()
        .hash_password(passphrase.as_bytes(), &salt)
        .map_err(|e| VaultError::Crypto(e.to_string()))?;
    let Some(hash_bytes) = hash.hash else {
        return Err(VaultError::Crypto("argon2 missing hash".into()));
    };
    let bytes = hash_bytes.as_bytes();
    let mut key = [0u8; 32];
    let n = bytes.len().min(32);
    key[..n].copy_from_slice(&bytes[..n]);
    Ok(key)
}

fn encrypt(plain: &[u8], passphrase: &str) -> Result<Vec<u8>> {
    let mut salt = [0u8; 16];
    OsRng.fill_bytes(&mut salt);
    let key = key_from_passphrase(passphrase, &salt)?;
    let cipher = Aes256Gcm::new_from_slice(&key).map_err(|e| VaultError::Crypto(e.to_string()))?;
    let mut nonce_bytes = [0u8; 12];
    OsRng.fill_bytes(&mut nonce_bytes);
    let ciphertext = cipher
        .encrypt(Nonce::from_slice(&nonce_bytes), plain)
        .map_err(|e| VaultError::Crypto(e.to_string()))?;

    let mut out = Vec::with_capacity(HEADER_LEN + ciphertext.len());
    out.extend_from_slice(MAGIC);
    out.extend_from_slice(&salt);
    out.extend_from_slice(&nonce_bytes);
    out.extend_from_slice(&ciphertext);
    Ok(out)
}

fn decrypt(data: &[u8], passphrase: &str) -> Result<Vec<u8>> {
    if data.len() < HEADER_LEN + 16 || &data[0..4] != MAGIC {
        return Err(VaultError::Msg("invalid vault format".into()));
    }
    let salt = &data[4..20];
    let nonce_bytes = &data[20..HEADER_LEN];
    let key = key_from_passphrase(passphrase, salt)?;
    let cipher = Aes256Gcm::new_from_slice(&key).map_err(|e| VaultError::Crypto(e.to_string()))?;
    cipher
        .decrypt(Nonce::from_slice(nonce_bytes), &data[HEADER_LEN..])
        .map_err(|_| VaultError::Msg("wrong passphrase or corrupt vault".into()))
}

/// Write via a temp file + fsync + rename so a crash never leaves a torn file.
fn write_atomic(path: &Path, bytes: &[u8]) -> Result<()> {
    let tmp = sidecar_path(path, ".tmp");
    {
        let mut f = fs::File::create(&tmp)?;
        f.write_all(bytes)?;
        f.sync_all()?;
    }
    fs::rename(&tmp, path)?;
    Ok(())
}

/// Encrypt the plaintext DB → `.db.vault`, verify it round-trips, then remove
/// the plaintext DB and its journal files. The caller must have closed every
/// connection to `db_path` first.
pub fn lock_database(db_path: &Path, passphrase: &str) -> Result<()> {
    validate_passphrase(passphrase)?;
    let plain = fs::read(db_path)?;
    let sealed = encrypt(&plain, passphrase)?;
    if decrypt(&sealed, passphrase)? != plain {
        return Err(VaultError::Crypto("vault verification failed".into()));
    }
    write_atomic(&vault_path(db_path), &sealed)?;

    // Failing to remove the plaintext means it is NOT protected — surface it.
    fs::remove_file(db_path)?;
    for suffix in ["-wal", "-shm", "-journal"] {
        let p = sidecar_path(db_path, suffix);
        if p.exists() {
            fs::remove_file(p)?;
        }
    }
    Ok(())
}

/// Decrypt `.db.vault` → plaintext DB, then remove the vault. Refuses to run
/// while a plaintext DB exists so a live database is never overwritten.
pub fn unlock_database(db_path: &Path, passphrase: &str) -> Result<()> {
    let vault = vault_path(db_path);
    if !vault.exists() {
        return Err(VaultError::Msg("no vault file found".into()));
    }
    if db_path.exists() {
        return Err(VaultError::Msg("database is already unlocked".into()));
    }
    let plain = decrypt(&fs::read(&vault)?, passphrase)?;
    write_atomic(db_path, &plain)?;
    fs::remove_file(&vault)?;
    Ok(())
}

pub fn vault_exists(db_path: &Path) -> bool {
    vault_path(db_path).exists()
}

/// Locked = encrypted vault present and no plaintext DB to open.
pub fn is_locked(db_path: &Path) -> bool {
    vault_exists(db_path) && !db_path.exists()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch_db(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "autotrace-vault-{name}-{}-{}",
            std::process::id(),
            OsRng.next_u32()
        ));
        fs::create_dir_all(&dir).unwrap();
        dir.join("autotrace.db")
    }

    #[test]
    fn lock_then_unlock_round_trips_and_removes_plaintext() {
        let db = scratch_db("roundtrip");
        fs::write(&db, b"sqlite bytes").unwrap();
        fs::write(sidecar_path(&db, "-journal"), b"j").unwrap();

        lock_database(&db, "correct horse").unwrap();
        assert!(!db.exists());
        assert!(!sidecar_path(&db, "-journal").exists());
        assert!(is_locked(&db));

        unlock_database(&db, "correct horse").unwrap();
        assert_eq!(fs::read(&db).unwrap(), b"sqlite bytes");
        assert!(!vault_exists(&db));
        assert!(!is_locked(&db));
    }

    #[test]
    fn wrong_passphrase_keeps_vault() {
        let db = scratch_db("wrong");
        fs::write(&db, b"data").unwrap();
        lock_database(&db, "correct horse").unwrap();

        assert!(unlock_database(&db, "wrong horse!").is_err());
        assert!(is_locked(&db));
        assert!(!db.exists());
    }

    #[test]
    fn unlock_refuses_to_overwrite_existing_db() {
        let db = scratch_db("overwrite");
        fs::write(&db, b"old").unwrap();
        lock_database(&db, "correct horse").unwrap();
        fs::write(&db, b"new live db").unwrap();

        assert!(unlock_database(&db, "correct horse").is_err());
        assert_eq!(fs::read(&db).unwrap(), b"new live db");
    }

    #[test]
    fn short_passphrase_rejected_before_touching_files() {
        let db = scratch_db("short");
        fs::write(&db, b"data").unwrap();
        assert!(lock_database(&db, "short").is_err());
        assert!(db.exists());
        assert!(!vault_exists(&db));
    }
}
