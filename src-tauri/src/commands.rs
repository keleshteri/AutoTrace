//! Tauri IPC commands exposed to the React UI.

use std::sync::Arc;

use tauri::{AppHandle, Manager, State};
use tauri_plugin_autostart::ManagerExt;

use crate::store::{
    AppRow, AppState, Client, DayReport, Hierarchy, Project, Rule, SessionRow, Store, Task,
    TrackerSettings,
};
use crate::tracker::TrackerHandle;

#[derive(serde::Serialize)]
pub struct AppStatus {
    pub name: &'static str,
    pub version: &'static str,
    pub db_path: String,
    pub schema_version: i64,
    pub tracker: crate::tracker::TrackerInfo,
    pub network_enabled: bool,
    pub settings: TrackerSettings,
}

#[tauri::command]
pub fn get_app_status(state: State<'_, AppState>) -> Result<AppStatus, String> {
    let schema_version = state.store.schema_version().map_err(|e| e.to_string())?;
    let settings = state
        .store
        .tracker_settings()
        .map_err(|e| e.to_string())?;

    Ok(AppStatus {
        name: "AutoTrace",
        version: env!("CARGO_PKG_VERSION"),
        db_path: state.store.path().display().to_string(),
        schema_version,
        tracker: state.tracker.info(),
        network_enabled: state
            .store
            .any_integration_enabled()
            .unwrap_or(false),
        settings,
    })
}

#[tauri::command]
pub fn get_db_path(state: State<'_, AppState>) -> String {
    state.store.path().display().to_string()
}

#[tauri::command]
pub fn pause_tracking(state: State<'_, AppState>) -> Result<(), String> {
    state.tracker.pause();
    Ok(())
}

#[tauri::command]
pub fn resume_tracking(state: State<'_, AppState>) -> Result<(), String> {
    state.tracker.resume();
    Ok(())
}

