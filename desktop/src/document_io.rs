use crate::{
    admission::Documents,
    files::{self, FileError, Snapshot},
};
use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use serde_json::{Value, json};
use std::{
    collections::HashSet,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;

pub struct FileWatch {
    watcher: RecommendedWatcher,
    /// Shared with the event callback, which forgets removed directories so a recreated directory
    /// is registered again.
    parents: Arc<Mutex<HashSet<PathBuf>>>,
}

fn forget_removed(parents: &Mutex<HashSet<PathBuf>>, event: &notify::Event) {
    if matches!(event.kind, notify::EventKind::Remove(_)) {
        let mut parents = parents.lock().unwrap();
        for path in &event.paths {
            parents.remove(path);
        }
    }
}

impl FileWatch {
    pub fn retain_documents(&mut self, docs: &Documents) {
        let watcher = &mut self.watcher;
        self.parents.lock().unwrap().retain(|parent| {
            if docs
                .entries()
                .any(|(_, document)| crate::translations::watch_paths(Path::new(&document.path)).contains(parent))
            {
                return true;
            }
            // Retain failed removals so a later close can retry releasing the watch.
            watcher.unwatch(parent).is_err()
        });
    }

    fn watch(&mut self, source: &Path) -> notify::Result<()> {
        for parent in crate::translations::watch_paths(source) {
            if !self.parents.lock().unwrap().contains(&parent) {
                self.watcher.watch(&parent, RecursiveMode::NonRecursive)?;
                self.parents.lock().unwrap().insert(parent);
            }
        }
        Ok(())
    }

    pub fn new(invalidate: impl Fn() + Send + 'static) -> notify::Result<Self> {
        let parents = Arc::new(Mutex::new(HashSet::new()));
        let removed = parents.clone();
        let watcher = notify::recommended_watcher(move |event: notify::Result<notify::Event>| {
            if let Ok(event) = &event {
                forget_removed(&removed, event);
            }
            // Events are invalidation hints, including overflow/errors; a fresh versioned read decides.
            if !matches!(&event, Ok(event) if matches!(event.kind, notify::EventKind::Access(_))) {
                invalidate();
            }
        })?;
        Ok(Self { watcher, parents })
    }
}

type State<'a> = tauri::State<'a, Arc<Mutex<Documents>>>;

fn admitted_id(docs: &Documents, id: &str) -> Result<usize, FileError> {
    id.parse::<usize>()
        .ok()
        .filter(|index| docs.get(*index).is_some())
        .ok_or_else(|| FileError::new(404, "document_not_open", "The document is not open."))
}

fn admitted(docs: &Documents, id: &str) -> Result<PathBuf, FileError> {
    Ok(PathBuf::from(&docs.get(admitted_id(docs, id)?).unwrap().path))
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
        .await?
}

fn read_registered_document(docs: &Mutex<Documents>, id: &str) -> Result<Snapshot, FileError> {
    let path = {
        let mut docs = docs.lock().unwrap();
        let index = admitted_id(&docs, id)?;
        let document = docs.get_mut(index).unwrap();
        if let Some(snapshot) = document.snapshot.take() {
            return Ok(snapshot);
        }
        PathBuf::from(&document.path)
    };
    files::read(&path)
}

#[tauri::command]
pub async fn read_document(id: String, docs: State<'_>) -> Result<Snapshot, FileError> {
    let docs = docs.inner().clone();
    crate::worker::blocking_work()
        .run(move || read_registered_document(&docs, &id))
        .await?
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
        .await?
}

/// Creates a new copy of an admitted document. A close copy leaves the registry untouched;
/// otherwise the copy replaces the original's registry entry.
fn save_copy(
    docs: &Mutex<Documents>,
    id: &str,
    path: &Path,
    content: &str,
    for_close: bool,
) -> Result<Value, FileError> {
    let canonical = crate::admission::copy_destination(path)?;
    let (session_id, saved) = if for_close {
        serialized_write(docs, id, |_| files::create_copy(path, content))
            .map(|saved| (id.to_owned(), saved))?
    } else {
        let mut docs = docs.lock().unwrap();
        let old_id = admitted_id(&docs, id)?;
        let (copy_id, saved) = docs.admit_new_copy(path, || files::create_copy(path, content))?;
        // Preserve the activation revision: a save picker must not steal later navigation.
        docs.remove(old_id);
        if docs.active_id == Some(old_id) {
            docs.active_id = Some(copy_id);
        }
        (copy_id.to_string(), saved)
    };
    Ok(json!({
        "meta": { "sessionId": session_id, "path": canonical,
            "displayName": path.file_name().unwrap().to_string_lossy(), "mtimeMs": saved.mtime_ms },
        "file": saved
    }))
}

#[tauri::command]
pub async fn save_document_copy(
    app: tauri::AppHandle,
    id: String,
    content: String,
    for_close: Option<bool>,
    docs: State<'_>,
    watch: tauri::State<'_, Arc<Mutex<FileWatch>>>,
) -> Result<Option<Value>, FileError> {
    let docs = docs.inner().clone();
    let path = admitted(&docs.lock().unwrap(), &id)?;
    let mut dialog = app.dialog().file().add_filter("Markdown", crate::admission::MARKDOWN_EXTENSIONS).set_file_name(format!(
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
    let for_close = for_close.unwrap_or(false);
    crate::worker::blocking_work()
        .run(move || {
            let saved = save_copy(&docs, &id, &path, &content, for_close)?;
            if !for_close {
                let documents = docs.lock().unwrap();
                watch.lock().unwrap().retain_documents(&documents);
            }
            Ok(Some(saved))
        })
        .await?
}

#[tauri::command]
pub async fn watch_document(
    id: String,
    docs: State<'_>,
    watch: tauri::State<'_, Arc<Mutex<FileWatch>>>,
) -> Result<(), FileError> {
    let docs = docs.inner().clone();
    let watch = watch.inner().clone();
    crate::worker::blocking_work()
        .run(move || {
            let docs = docs.lock().unwrap();
            let path = admitted(&docs, &id)?;
            watch
                .lock()
                .unwrap()
                .watch(&path)
                .map_err(|e| FileError::new(500, "watch_failed", e.to_string()))
        })
        .await?
}

#[tauri::command]
pub async fn read_translation(
    id: String,
    target_lang: String,
    docs: State<'_>,
) -> Result<Value, FileError> {
    let docs = docs.inner().clone();
    crate::worker::blocking_work()
        .run(move || {
            let path = admitted(&docs.lock().unwrap(), &id)?;
            crate::translations::read(&path, &target_lang)
        })
        .await?
}

#[tauri::command]
pub async fn list_translations(id: String, docs: State<'_>) -> Result<Vec<Value>, FileError> {
    let docs = docs.inner().clone();
    crate::worker::blocking_work().run(move || {
        let path = admitted(&docs.lock().unwrap(), &id)?;
        crate::translations::list(&path)
    }).await?
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
            language: None,
            version: VERSION,
            paths: vec![original.to_str().unwrap().into()],
        });
        let revision = docs.activation_revision;
        let docs = Mutex::new(docs);
        assert!(save_copy(&docs, "0", &original, "local", false).is_err());
        let html = dir.join("copy.html");
        assert_eq!(save_copy(&docs, "0", &html, "local", false).unwrap_err().error, "not_markdown");
        assert!(!html.exists());
        assert_eq!(docs.lock().unwrap().len(), 1);
        let result = save_copy(&docs, "0", &copy, "local", false).unwrap();
        assert_eq!(result["meta"]["sessionId"], "1");
        assert_eq!(result["file"]["content"], "local");
        assert_eq!(docs.lock().unwrap().activation_revision, revision);
        assert!(docs.lock().unwrap().get(0).is_none());
        assert_eq!(
            docs.lock().unwrap().get(1).unwrap().snapshot.as_ref().unwrap().version,
            result["file"]["version"].as_str().unwrap()
        );
        assert_eq!(fs::read_to_string(original).unwrap(), "original");
        assert_eq!(fs::read_to_string(copy).unwrap(), "local");
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn close_copy_preserves_admission_and_original_without_opening_another_file() {
        let dir =
            std::env::temp_dir().join(format!("mastermind-close-copy-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let original = dir.join("original.md");
        let copy = dir.join("copy.md");
        fs::write(&original, "original").unwrap();
        let mut docs = Documents::default();
        docs.admit(Request {
            language: None,
            version: VERSION,
            paths: vec![original.to_str().unwrap().into()],
        });
        let revision = docs.activation_revision;
        let docs = Mutex::new(docs);
        assert!(save_copy(&docs, "0", &original, "local", true).is_err());
        let html = dir.join("copy.html");
        assert_eq!(save_copy(&docs, "0", &html, "local", true).unwrap_err().error, "not_markdown");
        assert!(!html.exists());
        let saved = save_copy(&docs, "0", &copy, "local\r\n", true).unwrap();
        assert_eq!(saved["meta"]["sessionId"], "0");
        assert_eq!(saved["file"]["content"], "local\r\n");
        assert_eq!(fs::read_to_string(original).unwrap(), "original");
        assert_eq!(fs::read_to_string(copy).unwrap(), "local\r\n");
        assert_eq!(docs.lock().unwrap().len(), 1);
        assert!(docs.lock().unwrap().get(0).is_some());
        assert_eq!(docs.lock().unwrap().activation_revision, revision);
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn copy_destinations_are_validated_before_creation() {
        let dir = std::env::temp_dir().join(format!("mastermind-copy-checks-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let original = dir.join("original.md");
        let stale = dir.join("stale.md");
        fs::write(&original, "original").unwrap();
        fs::write(&stale, "stale").unwrap();
        let mut docs = Documents::default();
        docs.admit(Request {
            language: None,
            version: VERSION,
            paths: vec![original.to_str().unwrap().into(), stale.to_str().unwrap().into()],
        });
        fs::remove_file(&stale).unwrap();
        let docs = Mutex::new(docs);
        let error = save_copy(&docs, "0", &stale, "local", false).unwrap_err();
        assert_eq!(error.error, "already_open");
        assert!(!stale.exists());
        assert_eq!(docs.lock().unwrap().len(), 2);
        assert!(docs.lock().unwrap().get(0).is_some());
        #[cfg(unix)]
        {
            use std::os::unix::ffi::OsStrExt;
            let invalid = dir.join(std::ffi::OsStr::from_bytes(b"copy-\xff.md"));
            for for_close in [false, true] {
                let error = save_copy(&docs, "0", &invalid, "local", for_close).unwrap_err();
                assert_eq!(error.error, "unsupported_path_encoding");
                assert!(fs::symlink_metadata(&invalid).is_err());
            }
        }
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn removed_watch_directories_are_registered_again() {
        let parents = Mutex::new(HashSet::from([PathBuf::from("/watched"), PathBuf::from("/kept")]));
        let event = |kind| notify::Event::new(kind).add_path(PathBuf::from("/watched"));
        forget_removed(&parents, &event(notify::EventKind::Modify(notify::event::ModifyKind::Any)));
        assert_eq!(parents.lock().unwrap().len(), 2);
        forget_removed(&parents, &event(notify::EventKind::Remove(notify::event::RemoveKind::Folder)));
        assert_eq!(*parents.lock().unwrap(), HashSet::from([PathBuf::from("/kept")]));
    }

    #[test]
    fn writes_are_serialized_without_holding_the_document_registry() {
        use std::sync::mpsc;
        use std::time::Duration;
        let mut registry = Documents::default();
        registry.insert("/admitted/document.md".into(), None);
        let docs = Arc::new(Mutex::new(registry));
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
                language: None,
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
        assert!(docs.lock().unwrap().get(0).unwrap().snapshot.is_none());
    }

    #[test]
    fn reads_require_an_admitted_document_id() {
        let docs = Mutex::new(Documents::default());
        for id in ["0", "-1", "../file.md", "/tmp/file.md"] {
            assert_eq!(read_registered_document(&docs, id).unwrap_err().status, 404);
        }
    }
}
