use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::DialogExt;

const SETTINGS_FILE: &str = "location-settings.json";

#[derive(Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct StoredLocationSettings {
    project_location: Option<String>,
    hyperframes_location: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveLocationSettingsRequest {
    pub project_location: String,
    pub hyperframes_location: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocationSettingsResponse {
    pub project_location: String,
    pub hyperframes_location: String,
    pub default_project_location: String,
    pub default_hyperframes_location: String,
    pub restart_required: bool,
}

pub struct LocationRuntime {
    active_project_location: PathBuf,
}

impl LocationRuntime {
    pub fn new(active_project_location: PathBuf) -> Self {
        Self {
            active_project_location,
        }
    }
}

fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map(|dir| dir.join(SETTINGS_FILE))
        .map_err(|_| "application settings directory is unavailable".to_string())
}

fn read_stored(app: &AppHandle) -> StoredLocationSettings {
    let Ok(path) = settings_path(app) else {
        return StoredLocationSettings::default();
    };
    let Ok(json) = std::fs::read_to_string(path) else {
        return StoredLocationSettings::default();
    };
    serde_json::from_str(&json).unwrap_or_default()
}

fn default_project_location(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_local_data_dir()
        .map_err(|_| "local application data directory is unavailable".to_string())
}

fn default_hyperframes_location(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|dir| dir.join("projects"))
        .map_err(|_| "application data directory is unavailable".to_string())
}

fn stored_path(value: Option<String>, fallback: PathBuf) -> PathBuf {
    value
        .filter(|path| !path.trim().is_empty())
        .map(PathBuf::from)
        .unwrap_or(fallback)
}

pub fn project_location(app: &AppHandle) -> Result<PathBuf, String> {
    let stored = read_stored(app);
    Ok(stored_path(
        stored.project_location,
        default_project_location(app)?,
    ))
}

pub fn hyperframes_location(app: &AppHandle) -> Result<PathBuf, String> {
    let stored = read_stored(app);
    Ok(stored_path(
        stored.hyperframes_location,
        default_hyperframes_location(app)?,
    ))
}

fn validate_location(value: &str, label: &str) -> Result<PathBuf, String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(format!("{label} cannot be empty"));
    }
    let path = PathBuf::from(trimmed);
    if !path.is_absolute() {
        return Err(format!("{label} must be an absolute folder path"));
    }
    std::fs::create_dir_all(&path).map_err(|error| format!("cannot create {label}: {error}"))?;
    if !path.is_dir() {
        return Err(format!("{label} is not a directory"));
    }
    Ok(path)
}

fn paths_equal(left: &Path, right: &Path) -> bool {
    if cfg!(windows) {
        left.to_string_lossy()
            .eq_ignore_ascii_case(&right.to_string_lossy())
    } else {
        left == right
    }
}

fn response(
    app: &AppHandle,
    runtime: &LocationRuntime,
) -> Result<LocationSettingsResponse, String> {
    let project_location = project_location(app)?;
    let hyperframes_location = hyperframes_location(app)?;
    let default_project_location = default_project_location(app)?;
    let default_hyperframes_location = default_hyperframes_location(app)?;
    Ok(LocationSettingsResponse {
        restart_required: !paths_equal(&project_location, &runtime.active_project_location),
        project_location: project_location.to_string_lossy().into_owned(),
        hyperframes_location: hyperframes_location.to_string_lossy().into_owned(),
        default_project_location: default_project_location.to_string_lossy().into_owned(),
        default_hyperframes_location: default_hyperframes_location.to_string_lossy().into_owned(),
    })
}

#[tauri::command]
pub fn location_settings_get(
    app: AppHandle,
    runtime: State<'_, LocationRuntime>,
) -> Result<LocationSettingsResponse, String> {
    response(&app, &runtime)
}

#[tauri::command]
pub fn location_settings_save(
    app: AppHandle,
    runtime: State<'_, LocationRuntime>,
    request: SaveLocationSettingsRequest,
) -> Result<LocationSettingsResponse, String> {
    let project = validate_location(&request.project_location, "project location")?;
    let hyperframes = validate_location(
        &request.hyperframes_location,
        "HyperFrames and AI project location",
    )?;
    let defaults = (
        default_project_location(&app)?,
        default_hyperframes_location(&app)?,
    );
    let stored = StoredLocationSettings {
        project_location: (!paths_equal(&project, &defaults.0))
            .then(|| project.to_string_lossy().into_owned()),
        hyperframes_location: (!paths_equal(&hyperframes, &defaults.1))
            .then(|| hyperframes.to_string_lossy().into_owned()),
    };
    let path = settings_path(&app)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|error| format!("cannot create settings directory: {error}"))?;
    }
    let json = serde_json::to_string_pretty(&stored)
        .map_err(|error| format!("cannot serialize settings: {error}"))?;
    std::fs::write(path, json).map_err(|error| format!("cannot save settings: {error}"))?;
    response(&app, &runtime)
}

#[tauri::command]
pub async fn location_pick_folder(
    app: AppHandle,
    title: Option<String>,
) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut picker = app.dialog().file();
        if let Some(title) = title.filter(|value| !value.trim().is_empty()) {
            picker = picker.set_title(title);
        }
        picker
            .blocking_pick_folder()
            .map(|file| {
                file.into_path()
                    .map(|path| path.to_string_lossy().into_owned())
                    .map_err(|error| format!("selected folder is invalid: {error}"))
            })
            .transpose()
    })
    .await
    .map_err(|error| format!("folder picker failed: {error}"))?
}
