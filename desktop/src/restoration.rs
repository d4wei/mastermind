//! The remembered set of open documents; [`restoration.md`](restoration.md) states the contract.

use mastermind_launch_check::protocol::MAX_FILES;
use serde::{Deserialize, Serialize};
use std::{
    path::{Path, PathBuf},
    sync::{Arc, Condvar, Mutex},
    time::Duration,
};

/// The inventory file's format version; a file naming any other version is ignored.
pub const FORMAT_VERSION: u32 = 1;
/// Remembers at most as many documents as one opening request may name.
pub const MAX_REMEMBERED: usize = MAX_FILES;
const MAX_INVENTORY_BYTES: usize = 1024 * 1024;
/// How long a change waits for others before the write, so a burst of admissions writes once.
const SETTLE: Duration = Duration::from_millis(100);
/// How long exit waits for a write already in progress.
const FLUSH_WAIT: Duration = Duration::from_secs(2);

/// The open documents' canonical paths in admission order, and the active one.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct OpenFiles {
    pub version: u32,
    pub files: Vec<String>,
    pub active: Option<String>,
}

impl Default for OpenFiles {
    fn default() -> Self {
        Self::new(vec![], None)
    }
}

impl OpenFiles {
    /// Keeps the most recently admitted documents within the bound. The active path survives only
    /// when it is one of them.
    pub fn new(files: Vec<String>, active: Option<String>) -> Self {
        let files = files[files.len().saturating_sub(MAX_REMEMBERED)..].to_vec();
        let active = active.filter(|active| files.contains(active));
        Self {
            version: FORMAT_VERSION,
            files,
            active,
        }
    }
}

/// The inventory file beside the preference file, named after it so a disposable preference
/// override also isolates the remembered documents.
pub fn inventory_path(preferences: &Path) -> PathBuf {
    let stem = preferences
        .file_stem()
        .map(|stem| stem.to_string_lossy().into_owned())
        .unwrap_or_default();
    preferences.with_file_name(format!("{stem}.open-files.json"))
}

/// What the inventory file held when restoration read it.
#[derive(Clone, Debug, PartialEq)]
pub enum Saved {
    /// A usable inventory; a missing file is an empty one.
    Read(OpenFiles),
    /// Corrupt, oversized, or of another version. Restoration starts empty and replaces it.
    Unusable,
    /// The file could not be read this time, as with a sharing violation. Restoration starts
    /// empty and leaves the file until the open documents change.
    Unreadable,
}

fn read(path: &Path) -> Saved {
    let bytes = match crate::preferences::read_bounded(path, MAX_INVENTORY_BYTES) {
        Ok(Some(bytes)) => bytes,
        Ok(None) => return Saved::Read(OpenFiles::default()),
        Err(error) if error.kind() == std::io::ErrorKind::FileTooLarge => return Saved::Unusable,
        Err(_) => return Saved::Unreadable,
    };
    let Ok(saved) = serde_json::from_slice::<OpenFiles>(&bytes) else {
        return Saved::Unusable;
    };
    if saved.version != FORMAT_VERSION {
        return Saved::Unusable;
    }
    // Admission resolves relative paths against the working directory, which is not the person's.
    let files = saved
        .files
        .into_iter()
        .filter(|path| Path::new(path).is_absolute())
        .collect();
    Saved::Read(OpenFiles::new(files, saved.active))
}

fn write(path: &Path, files: &OpenFiles) -> Result<(), String> {
    let bytes = serde_json::to_vec_pretty(files).map_err(|e| e.to_string())?;
    crate::preferences::replace_file(path, &bytes, true)
}

pub(crate) type Writer = Box<dyn Fn(&Path, &OpenFiles) -> Result<(), String> + Send + Sync>;

