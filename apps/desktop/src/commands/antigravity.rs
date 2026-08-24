use hyperframes::agy;
use serde::{Deserialize, Serialize};
use std::io::{BufRead, BufReader};
use std::process::Child;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::state::{AgentRun, AppState, insert_run, remove_run};
use crate::util;

const WATCHDOG: Duration = Duration::from_secs(21 * 60);

#[derive(Debug, Deserialize)]
pub struct AntigravityRunRequest {
    #[serde(rename = "requestId")]
    pub request_id: String,
    #[serde(rename = "projectId")]
    pub project_id: String,
    pub prompt: String,
    #[serde(rename = "conversationId")]
    pub conversation_id: Option<String>,
    pub model: Option<String>,
}

#[tauri::command]
pub fn antigravity_status() -> agy::AntigravityStatus {
    match agy::resolve_executable() {
        Some(exe) => agy::probe_status(&exe),
        None => agy::AntigravityStatus {
            installed: false,
            executable_path: None,
            version: None,
            minimum_version_met: false,
            account_email: None,
            account_plan: None,
        },
    }
}

#[tauri::command]
pub fn antigravity_login() -> Result<bool, String> {
    let exe = agy::resolve_executable().ok_or("Antigravity CLI is not installed")?;
    let mut command = util::build_command(&exe, &[], None, true);
    command
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());
    let child = command
        .spawn()
        .map_err(|e| format!("failed to launch Antigravity CLI: {e}"))?;
    drop(child);
    Ok(true)
}

#[tauri::command]
pub fn antigravity_run(
    app: AppHandle,
    state: State<'_, AppState>,
    request: AntigravityRunRequest,
) -> Result<serde_json::Value, String> {
    if !crate::commands::valid_identifier(&request.project_id) {
        return Err("invalid project id".to_string());
    }
    if request.prompt.chars().count() > agy::MAX_PROMPT_CHARS {
        return Err(format!(
            "prompt exceeds the {} character limit",
            agy::MAX_PROMPT_CHARS
        ));
    }
    let status = antigravity_status();
    if !status.installed {
        return Err("Antigravity CLI is not installed".to_string());
    }
    if !status.minimum_version_met {
        return Err(format!(
            "Antigravity CLI {} is older than the required {}.{}.{}",
            status.version.as_deref().unwrap_or("?"),
            agy::MINIMUM_VERSION.0,
            agy::MINIMUM_VERSION.1,
            agy::MINIMUM_VERSION.2
        ));
    }

    let workspace = crate::commands::project_base(&app)?
        .join("projects")
        .join(&request.project_id)
        .join("agent-workspace");
    std::fs::create_dir_all(&workspace)
        .map_err(|e| format!("failed to create agent workspace: {e}"))?;

    let exe = status
        .executable_path
        .map(std::path::PathBuf::from)
        .unwrap_or_default();
    let args = agy::build_args(
        &request.prompt,
        request.conversation_id.as_deref(),
        request.model.as_deref(),
    );
    let child = util::build_command(&exe, &args, Some(&workspace), false)
        .spawn()
        .map_err(|e| format!("failed to start Antigravity CLI: {e}"))?;

    let run = Arc::new(AgentRun {
        child: Mutex::new(None),
        cancel: AtomicBool::new(false),
    });
    insert_run(&state.agent_runs, &request.request_id, run.clone())?;

    let app_handle = app.clone();
    let request_id = request.request_id.clone();
    std::thread::spawn(move || {
        supervise_agent(app_handle, request_id, run, child);
    });

    Ok(serde_json::json!({ "accepted": true }))
}

