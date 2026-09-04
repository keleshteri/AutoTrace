//! Tauri IPC commands exposed to the React UI.

use tauri::{AppHandle, Manager, State};

use crate::store::AppState;
use crate::tracker::TrackerInfo;

#[derive(serde::Serialize)]
pub struct AppStatus {
    pub name: &'static str,
    pub version: &'static str,
    pub db_path: String,
    pub schema_version: i64,
    pub tracker: TrackerInfo,
    pub network_enabled: bool,
}

#[tauri::command]
pub fn get_app_status(state: State<'_, AppState>) -> Result<AppStatus, String> {
    let schema_version = state
        .store
        .schema_version()
        .map_err(|e| e.to_string())?;

    Ok(AppStatus {
        name: "AutoTrace",
        version: env!("CARGO_PKG_VERSION"),
        db_path: state.store.path().display().to_string(),
        schema_version,
        tracker: TrackerInfo::current(),
        // MVP: no network stack; integrations are opt-in later.
        network_enabled: false,
    })
}

#[tauri::command]
pub fn get_db_path(state: State<'_, AppState>) -> String {
    state.store.path().display().to_string()
}

/// Initialize the store once the Tauri app handle is available (app-data path).
pub fn init_store(app: &AppHandle) -> Result<AppState, String> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("resolve app data dir: {e}"))?;

    let db_path = crate::store::Store::default_db_path(&app_data);
    let store = crate::store::Store::open(&db_path).map_err(|e| e.to_string())?;

    Ok(AppState { store })
}
