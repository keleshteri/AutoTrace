//! Tauri IPC commands exposed to the React UI.

use std::sync::Arc;

use tauri::{AppHandle, Manager, State};

use crate::store::{AppState, Client, Hierarchy, Project, SessionRow, Store, Task};
use crate::tracker::TrackerHandle;

#[derive(serde::Serialize)]
pub struct AppStatus {
    pub name: &'static str,
    pub version: &'static str,
    pub db_path: String,
    pub schema_version: i64,
    pub tracker: crate::tracker::TrackerInfo,
    pub network_enabled: bool,
}

#[tauri::command]
pub fn get_app_status(state: State<'_, AppState>) -> Result<AppStatus, String> {
    let schema_version = state.store.schema_version().map_err(|e| e.to_string())?;

    Ok(AppStatus {
        name: "AutoTrace",
        version: env!("CARGO_PKG_VERSION"),
        db_path: state.store.path().display().to_string(),
        schema_version,
        tracker: state.tracker.info(),
        network_enabled: false,
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

/// Initialize store + tracker once the Tauri app handle is available.
pub fn init_state(app: &AppHandle) -> Result<AppState, String> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("resolve app data dir: {e}"))?;

    let db_path = Store::default_db_path(&app_data);
    let store = Arc::new(Store::open(&db_path).map_err(|e| e.to_string())?);
    let tracker = Arc::new(TrackerHandle::start(Arc::clone(&store)));

    Ok(AppState { store, tracker })
}
