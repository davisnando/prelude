use std::fs;
use std::path::{Path, PathBuf};

use crate::git;

fn dir(root: &Path) -> Result<PathBuf, String> {
    let d = root.join(".prelude");
    fs::create_dir_all(&d).map_err(|e| format!("cannot create {}: {e}", d.display()))?;
    ensure_excluded(root);
    Ok(d)
}

/// Keeps `.prelude/` out of git without touching the committed `.gitignore`.
fn ensure_excluded(root: &Path) {
    let Ok(rel) = git::run(root, &["rev-parse", "--git-path", "info/exclude"]) else {
        return;
    };
    let path = root.join(rel);
    let current = fs::read_to_string(&path).unwrap_or_default();
    if current.lines().any(|l| matches!(l.trim(), ".prelude/" | ".prelude" | "/.prelude/")) {
        return;
    }
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let sep = if current.is_empty() || current.ends_with('\n') { "" } else { "\n" };
    let _ = fs::write(&path, format!("{current}{sep}# Prelude review state\n.prelude/\n"));
}

fn write_atomic(path: &Path, contents: &str) -> Result<(), String> {
    let tmp = path.with_extension("tmp");
    fs::write(&tmp, contents).map_err(|e| e.to_string())?;
    fs::rename(&tmp, path).map_err(|e| e.to_string())
}

pub fn load_state(root: &Path) -> Option<String> {
    fs::read_to_string(root.join(".prelude/state.json")).ok()
}

pub fn save_state(root: &Path, json: &str) -> Result<(), String> {
    write_atomic(&dir(root)?.join("state.json"), json)
}

pub fn write_review(root: &Path, markdown: &str) -> Result<String, String> {
    let path = dir(root)?.join("review.md");
    write_atomic(&path, markdown)?;
    Ok(path.to_string_lossy().into_owned())
}
