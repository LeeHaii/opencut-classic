pub mod antigravity;
pub mod doctor;
pub mod render;
pub mod settings;
pub mod studio;

use serde::Serialize;
use tauri::Manager;

#[derive(Serialize)]
pub struct Ping {
    pub pong: bool,
}

#[tauri::command]
pub fn ping() -> Ping {
    Ping { pong: true }
}

#[derive(Serialize)]
pub struct AppDataDir {
    pub path: String,
}

#[tauri::command]
pub fn app_data_dir(app: tauri::AppHandle) -> Result<AppDataDir, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|_| "app data directory unavailable".to_string())?;
    Ok(AppDataDir {
        path: dir.to_string_lossy().into_owned(),
    })
}

pub fn valid_identifier(id: &str) -> bool {
    hyperframes::layout::valid_identifier(id)
}
