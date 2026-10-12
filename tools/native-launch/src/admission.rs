use serde::{Deserialize, Serialize};
use std::{collections::BTreeMap, fs, io, path::PathBuf};

pub const VERSION: u32 = 1;
pub const MAX_FRAME: usize = 64 * 1024;
pub const MAX_FILES: usize = 64;

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Request {
    pub version: u32,
    pub paths: Vec<String>,
}

#[derive(Deserialize, Serialize, Debug)]
pub struct FileResult {
    pub path: String,
    pub canonical: Option<String>,
    pub status: String,
    pub error: Option<String>,
}

#[derive(Deserialize, Serialize, Debug)]
pub struct Response {
    pub version: u32,
    pub pid: u32,
    pub onboarding_needed: bool,
    pub results: Vec<FileResult>,
    pub error: Option<String>,
}

impl Response {
    pub fn error(error: &str) -> Self {
        Self {
            version: VERSION,
            pid: std::process::id(),
            onboarding_needed: true,
            results: vec![],
            error: Some(error.into()),
        }
    }
}

#[derive(Default)]
pub struct Documents {
    pub files: BTreeMap<PathBuf, Option<crate::files::Snapshot>>,
    pub order: Vec<String>,
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
        let results = request
            .paths
            .into_iter()
            .map(|path| match self.open(&path) {
                Ok((canonical, status)) => FileResult {
                    path,
                    canonical: Some(canonical),
                    status: status.into(),
                    error: None,
                },
                Err(error) => FileResult {
                    path,
                    canonical: None,
                    status: "error".into(),
                    error: Some(error.to_string()),
                },
            })
            .collect();
        Response {
            version: VERSION,
            pid: std::process::id(),
            onboarding_needed: true,
            results,
            error: None,
        }
    }

    fn open(&mut self, path: &str) -> io::Result<(String, &'static str)> {
        let canonical = fs::canonicalize(path)?;
        let display = canonical
            .to_str()
            .ok_or_else(|| io::Error::other("unsupported_path_encoding"))?
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
    }

    #[test]
    fn non_regular_and_missing_files_do_not_create_documents() {
        let fixture = Fixture::new();
        let mut docs = Documents::default();
        let result = docs.admit(fixture.request(&[".", "missing"]));
        assert!(result.results.iter().all(|r| r.status == "error"));
        assert!(!fixture.0.join("missing").exists());
        assert!(docs.files.is_empty());
    }
}
