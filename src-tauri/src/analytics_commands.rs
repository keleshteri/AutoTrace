//! IPC commands for Tracked Time, Dashboards, Reports, Routines, Meetings,
//! Capacity and @mention context.

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::store::analytics::{
    dashboard_templates, period_range, CapacityReport, Dashboard, DashboardTemplate, Meeting,
    Report, ReportRun, Routine, RoutineRun, Schedule,
};
use crate::store::query::{result_to_csv, QueryFilter, TimeQuery, TimeQueryResult};
use crate::store::{AppState, SessionRow};

fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

// Tracked Time

#[tauri::command]
pub fn run_time_query(state: State<'_, AppState>, query: TimeQuery) -> Result<TimeQueryResult, String> {
    state.store.run_time_query(&query).map_err(err)
}

#[tauri::command]
pub fn time_query_sessions(
    state: State<'_, AppState>,
    query: TimeQuery,
    row_key: Option<String>,
    col_key: Option<String>,
) -> Result<Vec<SessionRow>, String> {
    state
        .store
        .time_query_sessions(&query, row_key.as_deref(), col_key.as_deref())
        .map_err(err)
}

#[tauri::command]
pub fn export_time_query_csv(state: State<'_, AppState>, query: TimeQuery) -> Result<String, String> {
    let r = state.store.run_time_query(&query).map_err(err)?;
    Ok(result_to_csv(&r))
}

#[tauri::command]
pub fn resolve_period(period: String) -> (String, String) {
    period_range(&period, chrono::Local::now().date_naive())
}

// Dashboards

#[tauri::command]
pub fn list_dashboards(state: State<'_, AppState>) -> Result<Vec<Dashboard>, String> {
    state.store.list_dashboards().map_err(err)
}

#[tauri::command]
pub fn list_dashboard_templates() -> Vec<DashboardTemplate> {
    dashboard_templates()
}

#[tauri::command]
pub fn save_dashboard(
    state: State<'_, AppState>,
    id: Option<i64>,
    name: String,
    description: Option<String>,
    query: TimeQuery,
    period: String,
    pinned: Option<bool>,
) -> Result<Dashboard, String> {
    state
        .store
        .save_dashboard(id, &name, description.as_deref(), &query, &period, pinned.unwrap_or(true), None)
        .map_err(err)
}

#[tauri::command]
pub fn create_dashboard_from_template(state: State<'_, AppState>, slug: String) -> Result<Dashboard, String> {
    state.store.create_dashboard_from_template(&slug).map_err(err)
}

#[tauri::command]
pub fn set_dashboard_pinned(state: State<'_, AppState>, id: i64, pinned: bool) -> Result<(), String> {
    state.store.set_dashboard_pinned(id, pinned).map_err(err)
}

#[tauri::command]
pub fn delete_dashboard(state: State<'_, AppState>, id: i64) -> Result<(), String> {
    state.store.delete_dashboard(id).map_err(err)
}

// Reports

#[tauri::command]
pub fn list_reports(state: State<'_, AppState>) -> Result<Vec<Report>, String> {
    state.store.list_reports().map_err(err)
}

#[tauri::command]
pub fn save_report(
    state: State<'_, AppState>,
    id: Option<i64>,
    name: String,
    dashboard_id: Option<i64>,
    period: String,
    schedule: Schedule,
    ai_enabled: bool,
    enabled: Option<bool>,
) -> Result<Report, String> {
    state
        .store
        .save_report(id, &name, dashboard_id, &period, &schedule, ai_enabled, enabled.unwrap_or(true))
        .map_err(err)
}

#[tauri::command]
pub fn delete_report(state: State<'_, AppState>, id: i64) -> Result<(), String> {
    state.store.delete_report(id).map_err(err)
}

#[tauri::command]
pub async fn run_report(state: State<'_, AppState>, id: i64) -> Result<ReportRun, String> {
    let store = std::sync::Arc::clone(&state.store);
    tauri::async_runtime::spawn_blocking(move || crate::automation::run_report(&store, id, "manual"))
        .await
        .map_err(err)?
}

#[tauri::command]
pub fn list_report_runs(state: State<'_, AppState>, report_id: i64) -> Result<Vec<ReportRun>, String> {
    state.store.list_report_runs(report_id).map_err(err)
}

// Routines

#[tauri::command]
pub fn list_routines(state: State<'_, AppState>) -> Result<Vec<Routine>, String> {
    state.store.list_routines().map_err(err)
}

#[tauri::command]
pub fn save_routine(
    state: State<'_, AppState>,
    id: Option<i64>,
    name: String,
    schedule: Schedule,
    action_kind: String,
    action: serde_json::Value,
    enabled: Option<bool>,
) -> Result<Routine, String> {
    state
        .store
        .save_routine(id, &name, &schedule, &action_kind, &action, enabled.unwrap_or(true))
        .map_err(err)
}

