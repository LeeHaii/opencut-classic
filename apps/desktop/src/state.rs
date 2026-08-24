use std::collections::HashMap;
use std::process::Child;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};

#[derive(Default)]
pub struct AppState {
    pub agent_runs: Mutex<HashMap<String, Arc<AgentRun>>>,
    pub render_jobs: Mutex<HashMap<String, Arc<RenderJob>>>,
    pub studio: Mutex<Option<Arc<StudioSession>>>,
}

pub struct AgentRun {
    pub child: Mutex<Option<Child>>,
    pub cancel: AtomicBool,
}

pub struct RenderJob {
    pub child: Mutex<Option<Child>>,
    pub cancel: AtomicBool,
}

pub struct StudioSession {
    pub child: Mutex<Option<Child>>,
    pub cancel: AtomicBool,
    pub project_id: String,
    pub element_id: String,
}

pub fn insert_run<T>(
    map: &Mutex<HashMap<String, Arc<T>>>,
    id: &str,
    run: Arc<T>,
) -> Result<(), String> {
    let mut guard = map.lock().map_err(|_| "state poisoned")?;
    if guard.contains_key(id) {
        return Err(format!("a job with id {id} is already running"));
    }
    guard.insert(id.to_string(), run);
    Ok(())
}

pub fn remove_run<T>(map: &Mutex<HashMap<String, Arc<T>>>, id: &str) {
    if let Ok(mut guard) = map.lock() {
        guard.remove(id);
    }
}
