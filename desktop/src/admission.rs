use crate::files::FileError;
use crate::restoration::{OpenFiles, Remember, Saved};
use mastermind_launch_check::protocol::{FileResult, MAX_FILES, Request, Response, VERSION};
use std::{
    collections::{BTreeMap, HashMap},
    fs,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};

pub const MARKDOWN_EXTENSIONS: &[&str] = &["md", "markdown"];

fn require_markdown(path: &Path) -> Result<(), FileError> {
    if path
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| {
            MARKDOWN_EXTENSIONS
                .iter()
                .any(|allowed| extension.eq_ignore_ascii_case(allowed))
        })
    {
        return Ok(());
    }
    Err(FileError::new(
        400,
        "not_markdown",
        "Choose a Markdown file (.md or .markdown).",
    ))
}

pub struct Document {
    pub path: String,
    /// The admission snapshot, released when the renderer first reads it.
    pub snapshot: Option<crate::files::Snapshot>,
    /// The file admission read; later reads and writes refuse a file that does not continue it.
    /// Only test fixtures register a document without one.
    pub identity: Option<crate::files::Identity>,
    pub language: Option<String>,
    /// The last version a read found `settled`; a read that knows it checks the stamp alone.
    pub settled_version: Option<String>,
}

enum Admission {
    Opened(usize),
    AlreadyOpen(usize),
}

#[derive(Default)]
pub struct Documents {
    entries: BTreeMap<usize, Document>,
    ids: HashMap<String, usize>,
    next_id: usize,
    pub activation_revision: u64,
    pub active_id: Option<usize>,
    pub opening_errors: Vec<String>,
    /// Remembered documents that could not be reopened, until the renderer reports them.
    pub restore_failures: Vec<String>,
    remembered: Option<Arc<Remember>>,
    /// Present until restoration has run; nothing is recorded meanwhile.
    restoration: Option<Arc<Restoration>>,
}

/// A remembered document's canonical path and contents, or why it cannot be readmitted.
type Reopened = Result<(String, crate::files::Snapshot), FileError>;

/// The inventory as read and each of its documents, in saved order.
type Reads = (Saved, Vec<Reopened>);

enum Prepared {
    Unread,
    Read(Reads),
    Applied,
}

/// The remembered documents, read once by whichever needs them first: the startup task, outside
/// the registry lock, or a registry entry point that reaches restoration before it.
pub struct Restoration {
    remember: Arc<Remember>,
    prepared: Mutex<Prepared>,
}

/// At most this many threads read remembered documents at once.
const RESTORE_READERS: usize = 8;

impl Restoration {
    /// Reads the inventory and its documents unless restoration already read or applied them.
    pub fn prepare(&self) {
        let mut prepared = self.prepared.lock().unwrap();
        if matches!(*prepared, Prepared::Unread) {
            *prepared = Prepared::Read(self.read());
        }
    }

    /// The prepared reads, reading them now if nothing has; `None` once restoration applied them.
    fn take(&self) -> Option<Reads> {
        let mut prepared = self.prepared.lock().unwrap();
        match std::mem::replace(&mut *prepared, Prepared::Applied) {
            Prepared::Unread => Some(self.read()),
            Prepared::Read(reads) => Some(reads),
            Prepared::Applied => None,
        }
    }

    fn read(&self) -> Reads {
        let saved = self.remember.load();
        let files = saved
            .files()
            .map_or(&[][..], |files| files.files.as_slice());
        let reads = if files.is_empty() {
            vec![]
        } else {
            let chunk = files.len().div_ceil(RESTORE_READERS);
            std::thread::scope(|scope| {
                let readers: Vec<_> = files
                    .chunks(chunk)
                    .map(|part| scope.spawn(|| part.iter().map(|p| reopen(p)).collect::<Vec<_>>()))
                    .collect();
                readers
                    .into_iter()
                    .flat_map(|reader| reader.join().unwrap())
                    .collect()
            })
        };
        (saved, reads)
    }
}

/// Reads a remembered document through the admission checks, without the registry.
fn reopen(path: &str) -> Reopened {
    let (canonical, display) = resolve(path)?;
    require_markdown(&canonical)?;
    Ok((display, crate::files::read(&canonical, None)?))
}

/// The canonical path a requested Markdown path names, and its registry key.
fn resolve(path: &str) -> Result<(PathBuf, String), FileError> {
    // The selected name decides the document type before any filesystem access.
    require_markdown(Path::new(path))?;
    let canonical = fs::canonicalize(path)?;
    let display = utf8_path(&canonical)?;
    Ok((canonical, display))
}

fn utf8_path(path: &Path) -> Result<String, FileError> {
    path.to_str().map(str::to_owned).ok_or_else(|| {
        FileError::new(
            400,
            "unsupported_path_encoding",
            "The file path is not valid UTF-8.",
        )
    })
}

impl Documents {
    /// Remembers the open documents through `remember` and restores its inventory on first use;
    /// see `restoration.md`. The startup task prepares the returned restoration.
    pub fn remember(&mut self, remember: Arc<Remember>) -> Arc<Restoration> {
        let restoration = Arc::new(Restoration {
            remember: remember.clone(),
            prepared: Mutex::new(Prepared::Unread),
        });
        self.remembered = Some(remember);
        self.restoration = Some(restoration.clone());
        restoration
    }