#[tauri::command]
pub fn list_sessions_for_day(
    state: State<'_, AppState>,
    day: String,
) -> Result<Vec<SessionRow>, String> {
    state
        .store
        .sessions_for_day(&day)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_hierarchy(state: State<'_, AppState>) -> Result<Hierarchy, String> {
    state.store.hierarchy().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_client(
    state: State<'_, AppState>,
    name: String,
    color: Option<String>,
) -> Result<Client, String> {
    state
        .store
        .create_client(&name, color.as_deref())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_project(
    state: State<'_, AppState>,
    client_id: i64,
    name: String,
    color: Option<String>,
) -> Result<Project, String> {
    state
        .store
        .create_project(client_id, &name, color.as_deref())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_task(
    state: State<'_, AppState>,
    project_id: i64,
    name: String,
) -> Result<Task, String> {
    state
        .store
        .create_task(project_id, &name)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn tag_session(
    state: State<'_, AppState>,
    session_id: i64,
    client_id: Option<i64>,
    project_id: Option<i64>,
    task_id: Option<i64>,
) -> Result<(), String> {
    state
        .store
        .tag_session(session_id, client_id, project_id, task_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_rules(state: State<'_, AppState>) -> Result<Vec<Rule>, String> {
    state.store.list_rules().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_rule(
    state: State<'_, AppState>,
    name: String,
    pattern: String,
    match_field: String,
    client_id: Option<i64>,
    project_id: Option<i64>,
    task_id: Option<i64>,
    priority: i64,
    action: Option<String>,
) -> Result<Rule, String> {
    state
        .store
        .create_rule(
            &name,
            &pattern,
            &match_field,
            client_id,
            project_id,
            task_id,
            priority,
            action.as_deref().unwrap_or("tag"),
        )
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_rule(state: State<'_, AppState>, id: i64) -> Result<(), String> {
    state.store.delete_rule(id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_rule_enabled(
    state: State<'_, AppState>,
    id: i64,
    enabled: bool,
) -> Result<(), String> {
    state
        .store
        .set_rule_enabled(id, enabled)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_apps(state: State<'_, AppState>) -> Result<Vec<AppRow>, String> {
    state.store.list_apps().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_app_excluded(
    state: State<'_, AppState>,
    app_id: i64,
    excluded: bool,
) -> Result<(), String> {
    state
        .store
        .set_app_excluded(app_id, excluded)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_tracker_settings(state: State<'_, AppState>) -> Result<TrackerSettings, String> {
    state.store.tracker_settings().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_tracker_settings(
    app: AppHandle,
    state: State<'_, AppState>,
    settings: TrackerSettings,
) -> Result<(), String> {
    state
        .store
        .update_tracker_settings(&settings)
        .map_err(|e| e.to_string())?;

    // Best-effort autostart sync (desktop only).
    let autostart = app.autolaunch();
    let _ = if settings.launch_at_login {
        autostart.enable()
    } else {
        autostart.disable()
    };

    Ok(())
}

#[tauri::command]
pub fn delete_sessions_range(
    state: State<'_, AppState>,
    start: String,
    end: String,
) -> Result<i64, String> {
    state
        .store
        .delete_sessions_in_range(&start, &end)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_manual_session(
    state: State<'_, AppState>,
    title: String,
    started_at: String,
    ended_at: String,
    client_id: Option<i64>,
    project_id: Option<i64>,
    task_id: Option<i64>,
    notes: Option<String>,
) -> Result<i64, String> {
    state
        .store
        .create_manual_session(
            &title,
            &started_at,
            &ended_at,
            client_id,
            project_id,
            task_id,
            notes.as_deref(),
            None,
        )
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn approve_session(
    state: State<'_, AppState>,
    session_id: i64,
    approved: bool,
) -> Result<(), String> {
    state
        .store
        .approve_session(session_id, approved)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_session(
    state: State<'_, AppState>,
    session_id: i64,
    title: Option<String>,
    started_at: String,
    ended_at: Option<String>,
    notes: Option<String>,
    client_id: Option<i64>,
    project_id: Option<i64>,
    task_id: Option<i64>,
    category: Option<String>,
) -> Result<(), String> {
    state
        .store
        .update_session(
            session_id,
            title.as_deref(),
            &started_at,
            ended_at.as_deref(),
            notes.as_deref(),
            client_id,
            project_id,
            task_id,
            category.as_deref(),
        )
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_session(state: State<'_, AppState>, session_id: i64) -> Result<(), String> {
    state
        .store
        .delete_session(session_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn merge_sessions(state: State<'_, AppState>, ids: Vec<i64>) -> Result<i64, String> {
    state.store.merge_sessions(&ids).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn split_session(
    state: State<'_, AppState>,
    session_id: i64,
    at: String,
) -> Result<i64, String> {
    state
        .store
        .split_session(session_id, &at)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_pending_sessions(state: State<'_, AppState>) -> Result<Vec<SessionRow>, String> {
    state
        .store
        .list_pending_sessions()
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn reject_pending_session(
    state: State<'_, AppState>,
    session_id: i64,
) -> Result<(), String> {
    state
        .store
        .reject_pending_session(session_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_focus_digest(
    state: State<'_, AppState>,
    day: String,
) -> Result<crate::store::FocusDigest, String> {
    state
        .store
        .focus_digest_for_day(&day)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_weekly_digest(
    state: State<'_, AppState>,
    week_start: String,
) -> Result<crate::store::WeeklyDigest, String> {
    state
        .store
        .weekly_digest(&week_start)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_calendar_events(
    state: State<'_, AppState>,
    day: String,
) -> Result<Vec<crate::store::CalendarEvent>, String> {
    state
        .store
        .list_calendar_events(&day)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn import_ics(state: State<'_, AppState>, ics: String) -> Result<i64, String> {
    state.store.import_ics(&ics).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn suggest_from_calendar(
    state: State<'_, AppState>,
    day: String,
) -> Result<i64, String> {
    state
        .store
        .suggest_sessions_from_calendar(&day)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_day_report(state: State<'_, AppState>, day: String) -> Result<DayReport, String> {
    state.store.day_report(&day).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn export_csv_for_day(state: State<'_, AppState>, day: String) -> Result<String, String> {
    state
        .store
        .export_csv_for_day(&day)
        .map_err(|e| e.to_string())
}

/// Initialize store + tracker once the Tauri app handle is available.
pub fn init_state(app: &AppHandle) -> Result<AppState, String> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("resolve app data dir: {e}"))?;

    let db_path = Store::default_db_path(&app_data);
    let store = Arc::new(Store::open(&db_path).map_err(|e| e.to_string())?);
    let tracker = Arc::new(TrackerHandle::start(Arc::clone(&store)));
    let local_api = Arc::new(crate::integrations::LocalApiHandle::new(Arc::clone(&store)));

    Ok(AppState {
        store,
        tracker,
        local_api,
    })
}

#[tauri::command]
pub fn list_integrations(
    state: State<'_, AppState>,
) -> Result<Vec<crate::store::IntegrationRow>, String> {
    crate::integrations::list_for_ui(&state.store).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_integration(
    state: State<'_, AppState>,
    kind: String,
    enabled: bool,
    config_json: String,
) -> Result<crate::store::IntegrationRow, String> {
    let existing = state
        .store
        .get_integration_by_kind(&kind)
        .map_err(|e| e.to_string())?
        .map(|r| r.config_json)
        .unwrap_or_else(|| "{}".into());
    let merged = crate::integrations::merge_config(&kind, &existing, &config_json)
        .map_err(|e| e.to_string())?;
    let row = state
        .store
        .update_integration(&kind, enabled, &merged)
        .map_err(|e| e.to_string())?;
    if kind == "local_api" {
        state.local_api.reconcile();
    }
    let mut redacted = row;
    redacted.config_json = crate::integrations::redact_config(&kind, &redacted.config_json);
    Ok(redacted)
}

#[tauri::command]
pub fn disconnect_integration(state: State<'_, AppState>, kind: String) -> Result<(), String> {
    state
        .store
        .disconnect_integration(&kind)
        .map_err(|e| e.to_string())?;
    if kind == "local_api" {
        state.local_api.reconcile();
    }
    Ok(())
}

#[tauri::command]
pub fn list_eligible_exports(
    state: State<'_, AppState>,
    integration_kind: Option<String>,
) -> Result<Vec<crate::store::ExportEntry>, String> {
    let iid = if let Some(kind) = integration_kind {
        state
            .store
            .get_integration_by_kind(&kind)
            .map_err(|e| e.to_string())?
            .map(|r| r.id)
    } else {
        None
    };
    state
        .store
        .eligible_export_entries(iid)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn push_integration(
    state: State<'_, AppState>,
    kind: String,
    session_ids: Option<Vec<i64>>,
) -> Result<crate::integrations::PushBatchResult, String> {
    crate::integrations::push_integration(&state.store, &kind, session_ids)
}

#[tauri::command]
pub fn list_sync_log(
    state: State<'_, AppState>,
    kind: Option<String>,
) -> Result<Vec<crate::store::SyncLogRow>, String> {
    let iid = if let Some(kind) = kind {
        state
            .store
            .get_integration_by_kind(&kind)
            .map_err(|e| e.to_string())?
            .map(|r| r.id)
    } else {
        None
    };
    state.store.list_sync_log(iid).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_integration_mapping(
    state: State<'_, AppState>,
    kind: String,
    local_type: String,
    local_id: i64,
    remote_id: String,
) -> Result<(), String> {
    let row = state
        .store
        .get_integration_by_kind(&kind)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("unknown integration {kind}"))?;
    state
        .store
        .set_mapping(row.id, &local_type, local_id, &remote_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn local_api_status(state: State<'_, AppState>) -> Result<String, String> {
    Ok(state.local_api.status_message())
}

#[tauri::command]
pub fn get_active_focus(
    state: State<'_, AppState>,
) -> Result<Option<crate::store::FocusSession>, String> {
    state.store.get_active_focus().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn start_focus(
    state: State<'_, AppState>,
    goal: Option<String>,
    client_id: Option<i64>,
    project_id: Option<i64>,
    task_id: Option<i64>,
) -> Result<crate::store::FocusSession, String> {
    state
        .store
        .start_focus(goal.as_deref(), client_id, project_id, task_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn end_focus(
    state: State<'_, AppState>,
) -> Result<Option<crate::store::FocusSession>, String> {
    state.store.end_focus().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_focus_for_day(
    state: State<'_, AppState>,
    day: String,
) -> Result<Vec<crate::store::FocusSession>, String> {
    state
        .store
        .list_focus_for_day(&day)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_activity_events(
    state: State<'_, AppState>,
    day: String,
    query: Option<String>,
    limit: Option<i64>,
) -> Result<Vec<crate::store::ActivityEvent>, String> {
    state
        .store
        .list_activity_events(&day, query.as_deref(), limit.unwrap_or(500))
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_activity_events_in_range(
    state: State<'_, AppState>,
    started_at: String,
    ended_at: String,
    limit: Option<i64>,
) -> Result<Vec<crate::store::ActivityEvent>, String> {
    state
        .store
        .list_activity_events_in_range(&started_at, &ended_at, limit.unwrap_or(500))
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_activity_event(state: State<'_, AppState>, id: i64) -> Result<(), String> {
    state
        .store
        .delete_activity_event(id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn activity_app_breakdown(
    state: State<'_, AppState>,
    day: String,
) -> Result<Vec<crate::store::AppUsageBucket>, String> {
    state
        .store
        .activity_app_breakdown(&day)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn redact_activity_metadata(state: State<'_, AppState>) -> Result<i64, String> {
    state
        .store
        .redact_activity_metadata()
        .map_err(|e| e.to_string())
}

// —— Phase 4+ ——

#[tauri::command]
pub fn set_client_rate(
    state: State<'_, AppState>,
    client_id: i64,
    hourly_rate: Option<f64>,
) -> Result<(), String> {
    state
        .store
        .set_client_rate(client_id, hourly_rate)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_project_rate(
    state: State<'_, AppState>,
    project_id: i64,
    hourly_rate: Option<f64>,
    budget_hours: Option<f64>,
) -> Result<(), String> {
    state
        .store
        .set_project_rate(project_id, hourly_rate, budget_hours)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_session_billable(
    state: State<'_, AppState>,
    session_id: i64,
    billable: bool,
) -> Result<(), String> {
    state
        .store
        .set_session_billable(session_id, billable)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_profitability_report(
    state: State<'_, AppState>,
    from_day: String,
    to_day: String,
) -> Result<crate::store::ProfitabilityReport, String> {
    state
        .store
        .profitability_report(&from_day, &to_day)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn export_client_pdf_html(
    state: State<'_, AppState>,
    client_id: i64,
    from_day: String,
    to_day: String,
) -> Result<String, String> {
    state
        .store
        .client_pdf_html(client_id, &from_day, &to_day)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_workspaces(state: State<'_, AppState>) -> Result<Vec<crate::store::Workspace>, String> {
    state.store.list_workspaces().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_workspace(state: State<'_, AppState>, name: String) -> Result<crate::store::Workspace, String> {
    state.store.create_workspace(&name).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_active_workspace(state: State<'_, AppState>, id: i64) -> Result<(), String> {
    state.store.set_active_workspace(id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_workspace_sync(
    state: State<'_, AppState>,
    id: i64,
    sync_url: Option<String>,
    sync_token: Option<String>,
) -> Result<(), String> {
    state
        .store
        .set_workspace_sync(id, sync_url.as_deref(), sync_token.as_deref())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn export_sync_pack(state: State<'_, AppState>) -> Result<String, String> {
    state.store.export_sync_pack().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn push_sync_pack(state: State<'_, AppState>, workspace_id: i64) -> Result<String, String> {
    let pack = state.store.export_sync_pack().map_err(|e| e.to_string())?;
    let spaces = state.store.list_workspaces().map_err(|e| e.to_string())?;
    let ws = spaces
        .into_iter()
        .find(|w| w.id == workspace_id)
        .ok_or_else(|| "workspace not found".to_string())?;
    let url = ws
        .sync_url
        .filter(|u| !u.is_empty())
        .ok_or_else(|| "set a sync URL on the workspace first".to_string())?;
    let token = state
        .store
        .list_workspaces()
        .ok()
        .and_then(|_| None::<String>);
    let _ = token;
    let client = reqwest::blocking::Client::new();
    let resp = client
        .post(format!("{}/v1/sync", url.trim_end_matches('/')))
        .header("Content-Type", "application/json")
        .body(pack.clone())
        .send()
        .map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("sync failed: HTTP {}", resp.status()));
    }
    Ok(resp.text().unwrap_or_else(|_| "ok".into()))
}

#[tauri::command]
pub fn list_block_rules(state: State<'_, AppState>) -> Result<Vec<crate::store::BlockRule>, String> {
    state.store.list_block_rules().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_block_rule(
    state: State<'_, AppState>,
    pattern: String,
    match_field: String,
    mode: String,
) -> Result<crate::store::BlockRule, String> {
    state
        .store
        .create_block_rule(&pattern, &match_field, &mode)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_block_rule(state: State<'_, AppState>, id: i64) -> Result<(), String> {
    state.store.delete_block_rule(id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_feature_flag(state: State<'_, AppState>, key: String, value: String) -> Result<(), String> {
    state.store.set_setting(&key, &value).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_feature_flag(state: State<'_, AppState>, key: String) -> Result<Option<String>, String> {
    state.store.get_setting(&key).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn lock_database(state: State<'_, AppState>, passphrase: String) -> Result<(), String> {
    let path = state.store.path().to_path_buf();
    crate::vault::lock_database(&path, &passphrase, false).map_err(|e| e.to_string())?;
    state
        .store
        .set_setting("db_encryption", "1")
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn unlock_database(state: State<'_, AppState>, passphrase: String) -> Result<(), String> {
    let path = state.store.path().to_path_buf();
    crate::vault::unlock_database(&path, &passphrase).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn vault_status(state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    let path = state.store.path().to_path_buf();
    Ok(serde_json::json!({
        "vault_exists": crate::vault::vault_exists(&path),
        "db_encryption": state.store.get_setting("db_encryption").ok().flatten(),
    }))
}

#[tauri::command]
pub fn oauth_authorize_url(provider: String, client_id: String, redirect_uri: String) -> Result<String, String> {
    let scope = match provider.as_str() {
        "clickup" => return Ok(format!(
            "https://app.clickup.com/api?client_id={}&redirect_uri={}",
            urlencoding::encode(&client_id),
            urlencoding::encode(&redirect_uri)
        )),
        "google" => "https://www.googleapis.com/auth/calendar.readonly",
        "outlook" => "https://graph.microsoft.com/Calendars.Read",
        _ => return Err("unknown provider".into()),
    };
    let base = match provider.as_str() {
        "google" => "https://accounts.google.com/o/oauth2/v2/auth",
        "outlook" => "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
        _ => return Err("unknown provider".into()),
    };
    Ok(format!(
        "{base}?client_id={}&redirect_uri={}&response_type=code&scope={}&access_type=offline&prompt=consent",
        urlencoding::encode(&client_id),
        urlencoding::encode(&redirect_uri),
        urlencoding::encode(scope),
    ))
}

#[tauri::command]
pub fn oauth_exchange_code(
    state: State<'_, AppState>,
    provider: String,
    client_id: String,
    client_secret: String,
    redirect_uri: String,
    code: String,
) -> Result<String, String> {
    let (token_url, form) = match provider.as_str() {
        "clickup" => (
            "https://api.clickup.com/api/v2/oauth/token".to_string(),
            format!(
                "client_id={}&client_secret={}&code={}",
                urlencoding::encode(&client_id),
                urlencoding::encode(&client_secret),
                urlencoding::encode(&code)
            ),
        ),
        "google" => (
            "https://oauth2.googleapis.com/token".to_string(),
            format!(
                "client_id={}&client_secret={}&code={}&redirect_uri={}&grant_type=authorization_code",
                urlencoding::encode(&client_id),
                urlencoding::encode(&client_secret),
                urlencoding::encode(&code),
                urlencoding::encode(&redirect_uri)
            ),
        ),
        "outlook" => (
            "https://login.microsoftonline.com/common/oauth2/v2.0/token".to_string(),
            format!(
                "client_id={}&client_secret={}&code={}&redirect_uri={}&grant_type=authorization_code",
                urlencoding::encode(&client_id),
                urlencoding::encode(&client_secret),
                urlencoding::encode(&code),
                urlencoding::encode(&redirect_uri)
            ),
        ),
        _ => return Err("unknown provider".into()),
    };
    let client = reqwest::blocking::Client::new();
    let resp = client
        .post(&token_url)
        .header("Content-Type", "application/x-www-form-urlencoded")
        .body(form)
        .send()
        .map_err(|e| e.to_string())?;
    let status = resp.status();
    let body = resp.text().map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(format!("token exchange failed ({status}): {body}"));
    }
    let v: serde_json::Value = serde_json::from_str(&body).map_err(|e| e.to_string())?;
    let access = v
        .get("access_token")
        .and_then(|t| t.as_str())
        .ok_or_else(|| "no access_token".to_string())?;
    let refresh = v.get("refresh_token").and_then(|t| t.as_str());
    state
        .store
        .upsert_oauth_token(&provider, access, refresh, None, None, &body)
        .map_err(|e| e.to_string())?;
    Ok(format!("connected:{provider}"))
}

#[tauri::command]
pub fn sync_google_calendar(state: State<'_, AppState>, day: String) -> Result<i64, String> {
    let Some((access, _, _)) = state
        .store
        .get_oauth_token("google")
        .map_err(|e| e.to_string())?
    else {
        return Err("connect Google OAuth first".into());
    };
    let time_min = format!("{day}T00:00:00Z");
    let time_max = format!("{day}T23:59:59Z");
    let url = format!(
        "https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin={}&timeMax={}&singleEvents=true",
        urlencoding::encode(&time_min),
        urlencoding::encode(&time_max)
    );
    let client = reqwest::blocking::Client::new();
    let resp = client
        .get(&url)
        .bearer_auth(&access)
        .send()
        .map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("Google Calendar error: {}", resp.status()));
    }
    let v: serde_json::Value = resp.json().map_err(|e| e.to_string())?;
    let mut n = 0i64;
    if let Some(items) = v.get("items").and_then(|i| i.as_array()) {
        for item in items {
            let title = item
                .get("summary")
                .and_then(|s| s.as_str())
                .unwrap_or("Meeting");
            let start = item
                .pointer("/start/dateTime")
                .or_else(|| item.pointer("/start/date"))
                .and_then(|s| s.as_str());
            let end = item
                .pointer("/end/dateTime")
                .or_else(|| item.pointer("/end/date"))
                .and_then(|s| s.as_str());
            if let (Some(s), Some(e)) = (start, end) {
                let started = s.chars().take(19).collect::<String>().replace('Z', "");
                let ended = e.chars().take(19).collect::<String>().replace('Z', "");
                let _ = state.store.insert_calendar_event(title, &started, &ended, "google");
                n += 1;
            }
        }
    }
    Ok(n)
}

#[tauri::command]
pub fn sync_outlook_calendar(state: State<'_, AppState>, day: String) -> Result<i64, String> {
    let Some((access, _, _)) = state
        .store
        .get_oauth_token("outlook")
        .map_err(|e| e.to_string())?
    else {
        return Err("connect Outlook OAuth first".into());
    };
    let url = format!(
        "https://graph.microsoft.com/v1.0/me/calendarview?startDateTime={day}T00:00:00&endDateTime={day}T23:59:59",
    );
    let client = reqwest::blocking::Client::new();
    let resp = client
        .get(&url)
        .bearer_auth(&access)
        .send()
        .map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("Outlook Calendar error: {}", resp.status()));
    }
    let v: serde_json::Value = resp.json().map_err(|e| e.to_string())?;
    let mut n = 0i64;
    if let Some(items) = v.get("value").and_then(|i| i.as_array()) {
        for item in items {
            let title = item
                .get("subject")
                .and_then(|s| s.as_str())
                .unwrap_or("Meeting");
            let start = item.pointer("/start/dateTime").and_then(|s| s.as_str());
            let end = item.pointer("/end/dateTime").and_then(|s| s.as_str());
            if let (Some(s), Some(e)) = (start, end) {
                let started = s.chars().take(19).collect::<String>();
                let ended = e.chars().take(19).collect::<String>();
                let _ = state.store.insert_calendar_event(title, &started, &ended, "outlook");
                n += 1;
            }
        }
    }
    Ok(n)
}