#[derive(Default)]
struct WriterState {
    /// The latest recorded inventory the writer has not yet taken.
    pending: Option<OpenFiles>,
    /// What the file holds, when known. Only the writer thread compares against it, and only
    /// between writes, so it never stands for a write still in flight.
    written: Option<OpenFiles>,
    writing: bool,
    /// Set by `flush` and on drop: the writer stops waiting for the settling delay.
    urgent: bool,
    /// Set on drop: the writer exits once nothing is pending.
    closed: bool,
    /// The writer thread could not start, so nothing writes recorded inventories.
    stopped: bool,
}

struct Shared {
    path: PathBuf,
    settle: Duration,
    write: Writer,
    state: Mutex<WriterState>,
    /// Signals a recorded inventory, urgency, and the end of each write.
    changed: Condvar,
}

/// Writes the inventory on one writer thread. Changes arriving while a write waits or runs
/// replace one pending value, so a burst costs at most one more write.
pub struct Remember {
    shared: Arc<Shared>,
}

impl Remember {
    pub fn new(path: PathBuf) -> Arc<Self> {
        Self::with_writer(path, SETTLE, Box::new(write))
    }

    pub(crate) fn with_writer(path: PathBuf, settle: Duration, write: Writer) -> Arc<Self> {
        let shared = Arc::new(Shared {
            path,
            settle,
            write,
            state: Mutex::default(),
            changed: Condvar::new(),
        });
        let writer = shared.clone();
        let spawned = std::thread::Builder::new()
            .name("open-files".into())
            .spawn(move || writer.run());
        if let Err(error) = spawned {
            shared.state.lock().unwrap().stopped = true;
            eprintln!("Could not remember open files: {error}");
        }
        Arc::new(Self { shared })
    }

    /// Reads the remembered inventory for restoration and notes what the file holds. Restoration
    /// calls it before anything is recorded.
    pub fn load(&self) -> Saved {
        let saved = read(&self.shared.path);
        self.shared.state.lock().unwrap().written = match &saved {
            Saved::Read(files) => Some(files.clone()),
            Saved::Unusable | Saved::Unreadable => None,
        };
        saved
    }

    /// Schedules `files` to be written. Never waits on the filesystem.
    pub fn record(&self, files: OpenFiles) {
        let mut state = self.shared.state.lock().unwrap();
        if state.stopped {
            return;
        }
        state.pending = Some(files);
        self.shared.changed.notify_all();
    }

    /// Returns once the latest recorded inventory is on disk, including one recorded during a
    /// write in progress, or after a bounded wait.
    pub fn flush(&self) {
        let mut state = self.shared.state.lock().unwrap();
        state.urgent = true;
        self.shared.changed.notify_all();
        let (mut state, _) = self
            .shared
            .changed
            .wait_timeout_while(state, FLUSH_WAIT, |state| state.busy())
            .unwrap();
        state.urgent = state.closed;
    }

    #[cfg(test)]
    fn wait_idle(&self) {
        let state = self.shared.state.lock().unwrap();
        let (state, timeout) = self
            .shared
            .changed
            .wait_timeout_while(state, Duration::from_secs(5), |state| state.busy())
            .unwrap();
        assert!(!timeout.timed_out() && !state.busy());
    }
}

impl Drop for Remember {
    /// Writes what is pending without settling, then lets the writer thread exit.
    fn drop(&mut self) {
        let mut state = self.shared.state.lock().unwrap();
        state.closed = true;
        state.urgent = true;
        self.shared.changed.notify_all();
    }
}

impl WriterState {
    fn busy(&self) -> bool {
        !self.stopped && (self.pending.is_some() || self.writing)
    }
}

