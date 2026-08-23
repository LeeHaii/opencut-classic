use regex::Regex;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::time::Duration;

pub const MINIMUM_VERSION: (u32, u32, u32) = (1, 1, 7);
pub const PRINT_TIMEOUT_MINUTES: u64 = 20;
pub const MAX_PROMPT_CHARS: usize = 120_000;

const EMAIL_RE: &str = r#"[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}"#;
const VERSION_RE: &str = r"(\d+)\.(\d+)\.(\d+)";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AntigravityStatus {
    pub installed: bool,
    pub executable_path: Option<String>,
    pub version: Option<String>,
    pub minimum_version_met: bool,
    pub account_email: Option<String>,
    pub account_plan: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParsedTurn {
    pub text: String,
    pub conversation_id: Option<String>,
    pub usage: Option<serde_json::Value>,
    pub fallback_text: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AccountInfo {
    pub email: Option<String>,
    pub plan: Option<String>,
}

pub fn build_args(prompt: &str, conversation_id: Option<&str>, model: Option<&str>) -> Vec<String> {
    let mut args = vec![
        "--dangerously-skip-permissions".to_string(),
        "--print".to_string(),
        prompt.to_string(),
        "--output-format".to_string(),
        "stream-json".to_string(),
        "--print-timeout".to_string(),
        format!("{PRINT_TIMEOUT_MINUTES}m"),
    ];
    if let Some(id) = conversation_id.filter(|id| !id.trim().is_empty()) {
        args.push("--conversation".to_string());
        args.push(id.to_string());
    }
    if let Some(model) = model.map(str::trim).filter(|m| !m.is_empty()) {
        args.push("--model".to_string());
        args.push(model.to_string());
    }
    args
}

/// Resolves the agy executable without ever using a shell.
pub fn resolve_executable() -> Option<PathBuf> {
    if let Ok(path) = std::env::var("ANTIGRAVITY_CLI_PATH") {
        let path = PathBuf::from(path);
        if path.is_file() {
            return Some(path);
        }
    }
    if cfg!(windows) {
        if let Ok(local) = std::env::var("LOCALAPPDATA") {
            let candidate = PathBuf::from(local).join("agy").join("bin").join("agy.exe");
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    } else if let Ok(home) = std::env::var("HOME") {
        let candidate = PathBuf::from(home).join(".local").join("bin").join("agy");
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    which("agy")
}

fn which(name: &str) -> Option<PathBuf> {
    let program = if cfg!(windows) { "where.exe" } else { "which" };
    let output = Command::new(program)
        .arg(name)
        .stdin(Stdio::null())
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

fn version_numbers(text: &str) -> Option<(u32, u32, u32)> {
    let re = Regex::new(VERSION_RE).ok()?;
    let caps = re.captures(text)?;
    Some((
        caps.get(1)?.as_str().parse().ok()?,
        caps.get(2)?.as_str().parse().ok()?,
        caps.get(3)?.as_str().parse().ok()?,
    ))
}

pub fn meets_minimum_version(version: &str) -> bool {
    match version_numbers(version) {
        Some(found) => found >= MINIMUM_VERSION,
        None => false,
    }
}

/// Runs `<exe> --version` with a hard timeout and scrapes account info from
/// the banner output the CLI prints when not asked to hide it.
pub fn probe_status(executable: &Path) -> AntigravityStatus {
    let output = run_with_timeout(executable, &["--version"], Duration::from_secs(8));
    let stdout = output.as_deref().unwrap_or_default();
    let version = stdout.lines().find_map(|line| {
        version_numbers(line).map(|_| line.trim().to_string())
    });
    let account = account_from_output(stdout);
    AntigravityStatus {
        installed: true,
        executable_path: executable.to_string_lossy().into_owned().into(),
        minimum_version_met: version.as_deref().map(meets_minimum_version).unwrap_or(false),
        version,
        account_email: account.email,
        account_plan: account.plan,
    }
}

fn run_with_timeout(executable: &Path, args: &[&str], timeout: Duration) -> Option<String> {
    use std::io::Read;
    use std::sync::mpsc;
    use std::thread;

    let mut child = Command::new(executable)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .ok()?;
    // Drain stdout on this thread while a watchdog waits.
    let mut stdout = child.stdout.take()?;
    let (tx, rx) = mpsc::channel();
    thread::spawn(move || {
        let mut buf = Vec::new();
        let _ = stdout.read_to_end(&mut buf);
        let _ = tx.send(buf);
    });
    let deadline = std::time::Instant::now() + timeout;
    loop {
        if let Ok(buf) = rx.try_recv() {
            finish_child(&mut child);
            return Some(String::from_utf8_lossy(&buf).into_owned());
        }
        if let Ok(Some(_)) = child.try_wait() {
            // Process exited; give the reader a moment then collect.
            if let Ok(buf) = rx.recv_timeout(Duration::from_secs(1)) {
                return Some(String::from_utf8_lossy(&buf).into_owned());
            }
            return None;
        }
        if std::time::Instant::now() >= deadline {
            let _ = child.kill();
            finish_child(&mut child);
            return None;
        }
        thread::sleep(Duration::from_millis(50));
    }
}

fn finish_child(child: &mut Child) {
    let _ = child.wait();
}

fn collect_strings_matching(value: &serde_json::Value, pattern: &Regex, out: &mut Vec<String>) {
    match value {
        serde_json::Value::Object(map) => {
            for (key, inner) in map {
                if pattern.is_match(key) {
                    if let Some(s) = as_nonempty_string(inner) {
                        out.push(s);
                        continue;
                    }
                }
                collect_strings_matching(inner, pattern, out);
            }
        }
        serde_json::Value::Array(items) => {
            for item in items {
                collect_strings_matching(item, pattern, out);
            }
        }
        _ => {}
    }
}

fn as_nonempty_string(value: &serde_json::Value) -> Option<String> {
    match value {
        serde_json::Value::String(s) if !s.trim().is_empty() => Some(s.clone()),
        _ => None,
    }
}

fn find_first_string(value: &serde_json::Value, key_pattern: &Regex, min_len: usize) -> Option<String> {
    match value {
        serde_json::Value::Object(map) => {
            for (key, inner) in map {
                if key_pattern.is_match(key) {
                    if let Some(s) = as_nonempty_string(inner) {
                        if s.len() > min_len {
                            return Some(s);
                        }
                    }
                }
            }
            map.values().find_map(|inner| find_first_string(inner, key_pattern, min_len))
        }
        serde_json::Value::Array(items) => items.iter().find_map(|i| find_first_string(i, key_pattern, min_len)),
        _ => None,
    }
}

fn find_usage(value: &serde_json::Value) -> Option<serde_json::Value> {
    match value {
        serde_json::Value::Object(map) => {
            if let Some(usage) = map.get("usage") {
                if usage.is_object() {
                    return Some(usage.clone());
                }
            }
            map.values().find_map(find_usage)
        }
        serde_json::Value::Array(items) => items.iter().find_map(find_usage),
        _ => None,
    }
}

/// Parses newline-delimited stream-json output into a final turn result.
pub fn parse_stream_json(raw: &str) -> ParsedTurn {
    let id_re = Regex::new(r"^(conversation_?id|session_?id)$").expect("static regex");
    let text_key_re = Regex::new(r"^(text|content|result|response|output)$").expect("static regex");

    let mut events: Vec<serde_json::Value> = Vec::new();
    let mut plain_lines: Vec<&str> = Vec::new();
    for line in raw.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        match serde_json::from_str::<serde_json::Value>(trimmed) {
            Ok(value) => events.push(value),
            Err(_) => plain_lines.push(trimmed),
        }
    }

    let conversation_id = events.iter().find_map(|event| find_first_string(event, &id_re, 4));
    let usage = events.iter().find_map(find_usage);

    let mut finals: Vec<String> = Vec::new();
    let mut deltas: Vec<String> = Vec::new();
    for event in &events {
        let ty = event
            .get("type")
            .or_else(|| event.get("event"))
            .and_then(as_nonempty_string)
            .map(|s| s.to_ascii_lowercase())
            .unwrap_or_default();
        let role = event
            .get("role")
            .and_then(as_nonempty_string)
            .map(|s| s.to_ascii_lowercase())
            .unwrap_or_default();
        let mut strings = Vec::new();
        collect_strings_matching(event, &text_key_re, &mut strings);
        if ty.contains("result") || ty.contains("final") || role == "assistant" {
            finals.extend(strings);
        } else if ty.contains("delta") || ty.contains("message") {
            deltas.extend(strings);
        }
    }

    let final_from_result = finals.iter().rev().find(|s| !s.trim().is_empty()).cloned();
    let joined_deltas = deltas.join("");
    let joined_plain = plain_lines.join("\n");

    let (text, fallback_text) = if let Some(text) = final_from_result {
        (text, false)
    } else if !joined_deltas.trim().is_empty() {
        (joined_deltas, false)
    } else if !joined_plain.trim().is_empty() {
        (joined_plain.clone(), true)
    } else {
        (raw.trim().to_string(), true)
    };

    ParsedTurn { text, conversation_id, usage, fallback_text }
}

/// Scrapes account email/plan from CLI output (JSON lines or human banner).
pub fn account_from_output(raw: &str) -> AccountInfo {
    let email_key_re = Regex::new(r"^(account_?email|user_?email|email)$").expect("static regex");
    let plan_key_re =
        Regex::new(r"^(account_?plan|plan_?tier|subscription_?tier|tier)$").expect("static regex");
    let email_re = Regex::new(EMAIL_RE).expect("static regex");
    let plan_banner_re =
        Regex::new(r"(?i)plan\s*[:·|\-]\s*([A-Za-z][A-Za-z0-9_\- ]{0,30})").expect("static regex");

    let mut email: Option<String> = None;
    let mut plan: Option<String> = None;

    for line in raw.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let Ok(value) = serde_json::from_str::<serde_json::Value>(trimmed) else { continue };
        if email.is_none() {
            email = find_first_string(&value, &email_key_re, 3).filter(|s| email_re.is_match(s));
        }
        if plan.is_none() {
            plan = find_first_string(&value, &plan_key_re, 1);
        }
    }

    if email.is_none() {
        email = email_re.find(raw).map(|m| m.as_str().to_string());
    }
    if plan.is_none() {
        plan = plan_banner_re
            .captures(raw)
            .and_then(|caps| caps.get(1))
            .map(|m| m.as_str().trim().to_string());
    }

    AccountInfo { email, plan }
}

/// Extracts a human-readable error message preferring stderr, then structured
/// stdout JSON errors, falling back to a sign-in hint.
pub fn extract_error(stdout_raw: &str, stderr_raw: &str) -> String {
    const FALLBACK: &str =
        "Antigravity stopped before producing a response. Connect and sign in, then try again.";
    let stderr = stderr_raw.trim();
    if !stderr.is_empty() {
        return stderr.to_string();
    }
    for line in stdout_raw.lines().rev() {
        let trimmed = line.trim();
        if trimmed.is_empty() || !trimmed.starts_with('{') {
            continue;
        }
        let Ok(value) = serde_json::from_str::<serde_json::Value>(trimmed) else { continue };
        let candidates = [
            value.pointer("/result/error"),
            value.pointer("/error/message"),
            value.pointer("/error"),
            value.pointer("/message"),
        ];
        if let Some(message) = candidates.into_iter().flatten().find_map(as_nonempty_string) {
            return message;
        }
    }
    FALLBACK.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_expected_args() {
        let args = build_args("hello", Some("conv-1"), Some("Gemini"));
        assert_eq!(
            args,
            vec![
                "--dangerously-skip-permissions",
                "--print",
                "hello",
                "--output-format",
                "stream-json",
                "--print-timeout",
                "20m",
                "--conversation",
                "conv-1",
                "--model",
                "Gemini"
            ]
        );
    }

    #[test]
    fn parses_result_event_and_conversation() {
        let raw = concat!(
            r#"{"type":"system","conversation_id":"conv-abc123"}"#,
            "\n",
            r#"{"type":"assistant","text":"partial"}"#,
            "\n",
            r#"{"type":"result","result":"final answer","usage":{"credits":3}}"#
        );
        let turn = parse_stream_json(raw);
        assert_eq!(turn.text, "final answer");
        assert_eq!(turn.conversation_id.as_deref(), Some("conv-abc123"));
        assert_eq!(turn.usage.unwrap()["credits"], 3);
        assert!(!turn.fallback_text);
    }

    #[test]
    fn falls_back_to_plain_lines() {
        let turn = parse_stream_json("not json at all\nsecond line");
        assert!(turn.text.contains("not json at all"));
        assert!(turn.fallback_text);
    }

    #[test]
    fn scrapes_account_from_banner() {
        let info = account_from_output(
            "Antigravity CLI v1.2.0\nSigned in as dev@example.com\nPlan: PRO tier ready",
        );
        assert_eq!(info.email.as_deref(), Some("dev@example.com"));
        assert_eq!(info.plan.as_deref(), Some("PRO tier ready"));
    }

    #[test]
    fn extracts_error_prefers_stderr() {
        assert_eq!(extract_error("{\"error\":\"x\"}", "boom"), "boom");
        assert_eq!(extract_error("{\"result\":{\"error\":\"no quota\"}}", ""), "no quota");
        assert_eq!(extract_error("", "  "), extract_error("", ""));
    }
}
