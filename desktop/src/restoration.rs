//! The remembered set of open documents; [`restoration.md`](restoration.md) states the contract.

use mastermind_launch_check::protocol::MAX_FILES;
use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::Read,
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

/// Reads the inventory. `None` means the file is unreadable, corrupt, oversized, or of another
/// version, and restoration starts empty; a missing file is an empty inventory.
fn read(path: &Path) -> Option<OpenFiles> {
    let file = match fs::File::open(path) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Some(OpenFiles::default());
        }
        Err(_) => return None,
    };
    let mut bytes = Vec::new();
    file.take((MAX_INVENTORY_BYTES + 1) as u64)
        .read_to_end(&mut bytes)
        .ok()?;
    if bytes.len() > MAX_INVENTORY_BYTES {
        return None;
    }
    let saved: OpenFiles = serde_json::from_slice(&bytes).ok()?;
    if saved.version != FORMAT_VERSION {
        return None;
    }
    // Admission resolves relative paths against the working directory, which is not the person's.
    let files = saved
        .files
        .into_iter()
        .filter(|path| Path::new(path).is_absolute())
        .collect();
    Some(OpenFiles::new(files, saved.active))
}

fn write(path: &Path, files: &OpenFiles) -> Result<(), String> {
    let bytes = serde_json::to_vec_pretty(files).map_err(|e| e.to_string())?;
    crate::preferences::replace_file(path, &bytes, true)
}

type Writer = Box<dyn Fn(&Path, &OpenFiles) -> Result<(), String> + Send + Sync>;

#[derive(Default)]
struct WriterState {
    /// The latest inventory not yet written.
    pending: Option<OpenFiles>,
    /// What the file holds, when known, so an unchanged inventory is not rewritten.
    written: Option<OpenFiles>,
    running: bool,
}

/// Writes the inventory off the caller's thread. Changes arriving while a write waits or runs
/// replace one pending value, so a burst costs at most one more write.
pub struct Remember {
    path: PathBuf,
    settle: Duration,
    write: Writer,
    state: Mutex<WriterState>,
    idle: Condvar,
}

impl Remember {
    pub fn new(path: PathBuf) -> Arc<Self> {
        Self::with_writer(path, SETTLE, Box::new(write))
    }

    fn with_writer(path: PathBuf, settle: Duration, write: Writer) -> Arc<Self> {
        Arc::new(Self {
            path,
            settle,
            write,
            state: Mutex::default(),
            idle: Condvar::new(),
        })
    }

    /// Reads the remembered inventory for restoration; see [`read`].
    pub fn load(&self) -> OpenFiles {
        let saved = read(&self.path);
        self.state.lock().unwrap().written = saved.clone();
        saved.unwrap_or_default()
    }

    /// Schedules `files` to be written. Never waits on the filesystem.
    pub fn record(self: &Arc<Self>, files: OpenFiles) {
        let mut state = self.state.lock().unwrap();
        if state.pending.is_none() && state.written.as_ref() == Some(&files) {
            return;
        }
        state.pending = Some(files);
        if state.running {
            return;
        }
        state.running = true;
        let remember = self.clone();
        let spawned = std::thread::Builder::new()
            .name("open-files".into())
            .spawn(move || remember.drain());
        if let Err(error) = spawned {
            state.running = false;
            eprintln!("Could not remember open files: {error}");
        }
    }

    fn drain(&self) {
        std::thread::sleep(self.settle);
        loop {
            let files = {
                let mut state = self.state.lock().unwrap();
                match state.pending.take() {
                    Some(files) if state.written.as_ref() != Some(&files) => files,
                    Some(_) => continue,
                    None => {
                        state.running = false;
                        self.idle.notify_all();
                        return;
                    }
                }
            };
            self.write_now(files);
        }
    }