impl Shared {
    fn run(&self) {
        let mut state = self.state.lock().unwrap();
        loop {
            state = self
                .changed
                .wait_while(state, |state| state.pending.is_none() && !state.closed)
                .unwrap();
            if state.pending.is_none() {
                return;
            }
            // Waiting lets a burst of changes replace the pending value before one write.
            state = self
                .changed
                .wait_timeout_while(state, self.settle, |state| !state.urgent)
                .unwrap()
                .0;
            let files = state.pending.take().unwrap();
            if state.written.as_ref() == Some(&files) {
                self.changed.notify_all();
                continue;
            }
            state.writing = true;
            drop(state);
            let result = (self.write)(&self.path, &files);
            state = self.state.lock().unwrap();
            // A failed write leaves the session untouched; the next change tries again.
            state.written = match result {
                Ok(()) => Some(files),
                Err(error) => {
                    eprintln!("Could not remember open files: {error}");
                    None
                }
            };
            state.writing = false;
            self.changed.notify_all();
        }
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::test_support::TempDir;
    use std::{fs, sync::mpsc};

    pub(crate) fn wait_idle(remember: &Remember) {
        remember.wait_idle();
    }

    fn files(paths: &[&str], active: Option<&str>) -> OpenFiles {
        OpenFiles::new(
            paths.iter().map(|path| (*path).to_owned()).collect(),
            active.map(str::to_owned),
        )
    }

    /// An absolute document path on this platform: `read` drops relative entries, and a
    /// Unix-style `/a.md` is relative on Windows.
    fn absolute(root: &TempDir, name: &str) -> String {
        root.join(name).to_str().unwrap().to_owned()
    }

    fn absolute_files(root: &TempDir, names: &[&str], active: Option<&str>) -> OpenFiles {
        let paths: Vec<String> = names.iter().map(|name| absolute(root, name)).collect();
        let active = active.map(|name| absolute(root, name));
        files(
            &paths.iter().map(String::as_str).collect::<Vec<_>>(),
            active.as_deref(),
        )
    }

    #[test]
    fn the_inventory_lives_beside_the_preference_file_under_its_name() {
        assert_eq!(
            inventory_path(Path::new("/config/reviewer.json")),
            Path::new("/config/reviewer.open-files.json")
        );
        assert_eq!(
            inventory_path(Path::new("/tmp/run-preferences.json")),
            Path::new("/tmp/run-preferences.open-files.json")
        );
    }

    #[test]
    fn written_inventories_read_back_in_order_with_the_active_path() {
        let root = TempDir::new("open-files-round-trip");
        let path = root.join("reviewer.open-files.json");
        let remember = Remember::new(path.clone());
        assert_eq!(remember.load(), Saved::Read(OpenFiles::default()));
        let saved = absolute_files(&root, &["a.md", "文档 b.md", "c.md"], Some("文档 b.md"));
        remember.record(saved.clone());
        remember.wait_idle();
        assert_eq!(read(&path), Saved::Read(saved.clone()));
        assert_eq!(Remember::new(path.clone()).load(), Saved::Read(saved));
        let temp = root.join("reviewer.open-files.json.tmp");
        assert!(!temp.exists());
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = fs::metadata(&path).unwrap().permissions().mode();
            assert_eq!(mode & 0o777, 0o600);
        }
    }

    #[test]
    fn a_failed_replacement_keeps_the_previous_inventory_and_retries_on_the_next_change() {
        let root = TempDir::new("open-files-failed");
        let path = root.join("reviewer.open-files.json");
        let first = absolute_files(&root, &["a.md"], Some("a.md"));
        write(&path, &first).unwrap();
        // A nonempty directory at the temporary path makes creating the temporary file fail.
        let temp = root.join("reviewer.open-files.json.tmp");
        fs::create_dir(&temp).unwrap();
        fs::write(temp.join("kept"), b"").unwrap();
        let remember = Remember::with_writer(path.clone(), Duration::ZERO, Box::new(write));
        remember.load();
        remember.record(absolute_files(&root, &["a.md", "b.md"], None));
        remember.wait_idle();
        assert_eq!(read(&path), Saved::Read(first));
        fs::remove_dir_all(&temp).unwrap();
        let retried = absolute_files(&root, &["b.md"], Some("b.md"));
        remember.record(retried.clone());
        remember.wait_idle();
        assert_eq!(read(&path), Saved::Read(retried));
    }

