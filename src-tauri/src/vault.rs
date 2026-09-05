//! Opt-in local database encryption (AES-256-GCM + Argon2id).
//! Encrypts a sidecar vault of the SQLite file while the app is locked.

use std::fs;
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

fn vault_path(db: &Path) -> PathBuf {
    db.with_extension("db.vault")
}

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

/// Encrypt plaintext DB → `.db.vault` and optionally remove plaintext.
pub fn lock_database(db_path: &Path, passphrase: &str, remove_plaintext: bool) -> Result<()> {
    if passphrase.len() < 8 {
        return Err(VaultError::Msg("passphrase must be at least 8 characters".into()));
    }
    let plain = fs::read(db_path)?;
    let mut salt = [0u8; 16];
    OsRng.fill_bytes(&mut salt);
    let key = key_from_passphrase(passphrase, &salt)?;
    let cipher = Aes256Gcm::new_from_slice(&key).map_err(|e| VaultError::Crypto(e.to_string()))?;
    let mut nonce_bytes = [0u8; 12];
    OsRng.fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);
    let ciphertext = cipher
        .encrypt(nonce, plain.as_ref())
        .map_err(|e| VaultError::Crypto(e.to_string()))?;

    let mut out = Vec::with_capacity(4 + 16 + 12 + ciphertext.len());
    out.extend_from_slice(b"ATV1");
    out.extend_from_slice(&salt);
    out.extend_from_slice(&nonce_bytes);
    out.extend_from_slice(&ciphertext);
    fs::write(vault_path(db_path), out)?;
    if remove_plaintext {
        let _ = fs::remove_file(db_path);
        let wal = format!("{}-wal", db_path.display());
        let shm = format!("{}-shm", db_path.display());
        let _ = fs::remove_file(&wal);
        let _ = fs::remove_file(&shm);
    }
    Ok(())
}

/// Decrypt `.db.vault` → plaintext DB path.
pub fn unlock_database(db_path: &Path, passphrase: &str) -> Result<()> {
    let vault = vault_path(db_path);
    if !vault.exists() {
        return Err(VaultError::Msg("no vault file found".into()));
    }
    let data = fs::read(&vault)?;
    if data.len() < 4 + 16 + 12 + 16 || &data[0..4] != b"ATV1" {
        return Err(VaultError::Msg("invalid vault format".into()));
    }
    let salt = &data[4..20];
    let nonce_bytes = &data[20..32];
    let ciphertext = &data[32..];
    let key = key_from_passphrase(passphrase, salt)?;
    let cipher = Aes256Gcm::new_from_slice(&key).map_err(|e| VaultError::Crypto(e.to_string()))?;
    let nonce = Nonce::from_slice(nonce_bytes);
    let plain = cipher
        .decrypt(nonce, ciphertext)
        .map_err(|_| VaultError::Msg("wrong passphrase or corrupt vault".into()))?;
    fs::write(db_path, plain)?;
    Ok(())
}

pub fn vault_exists(db_path: &Path) -> bool {
    vault_path(db_path).exists()
}
