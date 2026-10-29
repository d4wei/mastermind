use crate::{
    admission::Documents,
    files::{self, FileError, Snapshot},
};
use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use serde_json::{Value, json};
use std::{
    collections::HashSet,
    path::{Path, PathBuf},
    sync::{Arc, Mutex, mpsc},
};
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;

/// Directories registered with the watcher, shared with its event callback. The callback only
/// moves a removed directory from `parents` to `removed`; `FileWatch` methods release the backend
/// registration afterwards. Watcher calls can join the thread that runs the callback, so this lock
/// is never held across a watcher call.
#[derive(Default)]
struct Directories {
    parents: HashSet<PathBuf>,
    removed: HashSet<PathBuf>,
}

impl Directories {
    fn forget(&mut self, paths: impl IntoIterator<Item = PathBuf>) {
        for path in paths {
            if self.parents.remove(&path) {
                self.removed.insert(path);
            }
        }
    }
}

pub struct FileWatch<W = RecommendedWatcher> {
    watcher: W,
    directories: Arc<Mutex<Directories>>,
    /// Removal paths the callback could not record without waiting for `directories`.
    deferred: mpsc::Receiver<PathBuf>,
}

/// Records a removed watched directory so the next watch request registers it again. The callback
/// never waits on `directories`; a contended lock defers the paths to the next `FileWatch` call.
fn forget_removed(
    directories: &Mutex<Directories>,
    deferred: &mpsc::Sender<PathBuf>,
    event: &notify::Event,
) {
    if !event.kind.is_remove() {
        return;
    }
    match directories.try_lock() {
        Ok(mut directories) => directories.forget(event.paths.iter().cloned()),
        Err(_) => {
            for path in &event.paths {
                let _ = deferred.send(path.clone());
            }
        }
    }
}

impl FileWatch {
    pub fn new(invalidate: impl Fn() + Send + 'static) -> notify::Result<Self> {
        Self::with_watcher(invalidate)
    }
}

impl<W: Watcher> FileWatch<W> {
    fn with_watcher(invalidate: impl Fn() + Send + 'static) -> notify::Result<Self> {
        let directories = Arc::new(Mutex::new(Directories::default()));
        let shared = directories.clone();
        let (defer, deferred) = mpsc::channel();
        let watcher = W::new(
            move |event: notify::Result<notify::Event>| {
                if let Ok(event) = &event {
                    forget_removed(&shared, &defer, event);
                }
                // Events are invalidation hints, including overflow/errors; a fresh versioned read
                // decides.
                if !matches!(&event, Ok(event) if event.kind.is_access()) {
                    invalidate();
                }
            },
            notify::Config::default(),
        )?;
        Ok(Self {
            watcher,
            directories,
            deferred,
        })
    }

    fn directories(&self) -> std::sync::MutexGuard<'_, Directories> {
        let mut directories = self.directories.lock().unwrap();
        directories.forget(self.deferred.try_iter());
        directories
    }

    /// Releases the backend registration of removed directories so re-registering one does not
    /// duplicate it. Errors are ignored because a backend may already have dropped the directory.
    fn release_removed(&mut self) {
        let removed = std::mem::take(&mut self.directories().removed);
        for path in removed {
            let _ = self.watcher.unwatch(&path);
        }
    }

    pub fn retain_documents(&mut self, docs: &Documents) {
        self.release_removed();
        let used: HashSet<PathBuf> = docs
            .entries()
            .flat_map(|(_, document)| crate::translations::watch_paths(Path::new(&document.path)))
            .collect();
        let unused: Vec<PathBuf> = self
            .directories()
            .parents
            .iter()
            .filter(|parent| !used.contains(*parent))
            .cloned()
            .collect();
        for parent in unused {
            // Retain failed removals so a later close can retry releasing the watch.
            if self.watcher.unwatch(&parent).is_ok() {
                self.directories().parents.remove(&parent);
            }
        }
    }

    fn watch(&mut self, source: &Path) -> notify::Result<()> {
        self.release_removed();
        for parent in crate::translations::watch_paths(source) {
            // Record the directory first so a removal reported during registration is not lost.
            let stale = {
                let mut directories = self.directories();
                if !directories.parents.insert(parent.clone()) {
                    continue;
                }
                directories.removed.remove(&parent)
            };
            // A removal recorded after `release_removed` names the registration this call
            // replaces. Releasing it now keeps a later release from dropping the new registration
            // while `parents` still lists the directory.
            if stale {
                let _ = self.watcher.unwatch(&parent);
            }
            if let Err(error) = self.watcher.watch(&parent, RecursiveMode::NonRecursive) {
                let mut directories = self.directories();
                directories.parents.remove(&parent);
                directories.removed.remove(&parent);
                return Err(error);
            }
        }
        Ok(())
    }
}

