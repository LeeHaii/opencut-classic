use hyperframes::{
    SeedSpec, append_child_to_master, composition_dirs_in, layout, new_master_document,
    normalize_child, seed_composition,
};
use serde::Deserialize;
use std::io::Read;
use std::net::TcpListener;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, State};

use crate::state::{AppState, StudioSession};
use crate::util;

const STUDIO_START_TIMEOUT: Duration = Duration::from_secs(25);
const POLL_INTERVAL: Duration = Duration::from_millis(1000);
const MAX_MASTER_CHARS: usize = 4_000_000;

#[derive(Debug, Deserialize)]
pub struct StudioOpenRequest {
    #[serde(rename = "projectId")]
    pub project_id: String,
    #[serde(rename = "elementId")]
    pub element_id: String,
    /// Current element HTML; becomes the master when the project file does
    /// not exist yet.
    pub html: String,
    #[serde(rename = "compositionId", default)]
    pub composition_id: Option<String>,
    pub width: Option<u32>,
    pub height: Option<u32>,
    #[serde(rename = "durationSecs", default)]
    pub duration_secs: Option<f64>,
}

fn ensure_project(request: &StudioOpenRequest, root: &std::path::Path) -> Result<(), String> {
    if root.join("index.html").exists() {
        return Ok(());
    }
    let initial = if request.html.trim().is_empty() {
        let spec = SeedSpec {
            composition_id: request
                .composition_id
                .as_deref()
                .unwrap_or("opencut-master"),
            width: request.width.unwrap_or(1920),
            height: request.height.unwrap_or(1080),
            duration_secs: request.duration_secs.unwrap_or(5.0),
            fps: 30,
        };
        seed_composition(&spec)
    } else {
        request.html.clone()
    };
    layout::write_atomic(&root.join("index.html"), &initial)
        .map_err(|e| format!("failed to write initial composition: {e}"))
}

#[derive(Clone, serde::Serialize)]
pub struct StudioInfo {
    pub url: String,
    pub port: u16,
    pub dir: String,
}

