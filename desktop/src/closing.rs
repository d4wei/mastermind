use crate::admission::Documents;
use mastermind_launch_check::protocol::{CloseRequest, FileResult, MAX_FILES, Response, VERSION};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, AtomicU64, Ordering},
    },
    time::Duration,
};
use tokio::sync::oneshot;

/// The event that asks the subscribed renderer to close admitted documents.
pub const RENDERER_EVENT: &str = "close-files-requested";

/// How long a close waits for the renderer. It is shorter than the transport deadline, so an
/// unanswered renderer still yields a `renderer_unavailable` reply rather than an unknown outcome.
pub const RENDERER_DEADLINE: Duration = Duration::from_secs(7);

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct CloseFilesRequested {
    pub request: u64,
    pub ids: Vec<String>,
}

#[derive(Deserialize, Serialize, Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum BlockReason {
    UnsavedEdits,
    PendingDraft,
    Recovery,
    RendererUnavailable,
}

impl BlockReason {
    fn code(self) -> String {
        serde_json::to_value(self)
            .unwrap()
            .as_str()
            .unwrap()
            .to_owned()
    }
}

/// The renderer's answer for one requested document.
#[derive(Deserialize, Clone, Debug, PartialEq)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum Outcome {
    Closed { id: String },
    Blocked { id: String, reason: BlockReason },
    Error { id: String, error: String },
}

impl Outcome {
    fn id(&self) -> &str {
        match self {
            Self::Closed { id } | Self::Blocked { id, .. } | Self::Error { id, .. } => id,
        }
    }
}

/// Close requests awaiting the renderer. Each request has its own ID, and only the renderer's
/// answer to that ID completes it; an answer after the deadline finds no entry and is discarded.
#[derive(Default)]
pub struct CloseRequests {
    subscribed: AtomicBool,
    next: AtomicU64,
    pending: Mutex<HashMap<u64, oneshot::Sender<Vec<Outcome>>>>,
}

/// Removes a request's entry however its wait ends, including cancellation by the transport
/// deadline.
struct PendingEntry<'a>(&'a CloseRequests, u64);

impl Drop for PendingEntry<'_> {
    fn drop(&mut self) {
        self.0.pending.lock().unwrap().remove(&self.1);
    }
}

impl CloseRequests {
    pub fn subscribe(&self) {
        self.subscribed.store(true, Ordering::SeqCst);
    }

    /// A navigating or lost renderer cannot answer; requests waiting on it fail at once.
    pub fn renderer_lost(&self) {
        self.subscribed.store(false, Ordering::SeqCst);
        self.pending.lock().unwrap().clear();
    }

    /// Delivers the renderer's answer; false when the request already ended.
    pub fn complete(&self, request: u64, outcomes: Vec<Outcome>) -> bool {
        let sender = self.pending.lock().unwrap().remove(&request);
        sender.is_some_and(|sender| sender.send(outcomes).is_ok())
    }

    /// Asks the renderer to close `ids` and waits for its answer. `None` means no subscribed
    /// renderer received the request or none answered in time.
    pub async fn ask(
        &self,
        ids: Vec<String>,
        emit: impl FnOnce(&CloseFilesRequested) -> bool,
        deadline: Duration,
    ) -> Option<Vec<Outcome>> {
        if !self.subscribed.load(Ordering::SeqCst) {
            return None;
        }
        let request = self.next.fetch_add(1, Ordering::SeqCst);
        let (sender, receiver) = oneshot::channel();
        self.pending.lock().unwrap().insert(request, sender);
        let _entry = PendingEntry(self, request);
        if !emit(&CloseFilesRequested { request, ids }) {
            return None;
        }
        tokio::time::timeout(deadline, receiver)
            .await
            .ok()
            .and_then(Result::ok)
    }
}

pub type Emit = Arc<dyn Fn(&CloseFilesRequested) -> bool + Send + Sync>;

/// How a close request reaches the renderer.
#[derive(Clone)]
pub struct Renderer {
    pub requests: Arc<CloseRequests>,
    pub emit: Emit,
    pub deadline: Duration,
}

/// The admitted document a close path names, matched by canonical path. A deleted file no longer
/// canonicalizes, so its canonical parent joined with its name is tried too.
fn resolve(docs: &Documents, path: &str) -> Option<(usize, String)> {
    let path = Path::new(path);
    let parent = path
        .parent()
        .zip(path.file_name())
        .and_then(|(parent, name)| std::fs::canonicalize(parent).ok().map(|p| p.join(name)));
    [
        std::fs::canonicalize(path).ok(),
        parent,
        Some(PathBuf::from(path)),
    ]
    .into_iter()
    .flatten()
    .filter_map(|candidate| candidate.to_str().map(str::to_owned))
    .find_map(|candidate| docs.find(&candidate).map(|id| (id, candidate)))
}