    #[test]
    fn corrupt_oversized_and_unknown_version_inventories_restore_nothing_and_are_replaced() {
        let root = TempDir::new("open-files-corrupt");
        let path = root.join("reviewer.open-files.json");
        let oversized = format!(
            "{{\"version\":1,\"files\":[\"/{}\"],\"active\":null}}",
            "x".repeat(MAX_INVENTORY_BYTES)
        );
        for contents in [
            "not json".to_owned(),
            r#"{"version":2,"files":["/a.md"],"active":null}"#.to_owned(),
            r#"{"version":1,"files":["/a.md"],"active":null,"extra":true}"#.to_owned(),
            r#"{"files":["/a.md"]}"#.to_owned(),
            oversized,
        ] {
            fs::write(&path, &contents).unwrap();
            let remember = Remember::new(path.clone());
            assert_eq!(remember.load(), Saved::Unusable, "{contents:.40}");
            // Even an empty inventory replaces an unreadable file.
            remember.record(OpenFiles::default());
            remember.wait_idle();
            assert_eq!(read(&path), Saved::Read(OpenFiles::default()));
        }
    }

    #[test]
    fn relative_entries_and_a_foreign_active_path_are_dropped_on_read() {
        let root = TempDir::new("open-files-relative");
        let path = root.join("reviewer.open-files.json");
        let kept = absolute(&root, "a.md");
        let saved = serde_json::json!({
            "version": 1,
            "files": ["relative.md", kept],
            "active": "relative.md",
        });
        fs::write(&path, saved.to_string()).unwrap();
        assert_eq!(read(&path), Saved::Read(files(&[kept.as_str()], None)));
    }

    #[test]
    fn the_bound_keeps_the_most_recent_documents() {
        let paths: Vec<String> = (0..MAX_REMEMBERED + 3)
            .map(|i| format!("/{i}.md"))
            .collect();
        let bounded = OpenFiles::new(paths.clone(), Some("/1.md".into()));
        assert_eq!(bounded.files, paths[3..]);
        assert_eq!(bounded.active, None);
        let kept = OpenFiles::new(paths.clone(), paths.last().cloned());
        assert_eq!(kept.active.as_deref(), paths.last().map(String::as_str));
    }

    /// A remembering writer that reports every inventory it writes.
    pub(crate) fn recording(
        path: PathBuf,
        settle: Duration,
    ) -> (Arc<Remember>, mpsc::Receiver<OpenFiles>) {
        let (sender, writes) = mpsc::channel();
        let remember = Remember::with_writer(
            path,
            settle,
            Box::new(move |_, files| {
                sender.send(files.clone()).unwrap();
                Ok(())
            }),
        );
        (remember, writes)
    }

    /// A writer whose writes each wait for `release` after announcing themselves on `started`.
    struct Gated {
        remember: Arc<Remember>,
        started: mpsc::Receiver<()>,
        release: mpsc::Sender<()>,
        writes: mpsc::Receiver<Vec<String>>,
    }

    impl Gated {
        fn new() -> Self {
            let (started_tx, started) = mpsc::channel();
            let (release, release_rx) = mpsc::channel::<()>();
            let release_rx = Mutex::new(release_rx);
            let (sender, writes) = mpsc::channel();
            let remember = Remember::with_writer(
                PathBuf::from("/unused"),
                Duration::ZERO,
                Box::new(move |_, files| {
                    started_tx.send(()).unwrap();
                    release_rx
                        .lock()
                        .unwrap()
                        .recv_timeout(Duration::from_secs(5))
                        .unwrap();
                    sender.send(files.files.clone()).unwrap();
                    Ok(())
                }),
            );
            remember.load();
            Self {
                remember,
                started,
                release,
                writes,
            }
        }

