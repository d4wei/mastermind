use crate::{
    admission::Documents,
    files::{self, FileError, Snapshot},
};
use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use serde_json::{Value, json};
use std::{
    collections::HashSet,
    fs,
    path::PathBuf,
    sync::{Arc, Mutex},
};
use tauri::{Emitter, Manager};

#[derive(Default)]
pub struct CloseGate(pub std::sync::atomic::AtomicBool);

pub struct FileWatch {
    watcher: RecommendedWatcher,
    parents: HashSet<PathBuf>,
}

impl FileWatch {
    pub fn new(app: tauri::AppHandle) -> notify::Result<Self> {
        let watcher = notify::recommended_watcher(move |event: notify::Result<notify::Event>| {
            // Events are invalidation hints, including overflow/errors; a fresh versioned read decides.
            if !matches!(&event, Ok(event) if matches!(event.kind, notify::EventKind::Access(_))) {
                let _ = app.emit("document-invalidated", ());
            }
        })?;
        Ok(Self {
            watcher,
            parents: HashSet::new(),
        })
    }
}

type State<'a> = tauri::State<'a, Arc<Mutex<Documents>>>;

fn admitted(docs: &Documents, id: &str) -> Result<PathBuf, FileError> {
    let index = id
        .parse::<usize>()
        .ok()
        .and_then(|index| docs.order.get(index));
    index.map(PathBuf::from).ok_or_else(|| FileError {
        status: 404,
        error: "document_not_open".into(),
    })
}

#[tauri::command]
pub fn document_meta(id: String, docs: State<'_>) -> Result<Value, FileError> {
    let docs = docs.lock().unwrap();
    let path = admitted(&docs, &id)?;
    Ok(
        json!({"sessionId": id, "path": path, "displayName": path.file_name().unwrap().to_string_lossy(),
        "isDraft": false, "mtimeMs": 0}),
    )
}

fn read_registered_document(docs: &Mutex<Documents>, id: &str) -> Result<Snapshot, FileError> {
    let path = {
        let mut docs = docs.lock().unwrap();
        let path = admitted(&docs, id)?;
        if let Some(snapshot) = docs.files.get_mut(&path).and_then(Option::take) {
            return Ok(snapshot);
        }
        path
    };
    files::read(&path).map_err(FileError::from)
}

#[tauri::command]
pub async fn read_document(id: String, docs: State<'_>) -> Result<Snapshot, FileError> {
    let docs = docs.inner().clone();
    tauri::async_runtime::spawn_blocking(move || read_registered_document(&docs, &id))
        .await
        .map_err(|e| FileError {
            status: 500,
            error: e.to_string(),
        })?
}

#[tauri::command]
pub async fn write_document(
    id: String,
    content: String,
    base_version: String,
    docs: State<'_>,
) -> Result<Snapshot, FileError> {
    let docs = docs.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let docs = docs.lock().unwrap();
        files::write(&admitted(&docs, &id)?, &content, &base_version)
    })
    .await
    .map_err(|e| FileError {
        status: 500,
        error: e.to_string(),
    })?
}

#[tauri::command]
pub fn watch_document(
    id: String,
    docs: State<'_>,
    watch: tauri::State<'_, Mutex<FileWatch>>,
) -> Result<(), String> {
    let path = admitted(&docs.lock().unwrap(), &id).map_err(|e| e.error)?;
    let parent = path.parent().unwrap().to_owned();
    let mut watch = watch.lock().unwrap();
    if !watch.parents.contains(&parent) {
        watch
            .watcher
            .watch(&parent, RecursiveMode::NonRecursive)
            .map_err(|e| e.to_string())?;
        watch.parents.insert(parent);
    }
    Ok(())
}

#[tauri::command]
pub fn read_translation(
    id: String,
    target_lang: String,
    docs: State<'_>,
) -> Result<Value, FileError> {
    if target_lang.is_empty()
        || !target_lang.starts_with(|c: char| c.is_ascii_alphabetic())
        || !target_lang
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err(FileError {
            status: 400,
            error: "invalid_language".into(),
        });
    }
    let path = admitted(&docs.lock().unwrap(), &id)?;
    let artifact = path
        .parent()
        .unwrap()
        .join(".mastermind/translations")
        .join(format!(
            "{}.{}.json",
            path.file_name().unwrap().to_string_lossy(),
            target_lang
        ));
    let raw = files::read(&artifact)?;
    serde_json::from_str(&raw.content()).map_err(|_| FileError {
        status: 409,
        error: "invalid_translation".into(),
    })
}

