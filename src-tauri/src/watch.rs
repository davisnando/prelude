use std::collections::HashMap;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::Mutex;
use std::time::Duration;

use notify::{RecommendedWatcher, RecursiveMode};
use notify_debouncer_mini::{new_debouncer, DebounceEventResult, Debouncer};
use tauri::{AppHandle, Emitter};

/// One watcher per window, keyed by window label.
#[derive(Default)]
pub struct Watchers(pub Mutex<HashMap<String, (PathBuf, Debouncer<RecommendedWatcher>)>>);

impl Watchers {
    pub fn label_for_root(&self, root: &Path) -> Option<String> {
        self.0
            .lock()
            .unwrap()
            .iter()
            .find(|(_, (r, _))| r == root)
            .map(|(l, _)| l.clone())
    }

    pub fn remove(&self, label: &str) {
        self.0.lock().unwrap().remove(label);
    }
}

/// Paths outside .git that git does not ignore, plus HEAD/ref moves inside .git.
fn relevant(root: &Path, paths: Vec<PathBuf>) -> bool {
    let mut candidates = Vec::new();
    for p in paths {
        let Ok(rel) = p.strip_prefix(root) else { continue };
        let rel = rel.to_string_lossy().to_string();
        if rel.is_empty() || rel == ".prelude" || rel.starts_with(".prelude/") {
            continue;
        }
        if rel == ".git" || rel.starts_with(".git/") {
            if rel == ".git/HEAD" || rel.starts_with(".git/refs/heads/") {
                return true;
            }
            continue;
        }
        candidates.push(rel);
    }
    if candidates.is_empty() {
        return false;
    }
    // `git check-ignore` prints only ignored paths; anything not printed matters.
    let Ok(mut child) = Command::new("git")
        .current_dir(root)
        .args(["check-ignore", "--stdin"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
    else {
        return true;
    };
    let input = candidates.join("\n") + "\n";
    if let Some(mut stdin) = child.stdin.take() {
        let _ = stdin.write_all(input.as_bytes());
    }
    let Ok(out) = child.wait_with_output() else {
        return true;
    };
    let ignored: std::collections::HashSet<String> = String::from_utf8_lossy(&out.stdout)
        .lines()
        .map(String::from)
        .collect();
    candidates.iter().any(|c| !ignored.contains(c))
}

pub fn watch(app: AppHandle, watchers: &Watchers, label: String, root: PathBuf) -> Result<(), String> {
    let target = label.clone();
    let watch_root = root.clone();
    let mut debouncer = new_debouncer(Duration::from_millis(300), move |res: DebounceEventResult| {
        if let Ok(events) = res {
            let paths = events.into_iter().map(|e| e.path).collect();
            if relevant(&watch_root, paths) {
                let _ = app.emit_to(target.as_str(), "repo-changed", ());
            }
        }
    })
    .map_err(|e| e.to_string())?;
    debouncer
        .watcher()
        .watch(&root, RecursiveMode::Recursive)
        .map_err(|e| e.to_string())?;
    watchers.0.lock().unwrap().insert(label, (root, debouncer));
    Ok(())
}
