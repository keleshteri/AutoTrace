//! Outbound webhook for approved time-entry summaries.

use sha2::{Digest, Sha256};

const SHA256_BLOCK: usize = 64;

use crate::integrations::entry_json;
use crate::store::{ExportEntry, IntegrationRow};

#[derive(Debug, serde::Deserialize)]
struct WebhookConfig {
    #[serde(default)]
    url: String,
    #[serde(default)]
    secret: String,
}

pub fn push_entry(row: &IntegrationRow, entry: &ExportEntry) -> Result<Option<String>, String> {
    let cfg: WebhookConfig =
        serde_json::from_str(&row.config_json).map_err(|e| format!("webhook config: {e}"))?;
    if cfg.url.is_empty() {
        return Err("Webhook URL required".into());
    }
    if !(cfg.url.starts_with("https://") || cfg.url.starts_with("http://127.0.0.1") || cfg.url.starts_with("http://localhost")) {
        return Err("Webhook URL must be https:// (or http://localhost for testing)".into());
    }

    let payload = entry_json(entry);
    let body = serde_json::to_string(&payload).map_err(|e| e.to_string())?;

    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())?;

    let mut req = client
        .post(&cfg.url)
        .header("Content-Type", "application/json")
        .header("User-Agent", "AutoTrace/0.1")
        .body(body.clone());

    if !cfg.secret.is_empty() && !cfg.secret.contains('•') {
        let sig = hex::encode(hmac_sha256(cfg.secret.as_bytes(), body.as_bytes()));
        // Receivers verify with HMAC-SHA256(secret, raw_body), GitHub-style.
        req = req.header("X-AutoTrace-Signature-256", format!("sha256={sig}"));
    }

    let resp = req.send().map_err(|e| format!("webhook request failed: {e}"))?;
    let status = resp.status();
    if !status.is_success() {
        let text = resp.text().unwrap_or_default();
        return Err(format!("webhook HTTP {status}: {text}"));
    }
    Ok(Some(format!("http:{status}")))
}

/// HMAC-SHA256 (RFC 2104). Replaces the old `sha256(secret || body)`, which is
/// open to length-extension forgery.
pub(crate) fn hmac_sha256(key: &[u8], msg: &[u8]) -> [u8; 32] {
    let mut block = [0u8; SHA256_BLOCK];
    if key.len() > SHA256_BLOCK {
        let digest = Sha256::digest(key);
        block[..32].copy_from_slice(digest.as_slice());
    } else {
        block[..key.len()].copy_from_slice(key);
    }

    let mut ipad = [0x36u8; SHA256_BLOCK];
    let mut opad = [0x5cu8; SHA256_BLOCK];
    for i in 0..SHA256_BLOCK {
        ipad[i] ^= block[i];
        opad[i] ^= block[i];
    }

    let mut inner = Sha256::new();
    inner.update(ipad);
    inner.update(msg);
    let inner = inner.finalize();

    let mut outer = Sha256::new();
    outer.update(opad);
    outer.update(inner.as_slice());
    let mut out = [0u8; 32];
    out.copy_from_slice(outer.finalize().as_slice());
    out
}

#[cfg(test)]
mod tests {
    use super::hmac_sha256;

    // RFC 4231 test cases 1, 2 and 6 (key longer than the block size).
    #[test]
    fn hmac_sha256_matches_rfc4231() {
        assert_eq!(
            hex::encode(hmac_sha256(&[0x0b; 20], b"Hi There")),
            "b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7"
        );
        assert_eq!(
            hex::encode(hmac_sha256(b"Jefe", b"what do ya want for nothing?")),
            "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843"
        );
        assert_eq!(
            hex::encode(hmac_sha256(
                &[0xaa; 131],
                b"Test Using Larger Than Block-Size Key - Hash Key First"
            )),
            "60e431591ee0b67f0d8a26aacbf5b77f8e0bc6213728c5140546040f0ee37f54"
        );
    }
}
