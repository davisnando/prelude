mod diff;
mod git;
mod store;
mod watch;

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Manager, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent};

/// Repo path each window should open on startup, keyed by window label.
#[derive(Default)]
struct Launch(Mutex<HashMap<String, String>>);

static WINDOW_COUNTER: AtomicUsize = AtomicUsize::new(0);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RepoInfo {
    root: String,
    name: String,
    branch: String,
    default_base: Option<String>,
    refs: Vec<String>,
}

#[tauri::command]
fn initial_repo(window: WebviewWindow, launch: State<Launch>) -> Option<String> {
    launch.0.lock().unwrap().remove(window.label())
}

#[tauri::command]
async fn open_repo(path: String) -> Result<RepoInfo, String> {
    let root = git::toplevel(Path::new(&path))?;
    Ok(RepoInfo {
        name: root
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| root.to_string_lossy().into_owned()),
        branch: git::branch(&root),
        default_base: git::default_base(&root),
        refs: git::refs(&root),
        root: root.to_string_lossy().into_owned(),
    })
}

#[tauri::command]
async fn get_diff(root: String, mode: String, base_ref: Option<String>) -> Result<diff::DiffResult, String> {
    diff::compute(Path::new(&root), &mode, base_ref)
}

#[tauri::command]
async fn load_state(root: String) -> Option<String> {
    store::load_state(Path::new(&root))
}

#[tauri::command]
async fn save_state(root: String, json: String) -> Result<(), String> {
    store::save_state(Path::new(&root), &json)
}

#[tauri::command]
async fn write_review(root: String, markdown: String) -> Result<String, String> {
    store::write_review(Path::new(&root), &markdown)
}

#[tauri::command]
fn watch_repo(app: AppHandle, window: WebviewWindow, watchers: State<watch::Watchers>, root: String) -> Result<(), String> {
    watch::watch(app, &watchers, window.label().to_string(), PathBuf::from(root))
}

/// First positional argument, resolved against the invoking shell's cwd.
fn repo_from_args(args: &[String], cwd: &Path) -> Option<PathBuf> {
    let arg = args.iter().skip(1).find(|a| !a.starts_with('-'))?;
    let p = cwd.join(arg);
    git::toplevel(&p).ok().or(Some(p))
}

fn open_window(app: &AppHandle, repo: Option<PathBuf>) {
    if let Some(root) = &repo {
        if let Some(label) = app.state::<watch::Watchers>().label_for_root(root) {
            if let Some(w) = app.get_webview_window(&label) {
                let _ = w.unminimize();
                let _ = w.set_focus();
                return;
            }
        }
    }
    let label = format!("w{}", WINDOW_COUNTER.fetch_add(1, Ordering::SeqCst));
    if let Some(root) = repo {
        app.state::<Launch>()
            .0
            .lock()
            .unwrap()
            .insert(label.clone(), root.to_string_lossy().into_owned());
    }
    let builder = WebviewWindowBuilder::new(app, &label, WebviewUrl::App("index.html".into()))
        .title("Prelude")
        .inner_size(1360.0, 900.0)
        .min_inner_size(760.0, 480.0);
    #[cfg(target_os = "macos")]
    let builder = builder
        .title_bar_style(tauri::TitleBarStyle::Overlay)
        .hidden_title(true);
    if let Err(e) = builder.build() {
        eprintln!("prelude: failed to open window: {e}");
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
            let repo = repo_from_args(&args, Path::new(&cwd));
            if repo.is_none() {
                if let Some(w) = app.webview_windows().values().next() {
                    let _ = w.set_focus();
                    return;
                }
            }
            open_window(app, repo);
        }))
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(watch::Watchers::default())
        .manage(Launch::default())
        .setup(|app| {
            let args: Vec<String> = std::env::args().collect();
            let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("/"));
            let repo = repo_from_args(&args, &cwd)
                .or_else(|| std::env::var("PRELUDE_REPO").ok().map(PathBuf::from));
            open_window(app.handle(), repo);
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::Destroyed = event {
                window.state::<watch::Watchers>().remove(window.label());
            }
        })
        .invoke_handler(tauri::generate_handler![
            initial_repo,
            open_repo,
            get_diff,
            load_state,
            save_state,
            write_review,
            watch_repo
        ])
        .run(tauri::generate_context!())
        .expect("error while running Prelude");
}