    /// A failed write leaves the session untouched; the next change tries again.
    fn write_now(&self, files: OpenFiles) {
        match (self.write)(&self.path, &files) {
            Ok(()) => self.state.lock().unwrap().written = Some(files),
            Err(error) => {
                self.state.lock().unwrap().written = None;
                eprintln!("Could not remember open files: {error}");
            }
        }
    }

    /// Writes a pending inventory before the process exits, after a write already running.
    pub fn flush(&self) {
        let state = self.state.lock().unwrap();
        let (mut state, _) = self
            .idle
            .wait_timeout_while(state, FLUSH_WAIT, |state| state.running)
            .unwrap();
        if state.running {
            return;
        }
        let Some(files) = state.pending.take() else {
            return;
        };
        if state.written.as_ref() == Some(&files) {
            return;
        }
        // Holding the state keeps a new writer thread from racing this write.
        state.running = true;
        drop(state);
        self.write_now(files);
        let mut state = self.state.lock().unwrap();
        state.running = false;
        self.idle.notify_all();
    }

    #[cfg(test)]
    fn wait_idle(&self) {
        let state = self.state.lock().unwrap();
        let (state, timeout) = self
            .idle
            .wait_timeout_while(state, Duration::from_secs(5), |state| state.running)
            .unwrap();
        assert!(!timeout.timed_out() && !state.running);
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::test_support::TempDir;
    use std::sync::mpsc;

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
        assert_eq!(remember.load(), OpenFiles::default());
        let saved = absolute_files(&root, &["a.md", "文档 b.md", "c.md"], Some("文档 b.md"));
        remember.record(saved.clone());
        remember.wait_idle();
        assert_eq!(read(&path), Some(saved.clone()));
        assert_eq!(Remember::new(path.clone()).load(), saved);
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
        assert_eq!(read(&path), Some(first));
        fs::remove_dir_all(&temp).unwrap();
        let retried = absolute_files(&root, &["b.md"], Some("b.md"));
        remember.record(retried.clone());
        remember.wait_idle();
        assert_eq!(read(&path), Some(retried));
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
            assert_eq!(remember.load(), OpenFiles::default(), "{contents:.40}");
            // Even an empty inventory replaces an unreadable file.
            remember.record(OpenFiles::default());
            remember.wait_idle();
            assert_eq!(read(&path), Some(OpenFiles::default()));
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
        assert_eq!(read(&path), Some(files(&[kept.as_str()], None)));
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

    #[test]
    fn a_burst_of_changes_writes_once_and_unchanged_inventories_are_not_rewritten() {
        let (sender, writes) = mpsc::channel();
        let remember = Remember::with_writer(
            PathBuf::from("/unused"),
            Duration::from_millis(200),
            Box::new(move |_, files| {
                sender.send(files.clone()).unwrap();
                Ok(())
            }),
        );
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
        remember.record(files(&["/a.md"], None));
        started.recv_timeout(Duration::from_secs(5)).unwrap();
        for paths in [&["/a.md", "/b.md"][..], &["/a.md", "/b.md", "/c.md"]] {
            remember.record(files(paths, None));
        }
        release.send(()).unwrap();
        started.recv_timeout(Duration::from_secs(5)).unwrap();
        release.send(()).unwrap();
        remember.wait_idle();
        assert_eq!(
            writes.try_iter().collect::<Vec<_>>(),
            [vec!["/a.md"], vec!["/a.md", "/b.md", "/c.md"]]
        );
    }

    #[test]
    fn flush_returns_after_the_pending_inventory_is_written() {
        let (sender, writes) = mpsc::channel();
        let remember = Remember::with_writer(
            PathBuf::from("/unused"),
            Duration::from_millis(300),
            Box::new(move |_, files| {
                sender.send(files.files.clone()).unwrap();
                Ok(())
            }),
        );
        remember.load();
        remember.record(files(&["/a.md"], None));
        // The settling writer thread counts as running, so flush waits for it.
        remember.flush();
        assert_eq!(writes.try_iter().collect::<Vec<_>>(), [vec!["/a.md"]]);
    }
}
