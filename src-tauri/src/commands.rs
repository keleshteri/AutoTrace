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
