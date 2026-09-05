//! System tray: show / hide / pause / resume / quit.

use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, Runtime,
};

use crate::store::AppState;

pub fn setup_tray<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "Show AutoTrace", true, None::<&str>)?;
    let hide = MenuItem::with_id(app, "hide", "Hide", true, None::<&str>)?;
    let pause = MenuItem::with_id(app, "pause", "Pause tracking", true, None::<&str>)?;
    let resume = MenuItem::with_id(app, "resume", "Resume tracking", true, None::<&str>)?;
    let start_focus = MenuItem::with_id(app, "start_focus", "Start Focus", true, None::<&str>)?;
    let end_focus = MenuItem::with_id(app, "end_focus", "End Focus", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let sep = PredefinedMenuItem::separator(app)?;

    let menu = Menu::with_items(
        app,
        &[
            &show,
            &hide,
            &sep,
            &pause,
            &resume,
            &sep,
            &start_focus,
            &end_focus,
            &sep,
            &quit,
        ],
    )?;

    let icon = app
        .default_window_icon()
        .cloned()
        .expect("default window icon");

    let _tray = TrayIconBuilder::with_id("main")
        .icon(icon)
        .tooltip("AutoTrace")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => show_main(app),
            "hide" => hide_main(app),
            "pause" => {
                if let Some(state) = app.try_state::<AppState>() {
                    state.tracker.pause();
                }
            }
            "resume" => {
                if let Some(state) = app.try_state::<AppState>() {
                    state.tracker.resume();
                }
            }
            "start_focus" => {
                if let Some(state) = app.try_state::<AppState>() {
                    let _ = state.store.start_focus(None, None, None, None);
                }
            }
            "end_focus" => {
                if let Some(state) = app.try_state::<AppState>() {
                    let _ = state.store.end_focus();
                }
            }
            "quit" => {
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main(tray.app_handle());
            }
        })
        .build(app)?;

    Ok(())
}

fn show_main<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn hide_main<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.hide();
    }
}
