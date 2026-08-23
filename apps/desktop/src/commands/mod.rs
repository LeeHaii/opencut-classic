pub mod antigravity;
pub mod doctor;
pub mod render;
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
    Ok(AppDataDir { path: dir.to_string_lossy().into_owned() })
}

/// Ensures the app-data root exists and returns it.
pub fn project_base(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|_| "app data directory unavailable".to_string())?;
    std::fs::create_dir_all(&base).map_err(|e| e.to_string())?;
    Ok(base)
}

pub fn valid_identifier(id: &str) -> bool {
    hyperframes::layout::valid_identifier(id)
}
