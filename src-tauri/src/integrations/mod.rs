//! Opt-in integration adapters. All connectors are off until the user enables them.
//!
//! Privacy rules (see docs/privacy/policy.md):
//! - Only approved, tagged (client/project) session summaries leave the device
//! - Disconnect clears tokens and sync metadata
//! - Local API binds to 127.0.0.1 only

mod clickup;
mod local_api;
mod webhook;

use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::store::{ExportEntry, IntegrationRow, Store, StoreError};

pub use local_api::LocalApiHandle;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PushResult {
    pub session_id: i64,
    pub ok: bool,
    pub remote_id: Option<String>,
    pub detail: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PushBatchResult {
    pub integration_kind: String,
    pub results: Vec<PushResult>,
}

pub fn redact_config(kind: &str, config_json: &str) -> String {
    let Ok(mut v) = serde_json::from_str::<serde_json::Value>(config_json) else {
        return "{}".into();
    };
    if let Some(obj) = v.as_object_mut() {
        for key in ["api_token", "token", "secret", "bearer"] {
            if let Some(val) = obj.get(key).and_then(|x| x.as_str()) {
                if !val.is_empty() {
                    obj.insert(key.to_string(), json!("••••••••"));
                }
            }
        }
        if kind == "local_api" {
            // keep port visible; token redacted above
        }
    }
    v.to_string()
}

pub fn list_for_ui(store: &Store) -> Result<Vec<IntegrationRow>, StoreError> {
    let mut rows = store.list_integrations()?;
    for row in &mut rows {
        row.config_json = redact_config(&row.kind, &row.config_json);
    }
    Ok(rows)
}

/// Merge UI config with existing secrets when the UI sends redacted placeholders.
pub fn merge_config(kind: &str, existing: &str, incoming: &str) -> Result<String, StoreError> {
    let mut base: serde_json::Value = serde_json::from_str(existing).unwrap_or(json!({}));
    let next: serde_json::Value = serde_json::from_str(incoming)
        .map_err(|e| StoreError::Msg(format!("invalid config: {e}")))?;
    if let (Some(b), Some(n)) = (base.as_object_mut(), next.as_object()) {
        for (k, v) in n {
            if matches!(k.as_str(), "api_token" | "token" | "secret" | "bearer") {
                if let Some(s) = v.as_str() {
                    if s.contains('•') || s.is_empty() {
                        continue; // keep existing secret
                    }
                }
            }
            b.insert(k.clone(), v.clone());
        }
        if kind == "local_api" && !b.contains_key("port") {
            b.insert("port".into(), json!(17890));
        }
    }
    Ok(base.to_string())
}

pub fn push_integration(
    store: &Store,
    kind: &str,
    session_ids: Option<Vec<i64>>,
) -> Result<PushBatchResult, String> {
    let row = store
        .get_integration_by_kind(kind)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("unknown integration: {kind}"))?;
    if !row.enabled {
        return Err(format!("{kind} is disabled — enable it in Integrations first"));
    }

    let entries = if let Some(ids) = session_ids {
        let mut out = Vec::new();
        for id in ids {
            if let Some(e) = store.export_entry_by_id(id).map_err(|e| e.to_string())? {
                out.push(e);
            } else {
                return Err(format!(
                    "session {id} is not eligible (need approved + tagged + ended)"
                ));
            }
        }
        out
    } else {
        store
            .eligible_export_entries(Some(row.id))
            .map_err(|e| e.to_string())?
    };

    let mut results = Vec::new();
    for entry in entries {
        let outcome = match kind {
            "clickup" => clickup::push_entry(store, &row, &entry),
            "webhook" => webhook::push_entry(&row, &entry),
            "local_api" => Err(
                "local_api does not push outbound — clients pull from localhost".into(),
            ),
            other => Err(format!("unsupported kind: {other}")),
        };

        match outcome {
            Ok(remote_id) => {
                let _ = store.record_sync(
                    row.id,
                    entry.session_id,
                    "ok",
                    remote_id.as_deref(),
                    None,
                );
                results.push(PushResult {
                    session_id: entry.session_id,
                    ok: true,
                    remote_id,
                    detail: "synced".into(),
                });
            }
            Err(e) => {
                let _ = store.record_sync(row.id, entry.session_id, "error", None, Some(&e));
                results.push(PushResult {
                    session_id: entry.session_id,
                    ok: false,
                    remote_id: None,
                    detail: e,
                });
            }
        }
    }

    Ok(PushBatchResult {
        integration_kind: kind.to_string(),
        results,
    })
}

pub fn entry_json(entry: &ExportEntry) -> serde_json::Value {
    json!({
        "session_id": entry.session_id,
        "started_at": entry.started_at,
        "ended_at": entry.ended_at,
        "duration_mins": entry.duration_mins,
        "client": entry.client_name,
        "project": entry.project_name,
        "task": entry.task_name,
        "description": entry.description,
        "notes": entry.notes,
    })
}
