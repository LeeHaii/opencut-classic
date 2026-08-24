#![allow(clippy::unused_self)]
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::Duration;
use tauri::Manager;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

pub const CREATE_NO_WINDOW: u32 = 0x0800_0000;
pub const CREATE_NEW_CONSOLE: u32 = 0x0010;

/// Builds a process command without a shell. `console` requests a visible
/// terminal (interactive login flows); everything else runs windowless.
pub fn build_command(
    executable: &Path,
    args: &[String],
    cwd: Option<&Path>,
    console: bool,
) -> Command {
    let mut command = Command::new(executable);
    command
        .args(args)
        .env_remove("AGY_CLI_HIDE_ACCOUNT_INFO")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(dir) = cwd {
        command.current_dir(dir);
    }
    if console {
        #[cfg(windows)]
        command.creation_flags(CREATE_NEW_CONSOLE);
        #[cfg(not(windows))]
        command.process_group(0);
    } else {
        hide_window(&mut command);
    }
    command
}

fn hide_window(command: &mut Command) {
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);
    #[cfg(not(windows))]
    let _ = command;
}

pub struct CaptureOutput {
    pub success: bool,
    pub stdout: String,
    pub stderr: String,
}

/// Runs a short-lived command capturing output with a hard timeout.
pub fn capture_with_timeout(
    executable: &Path,
    args: &[&str],
    timeout: Duration,
) -> Option<CaptureOutput> {
    use std::io::Read;
    use std::sync::mpsc;
    use std::thread;

    let mut command = Command::new(executable);
    command
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    hide_window(&mut command);
    let mut child = command.spawn().ok()?;
    let mut out_pipe = child.stdout.take()?;
    let mut err_pipe = child.stderr.take()?;
    let (out_tx, out_rx) = mpsc::channel::<String>();
    let (err_tx, err_rx) = mpsc::channel::<String>();
    thread::spawn(move || {
        let mut buf = Vec::new();
        let _ = out_pipe.read_to_end(&mut buf);
        let _ = out_tx.send(String::from_utf8_lossy(&buf).into_owned());
    });
    thread::spawn(move || {
        let mut buf = Vec::new();
        let _ = err_pipe.read_to_end(&mut buf);
        let _ = err_tx.send(String::from_utf8_lossy(&buf).into_owned());
    });
    let deadline = std::time::Instant::now() + timeout;
    loop {
        if let (Ok(stdout), Ok(stderr)) = (
            out_rx.recv_timeout(Duration::from_millis(50)),
            err_rx.try_recv(),
        ) {
            let status = child.try_wait().ok().flatten();
            return Some(CaptureOutput {
                success: status.is_some_and(|s| s.success()),
                stdout,
                stderr,
            });
        }
        if let Ok(Some(status)) = child.try_wait() {
            let stdout = out_rx
                .recv_timeout(Duration::from_secs(2))
                .unwrap_or_default();
            let stderr = err_rx
                .recv_timeout(Duration::from_secs(2))
                .unwrap_or_default();
            return Some(CaptureOutput {
                success: status.success(),
                stdout,
                stderr,
            });
        }
        if std::time::Instant::now() >= deadline {
            let _ = child.kill();
            let _ = child.wait();
            return None;
        }
        std::thread::sleep(Duration::from_millis(50));
    }
}

/// Locates an executable on PATH (no shell).
pub fn which(program: &str) -> Option<PathBuf> {
    let finder = if cfg!(windows) { "where.exe" } else { "which" };
    let output = Command::new(finder)
        .arg(program)
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let first = String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())?
        .to_string();
    let path = PathBuf::from(first);
    if path.is_file() { Some(path) } else { None }
}

/// Locates node, probing common install locations after PATH.
pub fn resolve_node() -> Option<PathBuf> {
    if let Ok(node) = std::env::var("OPENCUT_NODE_PATH") {
        let p = PathBuf::from(node);
        if p.is_file() {
            return Some(p);
        }
    }
    if let Some(found) = which("node") {
        return Some(found);
    }
    if cfg!(windows) {
        let candidates = [
            std::env::var("ProgramFiles")
                .ok()
                .map(|v| PathBuf::from(v).join("nodejs").join("node.exe")),
            std::env::var("LocalAppData").ok().map(|v| {
                PathBuf::from(v)
                    .join("Programs")
                    .join("nodejs")
                    .join("node.exe")
            }),
        ];
        candidates.into_iter().flatten().find(|p| p.is_file())
    } else {
        [
            "/usr/local/bin/node",
            "/usr/bin/node",
            "/opt/homebrew/bin/node",
        ]
        .iter()
        .map(PathBuf::from)
        .find(|p| p.is_file())
    }
}

/// Resolves the HyperFrames CLI script. Workspace installs are usually hoisted
/// to the repository-level node_modules; packaged builds stage a self-contained
/// dependency tree under the Tauri resource directory.
pub fn resolve_hyperframes_cli(app: &tauri::AppHandle) -> Option<PathBuf> {
    if let Ok(path) = std::env::var("HYPERFRAMES_CLI_PATH") {
        let p = PathBuf::from(path);
        if p.is_file() {
            return Some(p);
        }
    }
    let relative = PathBuf::from("node_modules")
        .join("hyperframes")
        .join("bin")
        .join("hyperframes.mjs");
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let mut candidates = vec![
        manifest_dir.join(&relative),
        manifest_dir.join("../..").join(&relative),
    ];
    if let Ok(resource_dir) = app.path().resource_dir() {
        candidates.push(resource_dir.join("hyperframes-cli").join(&relative));
        // Compatibility with early packages that copied only the CLI package.
        candidates.push(
            resource_dir
                .join("hyperframes-cli")
                .join("hyperframes")
                .join("bin")
                .join("hyperframes.mjs"),
        );
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(exe_dir) = exe.parent() {
            candidates.push(exe_dir.join(&relative));
            candidates.push(
                exe_dir
                    .join("resources")
                    .join("hyperframes-cli")
                    .join("node_modules")
                    .join("hyperframes")
                    .join("bin")
                    .join("hyperframes.mjs"),
            );
        }
    }
    candidates.into_iter().find(|p| p.is_file())
}

/// Kills a process tree best-effort.
pub fn kill_tree(pid: u32) {
    #[cfg(windows)]
    {
        let mut cmd = Command::new("taskkill");
        cmd.args([
            "/PID".to_string(),
            pid.to_string(),
            "/T".to_string(),
            "/F".to_string(),
        ]);
        hide_window(&mut cmd);
        let _ = cmd.output();
    }
    #[cfg(not(windows))]
    {
        let _ = Command::new("kill").arg(pid.to_string()).output();
        let _ = Command::new("pkill")
            .args(["-TERM", "-P", &pid.to_string()])
            .output();
    }
}
