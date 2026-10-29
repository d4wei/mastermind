use crate::files::FileError;
pub use mastermind_launch_check::protocol::{
    FileResult, MAX_FILES, MAX_FRAME, Request, Response, VERSION,
};
use std::{
    collections::{BTreeMap, HashMap},
    fs,
    path::{Path, PathBuf},
};

pub const MARKDOWN_EXTENSIONS: &[&str] = &["md", "markdown"];

pub fn require_markdown(path: &std::path::Path) -> Result<(), FileError> {
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
    pub language: Option<String>,
}

pub enum Admission {
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
    pub fn entries(&self) -> impl Iterator<Item = (usize, &Document)> {
        self.entries.iter().map(|(id, document)| (*id, document))
    }

    pub fn get(&self, id: usize) -> Option<&Document> {
        self.entries.get(&id)
    }

    pub fn get_mut(&mut self, id: usize) -> Option<&mut Document> {
        self.entries.get_mut(&id)
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
                snapshot,
                language: None,
            },
        );
        id
    }

    pub fn remove(&mut self, id: usize) -> Option<Document> {
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
                    }
                }
                Err(error) => FileResult {
                    path,
                    canonical: None,
                    status: "error".into(),
                    error: Some(error.error),
                    message: Some(error.message),
                },
            })
            .collect();
        if first.is_some() {
            self.active_id = first;
            self.activation_revision += 1;
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
    }

    pub(crate) fn open(&mut self, path: &str) -> Result<Admission, FileError> {
        // The selected name decides the document type before any filesystem access.
        require_markdown(Path::new(path))?;
        let canonical = fs::canonicalize(path)?;
        let display = utf8_path(&canonical)?;
        if let Some(&id) = self.ids.get(&display) {
            return Ok(Admission::AlreadyOpen(id));
        }
        require_markdown(&canonical)?;
        let snapshot = crate::files::read(&canonical)?;
        Ok(Admission::Opened(self.insert(display, Some(snapshot))))
    }

    /// Refuses a Save As destination registered to an admitted document other than `origin`, such
    /// as one whose file was deleted; a copy is never merged into another document. The origin's
    /// own path is allowed because the copy replaces its entry.
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

    /// Registers a created copy in place of `origin`. The destination is checked again because an
    /// admission can register the created file before this call. The activation revision is kept:
    /// a save picker must not steal later navigation. The registry is unlocked during creation, so
    /// `origin` may have closed meanwhile; the copy exists on disk and was chosen by the person, so
    /// it is then admitted as an ordinary new document and the active document is left alone.
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
        Ok(id)
    }
}

/// Compares Save As destinations case-insensitively on macOS and Windows, whose default volumes
/// ignore case. Admitted paths carry their on-disk case from canonicalization, but a destination
/// that does not exist yet keeps the case the person typed. Lowercasing approximates the volume's
/// folding rules; on a case-sensitive volume it only refuses a name that differs from an open
/// document's by case. No Unicode normalization is applied, although APFS and HFS+ treat
/// canonically equivalent names as one file: a typed destination in a different normalization
/// form from an admitted path (such as a composed and a decomposed `café.md`) compares unequal,
/// so a copy over an admitted document's deleted path in the other form can register that file
/// twice.
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
    use std::sync::atomic::{AtomicU64, Ordering};
    static NEXT: AtomicU64 = AtomicU64::new(0);

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
        let snapshot = crate::files::read(Path::new(&destination)).unwrap();
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

    struct Fixture(PathBuf);
    impl Fixture {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!(
                "mastermind-admission-{}-{}",
                std::process::id(),
                NEXT.fetch_add(1, Ordering::Relaxed)
            ));
            fs::create_dir(&path).unwrap();
            Self(path)
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
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
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

    #[cfg(windows)]
    #[test]
    fn identity_distinguishes_files_with_identical_content() {
        let fixture = Fixture::new();
        let a = fixture.0.join("a.md");
        let b = fixture.0.join("b.md");
        fs::write(&a, b"same").unwrap();
        fs::write(&b, b"same").unwrap();
        let original = fs::File::open(&a).unwrap();
        assert_eq!(
            crate::files::file_identity(&original).unwrap(),
            crate::files::file_identity(&fs::File::open(&a).unwrap()).unwrap()
        );
        assert_ne!(
            crate::files::file_identity(&original).unwrap(),
            crate::files::file_identity(&fs::File::open(&b).unwrap()).unwrap()
        );
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
            assert_eq!(retained.mtime_ms, snapshot.mtime_ms);
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
