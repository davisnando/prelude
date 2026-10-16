//! `prelude --core`: the app's backend without a window, for the terminal UI.
//!
//! Speaks JSON lines over stdin/stdout. Each request is `{"id": n, "cmd": "...", ...args}` with the
//! same commands and argument names the webview invokes; each reply is `{"id": n, "ok": value}` or
//! `{"id": n, "err": "message"}`. When a watched repo changes it prints `{"event": "repo-changed"}`.

use std::io::{BufRead, Write};
use std::path::{Path, PathBuf};

use serde_json::{json, Value};

use crate::{diff, repo_info, store, watch};

fn emit(msg: Value) {
    let mut out = std::io::stdout().lock();
    let _ = writeln!(out, "{msg}");
    let _ = out.flush();
}

fn arg(req: &Value, name: &str) -> Result<String, String> {
    req.get(name)
        .and_then(Value::as_str)
        .map(String::from)
        .ok_or_else(|| format!("missing argument `{name}`"))
}

pub fn serve() {
    // Kept alive for as long as the process runs; replaced when another repo is watched.
    let mut watcher = None;

    for line in std::io::stdin().lock().lines() {
        let Ok(line) = line else { break };
        if line.trim().is_empty() {
            continue;
        }
        let req: Value = match serde_json::from_str(&line) {
            Ok(v) => v,
            Err(e) => {
                emit(json!({ "id": null, "err": format!("bad request: {e}") }));
                continue;
            }
        };
        let id = req.get("id").cloned().unwrap_or(Value::Null);
        let cmd = req.get("cmd").and_then(Value::as_str).unwrap_or_default();

        let result: Result<Value, String> = (|| match cmd {
            "open_repo" => Ok(json!(repo_info(&arg(&req, "path")?)?)),
            "get_diff" => {
                let base = req.get("baseRef").and_then(Value::as_str).map(String::from);
                Ok(json!(diff::compute(Path::new(&arg(&req, "root")?), &arg(&req, "mode")?, base)?))
            }
            "load_state" => Ok(json!(store::load_state(Path::new(&arg(&req, "root")?)))),
            "save_state" => {
                store::save_state(Path::new(&arg(&req, "root")?), &arg(&req, "json")?)?;
                Ok(Value::Null)
            }
            "write_review" => Ok(json!(store::write_review(Path::new(&arg(&req, "root")?), &arg(&req, "markdown")?)?)),
            "watch_repo" => {
                watcher = None;
                watcher = Some(watch::start(PathBuf::from(arg(&req, "root")?), || {
                    emit(json!({ "event": "repo-changed" }))
                })?);
                Ok(Value::Null)
            }
            other => Err(format!("unknown command `{other}`")),
        })();

        emit(match result {
            Ok(v) => json!({ "id": id, "ok": v }),
            Err(e) => json!({ "id": id, "err": e }),
        });
    }
    drop(watcher);
}
