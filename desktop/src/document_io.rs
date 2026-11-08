use crate::{
    admission::Documents,
    files::{self, FileError, Identity, Snapshot},
};
use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use serde_json::{Value, json};
use std::{
    collections::HashSet,
    path::{Path, PathBuf},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
        mpsc,
    },
    time::Duration,
};
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;

/// Directories registered with the watcher, shared with its event callback. The callback only
/// reads it and moves a removed directory from `parents` to `removed`; `FileWatch` methods release
/// the backend registration afterwards. Watcher calls can join the thread that runs the callback,
/// so this lock is never held across a watcher call.
#[derive(Default)]
struct Directories {
    parents: HashSet<PathBuf>,
    removed: HashSet<PathBuf>,
    /// Watched documents, so events about their unrelated siblings can be ignored.
    documents: HashSet<PathBuf>,
}

impl Directories {
    /// Whether an event may concern a watched document or its translations. Only an event whose
    /// every path is another entry beside a watched document is ignored; events without paths,
    /// such as a rescan request, always concern them.
    fn concerns(&self, event: &notify::Event) -> bool {
        event.paths.is_empty()
            || event.paths.iter().any(|path| {
                self.documents.contains(path)
                    || self.parents.contains(path)
                    || path.file_name() == Some(std::ffi::OsStr::new(".mastermind"))
                    || !path.parent().is_some_and(|parent| {
                        self.documents
                            .iter()
                            .any(|document| document.parent() == Some(parent))
                    })
            })
    }

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

/// Records a removed watched directory so the next watch request registers it again, and reports
/// whether the event concerns a watched document. The callback never waits on `directories`; a
/// contended lock defers removed paths to the next `FileWatch` call and treats the event as
/// relevant.
fn observe(
    directories: &Mutex<Directories>,
    deferred: &mpsc::Sender<PathBuf>,
    event: &notify::Event,
) -> bool {
    match directories.try_lock() {
        Ok(mut directories) => {
            let concerns = directories.concerns(event);
            if event.kind.is_remove() {
                directories.forget(event.paths.iter().cloned());
            }
            concerns
        }
        Err(_) => {
            if event.kind.is_remove() {
                for path in &event.paths {
                    let _ = deferred.send(path.clone());
                }
            }
            true
        }
    }
}

/// How long a burst of watcher events gathers before one invalidation reaches the renderer.
pub const INVALIDATION_DELAY: Duration = Duration::from_millis(50);

/// Runs `emit` once, `delay` after the first of a burst of calls. A call after the pending flag
/// clears schedules another run, so no call goes unanswered by a later `emit`.
pub fn coalesce(delay: Duration, emit: impl Fn() + Send + Sync + 'static) -> impl Fn() + Send {
    let pending = Arc::new(AtomicBool::new(false));
    let emit = Arc::new(emit);
    move || {
        if pending.swap(true, Ordering::SeqCst) {
            return;
        }
        let (pending, emit) = (pending.clone(), emit.clone());
        std::thread::spawn(move || {
            std::thread::sleep(delay);
            pending.store(false, Ordering::SeqCst);
            emit();
        });
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
                // Events are invalidation hints, including overflow/errors; a fresh versioned read
                // decides.
                let relevant = match &event {
                    Ok(event) => observe(&shared, &defer, event) && !event.kind.is_access(),
                    Err(_) => true,
                };
                if relevant {
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
        self.directories().documents.retain(|path| {
            docs.entries()
                .any(|(_, document)| Path::new(&document.path) == path)
        });
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
        self.directories().documents.insert(source.to_owned());
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
    Ok(admitted_file(docs, id)?.0)
}

/// An admitted document's canonical path and the identity its file must continue.
fn admitted_file(docs: &Documents, id: &str) -> Result<(PathBuf, Option<Identity>), FileError> {
    let document = docs.get(admitted_id(docs, id)?).unwrap();
    Ok((PathBuf::from(&document.path), document.identity.clone()))
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

/// A document read: the snapshot, or only its version when the caller already holds it.
#[derive(Debug, serde::Serialize)]
#[serde(untagged)]
pub enum DocumentRead {
    Changed(Snapshot),
    Unchanged { version: String, unchanged: bool },
}

impl DocumentRead {
    fn unchanged(version: String) -> Self {
        Self::Unchanged {
            version,
            unchanged: true,
        }
    }
}

/// Reads an admitted document. A caller that passes the version it holds receives only that
/// version when the file still has it: a version an earlier read found settled is confirmed from
/// descriptor metadata, any other is read and hashed.
fn read_registered_document(
    docs: &Mutex<Documents>,
    id: &str,
    known: Option<&str>,
) -> Result<DocumentRead, FileError> {
    let (path, identity, settled) = {
        let mut docs = docs.lock().unwrap();
        let index = admitted_id(&docs, id)?;
        let document = docs.get_mut(index).unwrap();
        if let Some(snapshot) = document.snapshot.take() {
            return Ok(match known {
                Some(known) if known == snapshot.version => {
                    DocumentRead::unchanged(snapshot.version)
                }
                _ => DocumentRead::Changed(snapshot),
            });
        }
        (
            PathBuf::from(&document.path),
            document.identity.clone(),
            document.settled_version.clone(),
        )
    };
    if let Some(known) = known.filter(|known| settled.as_deref() == Some(*known)) {
        // A failed check falls through to the full read, which reports the failure.
        if files::unchanged(&path, identity.as_ref(), known).unwrap_or(false) {
            return Ok(DocumentRead::unchanged(known.to_owned()));
        }
    }
    let snapshot = files::read(&path, identity.as_ref())?;
    {
        let mut docs = docs.lock().unwrap();
        // The document may have closed, or Save As replaced its entry, during the read.
        if let Some(document) = admitted_id(&docs, id)
            .ok()
            .and_then(|index| docs.get_mut(index))
            && document.path == path.to_string_lossy()
        {
            document.settled_version = snapshot.settled.then(|| snapshot.version.clone());
        }
    }
    Ok(match known {
        Some(known) if known == snapshot.version => DocumentRead::unchanged(snapshot.version),
        _ => DocumentRead::Changed(snapshot),
    })
}

#[tauri::command]
pub async fn read_document(
    id: String,
    known_version: Option<String>,
    docs: State<'_>,
) -> Result<DocumentRead, FileError> {
    let docs = docs.inner().clone();
    crate::worker::blocking_work()
        .run(move || read_registered_document(&docs, &id, known_version.as_deref()))
        .await?
}

static DOCUMENT_WRITES: Mutex<()> = Mutex::new(());

fn serialized_write<T>(
    docs: &Mutex<Documents>,
    id: &str,
    write: impl FnOnce(PathBuf, Option<Identity>) -> Result<T, FileError>,
) -> Result<T, FileError> {
    let _write = DOCUMENT_WRITES.lock().unwrap();
    let (path, identity) = admitted_file(&docs.lock().unwrap(), id)?;
    write(path, identity)
}

/// A save's reply. The renderer already holds the content it sent, so only the new version and
/// lossiness return.
#[derive(Debug, PartialEq, serde::Serialize)]
pub struct Written {
    version: String,
    lossy: bool,
}

fn write_registered_document(
    docs: &Mutex<Documents>,
    id: &str,
    content: &str,
    base_version: &str,
) -> Result<Written, FileError> {
    let written = serialized_write(docs, id, |path, identity| {
        files::write(&path, content, base_version, identity.as_ref())
    })?;
    Ok(Written {
        version: written.version,
        lossy: written.lossy,
    })
}

#[tauri::command]
pub async fn write_document(
    id: String,
    content: String,
    base_version: String,
    docs: State<'_>,
) -> Result<Written, FileError> {
    let docs = docs.inner().clone();
    crate::worker::blocking_work()
        .run(move || write_registered_document(&docs, &id, &content, &base_version))
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
                crate::opening::inventory_changed(&app);
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
            serialized_write(&first_docs, "0", |path, _| {
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
            serialized_write(&docs, "0", |_, _| {
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
        let initial = changed(read_registered_document(&docs, "0", None));
        assert_eq!(initial.bytes, b"admitted\r\n");
        let deleted = read_registered_document(&docs, "0", None).unwrap_err();
        assert_eq!(deleted.status, 404);
        assert_eq!(deleted.kind, files::FailureKind::Missing);
        assert!(!path.exists());
        assert!(docs.lock().unwrap().get(0).unwrap().snapshot.is_none());
    }

    #[test]
    fn reads_require_an_admitted_document_id() {
        let docs = Mutex::new(Documents::default());
        for id in ["0", "-1", "../file.md", "/tmp/file.md"] {
            let error = read_registered_document(&docs, id, None).unwrap_err();
            assert_eq!(error.status, 404);
            // A released or unknown document is not evidence that its file was deleted.
            assert_eq!(error.kind, files::FailureKind::Failure);
        }
    }

    fn changed(read: Result<DocumentRead, FileError>) -> Snapshot {
        match read.unwrap() {
            DocumentRead::Changed(snapshot) => snapshot,
            unchanged => panic!("expected content, got {unchanged:?}"),
        }
    }

    fn admitted_fixture(name: &str, content: &[u8]) -> (TempDir, PathBuf, Mutex<Documents>) {
        let dir = TempDir::new(name);
        let path = dir.join("document.md");
        fs::write(&path, content).unwrap();
        let mut docs = Documents::default();
        docs.admit(Request {
            language: None,
            version: VERSION,
            paths: vec![path.to_str().unwrap().into()],
        });
        (dir, path, Mutex::new(docs))
    }

    #[test]
    fn a_read_that_knows_the_current_version_returns_no_content() {
        let (_dir, path, docs) = admitted_fixture("known-version", b"original\r\n");
        let version = changed(read_registered_document(&docs, "0", None)).version;
        let read = read_registered_document(&docs, "0", Some(&version)).unwrap();
        assert_eq!(
            serde_json::to_value(&read).unwrap(),
            json!({ "version": version, "unchanged": true })
        );
        // The same size with different bytes is read even if the stamp could not tell them apart.
        std::thread::sleep(std::time::Duration::from_millis(20));
        fs::write(&path, b"Original\r\n").unwrap();
        let reread = changed(read_registered_document(&docs, "0", Some(&version)));
        assert_ne!(reread.version, version);
        assert_eq!(reread.bytes, b"Original\r\n");
        // A version the caller does not hold returns the snapshot.
        assert_eq!(
            changed(read_registered_document(&docs, "0", Some("stale"))).version,
            reread.version
        );
    }

    #[test]
    fn only_a_settled_version_is_confirmed_by_its_stamp_without_hashing() {
        let (_dir, _path, docs) = admitted_fixture("settled-version", b"original\r\n");
        let version = changed(read_registered_document(&docs, "0", None)).version;
        // A file read just after it changed is not settled, so its next check reads and hashes.
        assert_eq!(docs.lock().unwrap().get(0).unwrap().settled_version, None);
        // A version with the file's stamp but other bytes tells the two paths apart: the stamp
        // alone accepts it, the digest refuses it.
        let (stamp, _) = version.rsplit_once(':').unwrap();
        let forged = format!("{stamp}:0");
        docs.lock().unwrap().get_mut(0).unwrap().settled_version = Some(forged.clone());
        let read = read_registered_document(&docs, "0", Some(&forged)).unwrap();
        assert!(matches!(read, DocumentRead::Unchanged { version, .. } if version == forged));
        docs.lock().unwrap().get_mut(0).unwrap().settled_version = None;
        assert_eq!(
            changed(read_registered_document(&docs, "0", Some(&forged))).version,
            version
        );
    }

    #[test]
    fn a_save_replies_with_its_version_and_lossiness_only() {
        let (_dir, path, docs) = admitted_fixture("write-reply", b"original\r\n");
        let base = changed(read_registered_document(&docs, "0", None)).version;
        let written = write_registered_document(&docs, "0", "edited\r\n", &base).unwrap();
        let reply = serde_json::to_value(&written).unwrap();
        assert_eq!(reply.as_object().unwrap().len(), 2);
        assert_eq!(reply["lossy"], false);
        assert_eq!(fs::read(&path).unwrap(), b"edited\r\n");
        // The save's own watcher event reads back the written version without content.
        let version = reply["version"].as_str().unwrap();
        assert!(matches!(
            read_registered_document(&docs, "0", Some(version)).unwrap(),
            DocumentRead::Unchanged { .. }
        ));
    }

    #[test]
    fn events_about_unrelated_siblings_do_not_invalidate() {
        use std::sync::atomic::AtomicUsize;
        let dir = PathBuf::from("/watched");
        let document = dir.join("doc.md");
        let count = Arc::new(AtomicUsize::new(0));
        let counted = count.clone();
        let mut watch = FileWatch::<Recording>::with_watcher(move || {
            counted.fetch_add(1, Ordering::SeqCst);
        })
        .unwrap();
        watch.watch(&document).unwrap();
        let mut deliver = |kind: notify::EventKind, paths: &[PathBuf]| {
            let event = paths.iter().fold(notify::Event::new(kind), |event, path| {
                event.add_path(path.clone())
            });
            watch.watcher.handler.handle_event(Ok(event));
            count.swap(0, Ordering::SeqCst)
        };
        let modify = notify::EventKind::Modify(notify::event::ModifyKind::Any);
        let access = notify::EventKind::Access(notify::event::AccessKind::Any);
        assert_eq!(deliver(modify, &[dir.join("sibling.txt")]), 0);
        assert_eq!(deliver(modify, &[dir.join("other.md")]), 0);
        assert_eq!(deliver(access, std::slice::from_ref(&document)), 0);
        assert_eq!(deliver(modify, std::slice::from_ref(&document)), 1);
        // A rename into place names both the temporary file and the document.
        let rename = notify::EventKind::Modify(notify::event::ModifyKind::Name(
            notify::event::RenameMode::Both,
        ));
        assert_eq!(
            deliver(rename, &[dir.join(".doc.md.tmp"), document.clone()]),
            1
        );
        assert_eq!(deliver(modify, &[dir.join(".mastermind")]), 1);
        let artifact = dir.join(".mastermind/translations/doc.md.fr.json");
        assert_eq!(deliver(modify, &[artifact]), 1);
        assert_eq!(deliver(notify::EventKind::Any, &[]), 1);
        assert_eq!(deliver(modify, std::slice::from_ref(&dir)), 1);
        // Without the directory set, the event cannot be judged and invalidates.
        let held = watch.directories.clone();
        let guard = held.lock().unwrap();
        assert_eq!(deliver(modify, &[dir.join("sibling.txt")]), 1);
        drop(guard);
        watch
            .watcher
            .handler
            .handle_event(Err(notify::Error::generic("overflow")));
        assert_eq!(count.swap(0, Ordering::SeqCst), 1);
        // A closed document's siblings, including itself, no longer concern the watch.
        watch.retain_documents(&Documents::default());
        assert!(watch.directories().documents.is_empty());
    }

    #[test]
    fn a_burst_of_invalidations_emits_once() {
        use std::sync::atomic::AtomicUsize;
        use std::time::Duration;
        let count = Arc::new(AtomicUsize::new(0));
        let counted = count.clone();
        let invalidate = coalesce(Duration::from_millis(100), move || {
            counted.fetch_add(1, Ordering::SeqCst);
        });
        for _ in 0..50 {
            invalidate();
        }
        std::thread::sleep(Duration::from_millis(400));
        assert_eq!(count.load(Ordering::SeqCst), 1);
        invalidate();
        std::thread::sleep(Duration::from_millis(400));
        assert_eq!(count.load(Ordering::SeqCst), 2);
    }
}