        /// Waits for the next write to start, then lets it finish.
        fn finish_next(&self) {
            self.started.recv_timeout(Duration::from_secs(5)).unwrap();
            self.release.send(()).unwrap();
        }
    }

    #[test]
    fn a_burst_of_changes_writes_once_and_unchanged_inventories_are_not_rewritten() {
        let (remember, writes) = recording(PathBuf::from("/unused"), Duration::from_millis(200));
        remember.load();
        for count in 1..=5 {
            let paths: Vec<String> = (0..count).map(|i| format!("/{i}.md")).collect();
            remember.record(OpenFiles::new(paths, None));
        }
        remember.wait_idle();
        let written: Vec<_> = writes.try_iter().collect();
        assert_eq!(written.len(), 1);
        assert_eq!(written[0].files.len(), 5);
        remember.record(written[0].clone());
        remember.wait_idle();
        assert!(writes.try_recv().is_err());
    }

    #[test]
    fn changes_during_a_write_coalesce_into_one_more_write() {
        let gated = Gated::new();
        gated.remember.record(files(&["/a.md"], None));
        gated.started.recv_timeout(Duration::from_secs(5)).unwrap();
        for paths in [&["/a.md", "/b.md"][..], &["/a.md", "/b.md", "/c.md"]] {
            gated.remember.record(files(paths, None));
        }
        gated.release.send(()).unwrap();
        gated.finish_next();
        gated.remember.wait_idle();
        assert_eq!(
            gated.writes.try_iter().collect::<Vec<_>>(),
            [vec!["/a.md"], vec!["/a.md", "/b.md", "/c.md"]]
        );
    }

    #[test]
    fn returning_to_the_saved_inventory_during_a_write_is_written_again() {
        // `load` found no file, so the file is taken to hold the empty inventory.
        let gated = Gated::new();
        gated.remember.record(files(&["/a.md"], None));
        gated.started.recv_timeout(Duration::from_secs(5)).unwrap();
        gated.remember.record(OpenFiles::default());
        gated.release.send(()).unwrap();
        gated.finish_next();
        gated.remember.wait_idle();
        assert_eq!(
            gated.writes.try_iter().collect::<Vec<_>>(),
            [vec!["/a.md"], vec![]]
        );
    }

    #[test]
    fn flush_returns_after_the_pending_inventory_is_written() {
        let (remember, writes) = recording(PathBuf::from("/unused"), Duration::from_secs(5));
        remember.load();
        remember.record(files(&["/a.md"], None));
        // Flushing skips the settling delay rather than waiting it out.
        let started = std::time::Instant::now();
        remember.flush();
        assert!(started.elapsed() < Duration::from_secs(2));
        assert_eq!(
            writes.try_iter().map(|f| f.files).collect::<Vec<_>>(),
            [vec!["/a.md"]]
        );
    }

    #[test]
    fn flush_waits_for_an_inventory_recorded_during_a_write_in_progress() {
        let gated = Gated::new();
        gated.remember.record(files(&["/a.md"], None));
        gated.started.recv_timeout(Duration::from_secs(5)).unwrap();
        let flushing = {
            let remember = gated.remember.clone();
            std::thread::spawn(move || remember.flush())
        };
        gated.remember.record(files(&["/b.md"], None));
        gated.release.send(()).unwrap();
        gated.finish_next();
        flushing.join().unwrap();
        assert_eq!(
            gated.writes.try_iter().collect::<Vec<_>>(),
            [vec!["/a.md"], vec!["/b.md"]]
        );
    }

    #[test]
    fn an_unreadable_inventory_is_reported_apart_from_a_corrupt_one() {
        let root = TempDir::new("open-files-unreadable");
        // Reading a directory fails as an I/O error on every platform.
        let path = root.join("reviewer.open-files.json");
        fs::create_dir(&path).unwrap();
        assert_eq!(Remember::new(path).load(), Saved::Unreadable);
    }
}
