//! Encrypt API keys at rest with a device-local key derived from the DB path.

use std::path::Path;

use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce};
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use rand::rngs::OsRng;
use rand::RngCore;
use sha2::{Digest, Sha256};

fn device_key(db_path: &Path) -> [u8; 32] {
    let mut h = Sha256::new();
    h.update(b"autotrace-ai-key-v1");
    h.update(db_path.to_string_lossy().as_bytes());
    let out = h.finalize();
    let mut key = [0u8; 32];
    key.copy_from_slice(&out);
    key
}

pub fn encrypt_secret(db_path: &Path, plaintext: &str) -> Result<String, String> {
    if plaintext.is_empty() {
        return Ok(String::new());
    }
    let key = device_key(db_path);
    let cipher = Aes256Gcm::new_from_slice(&key).map_err(|e| e.to_string())?;
    let mut nonce_bytes = [0u8; 12];
    OsRng.fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);
    let ct = cipher
        .encrypt(nonce, plaintext.as_bytes())
        .map_err(|e| e.to_string())?;
    let mut out = Vec::with_capacity(12 + ct.len());
    out.extend_from_slice(&nonce_bytes);
    out.extend_from_slice(&ct);
    Ok(B64.encode(out))
}

pub fn decrypt_secret(db_path: &Path, encoded: &str) -> Result<String, String> {
    if encoded.is_empty() {
        return Ok(String::new());
    }
    let raw = B64.decode(encoded).map_err(|e| e.to_string())?;
    if raw.len() < 13 {
        return Err("corrupt ai secret".into());
    }
    let (nonce_bytes, ct) = raw.split_at(12);
    let key = device_key(db_path);
    let cipher = Aes256Gcm::new_from_slice(&key).map_err(|e| e.to_string())?;
    let nonce = Nonce::from_slice(nonce_bytes);
    let pt = cipher
        .decrypt(nonce, ct)
        .map_err(|_| "failed to decrypt ai secret".to_string())?;
    String::from_utf8(pt).map_err(|e| e.to_string())
}
