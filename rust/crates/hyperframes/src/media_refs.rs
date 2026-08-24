use std::path::{Component, Path, PathBuf};

/// App-only media URL scheme used inside composition HTML while it lives in
/// the editor. Rewritten to `file:///` URLs only inside the isolated
/// render/studio directories.
pub const INTERNAL_SCHEME: &str = "opencut-media";

fn percent_encode_path(path: &str) -> String {
    let mut out = String::with_capacity(path.len());
    for byte in path.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(byte as char)
            }
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
}

fn percent_decode_path(encoded: &str) -> String {
    let bytes = encoded.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(byte) = u8::from_str_radix(&encoded[i + 1..i + 3], 16) {
                out.push(byte);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Builds the internal URL an element references a local media file with.
pub fn internal_url_for(path: &Path) -> String {
    format!(
        "{INTERNAL_SCHEME}://local/{}",
        percent_encode_path(&path.to_string_lossy())
    )
}

/// Lexically normalizes `.` and `..` components without touching the disk.
fn normalize(path: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                if !out.pop() {
                    // Escapes above the root; keep as-is so containment fails.
                    out.push("..");
                }
            }
            other => out.push(other.as_os_str()),
        }
    }
    out
}

/// Converts internal `opencut-media://local/<encoded>` URLs in `html` back to
/// absolute `file:///` URLs. Relative encoded paths are resolved against
/// `base_dir`. Only called on composition copies inside the isolated render /
/// studio directories — never on the source stored in the project.
pub fn rewrite_to_portable(html: &str, base_dir: &Path) -> String {
    let needle_prefix = format!("{INTERNAL_SCHEME}://local/");
    if !html.contains(&needle_prefix) {
        return html.to_string();
    }
    let normalized_base = normalize(base_dir);
    let mut out = String::with_capacity(html.len());
    let mut rest = html;
    while let Some(pos) = rest.find(&needle_prefix) {
        out.push_str(&rest[..pos]);
        let after = &rest[pos + needle_prefix.len()..];
        let end = after
            .find(|c: char| c == '"' || c == '\'' || c == ')' || c.is_whitespace())
            .unwrap_or(after.len());
        let decoded = percent_decode_path(&after[..end]);
        let candidate = normalize(&PathBuf::from(&decoded));
        let resolved = if candidate.is_absolute() {
            candidate
        } else {
            normalized_base.join(candidate)
        };
        let forward = resolved.to_string_lossy().replace('\\', "/");
        let leading_slash = forward.starts_with('/');
        out.push_str(&format!(
            "file://{}{}",
            if leading_slash { "" } else { "/" },
            forward
        ));
        rest = &after[end..];
    }
    out.push_str(rest);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(windows)]
    #[test]
    fn encodes_and_decodes_windows_paths() {
        let url = internal_url_for(Path::new(r"C:\Users\me\my video.mp4"));
        assert_eq!(
            url,
            "opencut-media://local/C%3A%5CUsers%5Cme%5Cmy%20video.mp4"
        );
        assert_eq!(
            percent_decode_path("C%3A%5CUsers%5Cme%5Cmy%20video.mp4"),
            r"C:\Users\me\my video.mp4"
        );
    }

    #[test]
    fn rewrites_every_internal_ref() {
        let base = if cfg!(windows) {
            Path::new("C:\\proj\\assets")
        } else {
            Path::new("/proj/assets")
        };
        let inside = internal_url_for(&base.join("clip.mp4"));
        let outside = internal_url_for(Path::new(if cfg!(windows) {
            "D:\\other\\x.mp4"
        } else {
            "/other/x.mp4"
        }));
        let html = format!(r#"<video src="{inside}"><video src="{outside}">"#);
        let rewritten = rewrite_to_portable(&html, base);
        assert_eq!(rewritten.matches("file://").count(), 2);
        assert!(rewritten.contains("clip.mp4"));
        assert!(rewritten.contains("x.mp4"));
        assert!(!rewritten.contains("opencut-media://"));
    }

    #[test]
    fn resolves_relative_refs_against_base() {
        let base = if cfg!(windows) {
            Path::new("C:\\proj")
        } else {
            Path::new("/proj")
        };
        let html = r#"<img src="opencut-media://local/img%2Fa.png">"#;
        let rewritten = rewrite_to_portable(html, base);
        assert!(rewritten.contains("img/a.png"), "{rewritten}");
    }
}