#[tauri::command]
pub fn studio_open(
    app: AppHandle,
    state: State<'_, AppState>,
    request: StudioOpenRequest,
) -> Result<StudioInfo, String> {
    for id in [&request.project_id, &request.element_id] {
        if !crate::commands::valid_identifier(id) {
            return Err(format!("invalid identifier: {id}"));
        }
    }
    // Singleton studio session.
    {
        let guard = state
            .studio
            .lock()
            .map_err(|_| "state poisoned".to_string())?;
        if guard.is_some() {
            return Err("A HyperFrames Studio window is already open".to_string());
        }
    }

    let node = util::resolve_node().ok_or("Node.js 22+ is required for HyperFrames Studio")?;
    let cli = util::resolve_hyperframes_cli(&app).ok_or(
        "The HyperFrames CLI is missing. Reinstall OpenCut desktop or set HYPERFRAMES_CLI_PATH",
    )?;

    let projects_dir = crate::commands::settings::hyperframes_location(&app)?;
    let dirs = composition_dirs_in(&projects_dir, &request.project_id, &request.element_id);
    std::fs::create_dir_all(&dirs.compositions).map_err(|e| e.to_string())?;
    ensure_project(&request, &dirs.root)?;

    let port = {
        let listener = TcpListener::bind(("127.0.0.1", 0))
            .map_err(|e| format!("no free port available: {e}"))?;
        listener
            .local_addr()
            .map(|a| a.port())
            .map_err(|e| e.to_string())?
    };

    let args = vec![
        cli.to_string_lossy().into_owned(),
        "preview".into(),
        dirs.root.to_string_lossy().into_owned(),
        "--port".into(),
        port.to_string(),
        "--force-new".into(),
        "--no-open".into(),
        "--no-proxy".into(),
    ];
    let mut command = util::build_command(&node, &args, Some(&dirs.root), false);
    let mut child = command
        .spawn()
        .map_err(|e| format!("failed to start Studio server: {e}"))?;

    // Wait for readiness via stdout URL or TCP probe.
    let started = Instant::now();
    let mut ready = false;
    if let Some(mut pipe) = child.stdout.take() {
        let deadline = started + STUDIO_START_TIMEOUT;
        let mut buf = [0u8; 512];
        loop {
            if Instant::now() >= deadline {
                break;
            }
            if let Ok(n) = pipe.read(&mut buf) {
                if n > 0 {
                    let text = String::from_utf8_lossy(&buf[..n]);
                    if text.contains("http://127.0.0.1") || text.contains("http://localhost") {
                        ready = true;
                        break;
                    }
                } else {
                    break;
                }
            }
            if TcpListener::bind(("127.0.0.1", port)).is_err() {
                // Port taken -> server is up.
                ready = true;
                break;
            }
            std::thread::sleep(Duration::from_millis(250));
        }
        // Give the server a beat to finish booting after first output.
        if !ready {
            for _ in 0..20 {
                if TcpListener::bind(("127.0.0.1", port)).is_err() {
                    ready = true;
                    break;
                }
                std::thread::sleep(Duration::from_millis(250));
            }
        }
    }

    if !ready {
        let _ = child.kill();
        let _ = child.wait();
        return Err(
            "HyperFrames Studio did not start in time. Check `hf_doctor` output.".to_string(),
        );
    }

    let session = Arc::new(StudioSession {
        child: Mutex::new(None),
        cancel: AtomicBool::new(false),
        project_id: request.project_id.clone(),
        element_id: request.element_id.clone(),
    });
    if let Ok(mut slot) = session.child.lock() {
        *slot = Some(child);
    }

    let poller_app = app.clone();
    let poller_session = session.clone();
    let watch_path = dirs.index_html.clone();
    let poll_project = request.project_id.clone();
    let poll_element = request.element_id.clone();
    std::thread::spawn(move || {
        let mut last_stamp = (0u64, 0u64);
        while !poller_session.cancel.load(Ordering::Relaxed) {
            if let Ok(meta) = std::fs::metadata(&watch_path) {
                let stamp = (
                    meta.len(),
                    meta.modified()
                        .ok()
                        .and_then(|m| m.duration_since(std::time::UNIX_EPOCH).ok())
                        .map(|d| d.as_millis() as u64)
                        .unwrap_or(0),
                );
                if stamp != last_stamp && last_stamp != (0, 0) {
                    if let Ok(html) = std::fs::read_to_string(&watch_path) {
                        let _ = poller_app.emit(
                            "studio-html-changed",
                            serde_json::json!({
                                "projectId": poll_project,
                                "elementId": poll_element,
                                "html": html,
                            }),
                        );
                    }
                }
                last_stamp = stamp;
            }
            std::thread::sleep(POLL_INTERVAL);
        }
    });

    insert_run_studio(&state, session)?;

    Ok(StudioInfo {
        url: format!("http://127.0.0.1:{port}"),
        port,
        dir: dirs.root.to_string_lossy().into_owned(),
    })
}

fn insert_run_studio(
    state: &State<'_, AppState>,
    session: Arc<StudioSession>,
) -> Result<(), String> {
    let mut guard = state
        .studio
        .lock()
        .map_err(|_| "state poisoned".to_string())?;
    if guard.is_some() {
        return Err("A HyperFrames Studio window is already open".to_string());
    }
    *guard = Some(session);
    Ok(())
}

#[derive(Debug, Deserialize)]
pub struct StudioWriteRequest {
    #[serde(rename = "projectId")]
    pub project_id: String,
    #[serde(rename = "elementId")]
    pub element_id: String,
    pub html: String,
}

/// Writes HTML straight into the master document (Studio live-reloads it).
#[tauri::command]
pub fn studio_write(app: AppHandle, request: StudioWriteRequest) -> Result<bool, String> {
    for id in [&request.project_id, &request.element_id] {
        if !crate::commands::valid_identifier(id) {
            return Err(format!("invalid identifier: {id}"));
        }
    }
    let projects_dir = crate::commands::settings::hyperframes_location(&app)?;
    let dirs = composition_dirs_in(&projects_dir, &request.project_id, &request.element_id);
    if !dirs.index_html.exists() {
        return Err("Studio project does not exist yet".to_string());
    }
    layout::write_atomic(&dirs.index_html, &request.html).map_err(|e| e.to_string())?;
    Ok(true)
}

