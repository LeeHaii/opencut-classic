use hyperframes::{composition_dirs, layout, media_refs, validate_composition};
use serde::Deserialize;
use std::io::{BufRead, BufReader};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::state::{insert_run, remove_run, RenderJob, AppState};
use crate::util;

const RENDER_WATCHDOG: Duration = Duration::from_secs(30 * 60);

#[derive(Debug, Deserialize)]
pub struct RenderRequest {
    #[serde(rename = "jobId")]
    pub job_id: String,
    #[serde(rename = "projectId")]
    pub project_id: String,
    #[serde(rename = "elementId")]
    pub element_id: String,
    pub html: String,
    /// Absolute paths (or project-relative) the composition references via
    /// internal media URLs; used as the rewrite base.
    #[serde(rename = "mediaBase", default)]
    pub media_base: Option<String>,
}

#[tauri::command]
pub fn hf_render(app: AppHandle, state: State<'_, AppState>, request: RenderRequest) -> Result<serde_json::Value, String> {
    for id in [&request.project_id, &request.element_id] {
        if !crate::commands::valid_identifier(id) {
            return Err(format!("invalid identifier: {id}"));
        }
    }
    validate_composition(&request.html).map_err(|e| e.to_string())?;

    let node = util::resolve_node().ok_or("Node.js 22+ is required for rendering. Install it from nodejs.org")?;
    let cli = util::resolve_hyperframes_cli()
        .ok_or("The HyperFrames CLI is missing. Reinstall OpenCut desktop or set HYPERFRAMES_CLI_PATH")?;

    let base = crate::commands::project_base(&app)?;
    let dirs = composition_dirs(&base, &request.project_id, &request.element_id);
    std::fs::create_dir_all(&dirs.compositions).map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dirs.renders).map_err(|e| e.to_string())?;

    // Portable copy: internal media URLs -> file:// URLs, written only inside
    // the isolated composition directory.
    let media_base = request
        .media_base
        .as_deref()
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| base.join("projects").join(&request.project_id));
    let portable = media_refs::rewrite_to_portable(&request.html, &media_base);
    layout::write_atomic(&dirs.index_html, &portable)
        .map_err(|e| format!("failed to write composition: {e}"))?;

    let args: Vec<String> = vec![
        cli.to_string_lossy().into_owned(),
        "render".into(),
        "-o".into(),
        dirs.scene_mp4.to_string_lossy().into_owned(),
    ];

    if dirs.scene_mp4.exists() {
        std::fs::remove_file(&dirs.scene_mp4).ok();
    }

    let mut command = util::build_command(&node, &args, Some(&dirs.root), false);
    let child = command.spawn().map_err(|e| format!("failed to start renderer: {e}"))?;

    let job = Arc::new(RenderJob { child: Mutex::new(None), cancel: AtomicBool::new(false) });
    insert_run(&state.render_jobs, &request.job_id, job.clone())?;

    let app_handle = app.clone();
    let job_id = request.job_id.clone();
    let element_id = request.element_id.clone();
    let mp4_path = dirs.scene_mp4.clone();
    std::thread::spawn(move || {
        supervise_render(app_handle, job_id, element_id, mp4_path, job, child);
    });

    Ok(serde_json::json!({ "accepted": true }))
}