/// The host's file watch; `None` when the platform watcher could not be created.
pub type SharedWatch = Arc<Mutex<Option<FileWatch>>>;

fn watch_failed(error: impl ToString) -> FileError {
    FileError::new(500, "watch_failed", error.to_string())
}

/// Registers watches for an admitted document. Without a watcher every request fails, so the UI
/// revalidates at its faster interval.
fn watch_admitted<W: Watcher>(
    watch: Option<&mut FileWatch<W>>,
    path: &Path,
) -> Result<(), FileError> {
    match watch {
        Some(watch) => watch.watch(path).map_err(watch_failed),
        None => Err(watch_failed("File watching is unavailable.")),
    }
}

pub fn retain_watches(watch: &Mutex<Option<FileWatch>>, docs: &Documents) {
    if let Some(watch) = watch.lock().unwrap().as_mut() {
        watch.retain_documents(docs);
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
    Ok(PathBuf::from(
        &docs.get(admitted_id(docs, id)?).unwrap().path,
    ))
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
                "displayName": path.file_name().unwrap().to_string_lossy()
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

/// Creates a new copy of an admitted document, as "Saving a new copy" in `files.md` specifies.
fn save_copy(
    docs: &Mutex<Documents>,
    id: &str,
    path: &Path,
    content: &str,
    for_close: bool,
) -> Result<Value, FileError> {
    let canonical = crate::admission::copy_destination(path)?;
    let _write = DOCUMENT_WRITES.lock().unwrap();
    let origin = {
        let docs = docs.lock().unwrap();
        let origin = admitted_id(&docs, id)?;
        if !for_close {
            docs.check_copy_destination(origin, &canonical)?;
        }
        origin
    };
    let saved = files::create_copy(path, content)?;
    let session_id = if for_close {
        id.to_owned()
    } else {
        let copy_id =
            docs.lock()
                .unwrap()
                .replace_with_copy(origin, canonical.clone(), saved.clone())?;
        copy_id.to_string()
    };
    Ok(json!({
        "meta": { "sessionId": session_id, "path": canonical,
            "displayName": path.file_name().unwrap().to_string_lossy() },
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
    watch: tauri::State<'_, SharedWatch>,
) -> Result<Option<Value>, FileError> {
    let docs = docs.inner().clone();
    let path = {
        let (docs, id) = (docs.clone(), id.clone());
        crate::worker::blocking_work()
            .run(move || admitted(&docs.lock().unwrap(), &id))
            .await??
    };
    let mut dialog = app
        .dialog()
        .file()
        .add_filter("Markdown", crate::admission::MARKDOWN_EXTENSIONS)
        .set_file_name(format!(
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
                retain_watches(&watch, &docs.lock().unwrap());
            }
            Ok(Some(saved))
        })
        .await?
}

#[tauri::command]
pub async fn watch_document(
    id: String,
    docs: State<'_>,
    watch: tauri::State<'_, SharedWatch>,
) -> Result<(), FileError> {
    let docs = docs.inner().clone();
    let watch = watch.inner().clone();
    crate::worker::blocking_work()
        .run(move || {
            let docs = docs.lock().unwrap();
            let path = admitted(&docs, &id)?;
            watch_admitted(watch.lock().unwrap().as_mut(), &path)
        })
        .await?
}

#[tauri::command]
pub async fn list_translations(id: String, docs: State<'_>) -> Result<Vec<Value>, FileError> {
    let docs = docs.inner().clone();
    crate::worker::blocking_work()
        .run(move || {
            let path = admitted(&docs.lock().unwrap(), &id)?;
            crate::translations::list(&path)
        })
        .await?
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::TempDir;
    use mastermind_launch_check::protocol::{Request, VERSION};
    use std::fs;

    #[test]
    fn saved_copy_replaces_admission_only_after_success_without_stealing_activation() {
        let dir = TempDir::new("copy");
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
        assert_eq!(
            save_copy(&docs, "0", &html, "local", false)
                .unwrap_err()
                .error,
            "not_markdown"
        );
        assert!(!html.exists());
        assert_eq!(docs.lock().unwrap().len(), 1);
        let result = save_copy(&docs, "0", &copy, "local", false).unwrap();
        assert_eq!(result["meta"]["sessionId"], "1");
        assert_eq!(result["file"]["content"], "local");
        assert_eq!(docs.lock().unwrap().activation_revision, revision);
        assert!(docs.lock().unwrap().get(0).is_none());
        assert_eq!(
            docs.lock()
                .unwrap()
                .get(1)
                .unwrap()
                .snapshot
                .as_ref()
                .unwrap()
                .version,
            result["file"]["version"].as_str().unwrap()
        );
        assert_eq!(fs::read_to_string(original).unwrap(), "original");
        assert_eq!(fs::read_to_string(copy).unwrap(), "local");
    }

    #[test]
    fn close_copy_preserves_admission_and_original_without_opening_another_file() {
        let dir = TempDir::new("close-copy");
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
        assert_eq!(
            save_copy(&docs, "0", &html, "local", true)
                .unwrap_err()
                .error,
            "not_markdown"
        );
        assert!(!html.exists());
        let saved = save_copy(&docs, "0", &copy, "local\r\n", true).unwrap();
        assert_eq!(saved["meta"]["sessionId"], "0");
        assert_eq!(saved["file"]["content"], "local\r\n");
        assert_eq!(fs::read_to_string(original).unwrap(), "original");
        assert_eq!(fs::read_to_string(copy).unwrap(), "local\r\n");
        assert_eq!(docs.lock().unwrap().len(), 1);
        assert!(docs.lock().unwrap().get(0).is_some());
        assert_eq!(docs.lock().unwrap().activation_revision, revision);
    }

    #[test]
    fn copy_destinations_are_validated_before_creation() {
        let dir = TempDir::new("copy-checks");
        let original = dir.join("original.md");
        let stale = dir.join("stale.md");
        fs::write(&original, "original").unwrap();
        fs::write(&stale, "stale").unwrap();
        let mut docs = Documents::default();
        docs.admit(Request {
            language: None,
            version: VERSION,
            paths: vec![
                original.to_str().unwrap().into(),
                stale.to_str().unwrap().into(),
            ],
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
    }

    /// Records backend calls and lets a test deliver events through the registered callback.
    struct Recording {
        handler: Box<dyn notify::EventHandler>,
        calls: Vec<(&'static str, PathBuf)>,
        /// A directory whose removal is reported during the next `unwatch` call.
        removal_during_unwatch: Option<PathBuf>,
    }

    fn removal(path: &Path) -> notify::Event {
        let kind = notify::EventKind::Remove(notify::event::RemoveKind::Folder);
        notify::Event::new(kind).add_path(path.to_owned())
    }

    impl Watcher for Recording {
        fn new<F: notify::EventHandler>(handler: F, _: notify::Config) -> notify::Result<Self> {
            Ok(Self {
                handler: Box::new(handler),
                calls: Vec::new(),
                removal_during_unwatch: None,
            })
        }
        fn watch(&mut self, path: &Path, _: RecursiveMode) -> notify::Result<()> {
            self.calls.push(("watch", path.to_owned()));
            Ok(())
        }
        fn unwatch(&mut self, path: &Path) -> notify::Result<()> {
            self.calls.push(("unwatch", path.to_owned()));
            if let Some(removed) = self.removal_during_unwatch.take() {
                self.handler.handle_event(Ok(removal(&removed)));
            }
            Ok(())
        }
        fn kind() -> notify::WatcherKind {
            notify::WatcherKind::NullWatcher
        }
    }

    impl FileWatch<Recording> {
        fn remove(&mut self, path: &Path) {
            self.watcher.handler.handle_event(Ok(removal(path)));
        }
    }

    #[test]
    fn removed_watch_directories_are_released_and_registered_again() {
        let dir = PathBuf::from("/watched");
        let mut watch = FileWatch::<Recording>::with_watcher(|| {}).unwrap();
        watch.watch(&dir.join("doc.md")).unwrap();
        watch.watch(&dir.join("doc.md")).unwrap();
        let modify = notify::Event::new(notify::EventKind::Modify(notify::event::ModifyKind::Any));
        watch
            .watcher
            .handler
            .handle_event(Ok(modify.add_path(dir.clone())));
        watch.watch(&dir.join("doc.md")).unwrap();
        assert_eq!(watch.watcher.calls, [("watch", dir.clone())]);
        watch.remove(&dir);
        watch.watch(&dir.join("doc.md")).unwrap();
        assert_eq!(
            watch.watcher.calls[1..],
            [("unwatch", dir.clone()), ("watch", dir.clone())]
        );
        // A removal reported while the directory set is locked is deferred, not waited on.
        let held = watch.directories.clone();
        let guard = held.lock().unwrap();
        watch.remove(&dir);
        drop(guard);
        watch.retain_documents(&Documents::default());
        assert_eq!(watch.watcher.calls[3..], [("unwatch", dir.clone())]);
        assert!(watch.directories().parents.is_empty());
    }

    #[test]
    fn a_removal_reported_while_watching_does_not_strand_the_directory() {
        let (dir, other) = (PathBuf::from("/watched"), PathBuf::from("/other"));
        let mut watch = FileWatch::<Recording>::with_watcher(|| {}).unwrap();
        watch.watch(&dir.join("doc.md")).unwrap();
        watch.watch(&other.join("doc.md")).unwrap();
        watch.remove(&other);
        // Releasing `other` reports `dir` removed before `dir` is registered again.
        watch.watcher.removal_during_unwatch = Some(dir.clone());
        watch.watch(&dir.join("doc.md")).unwrap();
        watch.watch(&dir.join("doc.md")).unwrap();
        assert_eq!(
            watch.watcher.calls[2..],
            [
                ("unwatch", other.clone()),
                ("unwatch", dir.clone()),
                ("watch", dir.clone())
            ]
        );
        let directories = watch.directories();
        assert!(directories.parents.contains(&dir));
        assert!(directories.removed.is_empty());
    }

    #[test]
    fn without_a_watcher_every_watch_request_fails() {
        let error = watch_admitted::<Recording>(None, Path::new("/watched/doc.md")).unwrap_err();
        assert_eq!((error.status, error.error.as_str()), (500, "watch_failed"));
        assert_eq!(error.kind, files::FailureKind::Failure);
        let mut watch = FileWatch::<Recording>::with_watcher(|| {}).unwrap();
        watch_admitted(Some(&mut watch), Path::new("/watched/doc.md")).unwrap();
        assert_eq!(watch.watcher.calls, [("watch", PathBuf::from("/watched"))]);
    }

    #[test]
    fn releasing_watches_does_not_wait_on_the_event_callback() {
        use std::sync::atomic::{AtomicBool, Ordering};
        use std::time::Duration;
        let base = TempDir::new("watch-churn");
        let (kept, released) = (base.join("kept"), base.join("released"));
        fs::create_dir_all(&kept).unwrap();
        fs::create_dir_all(&released).unwrap();
        let stop = Arc::new(AtomicBool::new(false));
        let churn = {
            let (stop, kept) = (stop.clone(), kept.clone());
            std::thread::spawn(move || {
                for index in 0.. {
                    if stop.load(Ordering::Relaxed) {
                        break;
                    }
                    let file = kept.join(format!("churn-{}", index % 50));
                    let _ = fs::write(&file, b"x");
                    let _ = fs::remove_file(&file);
                }
            })
        };
        let (progress, rounds) = std::sync::mpsc::channel();
        let (kept_doc, released_doc) = (kept.join("doc.md"), released.join("doc.md"));
        // Detached so a deadlock fails the timeout below instead of blocking the test run.
        std::thread::spawn(move || {
            let mut watch = FileWatch::new(|| {}).unwrap();
            let mut docs = Documents::default();
            docs.insert(kept_doc.to_str().unwrap().into(), None);
            watch.watch(&kept_doc).unwrap();
            for round in 0..100 {
                watch.watch(&released_doc).unwrap();
                watch.retain_documents(&docs);
                progress.send(round).unwrap();
            }
        });
        let mut last = None;
        while let Ok(round) = rounds.recv_timeout(Duration::from_secs(10)) {
            last = Some(round);
        }
        stop.store(true, Ordering::Relaxed);
        churn.join().unwrap();
        assert_eq!(
            last,
            Some(99),
            "releasing a watch stalled after round {last:?}"
        );
    }

    #[test]
    fn a_copy_can_replace_its_own_deleted_path() {
        let dir = TempDir::new("self-copy");
        let original = dir.join("a.md");
        fs::write(&original, "original").unwrap();
        let mut docs = Documents::default();
        docs.admit(Request {
            language: None,
            version: VERSION,
            paths: vec![original.to_str().unwrap().into()],
        });
        fs::remove_file(&original).unwrap();
        let docs = Mutex::new(docs);
        let result = save_copy(&docs, "0", &original, "recovered", false).unwrap();
        assert_eq!(result["meta"]["sessionId"], "1");
        assert_eq!(fs::read_to_string(&original).unwrap(), "recovered");
        let mut docs = docs.into_inner().unwrap();
        assert_eq!((docs.len(), docs.active_id), (1, Some(1)));
        let reopened = docs.admit(Request {
            language: None,
            version: VERSION,
            paths: vec![original.to_str().unwrap().into()],
        });
        assert_eq!(reopened.results[0].status, "already_open");
        assert_eq!(docs.active_id, Some(1));
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
        let dir = TempDir::new("first-read");
        let path = dir.join("document.md");
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
        let deleted = read_registered_document(&docs, "0").unwrap_err();
        assert_eq!(deleted.status, 404);
        assert_eq!(deleted.kind, files::FailureKind::Missing);
        assert!(!path.exists());
        assert!(docs.lock().unwrap().get(0).unwrap().snapshot.is_none());
    }

    #[test]
    fn reads_require_an_admitted_document_id() {
        let docs = Mutex::new(Documents::default());
        for id in ["0", "-1", "../file.md", "/tmp/file.md"] {
            let error = read_registered_document(&docs, id).unwrap_err();
            assert_eq!(error.status, 404);
            // A released or unknown document is not evidence that its file was deleted.
            assert_eq!(error.kind, files::FailureKind::Failure);
        }
    }
}
