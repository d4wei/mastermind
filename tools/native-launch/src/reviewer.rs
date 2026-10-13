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
pub async fn document_meta(id: String, docs: State<'_>) -> Result<Value, FileError> {
    let docs = docs.inner().clone();
    crate::worker::blocking_work()
        .run(move || {
            let docs = docs.lock().unwrap();
            let path = admitted(&docs, &id)?;
            Ok(json!({
                "sessionId": id,
                "path": path,
                "displayName": path.file_name().unwrap().to_string_lossy(),
                "isDraft": false,
                "mtimeMs": 0
            }))
        })
        .await
        .map_err(|e| FileError {
            status: 500,
            error: e.to_string(),
        })?
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
    crate::worker::blocking_work()
        .run(move || read_registered_document(&docs, &id))
        .await
        .map_err(|e| FileError {
            status: 500,
            error: e.to_string(),
        })?
}

fn serialized_write<T>(
    docs: &Mutex<Documents>,
    id: &str,
    write: impl FnOnce(PathBuf) -> Result<T, FileError>,
) -> Result<T, FileError> {
    static WRITES: Mutex<()> = Mutex::new(());
    let _write = WRITES.lock().unwrap();
    let path = admitted(&docs.lock().unwrap(), id)?;
    write(path)
}

#[tauri::command]
pub async fn write_document(
    id: String,
    content: String,
    base_version: String,
    docs: State<'_>,
) -> Result<Snapshot, FileError> {
    let docs = docs.inner().clone();
    crate::worker::blocking_work()
        .run(move || {
            serialized_write(&docs, &id, |path| {
                files::write(&path, &content, &base_version)
            })
        })
        .await
        .map_err(|e| FileError {
            status: 500,
            error: e.to_string(),
        })?
}

#[tauri::command]
pub async fn watch_document(
    id: String,
    docs: State<'_>,
    watch: tauri::State<'_, Arc<Mutex<FileWatch>>>,
) -> Result<(), String> {
    let docs = docs.inner().clone();
    let watch = watch.inner().clone();
    crate::worker::blocking_work()
        .run(move || {
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
        })
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn read_translation(
    id: String,
    target_lang: String,
    docs: State<'_>,
) -> Result<Value, FileError> {
    let docs = docs.inner().clone();
    crate::worker::blocking_work()
        .run(move || read_registered_translation(&docs, &id, &target_lang))
        .await
        .map_err(|e| FileError {
            status: 500,
            error: e.to_string(),
        })?
}

fn read_registered_translation(
    docs: &Mutex<Documents>,
    id: &str,
    target_lang: &str,
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
    let path = admitted(&docs.lock().unwrap(), id)?;
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
pub async fn read_preferences(app: tauri::AppHandle) -> Result<Option<Value>, String> {
    crate::worker::blocking_work()
        .run(move || match fs::read(preference_path(&app)?) {
            Ok(bytes) => serde_json::from_slice(&bytes)
                .map(Some)
                .map_err(|e| e.to_string()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(e) => Err(e.to_string()),
        })
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn write_preferences(app: tauri::AppHandle, config: Value) -> Result<(), String> {
    crate::worker::blocking_work()
        .run(move || write_preferences_file(preference_path(&app)?, config))
        .await
        .map_err(|e| e.to_string())?
}

fn write_preferences_file(path: PathBuf, config: Value) -> Result<(), String> {
    static WRITES: Mutex<()> = Mutex::new(());
    let _write = WRITES.lock().unwrap();
    let bytes = serde_json::to_vec_pretty(&config).map_err(|e| e.to_string())?;
    if !config.is_object() || bytes.len() > 64 * 1024 {
        return Err("invalid_preferences".into());
    }
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
    fn concurrent_preferences_writes_leave_one_complete_object() {
        let root = std::env::temp_dir().join(format!(
            "mastermind-preferences-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let path = root.join("reviewer.json");
        let start = Arc::new(std::sync::Barrier::new(9));
        let writers = (0..8)
            .map(|index| {
                let path = path.clone();
                let start = start.clone();
                std::thread::spawn(move || {
                    start.wait();
                    write_preferences_file(path, json!({"index": index, "value": "x".repeat(1024)}))
                })
            })
            .collect::<Vec<_>>();
        start.wait();
        for writer in writers {
            writer.join().unwrap().unwrap();
        }
        let saved: Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        assert!(saved["index"].as_u64().unwrap() < 8);
        assert_eq!(saved["value"], "x".repeat(1024));
        assert!(!path.with_extension("json.tmp").exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn writes_are_serialized_without_holding_the_document_registry() {
        use std::sync::mpsc;
        use std::time::Duration;
        let docs = Arc::new(Mutex::new(Documents {
            order: vec!["/admitted/document.md".into()],
            ..Documents::default()
        }));
        let (first_started_tx, first_started_rx) = mpsc::channel();
        let (release_tx, release_rx) = mpsc::channel();
        let first_docs = docs.clone();
        let first = std::thread::spawn(move || {
            serialized_write(&first_docs, "0", |path| {
                first_started_tx.send(path).unwrap();
                release_rx.recv_timeout(Duration::from_secs(5)).unwrap();
                Ok(())
            })
            .unwrap();
        });
        assert_eq!(
            first_started_rx
                .recv_timeout(Duration::from_secs(2))
                .unwrap(),
            PathBuf::from("/admitted/document.md")
        );
        assert!(docs.try_lock().is_ok());
        let (second_started_tx, second_started_rx) = mpsc::channel();
        let second = std::thread::spawn(move || {
            serialized_write(&docs, "0", |_| {
                second_started_tx.send(()).unwrap();
                Ok(())
            })
            .unwrap();
        });
        let blocked = second_started_rx
            .recv_timeout(Duration::from_millis(30))
            .is_err();
        release_tx.send(()).unwrap();
        first.join().unwrap();
        second_started_rx
            .recv_timeout(Duration::from_secs(2))
            .unwrap();
        second.join().unwrap();
        assert!(blocked);
    }

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