fn supervise_agent(app: AppHandle, request_id: String, run: Arc<AgentRun>, mut child: Child) {
    let stdout_pipe: Option<Box<dyn std::io::Read + Send>> =
        child.stdout.take().map(|p| Box::new(p) as _);
    let stderr_pipe: Option<Box<dyn std::io::Read + Send>> =
        child.stderr.take().map(|p| Box::new(p) as _);

    // Store the child so cancellation can kill it.
    if let Ok(mut slot) = run.child.lock() {
        *slot = Some(child);
    }

    let app_out = app.clone();
    let id_out = request_id.clone();
    let out_thread =
        std::thread::spawn(move || collect_stream(stdout_pipe, &app_out, &id_out, "stdout"));

    let app_err = app.clone();
    let id_err = request_id.clone();
    let err_thread =
        std::thread::spawn(move || collect_stream(stderr_pipe, &app_err, &id_err, "stderr"));

    // Watchdog loop: exit when the process ends, cancellation fires, or time runs out.
    let started = Instant::now();
    let mut cancelled = false;
    let mut timed_out = false;
    loop {
        if run.cancel.load(Ordering::Relaxed) {
            cancelled = true;
        }
        if started.elapsed() > WATCHDOG {
            timed_out = true;
        }
        if cancelled || timed_out {
            kill_stored_child(&run);
            break;
        }
        let finished = match run.child.lock() {
            Ok(mut slot) => slot.as_mut().and_then(|c| c.try_wait().ok().flatten()),
            Err(_) => None,
        };
        if finished.is_some() {
            break;
        }
        std::thread::sleep(Duration::from_millis(200));
    }

    let stdout_all = out_thread.join().unwrap_or_default();
    let stderr_all = err_thread.join().unwrap_or_default();

    remove_run_from_state(&app, &request_id);

    let payload = serde_json::json!({ "requestId": request_id });
    if cancelled {
        let _ = app.emit("antigravity-error", merge(payload, "cancelled"));
        return;
    }
    if timed_out {
        let _ = app.emit(
            "antigravity-error",
            merge(payload, "Antigravity did not respond within the time limit"),
        );
        return;
    }
    if stdout_all.trim().is_empty() && stderr_all.trim().is_empty() {
        let message = agy::extract_error(&stdout_all, &stderr_all);
        let _ = app.emit("antigravity-error", merge(payload, &message));
        return;
    }

    let turn = agy::parse_stream_json(&stdout_all);
    let _ = app.emit(
        "antigravity-done",
        AgentDonePayload {
            request_id,
            text: turn.text,
            conversation_id: turn.conversation_id,
            usage: turn.usage,
            fallback_text: turn.fallback_text,
            error: None,
        },
    );
}

fn kill_stored_child(run: &Arc<AgentRun>) {
    if let Ok(mut slot) = run.child.lock() {
        if let Some(child) = slot.as_mut() {
            let pid = child.id();
            let _ = child.kill();
            let _ = child.wait();
            util::kill_tree(pid);
        }
    }
}

#[derive(Serialize, Clone)]
pub struct AgentDonePayload {
    #[serde(rename = "requestId")]
    pub request_id: String,
    pub text: String,
    #[serde(rename = "conversationId")]
    pub conversation_id: Option<String>,
    pub usage: Option<serde_json::Value>,
    #[serde(rename = "fallbackText")]
    pub fallback_text: bool,
    pub error: Option<String>,
}

fn collect_stream(
    pipe: Option<Box<dyn std::io::Read + Send>>,
    app: &AppHandle,
    request_id: &str,
    stream: &'static str,
) -> String {
    let mut collected = String::new();
    if let Some(pipe) = pipe {
        let reader = BufReader::new(pipe);
        for line in reader.lines().map_while(Result::ok) {
            collected.push_str(&line);
            collected.push('\n');
            let _ = app.emit(
                "antigravity-chunk",
                serde_json::json!({ "requestId": request_id, "stream": stream, "chunk": line }),
            );
        }
    }
    collected
}

fn merge(mut value: serde_json::Value, message: &str) -> serde_json::Value {
    if let Some(obj) = value.as_object_mut() {
        obj.insert(
            "message".into(),
            serde_json::Value::String(message.to_string()),
        );
    }
    value
}

fn remove_run_from_state(app: &AppHandle, request_id: &str) {
    if let Some(state) = app.try_state::<AppState>() {
        remove_run(&state.agent_runs, request_id);
    }
}

#[tauri::command]
pub fn antigravity_cancel(state: State<'_, AppState>, request_id: String) -> Result<bool, String> {
    let run = state
        .agent_runs
        .lock()
        .map_err(|_| "state poisoned".to_string())?
        .get(&request_id)
        .cloned();
    match run {
        Some(run) => {
            run.cancel.store(true, Ordering::Relaxed);
            if let Ok(mut slot) = run.child.lock() {
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
    if let Ok(runs) = state.agent_runs.lock() {
        for (_, run) in runs.iter() {
            run.cancel.store(true, Ordering::Relaxed);
            if let Ok(mut slot) = run.child.lock() {
                if let Some(child) = slot.as_mut() {
                    let _ = child.kill();
                }
            }
        }
    }
}
