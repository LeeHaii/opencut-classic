use std::fs;
use std::path::{Path, PathBuf};

/// Validates identifiers used to construct filesystem paths.
pub fn valid_identifier(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 128
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

#[derive(Debug, Clone)]
pub struct CompositionDirs {
    pub root: PathBuf,
    pub compositions: PathBuf,
    pub renders: PathBuf,
    pub index_html: PathBuf,
    pub scene_mp4: PathBuf,
}

pub fn composition_dirs(base: &Path, project_id: &str, element_id: &str) -> CompositionDirs {
    composition_dirs_in(&base.join("projects"), project_id, element_id)
}

/// Resolve a composition from an explicit projects directory.
///
/// Desktop users can relocate this directory without changing the portable
/// layout shared by rendering, Studio, and AI workspaces.
pub fn composition_dirs_in(
    projects_dir: &Path,
    project_id: &str,
    element_id: &str,
) -> CompositionDirs {
    let root = projects_dir
        .join(project_id)
        .join("hyperframes")
        .join(element_id);
    CompositionDirs {
        compositions: root.join("compositions"),
        index_html: root.join("index.html"),
        scene_mp4: root.join("renders").join("scene.mp4"),
        renders: root.join("renders"),
        root,
    }
}

/// Atomic write: temp file in the same directory then rename over target.
pub fn write_atomic(path: &Path, contents: &str) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let file_name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "file".to_string());
    let tmp = path.with_file_name(format!(".{file_name}.tmp"));
    fs::write(&tmp, contents)?;
    match fs::rename(&tmp, path) {
        Ok(()) => Ok(()),
        Err(err) => {
            let _ = fs::remove_file(&tmp);
            Err(err)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_safe_identifiers_only() {
        assert!(valid_identifier("proj-1_a"));
        assert!(valid_identifier("e"));
        assert!(!valid_identifier(""));
        assert!(!valid_identifier("../escape"));
        assert!(!valid_identifier("a/b"));
        assert!(!valid_identifier("a b"));
        assert!(!valid_identifier("."));
        assert!(!valid_identifier(".."));
    }

    #[test]
    fn builds_layout() {
        let dirs = composition_dirs(Path::new("/data"), "p1", "el2");
        assert_eq!(
            dirs.index_html,
            PathBuf::from("/data/projects/p1/hyperframes/el2/index.html")
        );
        assert_eq!(
            dirs.scene_mp4,
            PathBuf::from("/data/projects/p1/hyperframes/el2/renders/scene.mp4")
        );
    }

    #[test]
    fn atomic_write_roundtrip() {
        let dir = std::env::temp_dir().join(format!("hf-test-{}", std::process::id()));
        let path = dir.join("nested").join("index.html");
        write_atomic(&path, "<html></html>").unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "<html></html>");
        let _ = fs::remove_dir_all(dir);
    }
}
