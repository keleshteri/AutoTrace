mod commands;
mod integrations;
mod store;
mod tagger;
mod tracker;
mod tray;

use tauri::{Manager, WindowEvent};
use tauri_plugin_autostart::MacosLauncher;

use crate::store::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            None,
        ))
        .setup(|app| {
            let state = commands::init_state(app.handle())?;
            app.manage(state);
            tray::setup_tray(app.handle())?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
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
            commands::list_rules,
            commands::create_rule,
            commands::delete_rule,
            commands::set_rule_enabled,
            commands::list_apps,
            commands::set_app_excluded,
            commands::get_tracker_settings,
            commands::update_tracker_settings,
            commands::delete_sessions_range,
            commands::create_manual_session,
            commands::approve_session,
            commands::update_session,
            commands::delete_session,
            commands::merge_sessions,
            commands::split_session,
            commands::list_pending_sessions,
            commands::reject_pending_session,
            commands::get_focus_digest,
            commands::get_weekly_digest,
            commands::list_calendar_events,
            commands::import_ics,
            commands::suggest_from_calendar,
            commands::get_day_report,
            commands::export_csv_for_day,
            commands::list_integrations,
            commands::update_integration,
            commands::disconnect_integration,
            commands::list_eligible_exports,
            commands::push_integration,
            commands::list_sync_log,
            commands::set_integration_mapping,
            commands::local_api_status,
            commands::get_active_focus,
            commands::start_focus,
            commands::end_focus,
            commands::list_focus_for_day,
            commands::list_activity_events,
            commands::list_activity_events_in_range,
            commands::delete_activity_event,
            commands::activity_app_breakdown,
            commands::redact_activity_metadata,
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