    /// Readmits the remembered documents once, before anything else enters the registry. Every
    /// registry entry point that admits or resolves documents calls it, so a request racing the
    /// startup restoration still finds the remembered documents admitted first.
    pub fn restore(&mut self) {
        let Some((saved, reads)) = self.restoration.take().and_then(|r| r.take()) else {
            return;
        };
        let (files, remembered_active) = saved.files().map_or((&[][..], None), |saved| {
            (saved.files.as_slice(), saved.active.as_ref())
        });
        let (mut first, mut active) = (None, None);
        for (path, read) in files.iter().zip(reads) {
            match read {
                Ok((display, snapshot)) => {
                    let id = match self.ids.get(&display) {
                        Some(&id) => id,
                        None => self.insert(display, Some(snapshot)),
                    };
                    first.get_or_insert(id);
                    if remembered_active == Some(path) {
                        active = Some(id);
                    }
                }
                Err(_) => self.restore_failures.push(path.clone()),
            }
        }
        // A file open event delivered before the host attached its inventory already chose the
        // active document; restoration only fills an empty selection.
        if self.active_id.is_none()
            && let Some(id) = active.or(first)
        {
            self.active_id = Some(id);
            self.activation_revision += 1;
        }
        // An unreadable inventory may still be valid; only a change to the open documents
        // replaces it.
        if !matches!(saved, Saved::Unreadable) {
            self.changed();
        }
    }

    /// Records the renderer's selection so the active document is remembered. A selection made
    /// before a newer activation is ignored, as that activation's choice stands.
    pub fn select(&mut self, id: usize, activation_revision: u64) {
        if activation_revision == self.activation_revision && self.entries.contains_key(&id) {
            self.active_id = Some(id);
            self.changed();
        }
    }

    /// Schedules the inventory write after a change to the open documents or the selection.
    fn changed(&self) {
        // Writing before restoration would replace the remembered inventory with a partial one.
        if self.restoration.is_some() {
            return;
        }
        if let Some(remember) = &self.remembered {
            let path = |id: usize| self.entries.get(&id).map(|d| d.path.clone());
            remember.record(OpenFiles::new(
                self.entries.values().map(|d| d.path.clone()).collect(),
                self.active_id.and_then(path),
            ));
        }
    }

    pub fn entries(&self) -> impl Iterator<Item = (usize, &Document)> {
        self.entries.iter().map(|(id, document)| (*id, document))
    }

    pub fn get(&self, id: usize) -> Option<&Document> {
        self.entries.get(&id)
    }

    pub fn get_mut(&mut self, id: usize) -> Option<&mut Document> {
        self.entries.get_mut(&id)
    }

    /// The document admitted under this canonical path.
    pub fn find(&self, canonical: &str) -> Option<usize> {
        self.ids.get(canonical).copied()
    }

    #[cfg(test)]
    pub fn len(&self) -> usize {
        self.entries.len()
    }

    pub(crate) fn insert(
        &mut self,
        path: String,
        snapshot: Option<crate::files::Snapshot>,
    ) -> usize {
        let id = self.next_id;
        self.next_id += 1;
        self.ids.insert(path.clone(), id);
        self.entries.insert(
            id,
            Document {
                path,
                identity: snapshot.as_ref().map(|snapshot| snapshot.identity.clone()),
                settled_version: snapshot
                    .as_ref()
                    .filter(|snapshot| snapshot.settled)
                    .map(|snapshot| snapshot.version.clone()),
                snapshot,
                language: None,
            },
        );
        id
    }

    fn remove(&mut self, id: usize) -> Option<Document> {
        let document = self.entries.remove(&id)?;
        self.ids.remove(&document.path);
        Some(document)
    }

    pub fn admit(&mut self, request: Request) -> Response {
        if request.version != VERSION {
            return Response::error("incompatible_version");
        }
        if request
            .language
            .as_ref()
            .is_some_and(|code| !mastermind_launch_check::protocol::language_code(code))
        {
            return Response::error("invalid_language");
        }
        if request.paths.is_empty()
            || request.paths.len() > MAX_FILES
            || request
                .paths
                .iter()
                .any(|p| !PathBuf::from(p).is_absolute())
        {
            return Response::error("invalid_request");
        }
        self.restore();
        let mut first = None;
        let results: Vec<FileResult> = request
            .paths
            .into_iter()
            .map(|path| match self.open(&path) {
                Ok(admission) => {
                    let (id, status) = match admission {
                        Admission::Opened(id) => (id, "opened"),
                        Admission::AlreadyOpen(id) => (id, "already_open"),
                    };
                    first.get_or_insert(id);
                    let document = self.entries.get_mut(&id).unwrap();
                    if document.language.is_none() {
                        document.language.clone_from(&request.language);
                    }
                    FileResult {
                        path,
                        canonical: Some(document.path.clone()),
                        status: status.into(),
                        error: None,
                        message: None,
                        reason: None,
                    }
                }
                Err(error) => FileResult {
                    path,
                    canonical: None,
                    status: "error".into(),
                    error: Some(error.error),
                    message: Some(error.message),
                    reason: None,
                },
            })
            .collect();
        if first.is_some() {
            self.active_id = first;
            self.activation_revision += 1;
            self.changed();
        }
        Response {
            version: VERSION,
            pid: std::process::id(),
            onboarding_needed: None,
            setup_results: None,
            results,
            error: None,
        }
    }