#[derive(Debug, Deserialize)]
pub struct StudioAppendRequest {
    #[serde(rename = "projectId")]
    pub project_id: String,
    #[serde(rename = "elementId")]
    pub element_id: String,
    /// Raw generated child HTML from the agent.
    pub html: String,
    #[serde(rename = "slug", default)]
    pub slug: Option<String>,
    #[serde(rename = "compositionId", default)]
    pub composition_id: Option<String>,
    pub width: Option<u32>,
    pub height: Option<u32>,
}

#[derive(Clone, serde::Serialize)]
pub struct StudioAppendResult {
    #[serde(rename = "masterHtml")]
    pub master_html: String,
    #[serde(rename = "childFileName")]
    pub child_file_name: String,
    #[serde(rename = "totalDurationSecs")]
    pub total_duration_secs: f64,
}

/// Appends a freshly generated child composition to the master document and
/// writes both files into the Studio project tree.
#[tauri::command]
pub fn studio_append(
    app: AppHandle,
    request: StudioAppendRequest,
) -> Result<StudioAppendResult, String> {
    for id in [&request.project_id, &request.element_id] {
        if !crate::commands::valid_identifier(id) {
            return Err(format!("invalid identifier: {id}"));
        }
    }
    if request.html.len() > MAX_MASTER_CHARS {
        return Err("generated composition is too large".to_string());
    }
    let projects_dir = crate::commands::settings::hyperframes_location(&app)?;
    let dirs = composition_dirs_in(&projects_dir, &request.project_id, &request.element_id);
    std::fs::create_dir_all(&dirs.compositions).map_err(|e| e.to_string())?;

    let slug = request.slug.unwrap_or_else(|| {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.subsec_nanos())
            .unwrap_or(0);
        format!("scene-{nanos}")
    });

    let normalized = normalize_child(&request.html, &slug).map_err(|e| e.to_string())?;

    let current = std::fs::read_to_string(&dirs.index_html).unwrap_or_default();
    let outcome = if current.contains("data-opencut-master") {
        append_child_to_master(&current, &normalized, &slug).map_err(|e| e.to_string())?
    } else {
        // Fresh master: the existing element HTML (or a seed) becomes the
        // first composition; the generated child is appended after it.
        let first = if current.trim().is_empty() {
            let spec = SeedSpec {
                composition_id: request.composition_id.as_deref().unwrap_or("opencut-first"),
                width: request.width.unwrap_or(1920),
                height: request.height.unwrap_or(1080),
                duration_secs: 5.0,
                fps: 30,
            };
            seed_composition(&spec)
        } else {
            current.clone()
        };
        let master = new_master_document(&first).map_err(|e| e.to_string())?;
        layout::write_atomic(&dirs.compositions.join("001-scene.html"), &first)
            .map_err(|e| e.to_string())?;
        append_child_to_master(&master, &normalized, &slug).map_err(|e| e.to_string())?
    };

    let child_path = dirs.compositions.join(&outcome.child_file_name);
    layout::write_atomic(&child_path, &normalized).map_err(|e| e.to_string())?;
    layout::write_atomic(&dirs.index_html, &outcome.master_html).map_err(|e| e.to_string())?;

    Ok(StudioAppendResult {
        master_html: outcome.master_html,
        child_file_name: outcome.child_file_name,
        total_duration_secs: outcome.total_duration_secs,
    })
}

#[tauri::command]
pub fn studio_close(state: State<'_, AppState>) -> Result<bool, String> {
    shutdown_inner(&state);
    Ok(true)
}

pub fn shutdown_inner(state: &State<'_, AppState>) {
    if let Ok(mut guard) = state.studio.lock() {
        if let Some(session) = guard.take() {
            session.cancel.store(true, Ordering::Relaxed);
            if let Ok(mut slot) = session.child.lock() {
                if let Some(child) = slot.as_mut() {
                    let pid = child.id();
                    let _ = child.kill();
                    let _ = child.wait();
                    util::kill_tree(pid);
                }
            }
        }
    }
}