fn supervise_render(
    app: AppHandle,
    job_id: String,
    element_id: String,
    mp4_path: std::path::PathBuf,
    job: Arc<RenderJob>,
    mut child: std::process::Child,
) {
    let stdout_pipe: Option<Box<dyn std::io::Read + Send>> = child.stdout.take().map(|p| Box::new(p) as _);
    let stderr_pipe: Option<Box<dyn std::io::Read + Send>> = child.stderr.take().map(|p| Box::new(p) as _);
    if let Ok(mut slot) = job.child.lock() {
        *slot = Some(child);
    }

    let emit_app = app.clone();
    let job_id_out = job_id.clone();
    let element_id_out = element_id.clone();
    let out_thread = std::thread::spawn(move || {
        let mut collected = String::new();
        if let Some(pipe) = stdout_pipe {
            for line in BufReader::new(pipe).lines().map_while(Result::ok) {
                collected.push_str(&line);
                collected.push('\n');
                let _ = emit_app.emit(
                    "hf-render-progress",
                    serde_json::json!({ "jobId": job_id_out, "elementId": element_id_out, "chunk": line }),
                );
            }
        }
        collected
    });
    let err_thread = std::thread::spawn(move || {
        let mut collected = String::new();
        if let Some(pipe) = stderr_pipe {
            for line in BufReader::new(pipe).lines().map_while(Result::ok) {
                collected.push_str(&line);
                collected.push('\n');
            }
        }
        collected
    });

    let started = Instant::now();
    let mut status: Option<bool> = None;
    loop {
        if job.cancel.load(Ordering::Relaxed) || started.elapsed() > RENDER_WATCHDOG {
            if let Ok(mut slot) = job.child.lock() {
                if let Some(child) = slot.as_mut() {
                    let pid = child.id();
                    let _ = child.kill();
                    let _ = child.wait();
                    util::kill_tree(pid);
                }
            }
            break;
        }
        if let Some(exit_status) = run_child_wait(&job) {
            status = Some(exit_status);
            break;
        }
        std::thread::sleep(Duration::from_millis(250));
    }
    let exit_ok = status.is_some_and(|s| s);

    let stdout_all = out_thread.join().unwrap_or_default();
    let stderr_all = err_thread.join().unwrap_or_default();

    if let Some(state) = app.try_state::<AppState>() {
        remove_run(&state.render_jobs, &job_id);
    }

    if job.cancel.load(Ordering::Relaxed) {
        let _ = app.emit("hf-render-error", serde_json::json!({ "jobId": job_id, "message": "cancelled" }));
        return;
    }
    if exit_ok && mp4_path.exists() {
        let _ = app.emit(
            "hf-render-done",
            serde_json::json!({
                "jobId": job_id,
                "elementId": element_id,
                "mp4Path": mp4_path.to_string_lossy(),
            }),
        );
    } else {
        let message = if !exit_ok && started.elapsed() <= RENDER_WATCHDOG {
            stderr_all
                .lines()
                .rev()
                .find(|l| !l.trim().is_empty())
                .map(|l| l.to_string())
                .unwrap_or_else(|| hyperframes::agy::extract_error(&stdout_all, &stderr_all))
        } else {
            "Rendering timed out or was cancelled".to_string()
        };
        let _ = app.emit(
            "hf-render-error",
            serde_json::json!({ "jobId": job_id, "elementId": element_id, "message": message }),
        );
    }
}

fn run_child_wait(job: &Arc<RenderJob>) -> Option<bool> {
    let mut slot = job.child.lock().ok()?;
    slot.as_mut()?.try_wait().ok().flatten().map(|status| status.success())
}

#[tauri::command]
pub fn hf_render_cancel(state: State<'_, AppState>, job_id: String) -> Result<bool, String> {
    let job = state
        .render_jobs
        .lock()
        .map_err(|_| "state poisoned".to_string())?
        .get(&job_id)
        .cloned();
    match job {
        Some(job) => {
            job.cancel.store(true, Ordering::Relaxed);
            if let Ok(mut slot) = job.child.lock() {
                if let Some(child) = slot.as_mut() {
                    let _ = child.kill();
                }
            }
            Ok(true)
        }
        None => Ok(false),
    }
}

pub fn cancel_all(state: State<'_, AppState>) {
    if let Ok(jobs) = state.render_jobs.lock() {
        for (_, job) in jobs.iter() {
            job.cancel.store(true, Ordering::Relaxed);
            if let Ok(mut slot) = job.child.lock() {
                if let Some(child) = slot.as_mut() {
                    let _ = child.kill();
                }
            }
        }
    }
}
