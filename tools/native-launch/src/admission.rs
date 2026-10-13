use crate::files::FileError;
pub use mastermind_launch_check::protocol::{
    FileResult, MAX_FILES, MAX_FRAME, Request, Response, VERSION,
};
use std::{collections::BTreeMap, fs, path::PathBuf};

#[derive(Default)]
pub struct Documents {
    pub files: BTreeMap<PathBuf, Option<crate::files::Snapshot>>,
    pub order: Vec<String>,
    pub activation_revision: u64,
    pub active_id: Option<usize>,
    pub opening_errors: Vec<String>,
}

impl Documents {
    pub fn admit(&mut self, request: Request) -> Response {
        if request.version != VERSION {
            return Response::error("incompatible_version");
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
        let results: Vec<FileResult> = request
            .paths
            .into_iter()
            .map(|path| match self.open(&path) {
                Ok((canonical, status)) => FileResult {
                    path,
                    canonical: Some(canonical),
                    status: status.into(),
                    error: None,
                    message: None,
                },
                Err(error) => FileResult {
                    path,
                    canonical: None,
                    status: "error".into(),
                    error: Some(error.error),
                    message: Some(error.message),
                },
            })
            .collect();
        if let Some(canonical) = results.iter().find_map(|result| result.canonical.as_ref()) {
            self.active_id = self.order.iter().position(|path| path == canonical);
            self.activation_revision += 1;
        }
        Response {
            version: VERSION,
            pid: std::process::id(),
            onboarding_needed: true,
            results,
            error: None,
        }
    }

    fn open(&mut self, path: &str) -> Result<(String, &'static str), FileError> {
        let canonical = fs::canonicalize(path)?;
        let display = canonical
            .to_str()
            .ok_or_else(|| {
                FileError::new(
                    400,
                    "unsupported_path_encoding",
                    "The file path is not valid UTF-8.",
                )
            })?
            .to_owned();
        if self.files.contains_key(&canonical) {
            return Ok((display, "already_open"));
        }
        let snapshot = crate::files::read(&canonical)?;
        self.files.insert(canonical, Some(snapshot));
        self.order.push(display.clone());
        Ok((display, "opened"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};
    static NEXT: AtomicU64 = AtomicU64::new(0);
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

    #[cfg(windows)]
    #[test]
    fn identity_distinguishes_files_with_identical_content() {
        let fixture = Fixture::new();
        let a = fixture.0.join("a");
        let b = fixture.0.join("b");
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
        fs::write(fixture.0.join("file"), original).unwrap();
        let mut docs = Documents::default();
        assert_eq!(
            docs.admit(fixture.request(&["file"])).results[0].status,
            "opened"
        );
        fs::write(fixture.0.join("file"), b"external change").unwrap();
        assert_eq!(
            docs.admit(fixture.request(&["file"])).results[0].status,
            "already_open"
        );
        assert_eq!(
            docs.files.values().next().unwrap().as_ref().unwrap().bytes,
            original
        );
        assert_eq!(docs.active_id, Some(0));
        assert_eq!(docs.activation_revision, 2);
    }

    #[test]
    fn partial_failure_and_aliases_keep_order() {
        let fixture = Fixture::new();
        fs::write(fixture.0.join("a"), "first").unwrap();
        fs::write(fixture.0.join("b"), "second").unwrap();
        let mut docs = Documents::default();
        let result = docs.admit(fixture.request(&["a", "missing", "./a", "b"]));
        assert_eq!(
            result
                .results
                .iter()
                .map(|r| r.status.as_str())
                .collect::<Vec<_>>(),
            ["opened", "error", "already_open", "opened"]
        );
        assert_eq!(docs.order.len(), 2);
        assert_eq!(PathBuf::from(&docs.order[0]).file_name().unwrap(), "a");
        assert_eq!(PathBuf::from(&docs.order[1]).file_name().unwrap(), "b");
        assert_eq!(docs.active_id, Some(0));
        assert_eq!(docs.activation_revision, 1);
    }

    #[test]
    fn mixed_admission_serializes_file_error_codes_and_messages_in_order() {
        let fixture = Fixture::new();
        fs::write(fixture.0.join("a"), b"original\r\n").unwrap();
        let large = fs::File::create(fixture.0.join("large")).unwrap();
        large.set_len(crate::files::MAX_FILE_BYTES + 1).unwrap();
        let mut docs = Documents::default();
        let response = docs.admit(fixture.request(&["missing", "a", ".", "large"]));
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
        assert_eq!(docs.order.len(), 1);
        assert_eq!(docs.active_id, Some(0));
        assert_eq!(
            docs.files.values().next().unwrap().as_ref().unwrap().bytes,
            b"original\r\n"
        );
    }

    #[test]
    fn first_success_selects_its_existing_order_index() {
        let fixture = Fixture::new();
        for name in ["a", "b", "c", "d"] {
            fs::write(fixture.0.join(name), name).unwrap();
        }
        let mut docs = Documents::default();
        docs.admit(fixture.request(&["a", "b"]));
        let result = docs.admit(fixture.request(&["missing", "./b", "c", "a"]));
        assert_eq!(result.results[1].status, "already_open");
        assert_eq!(docs.active_id, Some(1));
        assert_eq!(docs.activation_revision, 2);

        let result = docs.admit(fixture.request(&["missing", "d", "b"]));
        assert_eq!(result.results[1].status, "opened");
        assert_eq!(docs.active_id, Some(3));
        assert_eq!(docs.activation_revision, 3);
        assert_eq!(docs.order.len(), 4);
    }

    #[test]
    fn failures_and_invalid_requests_retain_selection_and_snapshot() {
        let fixture = Fixture::new();
        fs::write(fixture.0.join("a"), "first").unwrap();
        fs::write(fixture.0.join("b"), "second").unwrap();
        let mut docs = Documents::default();
        docs.admit(fixture.request(&["a", "b"]));
        docs.opening_errors.push("graphical opening error".into());
        docs.admit(fixture.request(&["b"]));
        let canonical = fs::canonicalize(fixture.0.join("b")).unwrap();
        let snapshot = docs.files[&canonical].as_ref().unwrap().clone();
        fs::remove_file(fixture.0.join("b")).unwrap();

        let result = docs.admit(fixture.request(&["b", "missing", "."]));
        assert!(result.results.iter().all(|r| r.status == "error"));
        assert_eq!(docs.active_id, Some(1));
        assert_eq!(docs.activation_revision, 2);
        let mut wrong_version = fixture.request(&["a"]);
        wrong_version.version += 1;
        for request in [
            wrong_version,
            fixture.request(&[]),
            fixture.request(&vec!["a"; MAX_FILES + 1]),
            Request {
                version: VERSION,
                paths: vec!["relative".into()],
            },
        ] {
            assert!(docs.admit(request).error.is_some());
            assert_eq!(docs.active_id, Some(1));
            assert_eq!(docs.activation_revision, 2);
            assert_eq!(docs.order.len(), 2);
            assert_eq!(docs.opening_errors, ["graphical opening error"]);
            let retained = docs.files[&canonical].as_ref().unwrap();
            assert_eq!(retained.bytes, snapshot.bytes);
            assert_eq!(retained.version, snapshot.version);
            assert_eq!(retained.mtime_ms, snapshot.mtime_ms);
        }
    }

    #[test]
    fn invalid_envelopes_admit_nothing() {
        let fixture = Fixture::new();
        fs::write(fixture.0.join("a"), "first").unwrap();
        let mut docs = Documents::default();
        let mut request = fixture.request(&["a"]);
        request.version = VERSION + 1;
        assert_eq!(
            docs.admit(request).error.as_deref(),
            Some("incompatible_version")
        );
        let request = Request {
            version: VERSION,
            paths: vec!["relative".into()],
        };
        assert_eq!(
            docs.admit(request).error.as_deref(),
            Some("invalid_request")
        );
        assert!(docs.files.is_empty());
        assert_eq!(docs.active_id, None);
        assert_eq!(docs.activation_revision, 0);
    }

    #[test]
    fn non_regular_and_missing_files_do_not_create_documents() {
        let fixture = Fixture::new();
        let mut docs = Documents::default();
        let result = docs.admit(fixture.request(&[".", "missing"]));
        assert!(result.results.iter().all(|r| r.status == "error"));
        assert!(!fixture.0.join("missing").exists());
        assert!(docs.files.is_empty());
        assert_eq!(docs.active_id, None);
        assert_eq!(docs.activation_revision, 0);
    }
}