fn result(path: String, canonical: Option<String>, status: &str) -> FileResult {
    FileResult {
        path,
        canonical,
        status: status.into(),
        error: None,
        message: None,
        reason: None,
    }
}

/// Reports one requested path from the renderer's answers. Nothing counts as closed without the
/// renderer saying so; a document it no longer holds was closed concurrently.
fn file_result(
    path: String,
    resolved: Option<(usize, String)>,
    answers: Option<&HashMap<String, Outcome>>,
) -> FileResult {
    let Some((id, canonical)) = resolved else {
        return result(path, None, "not_open");
    };
    match answers.and_then(|answers| answers.get(&id.to_string())) {
        Some(Outcome::Closed { .. }) => result(path, Some(canonical), "closed"),
        Some(Outcome::Error { error, .. }) if error == "document_not_open" => {
            result(path, Some(canonical), "not_open")
        }
        Some(Outcome::Error { error, .. }) => FileResult {
            error: Some(error.clone()),
            message: Some("The reader could not close this document.".into()),
            ..result(path, Some(canonical), "error")
        },
        Some(Outcome::Blocked { reason, .. }) => FileResult {
            reason: Some(reason.code()),
            ..result(path, Some(canonical), "blocked")
        },
        None => FileResult {
            reason: Some(BlockReason::RendererUnavailable.code()),
            ..result(path, Some(canonical), "blocked")
        },
    }
}

/// Answers a launcher close request, as `protocol.md` describes. The host never removes a
/// document itself; only the renderer, after checking for unsaved work, closes one.
pub async fn close(
    request: CloseRequest,
    docs: Arc<Mutex<Documents>>,
    setup: Arc<crate::setup::Setup>,
    renderer: &Renderer,
) -> Response {
    if request.version != VERSION {
        return Response::error("incompatible_version");
    }
    if request.close.is_empty()
        || request.close.len() > MAX_FILES
        || request.close.iter().any(|p| !Path::new(p).is_absolute())
    {
        return Response::error("invalid_request");
    }
    let paths = request.close;
    let resolved = crate::worker::blocking_work()
        .run(move || {
            let docs = docs.lock().unwrap();
            let resolved: Vec<_> = paths
                .into_iter()
                .map(|path| {
                    let document = resolve(&docs, &path);
                    (path, document)
                })
                .collect();
            (resolved, setup.onboarding_needed().ok())
        })
        .await;
    let Ok((resolved, onboarding_needed)) = resolved else {
        return Response::error("host_failure");
    };
    let mut ids: Vec<String> = Vec::new();
    for id in resolved
        .iter()
        .filter_map(|(_, document)| document.as_ref())
    {
        let id = id.0.to_string();
        if !ids.contains(&id) {
            ids.push(id);
        }
    }
    let answers = if ids.is_empty() {
        None
    } else {
        let emit = renderer.emit.clone();
        renderer
            .requests
            .ask(ids, |event| emit(event), renderer.deadline)
            .await
            .map(|outcomes| {
                outcomes
                    .into_iter()
                    .map(|outcome| (outcome.id().to_owned(), outcome))
                    .collect::<HashMap<_, _>>()
            })
    };
    Response {
        onboarding_needed,
        results: resolved
            .into_iter()
            .map(|(path, document)| file_result(path, document, answers.as_ref()))
            .collect(),
        error: None,
        ..Response::error("")
    }
}

#[tauri::command]
pub fn close_requests_ready(requests: tauri::State<'_, Arc<CloseRequests>>) {
    requests.subscribe();
}