#[tauri::command]
pub fn set_routine_enabled(state: State<'_, AppState>, id: i64, enabled: bool) -> Result<(), String> {
    state.store.set_routine_enabled(id, enabled).map_err(err)
}

#[tauri::command]
pub fn delete_routine(state: State<'_, AppState>, id: i64) -> Result<(), String> {
    state.store.delete_routine(id).map_err(err)
}

#[tauri::command]
pub async fn run_routine(state: State<'_, AppState>, id: i64) -> Result<RoutineRun, String> {
    let store = std::sync::Arc::clone(&state.store);
    tauri::async_runtime::spawn_blocking(move || crate::automation::run_routine(&store, id, "manual"))
        .await
        .map_err(err)?
}

#[tauri::command]
pub fn list_routine_runs(
    state: State<'_, AppState>,
    routine_id: Option<i64>,
    limit: Option<i64>,
) -> Result<Vec<RoutineRun>, String> {
    state
        .store
        .list_routine_runs(routine_id, limit.unwrap_or(50).clamp(1, 500))
        .map_err(err)
}

// Meetings

#[tauri::command]
pub fn list_meetings(state: State<'_, AppState>, from: String, to: String) -> Result<Vec<Meeting>, String> {
    state.store.sync_meetings_from_calendar(&from, &to).map_err(err)?;
    state.store.list_meetings(&from, &to).map_err(err)
}

#[tauri::command]
pub fn create_meeting(
    state: State<'_, AppState>,
    title: String,
    started_at: String,
    ended_at: String,
    attendees: Option<String>,
) -> Result<Meeting, String> {
    state
        .store
        .create_meeting(&title, &started_at, &ended_at, attendees.as_deref())
        .map_err(err)
}

#[tauri::command]
pub fn update_meeting(
    state: State<'_, AppState>,
    id: i64,
    attendance: Option<String>,
    client_id: Option<i64>,
    project_id: Option<i64>,
    attendees: Option<String>,
) -> Result<Meeting, String> {
    state
        .store
        .update_meeting(id, attendance.as_deref(), client_id, project_id, attendees.as_deref())
        .map_err(err)
}

#[tauri::command]
pub fn attach_meeting_transcript(state: State<'_, AppState>, id: i64, transcript: String) -> Result<Meeting, String> {
    state.store.attach_meeting_transcript(id, &transcript).map_err(err)
}

#[tauri::command]
pub async fn summarize_meeting(state: State<'_, AppState>, id: i64) -> Result<Meeting, String> {
    let store = std::sync::Arc::clone(&state.store);
    tauri::async_runtime::spawn_blocking(move || {
        let m = store.get_meeting(id).map_err(err)?.ok_or("meeting not found")?;
        let transcript = m.transcript.clone().filter(|t| !t.trim().is_empty()).ok_or("attach a transcript first")?;
        // Cap what leaves the machine.
        let clipped: String = transcript.chars().take(24_000).collect();
        let r = crate::ai::run_agent(
            &store,
            crate::ai::AgentRequest {
                agent: "meeting".into(),
                model: None,
                prompt: format!("Meeting \"{}\" transcript:\n{}", m.title, clipped),
                system: Some(
                    "Summarize this meeting transcript in markdown: 3-5 bullet summary, then 'Action items' list. Use only the transcript."
                        .into(),
                ),
                chat_id: None,
                template_slug: None,
                variables: None,
                day: Some(m.started_at.chars().take(10).collect()),
            },
        )?;
        store.set_meeting_summary(id, &r.text).map_err(err)?;
        store.get_meeting(id).map_err(err)?.ok_or_else(|| "meeting not found".to_string())
    })
    .await
    .map_err(err)?
}

#[tauri::command]
pub fn log_meeting_session(state: State<'_, AppState>, id: i64) -> Result<Meeting, String> {
    state.store.log_meeting_session(id).map_err(err)
}

#[tauri::command]
pub fn delete_meeting(state: State<'_, AppState>, id: i64) -> Result<(), String> {
    state.store.delete_meeting(id).map_err(err)
}

// Capacity

#[tauri::command]
pub fn capacity_report(state: State<'_, AppState>, from: String, to: String) -> Result<CapacityReport, String> {
    state.store.capacity_report(&from, &to).map_err(err)
}

// @mentions

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MentionItem {
    /// client | project | task | dashboard | app
    pub kind: String,
    pub id: String,
    pub label: String,
    pub sub: Option<String>,
}