fn preference_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let root = app.path().app_config_dir().map_err(|e| e.to_string())?;
    Ok(root.join("reviewer.json"))
}

#[tauri::command]
pub fn read_preferences(app: tauri::AppHandle) -> Result<Option<Value>, String> {
    match fs::read(preference_path(&app)?) {
        Ok(bytes) => serde_json::from_slice(&bytes)
            .map(Some)
            .map_err(|e| e.to_string()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub fn write_preferences(app: tauri::AppHandle, config: Value) -> Result<(), String> {
    let bytes = serde_json::to_vec_pretty(&config).map_err(|e| e.to_string())?;
    if !config.is_object() || bytes.len() > 64 * 1024 {
        return Err("invalid_preferences".into());
    }
    let path = preference_path(&app)?;
    fs::create_dir_all(path.parent().unwrap()).map_err(|e| e.to_string())?;
    let temp = path.with_extension("json.tmp");
    fs::write(&temp, bytes).map_err(|e| e.to_string())?;
    fs::rename(&temp, path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn finish_close(
    app: tauri::AppHandle,
    gate: tauri::State<'_, CloseGate>,
) -> Result<(), String> {
    gate.0.store(true, std::sync::atomic::Ordering::SeqCst);
    crate::termination::complete(app, true).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn cancel_close(
    app: tauri::AppHandle,
    gate: tauri::State<'_, CloseGate>,
) -> Result<(), String> {
    gate.0.store(false, std::sync::atomic::Ordering::SeqCst);
    crate::termination::complete(app, false).map_err(|e| e.to_string())
}

pub fn menu(app: &tauri::AppHandle) -> tauri::Result<tauri::menu::Menu<tauri::Wry>> {
    use tauri::menu::{Menu, SubmenuBuilder};
    #[cfg(not(target_os = "macos"))]
    let quit = tauri::menu::MenuItem::with_id(
        app,
        "quit-reviewer",
        "Quit mastermind",
        true,
        Some("CmdOrCtrl+Q"),
    )?;
    let application = SubmenuBuilder::new(app, "mastermind");
    #[cfg(target_os = "macos")]
    let application = application.quit();
    #[cfg(not(target_os = "macos"))]
    let application = application.item(&quit);
    let application = application.build()?;
    let open = tauri::menu::MenuItem::with_id(
        app,
        "open-files",
        "Open files…",
        true,
        Some("CmdOrCtrl+O"),
    )?;
    let file = SubmenuBuilder::new(app, "File").item(&open).build()?;
    let edit = SubmenuBuilder::new(app, "Edit");
    #[cfg(target_os = "macos")]
    let edit = edit.undo().redo().separator();
    let edit = edit.cut().copy().paste().select_all().build()?;
    Menu::with_items(app, &[&application, &file, &edit])
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::admission::{Request, VERSION};

    #[test]
    fn admission_snapshot_survives_deletion_before_the_first_ui_read() {
        let path = std::env::temp_dir().join(format!(
            "mastermind-first-read-{}-{}.md",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::write(&path, b"admitted\r\n").unwrap();
        let mut docs = Documents::default();
        assert_eq!(
            docs.admit(Request {
                version: VERSION,
                paths: vec![path.to_str().unwrap().into()]
            })
            .results[0]
                .status,
            "opened"
        );
        fs::remove_file(&path).unwrap();
        let docs = Mutex::new(docs);
        let initial = read_registered_document(&docs, "0").unwrap();
        assert_eq!(initial.bytes, b"admitted\r\n");
        assert_eq!(
            read_registered_document(&docs, "0").unwrap_err().status,
            404
        );
        assert!(!path.exists());
        assert!(docs.lock().unwrap().files.values().all(Option::is_none));
    }

    #[test]
    fn reads_require_an_admitted_document_id() {
        let docs = Mutex::new(Documents::default());
        for id in ["0", "-1", "../file.md", "/tmp/file.md"] {
            assert_eq!(read_registered_document(&docs, id).unwrap_err().status, 404);
        }
    }
}
