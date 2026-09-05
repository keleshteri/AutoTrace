//! Outbound webhook for approved time-entry summaries.

use sha2::{Digest, Sha256};

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
        let mut hasher = Sha256::new();
        hasher.update(cfg.secret.as_bytes());
        hasher.update(body.as_bytes());
        let sig = hex::encode(hasher.finalize());
        req = req.header("X-AutoTrace-Signature", format!("sha256={sig}"));
    }

    let resp = req.send().map_err(|e| format!("webhook request failed: {e}"))?;
    let status = resp.status();
    if !status.is_success() {
        let text = resp.text().unwrap_or_default();
        return Err(format!("webhook HTTP {status}: {text}"));
    }
    Ok(Some(format!("http:{status}")))
}
