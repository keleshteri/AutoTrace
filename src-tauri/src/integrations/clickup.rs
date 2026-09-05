//! ClickUp time-entry push (personal API token). Opt-in only.

use serde_json::json;

use crate::store::{ExportEntry, IntegrationRow, Store};

#[derive(Debug, serde::Deserialize)]
struct ClickUpConfig {
    #[serde(default)]
    api_token: String,
    #[serde(default)]
    team_id: String,
    /// When true, include notes in the ClickUp description (still never raw window titles).
    #[serde(default)]
    include_notes: bool,
}

pub fn push_entry(
    store: &Store,
    row: &IntegrationRow,
    entry: &ExportEntry,
) -> Result<Option<String>, String> {
    let cfg: ClickUpConfig =
        serde_json::from_str(&row.config_json).map_err(|e| format!("clickup config: {e}"))?;
    if cfg.api_token.is_empty() || cfg.api_token.contains('•') {
        return Err("ClickUp API token missing — paste a personal API token".into());
    }
    if cfg.team_id.is_empty() {
        return Err("ClickUp team_id required".into());
    }

    let start_ms = parse_to_millis(&entry.started_at)?;
    let end = entry
        .ended_at
        .as_deref()
        .ok_or_else(|| "session has no end time".to_string())?;
    let end_ms = parse_to_millis(end)?;
    let duration = (end_ms - start_ms).max(0);

    let mut description = format!("AutoTrace: {}", entry.description);
    if cfg.include_notes {
        if let Some(n) = entry.notes.as_deref() {
            if !n.is_empty() {
                description.push_str(" — ");
                description.push_str(n);
            }
        }
    }

    let mut body = json!({
        "description": description,
        "start": start_ms,
        "duration": duration,
        "billable": true,
    });

    // Optional mapped ClickUp task id
    if let Some(task_id) = entry.task_id {
        if let Ok(Some(remote)) = store.get_mapping(row.id, "task", task_id) {
            body["tid"] = json!(remote);
        }
    } else if let Some(project_id) = entry.project_id {
        if let Ok(Some(remote)) = store.get_mapping(row.id, "project", project_id) {
            // ClickUp time entries accept task id via tid; project mapping may store a task
            body["tid"] = json!(remote);
        }
    }

    let url = format!(
        "https://api.clickup.com/api/v2/team/{}/time_entries",
        cfg.team_id.trim()
    );
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())?;

    let resp = client
        .post(&url)
        .header("Authorization", cfg.api_token.trim())
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .map_err(|e| format!("ClickUp request failed: {e}"))?;

    let status = resp.status();
    let text = resp.text().unwrap_or_default();
    if !status.is_success() {
        return Err(format!("ClickUp HTTP {status}: {text}"));
    }

    let remote_id = serde_json::from_str::<serde_json::Value>(&text)
        .ok()
        .and_then(|v| {
            v.get("data")
                .and_then(|d| d.get("id"))
                .and_then(|id| id.as_str().map(|s| s.to_string()).or_else(|| {
                    id.as_i64().map(|n| n.to_string())
                }))
        });

    Ok(remote_id)
}

fn parse_to_millis(iso: &str) -> Result<i64, String> {
    let normalized = if iso.contains('T') {
        iso.to_string()
    } else {
        iso.replace(' ', "T")
    };
    // Accept with or without timezone; treat naive as local wall-clock → UTC millis approx via chrono Local
    if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(&normalized) {
        return Ok(dt.timestamp_millis());
    }
    if let Ok(ndt) = chrono::NaiveDateTime::parse_from_str(&normalized, "%Y-%m-%dT%H:%M:%S") {
        // Interpret as local
        let local = ndt
            .and_local_timezone(chrono::Local)
            .single()
            .ok_or_else(|| format!("ambiguous time: {iso}"))?;
        return Ok(local.timestamp_millis());
    }
    Err(format!("unparseable timestamp: {iso}"))
}
