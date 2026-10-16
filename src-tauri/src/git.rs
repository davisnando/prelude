use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

/// SHA of git's empty tree, used as the diff base in repos without commits.
pub const EMPTY_TREE: &str = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

fn cmd(root: &Path, args: &[&str]) -> Command {
    let mut c = Command::new("git");
    c.current_dir(root)
        .args(["-c", "core.quotepath=off", "--no-pager"])
        .args(args)
        .env("GIT_OPTIONAL_LOCKS", "0");
    c
}

pub fn run_bytes(root: &Path, args: &[&str]) -> Result<Vec<u8>, String> {
    let out = cmd(root, args)
        .output()
        .map_err(|e| format!("failed to run git: {e}"))?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr);
        return Err(format!("git {}: {}", args.join(" "), err.trim()));
    }
    Ok(out.stdout)
}

pub fn run(root: &Path, args: &[&str]) -> Result<String, String> {
    run_bytes(root, args).map(|b| String::from_utf8_lossy(&b).trim_end().to_string())
}

pub fn ok(root: &Path, args: &[&str]) -> bool {
    cmd(root, args)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

pub fn toplevel(path: &Path) -> Result<PathBuf, String> {
    let dir = if path.is_file() {
        path.parent().unwrap_or(path)
    } else {
        path
    };
    run(dir, &["rev-parse", "--show-toplevel"])
        .map(PathBuf::from)
        .map_err(|_| format!("{} is not inside a git repository", path.display()))
}

pub fn head_exists(root: &Path) -> bool {
    ok(root, &["rev-parse", "--verify", "-q", "HEAD"])
}

pub fn ref_exists(root: &Path, r: &str) -> bool {
    ok(root, &["rev-parse", "--verify", "-q", &format!("{r}^{{commit}}")])
}

pub fn branch(root: &Path) -> String {
    match run(root, &["symbolic-ref", "--short", "-q", "HEAD"]) {
        Ok(b) if !b.is_empty() => b,
        _ => run(root, &["rev-parse", "--short", "HEAD"])
            .map(|s| format!("detached@{s}"))
            .unwrap_or_else(|_| "HEAD".into()),
    }
}

/// Picks the branch a PR would most likely target.
pub fn default_base(root: &Path) -> Option<String> {
    if let Ok(r) = run(root, &["symbolic-ref", "--short", "-q", "refs/remotes/origin/HEAD"]) {
        if !r.is_empty() {
            return Some(r);
        }
    }
    ["main", "master", "origin/main", "origin/master", "develop"]
        .into_iter()
        .find(|r| ref_exists(root, r))
        .map(String::from)
}

pub fn refs(root: &Path) -> Vec<String> {
    run(
        root,
        &[
            "for-each-ref",
            "--sort=-committerdate",
            "--format=%(refname:short)",
            "refs/heads",
            "refs/remotes",
        ],
    )
    .map(|s| {
        s.lines()
            .filter(|l| !l.ends_with("/HEAD") && *l != "origin")
            .map(String::from)
            .collect()
    })
    .unwrap_or_default()
}

/// Reads many blobs (`<rev>:<path>` specs) through a single `git cat-file --batch`.
pub fn cat_files(root: &Path, specs: &[String]) -> Result<HashMap<String, Vec<u8>>, String> {
    let mut result = HashMap::new();
    if specs.is_empty() {
        return Ok(result);
    }
    let mut child = cmd(root, &["cat-file", "--batch"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("failed to run git cat-file: {e}"))?;

    let mut stdin = child.stdin.take().unwrap();
    let input: String = specs.iter().map(|s| format!("{s}\n")).collect();
    let writer = std::thread::spawn(move || {
        let _ = stdin.write_all(input.as_bytes());
    });
    let mut out = Vec::new();
    child
        .stdout
        .take()
        .unwrap()
        .read_to_end(&mut out)
        .map_err(|e| e.to_string())?;
    let _ = writer.join();
    let _ = child.wait();

    let mut pos = 0;
    for spec in specs {
        let Some(nl) = out[pos..].iter().position(|&b| b == b'\n') else {
            break;
        };
        let header = String::from_utf8_lossy(&out[pos..pos + nl]).to_string();
        pos += nl + 1;
        let parts: Vec<&str> = header.split(' ').collect();
        if parts.len() == 3 && parts[1] == "blob" {
            let size: usize = parts[2].parse().unwrap_or(0);
            let end = (pos + size).min(out.len());
            result.insert(spec.clone(), out[pos..end].to_vec());
            pos = end + 1; // trailing newline
        } else if parts.len() == 3 {
            // Non-blob object (e.g. submodule commit): skip its payload.
            let size: usize = parts[2].parse().unwrap_or(0);
            pos = (pos + size + 1).min(out.len());
        }
    }
    Ok(result)
}