#[tauri::command]
pub fn mention_search(state: State<'_, AppState>, q: String) -> Result<Vec<MentionItem>, String> {
    let needle = q.trim().to_lowercase();
    let hit = |s: &str| needle.is_empty() || s.to_lowercase().contains(&needle);
    let mut out = Vec::new();
    for d in state.store.list_dashboards().map_err(err)? {
        if hit(&d.name) {
            out.push(MentionItem { kind: "dashboard".into(), id: d.id.to_string(), label: d.name, sub: d.description });
        }
    }
    let h = state.store.hierarchy().map_err(err)?;
    for c in &h.clients {
        if hit(&c.name) {
            out.push(MentionItem { kind: "client".into(), id: c.id.to_string(), label: c.name.clone(), sub: None });
        }
        for p in &c.projects {
            if hit(&p.name) {
                out.push(MentionItem {
                    kind: "project".into(),
                    id: p.id.to_string(),
                    label: p.name.clone(),
                    sub: Some(c.name.clone()),
                });
            }
            for t in &p.tasks {
                if hit(&t.name) {
                    out.push(MentionItem {
                        kind: "task".into(),
                        id: t.id.to_string(),
                        label: t.name.clone(),
                        sub: Some(p.name.clone()),
                    });
                }
            }
        }
    }
    for a in state.store.list_apps().map_err(err)? {
        if !a.excluded && hit(&a.name) {
            out.push(MentionItem { kind: "app".into(), id: a.name.to_lowercase(), label: a.name, sub: None });
        }
    }
    out.truncate(40);
    Ok(out)
}

/// Build the exact JSON context the AI will see for the given mentions.
#[tauri::command]
pub fn mention_context(
    state: State<'_, AppState>,
    mentions: Vec<MentionItem>,
    period: Option<String>,
) -> Result<serde_json::Value, String> {
    let period = period.unwrap_or_else(|| "month".into());
    let (from, to) = period_range(&period, chrono::Local::now().date_naive());
    let mut items = Vec::new();
    for m in mentions.iter().take(8) {
        let q = if m.kind == "dashboard" {
            let id: i64 = m.id.parse().map_err(err)?;
            let d = state.store.get_dashboard(id).map_err(err)?.ok_or("dashboard not found")?;
            d.query
        } else {
            let (rows_by, cols_by) = match m.kind.as_str() {
                "client" => ("project", "week"),
                "project" => ("task", "week"),
                "task" => ("category", "week"),
                _ => ("domain", "week"),
            };
            TimeQuery {
                from: from.clone(),
                to: to.clone(),
                rows_by: rows_by.into(),
                cols_by: cols_by.into(),
                filters: vec![QueryFilter { dim: m.kind.clone(), values: vec![m.id.clone()] }],
                include_idle: false,
                compare_previous: true,
            }
        };
        let mut q = q;
        q.compare_previous = true;
        let r = state.store.run_time_query(&q).map_err(err)?;
        items.push(serde_json::json!({
            "mention": { "kind": m.kind, "label": m.label },
            "period": { "from": r.query.from, "to": r.query.to },
            "grouped_by": { "rows": r.query.rows_by, "cols": r.query.cols_by },
            "kpis": r.kpis,
            "previous_period_kpis": r.previous,
            "delta_pct": r.delta_pct,
            "rows": r.rows.iter().zip(r.row_totals.iter()).take(20)
                .map(|(row, t)| serde_json::json!({"label": row.label, "secs": t})).collect::<Vec<_>>(),
            "cols": r.cols.iter().zip(r.col_totals.iter())
                .map(|(c, t)| serde_json::json!({"label": c.label, "secs": t})).collect::<Vec<_>>(),
        }));
    }
    Ok(serde_json::json!({ "note": "Durations are seconds.", "mentions": items }))
}

/// Chat with mention context appended; history keeps the user's clean prompt.
#[tauri::command]
pub async fn run_ai_chat_with_context(
    state: State<'_, AppState>,
    prompt: String,
    context: serde_json::Value,
    chat_id: Option<i64>,
    model: Option<String>,
    day: Option<String>,
) -> Result<crate::store::AiRunResult, String> {
    let store = std::sync::Arc::clone(&state.store);
    tauri::async_runtime::spawn_blocking(move || {
        let r = crate::ai::run_agent(
            &store,
            crate::ai::AgentRequest {
                agent: "chat".into(),
                model,
                prompt: format!(
                    "{prompt}\n\nAutoTrace data for the @mentions above (JSON, use only this):\n{context}"
                ),
                system: None,
                chat_id: None,
                template_slug: None,
                variables: None,
                day,
            },
        )?;
        if let Some(cid) = chat_id {
            let _ = store.add_ai_message(cid, "user", &prompt);
            let _ = store.add_ai_message(cid, "assistant", &r.text);
        }
        Ok(r)
    })
    .await
    .map_err(err)?
}

// Focus

#[tauri::command]
pub fn focus_overview(
    state: State<'_, AppState>,
    day: String,
) -> Result<crate::store::analytics::FocusOverview, String> {
    state.store.focus_overview(&day).map_err(err)
}
