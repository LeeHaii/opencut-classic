#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod state;
mod util;

use state::AppState;
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

const DEFAULT_PROD_URL: &str = "https://www.opencut.pro";

fn editor_url() -> String {
    if let Ok(url) = std::env::var("OPENCUT_DESKTOP_URL") {
        if !url.trim().is_empty() {
            return url;
        }
    }
    if cfg!(debug_assertions) {
        "http://localhost:3000".to_string()
    } else {
        DEFAULT_PROD_URL.to_string()
    }
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            commands::ping,
            commands::app_data_dir,
            commands::settings::location_settings_get,
            commands::settings::location_settings_save,
            commands::settings::location_pick_folder,
            commands::antigravity::antigravity_status,
            commands::antigravity::antigravity_login,
            commands::antigravity::antigravity_run,
            commands::antigravity::antigravity_cancel,
            commands::doctor::hf_doctor,
            commands::render::hf_render,
            commands::render::hf_render_cancel,
            commands::studio::studio_open,
            commands::studio::studio_write,
            commands::studio::studio_append,
            commands::studio::studio_close
        ])
        .setup(|app| {
            let project_location = commands::settings::project_location(app.handle())?;
            std::fs::create_dir_all(&project_location)
                .map_err(|e| format!("failed to create project location: {e}"))?;
            app.manage(commands::settings::LocationRuntime::new(
                project_location.clone(),
            ));
            let url = editor_url();
            let parsed: tauri::Url = url
                .parse()
                .map_err(|e| format!("invalid editor url: {e}"))?;
            let window = WebviewWindowBuilder::new(app, "main", WebviewUrl::External(parsed))
                .data_directory(project_location)
                .title("RhymxCut")
                .inner_size(1440.0, 900.0)
                .min_inner_size(1024.0, 640.0)
                // Let HTML5 drag-and-drop work inside the editor (media bin,
                // timeline). The app does not use Tauri's own drag-drop events.
                .disable_drag_drop_handler()
                .build()?;
            let _ = window.set_focus();
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("failed to build tauri application")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                let state = app.state::<AppState>();
                commands::studio::shutdown_inner(&state);
                commands::antigravity::cancel_all(state);
                commands::render::cancel_all(app.state::<AppState>());
            }
        });
}