    pub fn close(&mut self, id: usize, active_id: Option<usize>, activation_revision: u64) {
        if self.remove(id).is_none() {
            return;
        }
        // A selection the renderer observed before a concurrent close may name a removed ID.
        if activation_revision == self.activation_revision
            && active_id.is_none_or(|active| self.entries.contains_key(&active) || active == id)
        {
            self.active_id = active_id;
        }
        if self.active_id == Some(id) {
            self.active_id = self
                .entries
                .range(id..)
                .next()
                .or_else(|| self.entries.iter().next_back())
                .map(|(id, _)| *id);
        }
        self.activation_revision += 1;
        self.changed();
    }

    fn open(&mut self, path: &str) -> Result<Admission, FileError> {
        let (canonical, display) = resolve(path)?;
        if let Some(&id) = self.ids.get(&display) {
            return Ok(Admission::AlreadyOpen(id));
        }
        require_markdown(&canonical)?;
        let snapshot = crate::files::read(&canonical, None)?;
        Ok(Admission::Opened(self.insert(display, Some(snapshot))))
    }

    /// Refuses a Save As destination registered to another document; see `files.md`.
    pub(crate) fn check_copy_destination(
        &self,
        origin: usize,
        canonical: &str,
    ) -> Result<(), FileError> {
        let destination = destination_key(canonical);
        if self
            .ids
            .iter()
            .any(|(path, id)| *id != origin && destination_key(path) == destination)
        {
            return Err(FileError::new(
                409,
                "already_open",
                "Another open document uses this path. Choose a different name.",
            ));
        }
        Ok(())
    }

    /// Registers a created copy in place of `origin`, as `files.md` specifies for Save As.
    pub(crate) fn replace_with_copy(
        &mut self,
        origin: usize,
        canonical: String,
        snapshot: crate::files::Snapshot,
    ) -> Result<usize, FileError> {
        self.check_copy_destination(origin, &canonical)?;
        let replaces_origin = self.remove(origin).is_some();
        let id = self.insert(canonical, Some(snapshot));
        if replaces_origin && self.active_id == Some(origin) {
            self.active_id = Some(id);
        }
        self.changed();
        Ok(id)
    }
}

/// The Save As destination comparison key; `files.md` states its case and normalization limits.
fn destination_key(path: &str) -> String {
    if cfg!(any(target_os = "macos", windows)) {
        path.to_lowercase()
    } else {
        path.to_owned()
    }
}

