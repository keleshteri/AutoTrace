mod commands;
mod store;
mod tagger;
mod tracker;
mod tray;

use tauri::{Manager, WindowEvent};

use crate::store::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let state = commands::init_state(app.handle())?;
            app.manage(state);
            tray::setup_tray(app.handle())?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                // Close-to-tray: keep the tracker running in the background.
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_app_status,
            commands::get_db_path,
            commands::pause_tracking,
            commands::resume_tracking,
            commands::list_sessions_for_day,
            commands::get_hierarchy,
            commands::create_client,
            commands::create_project,
            commands::create_task,
            commands::tag_session,
        ])
        .build(tauri::generate_context!())
        .expect("error while building AutoTrace")
        .run(|app_handle, event| {
            if let tauri::RunEvent::Exit = event {
                if let Some(state) = app_handle.try_state::<AppState>() {
                    state.tracker.stop();
                }
            }
        });
}
