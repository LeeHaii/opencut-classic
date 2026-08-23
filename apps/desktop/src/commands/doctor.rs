use hyperframes::agy;
use serde::Serialize;
use std::time::Duration;
use tauri::AppHandle;

use crate::util;

#[derive(Serialize, Clone)]
pub struct ToolStatus {
    pub found: bool,
    pub path: Option<String>,
    pub version: Option<String>,
}

#[derive(Serialize, Clone)]
pub struct DoctorReport {
    pub node: ToolStatus,
    pub ffmpeg: ToolStatus,
    pub hyperframes_cli: ToolStatus,
    pub antigravity: agy::AntigravityStatus,
    #[serde(rename = "mediaBase")]
    pub media_base: String,
}

fn version_of(exe: &std::path::Path, args: &[&str]) -> Option<String> {
    util::capture_with_timeout(exe, args, Duration::from_secs(8)).and_then(|out| {
        out.stdout
            .lines()
            .find(|line| !line.trim().is_empty())
            .map(|l| l.trim().to_string())
    })
}

#[tauri::command]
pub fn hf_doctor(app: AppHandle) -> DoctorReport {
    let node_path = util::resolve_node();
    let node = ToolStatus {
        found: node_path.is_some(),
        path: node_path.as_ref().map(|p| p.to_string_lossy().into_owned()),
        version: node_path.as_ref().and_then(|p| version_of(p, &["--version"])),
    };

    let ffmpeg_path = util::which("ffmpeg");
    let ffmpeg = ToolStatus {
        found: ffmpeg_path.is_some(),
        path: ffmpeg_path.as_ref().map(|p| p.to_string_lossy().into_owned()),
        version: ffmpeg_path.as_ref().and_then(|p| version_of(p, &["-version"])),
    };

    let cli_path = util::resolve_hyperframes_cli();
    let cli_version = cli_path.as_ref().zip(node_path.as_ref()).and_then(|(cli, node)| {
        util::capture_with_timeout(node, &[&cli.to_string_lossy(), "--version"], Duration::from_secs(15))
            .and_then(|out| {
                out.stdout
                    .lines()
                    .find(|line| !line.trim().is_empty())
                    .map(|l| l.trim().to_string())
            })
    });
    let hyperframes_cli = ToolStatus {
        found: cli_path.is_some(),
        path: cli_path.as_ref().map(|p| p.to_string_lossy().into_owned()),
        version: cli_version,
    };

    let media_base = crate::commands::project_base(&app)
        .map(|base| base.join("projects").to_string_lossy().into_owned())
        .unwrap_or_default();

    DoctorReport {
        node,
        ffmpeg,
        hyperframes_cli,
        antigravity: super::antigravity::antigravity_status(),
        media_base,
    }
}