/// Validates a Save As destination before creation and returns its canonical path. Exclusive
/// creation refuses a final symlink, so the created file's canonical path is its canonical parent
/// joined with the selected name.
pub(crate) fn copy_destination(path: &Path) -> Result<String, FileError> {
    require_markdown(path)?;
    let invalid = || FileError::new(400, "invalid_path", "Choose a file path for the copy.");
    let name = path.file_name().ok_or_else(invalid)?;
    let parent = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .ok_or_else(invalid)?;
    utf8_path(path)?;
    utf8_path(&fs::canonicalize(parent)?.join(name))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::TempDir;

    #[test]
    fn only_markdown_documents_enter_the_registry() {
        let fixture = Fixture::new();
        let names = [
            "valid.md",
            "UPPER.MD",
            "long.markdown",
            "mixed.Markdown",
            "notebook.html",
            "notes.txt",
            "README",
            "fake.md.html",
        ];
        for name in names {
            fs::write(fixture.0.join(name), "# Text").unwrap();
        }
        let mut docs = Documents::default();
        let result = docs.admit(fixture.request(&names));
        assert!(
            result.results[..4]
                .iter()
                .all(|result| result.status == "opened")
        );
        assert!(
            result.results[4..]
                .iter()
                .all(|result| result.error.as_deref() == Some("not_markdown"))
        );
        assert_eq!(docs.len(), 4);
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(fixture.0.join("notebook.html"), fixture.0.join("alias.md"))
                .unwrap();
            std::os::unix::fs::symlink(fixture.0.join("valid.md"), fixture.0.join("alias.html"))
                .unwrap();
            let result = docs.admit(fixture.request(&["alias.md", "alias.html"]));
            assert!(
                result
                    .results
                    .iter()
                    .all(|result| result.error.as_deref() == Some("not_markdown"))
            );
            assert_eq!(docs.len(), 4);
        }
    }
    #[test]
    fn non_markdown_names_are_rejected_before_filesystem_access() {
        let fixture = Fixture::new();
        let large = fs::File::create(fixture.0.join("large.txt")).unwrap();
        large.set_len(crate::files::MAX_FILE_BYTES + 1).unwrap();
        fs::create_dir(fixture.0.join("folder.txt")).unwrap();
        let mut docs = Documents::default();
        let result = docs.admit(fixture.request(&["missing.txt", "large.txt", "folder.txt"]));
        assert!(
            result
                .results
                .iter()
                .all(|result| result.error.as_deref() == Some("not_markdown"))
        );
        assert_eq!(docs.len(), 0);
    }

    #[test]
    fn closing_ignores_a_selection_that_is_no_longer_admitted() {
        let fixture = Fixture::new();
        for name in ["a.md", "b.md", "c.md"] {
            fs::write(fixture.0.join(name), name).unwrap();
        }
        let mut docs = Documents::default();
        docs.admit(fixture.request(&["a.md", "b.md", "c.md"]));
        docs.close(1, Some(7), docs.activation_revision);
        assert_eq!(docs.active_id, Some(0));
        docs.close(2, Some(1), docs.activation_revision);
        assert_eq!(docs.active_id, Some(0));
    }

    #[test]
    fn a_new_copy_is_never_merged_into_a_registered_document() {
        let fixture = Fixture::new();
        fs::write(fixture.0.join("a.md"), "a").unwrap();
        fs::write(fixture.0.join("stale.md"), "stale").unwrap();
        let mut docs = Documents::default();
        docs.admit(fixture.request(&["a.md", "stale.md"]));
        fs::remove_file(fixture.0.join("stale.md")).unwrap();
        let stale = copy_destination(&fixture.0.join("stale.md")).unwrap();
        let error = docs.check_copy_destination(0, &stale).unwrap_err();
        assert_eq!((error.status, error.error.as_str()), (409, "already_open"));
        assert!(docs.check_copy_destination(1, &stale).is_ok());
        let snapshot = docs.get(0).unwrap().snapshot.clone().unwrap();
        assert_eq!(
            docs.replace_with_copy(0, stale, snapshot)
                .unwrap_err()
                .error,
            "already_open"
        );
        assert_eq!(docs.len(), 2);
        assert!(docs.get(0).unwrap().snapshot.is_some());
    }

    #[test]
    fn a_copy_whose_origin_closed_during_creation_is_admitted_as_a_new_document() {
        let fixture = Fixture::new();
        fs::write(fixture.0.join("a.md"), "a").unwrap();
        fs::write(fixture.0.join("b.md"), "b").unwrap();
        let mut docs = Documents::default();
        docs.admit(fixture.request(&["a.md", "b.md"]));
        docs.close(0, Some(0), docs.activation_revision);
        assert_eq!(docs.active_id, Some(1));
        fs::write(fixture.0.join("copy.md"), "a").unwrap();
        let destination = copy_destination(&fixture.0.join("copy.md")).unwrap();
        let snapshot = crate::files::read(Path::new(&destination), None).unwrap();
        let revision = docs.activation_revision;
        let id = docs
            .replace_with_copy(0, destination.clone(), snapshot)
            .unwrap();
        assert_eq!(docs.get(id).unwrap().path, destination);
        assert_eq!(docs.len(), 2);
        assert_eq!(
            (docs.active_id, docs.activation_revision),
            (Some(1), revision)
        );
    }

    #[cfg(any(target_os = "macos", windows))]
    #[test]
    fn copy_destinations_differing_only_by_case_are_refused() {
        let fixture = Fixture::new();
        fs::write(fixture.0.join("a.md"), "a").unwrap();
        fs::write(fixture.0.join("stale.md"), "stale").unwrap();
        let mut docs = Documents::default();
        docs.admit(fixture.request(&["a.md", "stale.md"]));
        fs::remove_file(fixture.0.join("stale.md")).unwrap();
        let alias = copy_destination(&fixture.0.join("STALE.md")).unwrap();
        assert_eq!(
            docs.check_copy_destination(0, &alias).unwrap_err().error,
            "already_open"
        );
    }

    impl Fixture {
        /// A fixture holding each named file, whose contents are its name.
        fn with_files(names: &[&str]) -> Self {
            let fixture = Self::new();
            for name in names {
                fs::write(fixture.0.join(name), name).unwrap();
            }
            fixture
        }

        fn inventory(&self) -> PathBuf {
            self.0.join("reviewer.open-files.json")
        }

        /// A registry remembering through this fixture's inventory, as a fresh host would.
        fn remembering(&self) -> (Documents, Arc<Remember>) {
            let remember = Remember::new(self.inventory());
            let mut docs = Documents::default();
            docs.remember(remember.clone());
            (docs, remember)
        }

        fn remembered(&self) -> OpenFiles {
            match Remember::new(self.inventory()).load() {
                Saved::Read(files) => files,
                other => panic!("the inventory is not usable: {other:?}"),
            }
        }
    }

    fn paths(docs: &Documents) -> Vec<String> {
        docs.entries().map(|(_, d)| d.path.clone()).collect()
    }

    use crate::restoration::tests::wait_idle;

    #[test]
    fn open_documents_and_the_selection_are_restored_in_order_after_a_relaunch() {
        let fixture = Fixture::with_files(&["a.md", "b.md", "c.md"]);
        let (mut docs, remember) = fixture.remembering();
        docs.restore();
        docs.admit(fixture.request(&["c.md", "a.md"]));
        docs.admit(fixture.request(&["b.md"]));
        docs.select(1, docs.activation_revision);
        wait_idle(&remember);
        let saved = fixture.remembered();
        assert_eq!(saved.files, paths(&docs));
        assert_eq!(saved.active, Some(docs.get(1).unwrap().path.clone()));

        let (mut relaunched, _) = fixture.remembering();
        relaunched.restore();
        assert_eq!(paths(&relaunched), saved.files);
        assert_eq!(relaunched.active_id, Some(1));
        assert_eq!(relaunched.activation_revision, 1);
        assert!(relaunched.restore_failures.is_empty());
        // Restoration only reads; the files keep their bytes.
        for name in ["a.md", "b.md", "c.md"] {
            assert_eq!(fs::read_to_string(fixture.0.join(name)).unwrap(), name);
        }
        relaunched.restore();
        assert_eq!(relaunched.len(), 3);
        assert_eq!(relaunched.activation_revision, 1);
    }

    #[test]
    fn startup_restoration_admits_the_documents_it_prepared_before_the_lock() {
        let fixture = Fixture::with_files(&["a.md", "b.md"]);
        let (mut docs, remember) = fixture.remembering();
        docs.admit(fixture.request(&["a.md", "b.md"]));
        wait_idle(&remember);

        let mut relaunched = Documents::default();
        let restoration = relaunched.remember(Remember::new(fixture.inventory()));
        restoration.prepare();
        // The prepared reads are what restoration admits, and preparing again reads nothing.
        fs::remove_file(fixture.0.join("b.md")).unwrap();
        restoration.prepare();
        relaunched.restore();
        assert_eq!(paths(&relaunched), paths(&docs));
        assert!(relaunched.restore_failures.is_empty());
        restoration.prepare();
        relaunched.restore();
        assert_eq!(relaunched.len(), 2);
    }

    #[test]
    fn a_triggering_request_admits_after_the_remembered_documents_and_takes_the_selection() {
        let fixture = Fixture::with_files(&["a.md", "b.md", "new.md"]);
        let (mut docs, remember) = fixture.remembering();
        docs.admit(fixture.request(&["a.md", "b.md"]));
        docs.select(1, docs.activation_revision);
        wait_idle(&remember);

        // The request reaches the registry before the startup restoration ran.
        let (mut relaunched, remember) = fixture.remembering();
        let response = relaunched.admit(fixture.request(&["missing.md", "new.md", "a.md"]));
        assert_eq!(
            response
                .results
                .iter()
                .map(|r| r.status.as_str())
                .collect::<Vec<_>>(),
            ["error", "opened", "already_open"]
        );
        let names: Vec<_> = paths(&relaunched)
            .iter()
            .map(|p| {
                Path::new(p)
                    .file_name()
                    .unwrap()
                    .to_str()
                    .unwrap()
                    .to_owned()
            })
            .collect();
        assert_eq!(names, ["a.md", "b.md", "new.md"]);
        assert_eq!(relaunched.active_id, Some(2));
        relaunched.restore();
        assert_eq!(relaunched.len(), 3);
        wait_idle(&remember);
        assert_eq!(
            fixture.remembered().active,
            Some(paths(&relaunched)[2].clone())
        );

        // A request whose files all fail leaves the remembered selection.
        let (mut failed, _) = fixture.remembering();
        failed.admit(fixture.request(&["missing.md"]));
        assert_eq!(failed.active_id, Some(2));

        // A request admitted before the inventory was attached keeps its selection.
        let mut early = Documents::default();
        early.admit(fixture.request(&["b.md"]));
        early.remember(Remember::new(fixture.inventory()));
        early.restore();
        assert_eq!(early.len(), 3);
        assert_eq!((early.active_id, early.activation_revision), (Some(0), 1));
    }

    #[test]
    fn missing_and_refused_remembered_documents_are_reported_and_forgotten() {
        let fixture = Fixture::with_files(&["a.md", "gone.md", "moved.md", "b.md"]);
        let (mut docs, remember) = fixture.remembering();
        docs.admit(fixture.request(&["a.md", "gone.md", "moved.md", "b.md"]));
        docs.select(1, docs.activation_revision);
        wait_idle(&remember);
        fs::remove_file(fixture.0.join("gone.md")).unwrap();
        fs::rename(fixture.0.join("moved.md"), fixture.0.join("moved.txt")).unwrap();
        let large = fs::File::create(fixture.0.join("b.md")).unwrap();
        large.set_len(crate::files::MAX_FILE_BYTES + 1).unwrap();
        let gone = paths(&docs)[1].clone();

        let (mut relaunched, remember) = fixture.remembering();
        relaunched.restore();
        assert_eq!(
            relaunched.restore_failures,
            paths(&docs)[1..].to_vec(),
            "each refused document is reported once"
        );
        assert_eq!(paths(&relaunched), paths(&docs)[..1]);
        // The remembered selection is gone, so the first restored document is active.
        assert_eq!(relaunched.active_id, Some(0));
        wait_idle(&remember);
        let saved = fixture.remembered();
        assert_eq!(saved.files, paths(&docs)[..1]);
        assert!(!saved.files.contains(&gone));
    }

    #[test]
    fn nothing_remembered_restores_nothing_and_writes_nothing() {
        let fixture = Fixture::new();
        let (mut docs, remember) = fixture.remembering();
        docs.restore();
        wait_idle(&remember);
        assert_eq!(
            (docs.len(), docs.active_id, docs.activation_revision),
            (0, None, 0)
        );
        assert!(!fixture.inventory().exists());
    }

    #[test]
    fn an_unreadable_inventory_is_kept_until_the_open_documents_change() {
        let fixture = Fixture::with_files(&["a.md"]);
        // Reading a directory fails as an I/O error, unlike a missing or corrupt file.
        fs::create_dir(fixture.inventory()).unwrap();
        let (remember, writes) =
            crate::restoration::tests::recording(fixture.inventory(), std::time::Duration::ZERO);
        let mut docs = Documents::default();
        docs.remember(remember.clone());
        docs.restore();
        wait_idle(&remember);
        assert!(writes.try_recv().is_err());
        assert_eq!((docs.len(), docs.active_id), (0, None));
        docs.admit(fixture.request(&["a.md"]));
        wait_idle(&remember);
        assert_eq!(
            writes
                .try_iter()
                .map(|saved| saved.files)
                .collect::<Vec<_>>(),
            [paths(&docs)]
        );
    }

    #[test]
    fn closing_and_save_as_update_the_remembered_inventory() {
        let fixture = Fixture::with_files(&["a.md", "b.md"]);
        let (mut docs, remember) = fixture.remembering();
        docs.admit(fixture.request(&["a.md", "b.md"]));
        fs::write(fixture.0.join("copy.md"), "a").unwrap();
        let destination = copy_destination(&fixture.0.join("copy.md")).unwrap();
        let snapshot = crate::files::read(Path::new(&destination), None).unwrap();
        docs.replace_with_copy(0, destination.clone(), snapshot)
            .unwrap();
        wait_idle(&remember);
        let saved = fixture.remembered();
        assert_eq!(saved.files, paths(&docs));
        assert_eq!(saved.active, Some(destination));
        docs.close(1, Some(2), docs.activation_revision);
        docs.close(2, Some(2), docs.activation_revision);
        wait_idle(&remember);
        assert_eq!(fixture.remembered(), OpenFiles::default());
    }

    #[test]
    fn a_selection_older_than_the_latest_activation_is_not_remembered() {
        let fixture = Fixture::with_files(&["a.md", "b.md", "c.md"]);
        let mut docs = Documents::default();
        docs.admit(fixture.request(&["a.md", "b.md"]));
        let observed = docs.activation_revision;
        docs.admit(fixture.request(&["c.md"]));
        docs.select(1, observed);
        assert_eq!(docs.active_id, Some(2));
        docs.select(7, docs.activation_revision);
        assert_eq!(docs.active_id, Some(2));
        docs.select(0, docs.activation_revision);
        assert_eq!((docs.active_id, docs.activation_revision), (Some(0), 2));
    }

    #[test]
    fn restoration_keeps_the_most_recent_documents_within_the_request_bound() {
        let names: Vec<String> = (0..MAX_FILES + 2).map(|i| format!("{i}.md")).collect();
        let refs: Vec<&str> = names.iter().map(String::as_str).collect();
        let fixture = Fixture::with_files(&refs);
        let (mut docs, remember) = fixture.remembering();
        docs.admit(fixture.request(&refs[..MAX_FILES]));
        docs.admit(fixture.request(&refs[MAX_FILES..]));
        wait_idle(&remember);
        // Restoring this many documents spreads the reads across threads and keeps saved order.
        let (mut relaunched, _) = fixture.remembering();
        relaunched.restore();
        assert_eq!(relaunched.len(), MAX_FILES);
        assert_eq!(paths(&relaunched), paths(&docs)[2..]);
        assert_eq!(
            relaunched.get(relaunched.active_id.unwrap()).unwrap().path,
            docs.get(docs.active_id.unwrap()).unwrap().path
        );
    }

    #[test]
    fn reopening_an_open_file_is_a_successful_no_op() {
        let fixture = Fixture::new();
        fs::write(fixture.0.join("a.md"), "a").unwrap();
        let mut docs = Documents::default();
        let opened = docs.admit(fixture.request(&["a.md"]));
        let reopened = docs.admit(fixture.request(&["a.md", "./a.md"]));
        assert_eq!(
            reopened
                .results
                .iter()
                .map(|r| (r.status.as_str(), r.canonical.as_deref()))
                .collect::<Vec<_>>(),
            [("already_open", opened.results[0].canonical.as_deref()); 2]
        );
        for response in [&opened, &reopened] {
            assert_eq!(mastermind_launch_check::protocol::exit_status(response), 0);
        }
        assert_eq!(docs.len(), 1);
    }

    struct Fixture(TempDir);
    impl Fixture {
        fn new() -> Self {
            Self(TempDir::new("admission"))
        }
        fn request(&self, names: &[&str]) -> Request {
            Request {
                language: None,
                version: VERSION,
                paths: names
                    .iter()
                    .map(|n| self.0.join(n).to_str().unwrap().to_owned())
                    .collect(),
            }
        }
    }

    #[test]
    fn language_hints_belong_to_admitted_documents_and_end_on_close() {
        let fixture = Fixture::new();
        fs::write(fixture.0.join("a.md"), "a.md").unwrap();
        let mut docs = Documents::default();
        let mut request = fixture.request(&["a.md", "missing.md"]);
        request.language = Some("fr".into());
        docs.admit(request);
        assert_eq!(
            docs.entries().filter(|(_, d)| d.language.is_some()).count(),
            1
        );
        assert_eq!(docs.get(0).unwrap().language.as_deref(), Some("fr"));
        let mut request = fixture.request(&["a.md"]);
        request.language = Some("zh-CN".into());
        docs.admit(request);
        assert_eq!(docs.get(0).unwrap().language.as_deref(), Some("fr"));
        docs.close(0, None, docs.activation_revision);
        assert_eq!(docs.len(), 0);
    }

    #[test]
    fn closing_preserves_ids_and_reopening_allocates_a_fresh_one() {
        let fixture = Fixture::new();
        for name in ["a.md", "b.md", "c.md"] {
            fs::write(fixture.0.join(name), name).unwrap();
        }
        let mut docs = Documents::default();
        docs.admit(fixture.request(&["a.md", "b.md", "c.md"]));
        docs.close(1, Some(1), docs.activation_revision);
        assert_eq!(docs.active_id, Some(2));
        assert!(docs.get(1).is_none());
        assert_eq!(
            docs.get(2).unwrap().path,
            fs::canonicalize(fixture.0.join("c.md"))
                .unwrap()
                .to_str()
                .unwrap()
        );
        assert_eq!(fs::read_to_string(fixture.0.join("b.md")).unwrap(), "b.md");
        docs.admit(fixture.request(&["b.md"]));
        assert_eq!(docs.active_id, Some(3));
        assert_eq!(
            docs.entries().map(|(id, _)| id).collect::<Vec<_>>(),
            [0, 2, 3]
        );
        docs.close(0, Some(2), docs.activation_revision);
        assert_eq!(docs.active_id, Some(2));
        docs.close(3, Some(3), docs.activation_revision);
        assert_eq!(docs.active_id, Some(2));
        docs.close(2, Some(2), docs.activation_revision);
        assert_eq!(docs.active_id, None);
        assert_eq!(docs.len(), 0);
    }

    #[test]
    fn closing_does_not_override_a_concurrent_open_request() {
        let fixture = Fixture::new();
        for name in ["a.md", "b.md", "c.md"] {
            fs::write(fixture.0.join(name), name).unwrap();
        }
        let mut docs = Documents::default();
        docs.admit(fixture.request(&["a.md", "b.md"]));
        let revision = docs.activation_revision;
        docs.admit(fixture.request(&["c.md"]));
        docs.close(0, Some(0), revision);
        assert_eq!(docs.active_id, Some(2));
    }

    #[test]
    fn retains_exact_bytes_and_existing_snapshot() {
        let fixture = Fixture::new();
        let original = b"# Review\r\n\r\n{>>@Alex: Keep this.<<}\r\n";
        fs::write(fixture.0.join("file.md"), original).unwrap();
        let mut docs = Documents::default();
        assert_eq!(
            docs.admit(fixture.request(&["file.md"])).results[0].status,
            "opened"
        );
        fs::write(fixture.0.join("file.md"), b"external change").unwrap();
        assert_eq!(
            docs.admit(fixture.request(&["file.md"])).results[0].status,
            "already_open"
        );
        assert_eq!(
            docs.get(0).unwrap().snapshot.as_ref().unwrap().bytes,
            original
        );
        assert_eq!(docs.active_id, Some(0));
        assert_eq!(docs.activation_revision, 2);
    }

    #[test]
    fn partial_failure_and_aliases_keep_order() {
        let fixture = Fixture::new();
        fs::write(fixture.0.join("a.md"), "first").unwrap();
        fs::write(fixture.0.join("b.md"), "second").unwrap();
        let mut docs = Documents::default();
        let result = docs.admit(fixture.request(&["a.md", "missing.md", "./a.md", "b.md"]));
        assert_eq!(
            result
                .results
                .iter()
                .map(|r| r.status.as_str())
                .collect::<Vec<_>>(),
            ["opened", "error", "already_open", "opened"]
        );
        assert_eq!(docs.len(), 2);
        assert_eq!(
            PathBuf::from(&docs.get(0).unwrap().path)
                .file_name()
                .unwrap(),
            "a.md"
        );
        assert_eq!(
            PathBuf::from(&docs.get(1).unwrap().path)
                .file_name()
                .unwrap(),
            "b.md"
        );
        assert_eq!(docs.active_id, Some(0));
        assert_eq!(docs.activation_revision, 1);
    }

    #[test]
    fn mixed_admission_serializes_file_error_codes_and_messages_in_order() {
        let fixture = Fixture::new();
        fs::write(fixture.0.join("a.md"), b"original\r\n").unwrap();
        let large = fs::File::create(fixture.0.join("large.md")).unwrap();
        large.set_len(crate::files::MAX_FILE_BYTES + 1).unwrap();
        fs::create_dir(fixture.0.join("folder.md")).unwrap();
        let mut docs = Documents::default();
        let response =
            docs.admit(fixture.request(&["missing.md", "a.md", "folder.md", "large.md"]));
        let encoded = serde_json::to_value(response).unwrap();
        for (index, code) in [
            (0, "file_not_found"),
            (2, "not_supported_file"),
            (3, "file_too_large"),
        ] {
            let result = &encoded["results"][index];
            assert_eq!(result["status"], "error");
            assert_eq!(result["error"], code);
            assert!(!result["message"].as_str().unwrap().is_empty());
            assert!(result["canonical"].is_null());
        }
        assert_eq!(encoded["results"][1]["status"], "opened");
        assert!(encoded["results"][1].get("message").is_none());
        assert_eq!(docs.len(), 1);
        assert_eq!(docs.active_id, Some(0));
        assert_eq!(
            docs.get(0).unwrap().snapshot.as_ref().unwrap().bytes,
            b"original\r\n"
        );
    }

    #[test]
    fn first_success_selects_its_existing_order_index() {
        let fixture = Fixture::new();
        for name in ["a.md", "b.md", "c.md", "d.md"] {
            fs::write(fixture.0.join(name), name).unwrap();
        }
        let mut docs = Documents::default();
        docs.admit(fixture.request(&["a.md", "b.md"]));
        let result = docs.admit(fixture.request(&["missing.md", "./b.md", "c.md", "a.md"]));
        assert_eq!(result.results[1].status, "already_open");
        assert_eq!(docs.active_id, Some(1));
        assert_eq!(docs.activation_revision, 2);

        let result = docs.admit(fixture.request(&["missing.md", "d.md", "b.md"]));
        assert_eq!(result.results[1].status, "opened");
        assert_eq!(docs.active_id, Some(3));
        assert_eq!(docs.activation_revision, 3);
        assert_eq!(docs.len(), 4);
    }

    #[test]
    fn failures_and_invalid_requests_retain_selection_and_snapshot() {
        let fixture = Fixture::new();
        fs::write(fixture.0.join("a.md"), "first").unwrap();
        fs::write(fixture.0.join("b.md"), "second").unwrap();
        let mut docs = Documents::default();
        docs.admit(fixture.request(&["a.md", "b.md"]));
        docs.opening_errors.push("graphical opening error".into());
        docs.admit(fixture.request(&["b.md"]));
        let snapshot = docs.get(1).unwrap().snapshot.as_ref().unwrap().clone();
        fs::remove_file(fixture.0.join("b.md")).unwrap();

        let result = docs.admit(fixture.request(&["b.md", "missing.md", "."]));
        assert!(result.results.iter().all(|r| r.status == "error"));
        assert_eq!(docs.active_id, Some(1));
        assert_eq!(docs.activation_revision, 2);
        let mut wrong_version = fixture.request(&["a.md"]);
        wrong_version.version += 1;
        for request in [
            wrong_version,
            fixture.request(&[]),
            fixture.request(&vec!["a.md"; MAX_FILES + 1]),
            Request {
                language: None,
                version: VERSION,
                paths: vec!["relative".into()],
            },
        ] {
            assert!(docs.admit(request).error.is_some());
            assert_eq!(docs.active_id, Some(1));
            assert_eq!(docs.activation_revision, 2);
            assert_eq!(docs.len(), 2);
            assert_eq!(docs.opening_errors, ["graphical opening error"]);
            let retained = docs.get(1).unwrap().snapshot.as_ref().unwrap();
            assert_eq!(retained.bytes, snapshot.bytes);
            assert_eq!(retained.version, snapshot.version);
        }
    }

    #[test]
    fn invalid_envelopes_admit_nothing() {
        let fixture = Fixture::new();
        fs::write(fixture.0.join("a.md"), "first").unwrap();
        let mut docs = Documents::default();
        let mut request = fixture.request(&["a.md"]);
        request.version = VERSION + 1;
        assert_eq!(
            docs.admit(request).error.as_deref(),
            Some("incompatible_version")
        );
        let request = Request {
            language: None,
            version: VERSION,
            paths: vec!["relative".into()],
        };
        assert_eq!(
            docs.admit(request).error.as_deref(),
            Some("invalid_request")
        );
        assert_eq!(docs.len(), 0);
        assert_eq!(docs.active_id, None);
        assert_eq!(docs.activation_revision, 0);
    }

    #[test]
    fn non_regular_and_missing_files_do_not_create_documents() {
        let fixture = Fixture::new();
        let mut docs = Documents::default();
        let result = docs.admit(fixture.request(&[".", "missing.md"]));
        assert!(result.results.iter().all(|r| r.status == "error"));
        assert!(!fixture.0.join("missing.md").exists());
        assert_eq!(docs.len(), 0);
        assert_eq!(docs.active_id, None);
        assert_eq!(docs.activation_revision, 0);
    }
}
