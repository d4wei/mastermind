use crate::{
    admission::Documents,
    files::{self, FileError, Snapshot},
};
use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use serde_json::{Value, json};
use std::{
    collections::HashSet,
    path::PathBuf,
    sync::{Arc, Mutex},
};
use tauri::{Emitter, Manager};
use tauri_plugin_dialog::DialogExt;

pub struct FileWatch {
    watcher: RecommendedWatcher,
    parents: HashSet<PathBuf>,
}

impl FileWatch {
    pub fn retain_documents(&mut self, docs: &Documents) {
        self.parents.retain(|parent| {
            if docs
                .files
                .keys()
                .any(|path| path.parent() == Some(parent.as_path()))
            {
                return true;
            }
            // Retain failed removals so a later close can retry releasing the watch.
            self.watcher.unwatch(parent).is_err()
        });
    }

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
        .and_then(|index| docs.order.get(&index));
    index
        .map(PathBuf::from)
        .ok_or_else(|| FileError::new(404, "document_not_open", "The document is not open."))
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
                "mtimeMs": 0
            }))
        })
        .await
        .map_err(|e| FileError::new(500, "file_io_error", e.to_string()))?
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
    files::read(&path)
}

#[tauri::command]
pub async fn read_document(id: String, docs: State<'_>) -> Result<Snapshot, FileError> {
    let docs = docs.inner().clone();
    crate::worker::blocking_work()
        .run(move || read_registered_document(&docs, &id))
        .await
        .map_err(|e| FileError::new(500, "file_io_error", e.to_string()))?
}

static DOCUMENT_WRITES: Mutex<()> = Mutex::new(());

fn serialized_write<T>(
    docs: &Mutex<Documents>,
    id: &str,
    write: impl FnOnce(PathBuf) -> Result<T, FileError>,
) -> Result<T, FileError> {
    let _write = DOCUMENT_WRITES.lock().unwrap();
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
        .map_err(|e| FileError::new(500, "file_io_error", e.to_string()))?
}

fn save_registered_copy(
    docs: &Mutex<Documents>,
    id: &str,
    path: PathBuf,
    content: &str,
) -> Result<Value, FileError> {
    let mut docs = docs.lock().unwrap();
    let original = admitted(&docs, id)?;
    files::create_copy(&path, content)?;
    let (canonical, _) = docs.open(path.to_str().ok_or_else(|| {
        FileError::new(
            400,
            "unsupported_path_encoding",
            "The file path is not valid UTF-8.",
        )
    })?)?;
    let copy_id = *docs
        .order
        .iter()
        .find(|(_, value)| **value == canonical)
        .unwrap()
        .0;
    let saved = files::read(std::path::Path::new(&canonical))?;
    if saved.content() != content {
        return Err(FileError::conflict());
    }
    // Preserve the activation revision: a save picker must not steal later navigation.
    let old_id = id.parse::<usize>().unwrap();
    docs.order.remove(&old_id);
    docs.files.remove(&original);
    if docs.active_id == Some(old_id) {
        docs.active_id = Some(copy_id);
    }
    Ok(json!({
        "meta": { "sessionId": copy_id.to_string(), "path": canonical,
            "displayName": path.file_name().unwrap().to_string_lossy(), "mtimeMs": saved.mtime_ms },
        "file": saved
    }))
}

#[tauri::command]
pub async fn save_document_copy(
    app: tauri::AppHandle,
    id: String,
    content: String,
    docs: State<'_>,
    watch: tauri::State<'_, Arc<Mutex<FileWatch>>>,
) -> Result<Option<Value>, FileError> {
    let docs = docs.inner().clone();
    let path = admitted(&docs.lock().unwrap(), &id)?;
    let mut dialog = app.dialog().file().set_file_name(format!(
        "{}-copy.md",
        path.file_stem().unwrap_or_default().to_string_lossy()
    ));
    if let Some(parent) = path.parent() {
        dialog = dialog.set_directory(parent);
    }
    if let Some(window) = app.get_webview_window("main") {
        dialog = dialog.set_parent(&window);
    }
    let (sender, receiver) = tokio::sync::oneshot::channel();
    dialog.save_file(move |path| {
        let _ = sender.send(path);
    });
    let Some(path) = receiver
        .await
        .map_err(|e| FileError::new(500, "dialog_error", e.to_string()))?
    else {
        return Ok(None);
    };
    let path = path
        .into_path()
        .map_err(|e| FileError::new(400, "invalid_path", e.to_string()))?;
    let watch = watch.inner().clone();
    crate::worker::blocking_work()
        .run(move || {
            let saved = save_registered_copy(&docs, &id, path, &content)?;
            let documents = docs.lock().unwrap();
            watch.lock().unwrap().retain_documents(&documents);
            Ok(Some(saved))
        })
        .await
        .map_err(|e| FileError::new(500, "file_io_error", e.to_string()))?
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
            let docs = docs.lock().unwrap();
            let path = admitted(&docs, &id).map_err(|e| e.error)?;
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
        .map_err(|e| FileError::new(500, "file_io_error", e.to_string()))?
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
        return Err(FileError::new(
            400,
            "invalid_language",
            "The translation language is invalid.",
        ));
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
    serde_json::from_str(&raw.content()).map_err(|_| {
        FileError::new(
            409,
            "invalid_translation",
            "The translation artifact is not valid JSON.",
        )
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::admission::{Request, VERSION};
    use std::fs;

    #[test]
    fn saved_copy_replaces_admission_only_after_success_without_stealing_activation() {
        let dir = std::env::temp_dir().join(format!("mastermind-copy-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let original = dir.join("original.md");
        let copy = dir.join("copy.md");
        fs::write(&original, "original").unwrap();
        let mut docs = Documents::default();
        docs.admit(Request {
            version: VERSION,
            paths: vec![original.to_str().unwrap().into()],
        });
        let revision = docs.activation_revision;
        let docs = Mutex::new(docs);
        assert!(save_registered_copy(&docs, "0", original.clone(), "local").is_err());
        assert_eq!(docs.lock().unwrap().order.len(), 1);
        let result = save_registered_copy(&docs, "0", copy.clone(), "local").unwrap();
        assert_eq!(result["meta"]["sessionId"], "1");
        assert_eq!(result["file"]["content"], "local");
        assert_eq!(docs.lock().unwrap().activation_revision, revision);
        assert!(!docs.lock().unwrap().order.contains_key(&0));
        assert_eq!(fs::read_to_string(original).unwrap(), "original");
        assert_eq!(fs::read_to_string(copy).unwrap(), "local");
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn writes_are_serialized_without_holding_the_document_registry() {
        use std::sync::mpsc;
        use std::time::Duration;
        let docs = Arc::new(Mutex::new(Documents {
            order: [(0, "/admitted/document.md".into())].into(),
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
        assert!(DOCUMENT_WRITES.try_lock().is_err());
        release_tx.send(()).unwrap();
        first.join().unwrap();
        second_started_rx
            .recv_timeout(Duration::from_secs(2))
            .unwrap();
        second.join().unwrap();
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
