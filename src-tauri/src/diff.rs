use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::path::Path;
use std::time::Duration;

use serde::Serialize;
use similar::{Algorithm, ChangeTag, TextDiff};

use crate::git;

const MAX_FILE_BYTES: usize = 1_500_000;

/// One line of the full-file alignment. Short keys keep the IPC payload small.
#[derive(Serialize)]
pub struct Row {
    /// "c" context, "a" added, "d" deleted
    k: &'static str,
    /// old line number (0 = none)
    o: u32,
    /// new line number (0 = none)
    n: u32,
    t: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileDiff {
    path: String,
    old_path: Option<String>,
    /// added | modified | deleted | renamed | untracked
    status: &'static str,
    binary: bool,
    too_large: bool,
    additions: u32,
    deletions: u32,
    hash: String,
    rows: Vec<Row>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffResult {
    branch: String,
    base_ref: Option<String>,
    base_commit: String,
    files: Vec<FileDiff>,
}

struct Entry {
    status: &'static str,
    path: String,
    old_path: Option<String>,
}

fn parse_name_status(raw: &[u8]) -> Vec<Entry> {
    let parts: Vec<String> = raw
        .split(|&b| b == 0)
        .map(|p| String::from_utf8_lossy(p).to_string())
        .collect();
    let mut entries = Vec::new();
    let mut i = 0;
    while i < parts.len() {
        let code = &parts[i];
        if code.is_empty() {
            i += 1;
            continue;
        }
        match code.chars().next().unwrap() {
            'R' | 'C' if i + 2 < parts.len() => {
                let is_rename = code.starts_with('R');
                entries.push(Entry {
                    status: if is_rename { "renamed" } else { "added" },
                    old_path: Some(parts[i + 1].clone()),
                    path: parts[i + 2].clone(),
                });
                i += 3;
            }
            c if i + 1 < parts.len() => {
                let status = match c {
                    'A' => "added",
                    'D' => "deleted",
                    _ => "modified",
                };
                entries.push(Entry {
                    status,
                    old_path: if c == 'A' { None } else { Some(parts[i + 1].clone()) },
                    path: parts[i + 1].clone(),
                });
                i += 2;
            }
            _ => break,
        }
    }
    entries
}

fn is_binary(bytes: &[u8]) -> bool {
    bytes[..bytes.len().min(8000)].contains(&0)
}

fn split_lines(text: &str) -> Vec<&str> {
    let mut lines: Vec<&str> = text
        .split('\n')
        .map(|l| l.strip_suffix('\r').unwrap_or(l))
        .collect();
    if lines.last() == Some(&"") {
        lines.pop();
    }
    lines
}

fn read_worktree(root: &Path, rel: &str) -> Option<Vec<u8>> {
    let p = root.join(rel);
    let meta = std::fs::symlink_metadata(&p).ok()?;
    if meta.file_type().is_symlink() {
        return std::fs::read_link(&p)
            .ok()
            .map(|t| t.to_string_lossy().into_owned().into_bytes());
    }
    if meta.is_dir() {
        return None; // submodule
    }
    std::fs::read(p).ok()
}

fn build_rows(old: &str, new: &str) -> (Vec<Row>, u32, u32) {
    let old_lines = split_lines(old);
    let new_lines = split_lines(new);
    let diff = TextDiff::configure()
        .algorithm(Algorithm::Patience)
        .timeout(Duration::from_secs(2))
        .diff_slices(&old_lines, &new_lines);
    let (mut adds, mut dels) = (0, 0);
    let mut rows = Vec::with_capacity(old_lines.len().max(new_lines.len()));
    for op in diff.ops() {
        for ch in diff.iter_changes(op) {
            let o = ch.old_index().map(|i| i as u32 + 1).unwrap_or(0);
            let n = ch.new_index().map(|i| i as u32 + 1).unwrap_or(0);
            let k = match ch.tag() {
                ChangeTag::Equal => "c",
                ChangeTag::Insert => {
                    adds += 1;
                    "a"
                }
                ChangeTag::Delete => {
                    dels += 1;
                    "d"
                }
            };
            rows.push(Row {
                k,
                o,
                n,
                t: ch.value().to_string(),
            });
        }
    }
    (rows, adds, dels)
}

fn hash_of(a: &[u8], b: &[u8]) -> String {
    let mut h = DefaultHasher::new();
    a.hash(&mut h);
    b.hash(&mut h);
    format!("{:016x}", h.finish())
}

fn ignored(path: &str) -> bool {
    path == ".prelude" || path.starts_with(".prelude/")
}

/// Diffs `base` against the working tree, untracked files included.
pub fn compute(root: &Path, mode: &str, base_ref: Option<String>) -> Result<DiffResult, String> {
    let has_head = git::head_exists(root);
    let base_ref = if mode == "branch" {
        base_ref
            .filter(|r| git::ref_exists(root, r))
            .or_else(|| git::default_base(root))
    } else {
        None
    };
    let base_commit = if !has_head {
        git::EMPTY_TREE.to_string()
    } else if let Some(r) = &base_ref {
        git::run(root, &["merge-base", r, "HEAD"])
            .or_else(|_| git::run(root, &["rev-parse", "HEAD"]))?
    } else {
        git::run(root, &["rev-parse", "HEAD"])?
    };

    let raw = git::run_bytes(
        root,
        &[
            "diff",
            "--name-status",
            "-z",
            "-M",
            "--no-ext-diff",
            "--no-color",
            &base_commit,
            "--",
        ],
    )?;
    let mut entries = parse_name_status(&raw);
    let untracked = git::run_bytes(root, &["ls-files", "--others", "--exclude-standard", "-z"])?;
    for p in untracked.split(|&b| b == 0).filter(|p| !p.is_empty()) {
        entries.push(Entry {
            status: "untracked",
            path: String::from_utf8_lossy(p).to_string(),
            old_path: None,
        });
    }
    entries.retain(|e| !ignored(&e.path));

    let specs: Vec<String> = entries
        .iter()
        .filter_map(|e| e.old_path.as_ref().map(|p| format!("{base_commit}:{p}")))
        .collect();
    let mut blobs = if has_head {
        git::cat_files(root, &specs)?
    } else {
        Default::default()
    };

    let mut files = Vec::with_capacity(entries.len());
    for e in entries {
        let old = e
            .old_path
            .as_ref()
            .and_then(|p| blobs.remove(&format!("{base_commit}:{p}")))
            .unwrap_or_default();
        let new = if e.status == "deleted" {
            Vec::new()
        } else {
            match read_worktree(root, &e.path) {
                Some(b) => b,
                None if e.status == "modified" => continue, // submodule or vanished
                None => Vec::new(),
            }
        };
        if old == new && e.status != "renamed" {
            continue;
        }
        let hash = hash_of(&old, &new);
        let binary = is_binary(&old) || is_binary(&new);
        let too_large = old.len() > MAX_FILE_BYTES || new.len() > MAX_FILE_BYTES;
        let (rows, additions, deletions) = if binary || too_large {
            (Vec::new(), 0, 0)
        } else {
            build_rows(&String::from_utf8_lossy(&old), &String::from_utf8_lossy(&new))
        };
        files.push(FileDiff {
            path: e.path,
            old_path: e.old_path.filter(|_| e.status == "renamed"),
            status: e.status,
            binary,
            too_large,
            additions,
            deletions,
            hash,
            rows,
        });
    }
    files.sort_by(|a, b| a.path.cmp(&b.path));

    Ok(DiffResult {
        branch: git::branch(root),
        base_ref,
        base_commit,
        files,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::process::Command;

    fn sh(dir: &Path, args: &[&str]) {
        let ok = Command::new("git")
            .current_dir(dir)
            .args(["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false"])
            .args(args)
            .output()
            .unwrap()
            .status
            .success();
        assert!(ok, "git {args:?} failed");
    }

    #[test]
    fn branch_diff_covers_commits_worktree_and_untracked() {
        let dir = std::env::temp_dir().join(format!("prelude-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        sh(&dir, &["init", "-q", "-b", "main"]);
        fs::write(dir.join("a.txt"), "one\ntwo\nthree\n").unwrap();
        fs::write(dir.join("gone.txt"), "bye\n").unwrap();
        fs::write(dir.join("old-name.txt"), "same content here\nline two\nline three\n").unwrap();
        sh(&dir, &["add", "."]);
        sh(&dir, &["commit", "-qm", "init"]);
        sh(&dir, &["checkout", "-qb", "feature"]);
        fs::write(dir.join("committed.txt"), "on branch\n").unwrap();
        sh(&dir, &["add", "."]);
        sh(&dir, &["commit", "-qm", "branch work"]);
        fs::write(dir.join("a.txt"), "one\nTWO\nthree\nfour\n").unwrap();
        fs::remove_file(dir.join("gone.txt")).unwrap();
        sh(&dir, &["mv", "old-name.txt", "new-name.txt"]);
        fs::write(dir.join("fresh.txt"), "untracked\n").unwrap();
        fs::create_dir_all(dir.join(".prelude")).unwrap();
        fs::write(dir.join(".prelude/state.json"), "{}").unwrap();

        let r = compute(&dir, "branch", None).unwrap();
        assert_eq!(r.branch, "feature");
        assert_eq!(r.base_ref.as_deref(), Some("main"));
        let status: Vec<(&str, &str)> = r.files.iter().map(|f| (f.path.as_str(), f.status)).collect();
        assert_eq!(
            status,
            vec![
                ("a.txt", "modified"),
                ("committed.txt", "added"),
                ("fresh.txt", "untracked"),
                ("gone.txt", "deleted"),
                ("new-name.txt", "renamed"),
            ]
        );
        let a = &r.files[0];
        assert_eq!((a.additions, a.deletions), (2, 1));
        let kinds: String = a.rows.iter().map(|r| r.k).collect();
        assert_eq!(kinds, "cdaca");
        assert_eq!(r.files[4].old_path.as_deref(), Some("old-name.txt"));

        let u = compute(&dir, "uncommitted", None).unwrap();
        assert!(u.files.iter().all(|f| f.path != "committed.txt"));
        assert!(u.base_ref.is_none());
        let _ = fs::remove_dir_all(&dir);
    }
}
