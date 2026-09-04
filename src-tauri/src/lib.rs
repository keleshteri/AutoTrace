mod commands;
mod store;
mod tagger;
mod tracker;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let state = commands::init_store(app.handle())?;
            app.manage(state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_app_status,
            commands::get_db_path,
        ])
        .run(tauri::generate_context!())
        .expect("error while running AutoTrace");
}