#[tauri::command]
pub fn complete_close_request(
    request_id: u64,
    results: Vec<Outcome>,
    requests: tauri::State<'_, Arc<CloseRequests>>,
) -> bool {
    requests.complete(request_id, results)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::TempDir;
    use mastermind_launch_check::protocol::Request;
    use std::fs;

    fn runtime() -> tokio::runtime::Runtime {
        tokio::runtime::Builder::new_multi_thread()
            .enable_time()
            .build()
            .unwrap()
    }

    #[test]
    fn renderer_outcomes_have_strict_shapes() {
        let outcomes: Vec<Outcome> = serde_json::from_value(serde_json::json!([
            {"id": "0", "status": "closed"},
            {"id": "1", "status": "blocked", "reason": "pending_draft"},
            {"id": "2", "status": "error", "error": "close_failed"}
        ]))
        .unwrap();
        assert_eq!(
            outcomes[1],
            Outcome::Blocked {
                id: "1".into(),
                reason: BlockReason::PendingDraft
            }
        );
        for invalid in [
            serde_json::json!({"id": "0", "status": "discarded"}),
            serde_json::json!({"id": "0", "status": "blocked", "reason": "busy"}),
            serde_json::json!({"id": "0", "status": "blocked"}),
        ] {
            assert!(serde_json::from_value::<Outcome>(invalid).is_err());
        }
        assert_eq!(
            BlockReason::RendererUnavailable.code(),
            "renderer_unavailable"
        );
    }

    #[test]
    fn requests_complete_only_with_their_own_answer_and_within_the_deadline() {
        runtime().block_on(async {
            let requests = Arc::new(CloseRequests::default());
            let mut emitted = Vec::new();
            assert_eq!(
                requests
                    .ask(
                        vec!["0".into()],
                        |event| {
                            emitted.push(event.clone());
                            true
                        },
                        Duration::from_secs(1)
                    )
                    .await,
                None
            );
            assert!(
                emitted.is_empty(),
                "an unsubscribed renderer is never asked"
            );
            requests.subscribe();
            let answering = requests.clone();
            let (first, second) = tokio::join!(
                requests.ask(
                    vec!["0".into()],
                    |event| {
                        let event = event.clone();
                        let answering = answering.clone();
                        tokio::spawn(async move {
                            let id = event.ids[0].clone();
                            assert!(
                                answering.complete(event.request, vec![Outcome::Closed { id }])
                            );
                        });
                        true
                    },
                    Duration::from_secs(2)
                ),
                requests.ask(vec!["1".into()], |_| true, Duration::from_millis(50))
            );
            assert_eq!(first, Some(vec![Outcome::Closed { id: "0".into() }]));
            assert_eq!(second, None);
            // The timed-out request's ID was distinct, and its late answer is discarded.
            assert!(!requests.complete(1, vec![Outcome::Closed { id: "1".into() }]));
            assert!(requests.pending.lock().unwrap().is_empty());
            assert_eq!(
                requests
                    .ask(vec!["2".into()], |_| false, Duration::from_secs(1))
                    .await,
                None
            );
            assert!(requests.pending.lock().unwrap().is_empty());
        });
    }

    #[test]
    fn a_lost_renderer_fails_waiting_requests_at_once() {
        runtime().block_on(async {
            let requests = Arc::new(CloseRequests::default());
            requests.subscribe();
            let losing = requests.clone();
            let started = std::time::Instant::now();
            let answer = requests
                .ask(
                    vec!["0".into()],
                    |_| {
                        tokio::spawn(async move { losing.renderer_lost() });
                        true
                    },
                    Duration::from_secs(5),
                )
                .await;
            assert_eq!(answer, None);
            assert!(started.elapsed() < Duration::from_secs(2));
            assert_eq!(
                requests
                    .ask(vec!["0".into()], |_| true, Duration::from_secs(1))
                    .await,
                None
            );
        });
    }

    struct Fixture {
        dir: TempDir,
        docs: Arc<Mutex<Documents>>,
        setup: Arc<crate::setup::Setup>,
    }

    impl Fixture {
        fn new(names: &[&str]) -> Self {
            let dir = TempDir::new("closing");
            let mut docs = Documents::default();
            for name in names {
                fs::write(dir.join(name), b"# Text\r\n").unwrap();
            }
            docs.admit(Request {
                language: None,
                version: VERSION,
                paths: names
                    .iter()
                    .map(|name| dir.join(name).to_str().unwrap().into())
                    .collect(),
            });
            let setup = Arc::new(crate::setup::Setup::new(dir.join("preferences.json")));
            Self {
                dir,
                docs: Arc::new(Mutex::new(docs)),
                setup,
            }
        }

        fn request(&self, names: &[&str]) -> CloseRequest {
            CloseRequest {
                version: VERSION,
                close: names
                    .iter()
                    .map(|name| self.dir.join(name).to_str().unwrap().into())
                    .collect(),
            }
        }

        async fn close(&self, names: &[&str], renderer: &Renderer) -> Response {
            close(
                self.request(names),
                self.docs.clone(),
                self.setup.clone(),
                renderer,
            )
            .await
        }
    }

    /// A renderer that answers each requested ID through `answer`, as the webview would.
    fn answering(answer: fn(&str) -> Outcome) -> (Renderer, Arc<Mutex<Vec<Vec<String>>>>) {
        let requests = Arc::new(CloseRequests::default());
        requests.subscribe();
        let asked = Arc::new(Mutex::new(Vec::new()));
        let (completing, recorded) = (requests.clone(), asked.clone());
        let emit: Emit = Arc::new(move |event: &CloseFilesRequested| {
            recorded.lock().unwrap().push(event.ids.clone());
            let outcomes = event.ids.iter().map(|id| answer(id)).collect();
            let (completing, request) = (completing.clone(), event.request);
            tokio::spawn(async move { completing.complete(request, outcomes) });
            true
        });
        let renderer = Renderer {
            requests,
            emit,
            deadline: Duration::from_secs(2),
        };
        (renderer, asked)
    }

    fn statuses(response: &Response) -> Vec<(&str, Option<&str>)> {
        response
            .results
            .iter()
            .map(|result| (result.status.as_str(), result.reason.as_deref()))
            .collect()
    }

    #[test]
    fn close_reports_each_path_in_order_from_the_renderer_answer() {
        let fixture = Fixture::new(&["a.md", "b.md", "c.md", "d.md"]);
        fs::write(fixture.dir.join("notes.txt"), b"not admitted").unwrap();
        let (renderer, asked) = answering(|id| match id {
            "0" => Outcome::Closed { id: id.into() },
            "1" => Outcome::Blocked {
                id: id.into(),
                reason: BlockReason::PendingDraft,
            },
            "2" => Outcome::Error {
                id: id.into(),
                error: "document_not_open".into(),
            },
            _ => Outcome::Error {
                id: id.into(),
                error: "close_failed".into(),
            },
        });
        let response = runtime().block_on(fixture.close(
            &[
                "a.md",
                "notes.txt",
                "b.md",
                "missing.md",
                "a.md",
                "c.md",
                "d.md",
            ],
            &renderer,
        ));
        assert!(response.error.is_none());
        assert_eq!(
            statuses(&response),
            [
                ("closed", None),
                ("not_open", None),
                ("blocked", Some("pending_draft")),
                ("not_open", None),
                ("closed", None),
                ("not_open", None),
                ("error", None),
            ]
        );
        assert_eq!(response.results[6].error.as_deref(), Some("close_failed"));
        assert_eq!(
            response.results[0].canonical.as_deref(),
            fixture.dir.join("a.md").to_str()
        );
        // Duplicate paths ask once per document.
        assert_eq!(*asked.lock().unwrap(), [["0", "1", "2", "3"]]);
        assert_eq!(mastermind_launch_check::protocol::exit_status(&response), 1);
    }

    #[test]
    fn deleted_and_aliased_files_resolve_to_their_admitted_document() {
        let fixture = Fixture::new(&["a.md", "b.md"]);
        fs::remove_file(fixture.dir.join("a.md")).unwrap();
        #[cfg(unix)]
        std::os::unix::fs::symlink(fixture.dir.join("b.md"), fixture.dir.join("alias.md")).unwrap();
        let (renderer, asked) = answering(|id| Outcome::Closed { id: id.into() });
        let names: &[&str] = if cfg!(unix) {
            &["a.md", "alias.md"]
        } else {
            &["a.md", "b.md"]
        };
        let response = runtime().block_on(fixture.close(names, &renderer));
        assert_eq!(statuses(&response), [("closed", None), ("closed", None)]);
        assert_eq!(*asked.lock().unwrap(), [["0", "1"]]);
    }

    #[test]
    fn without_a_renderer_answer_nothing_is_closed() {
        let fixture = Fixture::new(&["a.md"]);
        let silent = Renderer {
            requests: Arc::new(CloseRequests::default()),
            emit: Arc::new(|_: &CloseFilesRequested| true),
            deadline: Duration::from_millis(50),
        };
        let runtime = runtime();
        for subscribed in [false, true] {
            if subscribed {
                silent.requests.subscribe();
            }
            let response = runtime.block_on(fixture.close(&["a.md", "other.md"], &silent));
            assert_eq!(
                statuses(&response),
                [
                    ("blocked", Some("renderer_unavailable")),
                    ("not_open", None)
                ]
            );
            assert_eq!(fixture.docs.lock().unwrap().len(), 1);
            assert!(
                fixture
                    .docs
                    .lock()
                    .unwrap()
                    .get(0)
                    .unwrap()
                    .snapshot
                    .is_some()
            );
        }
    }

    #[test]
    fn invalid_close_requests_are_refused_before_resolution() {
        let fixture = Fixture::new(&["a.md"]);
        let (renderer, asked) = answering(|id| Outcome::Closed { id: id.into() });
        let runtime = runtime();
        for (request, error) in [
            (
                CloseRequest {
                    version: VERSION + 1,
                    close: vec![fixture.dir.join("a.md").to_str().unwrap().into()],
                },
                "incompatible_version",
            ),
            (
                CloseRequest {
                    version: VERSION,
                    close: vec![],
                },
                "invalid_request",
            ),
            (
                CloseRequest {
                    version: VERSION,
                    close: vec!["a.md".into()],
                },
                "invalid_request",
            ),
            (
                CloseRequest {
                    version: VERSION,
                    close: vec!["/a.md".into(); MAX_FILES + 1],
                },
                "invalid_request",
            ),
        ] {
            let response = runtime.block_on(close(
                request,
                fixture.docs.clone(),
                fixture.setup.clone(),
                &renderer,
            ));
            assert_eq!(response.error.as_deref(), Some(error));
        }
        assert!(asked.lock().unwrap().is_empty());
    }
}
