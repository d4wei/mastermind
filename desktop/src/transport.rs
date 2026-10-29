use crate::{admission::Documents, worker::BlockingWork};
use interprocess::local_socket::tokio::{Listener, prelude::*};
use mastermind_launch_check::protocol::{MAX_FRAME, MAX_REPLY_FRAME, Operation, Response, VERSION};
use std::{
    io,
    path::Path,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
};
use tokio::{
    io::{AsyncBufReadExt, AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt, BufReader},
    sync::{OwnedSemaphorePermit, Semaphore},
};

pub const DEADLINE: std::time::Duration = std::time::Duration::from_secs(10);
const ACCEPT_RETRY: std::time::Duration = std::time::Duration::from_millis(100);
const ACCEPT_RETRY_CAP: std::time::Duration = std::time::Duration::from_secs(5);
const CONNECTION_SLOTS: usize = 16;
const BUSY_REPLY_DEADLINE: std::time::Duration = std::time::Duration::from_secs(1);

fn accept_retry_delay(failures: u32) -> std::time::Duration {
    ACCEPT_RETRY
        .saturating_mul(1 << failures.saturating_sub(1).min(16))
        .min(ACCEPT_RETRY_CAP)
}

async fn frame(stream: impl AsyncRead + Unpin, limit: usize) -> io::Result<Vec<u8>> {
    let mut bytes = Vec::new();
    BufReader::new(stream.take((limit + 1) as u64))
        .read_until(b'\n', &mut bytes)
        .await?;
    if bytes.len() > limit || bytes.last() != Some(&b'\n') {
        return Err(io::Error::other("invalid_frame"));
    }
    Ok(bytes)
}

pub async fn exchange(root: &Path, request: &Operation) -> io::Result<Response> {
    let stream = crate::endpoint::connect(root).await?;
    let mut bytes = serde_json::to_vec(request)?;
    bytes.push(b'\n');
    if bytes.len() > MAX_FRAME {
        return Err(io::Error::other("request_too_large"));
    }
    (&stream).write_all(&bytes).await?;
    let response: Response = serde_json::from_slice(&frame(&stream, MAX_REPLY_FRAME).await?)?;
    if response.version != VERSION {
        return Err(io::Error::other("incompatible_version"));
    }
    Ok(response)
}

/// Admissions wait in their own lane, so a stalled one cannot take the capacity document commands
/// need.
fn lane(request: &Operation) -> &'static BlockingWork {
    match request {
        Operation::Open(_) => crate::worker::admission_work(),
        Operation::Setup(_) => crate::worker::blocking_work(),
    }
}

fn dispatch(request: Operation, docs: &Mutex<Documents>, setup: &crate::setup::Setup) -> Response {
    let mut response = match request {
        Operation::Open(request) => docs.lock().unwrap().admit(request),
        Operation::Setup(request) => setup.suggest(request),
    };
    // A rejected request reports unknown setup state, like invocation failures.
    if response.error.is_none() {
        response.onboarding_needed = setup.onboarding_needed().ok();
    }
    response
}

/// Waits for the next connection. The listener treats every accept failure as transient, such as
/// descriptor exhaustion or an aborted connection, and keeps serving; backoff keeps a failure that
/// does not clear from spinning.
async fn next_connection<T, F>(mut accept: impl FnMut() -> F) -> T
where
    F: std::future::Future<Output = io::Result<T>>,
{
    let mut failures = 0u32;
    loop {
        match accept().await {
            Ok(connection) => return connection,
            Err(error) => {
                failures = failures.saturating_add(1);
                eprintln!("Launcher connection failed: {error}");
                tokio::time::sleep(accept_retry_delay(failures)).await;
            }
        }
    }
}

async fn respond(
    request: Operation,
    docs: Arc<Mutex<Documents>>,
    setup: Arc<crate::setup::Setup>,
) -> Response {
    lane(&request)
        .run(move || dispatch(request, &docs, &setup))
        .await
        .unwrap_or_else(|_| Response::error("host_failure"))
}

async fn write_reply(mut stream: impl AsyncWrite + Unpin, response: &Response) {
    let mut bytes = serde_json::to_vec(response).unwrap();
    bytes.push(b'\n');
    let _ = stream.write_all(&bytes).await;
}

/// Takes a connection slot, or refuses the connection with `busy` so the launcher reports a
/// definite refusal rather than an unknown outcome.
async fn take_slot(
    slots: &Arc<Semaphore>,
    stream: impl AsyncWrite + Unpin,
) -> Option<OwnedSemaphorePermit> {
    match slots.clone().try_acquire_owned() {
        Ok(permit) => Some(permit),
        Err(_) => {
            let busy = Response::error("busy");
            let _ = tokio::time::timeout(BUSY_REPLY_DEADLINE, write_reply(stream, &busy)).await;
            None
        }
    }
}

pub async fn serve(
    listener: Listener,
    docs: Arc<Mutex<Documents>>,
    setup: Arc<crate::setup::Setup>,
    app: tauri::AppHandle,
) {
    let drop_reply = Arc::new(AtomicBool::new(
        std::env::var_os("MM_LAUNCH_CHECK_DROP_REPLY").is_some(),
    ));
    let slots = Arc::new(Semaphore::new(CONNECTION_SLOTS));
    loop {
        let stream = next_connection(|| listener.accept()).await;
        let Some(permit) = take_slot(&slots, &stream).await else {
            continue;
        };
        let docs = docs.clone();
        let setup = setup.clone();
        let app = app.clone();
        let drop_reply = drop_reply.clone();
        tokio::spawn(async move {
            let _permit = permit;
            let work = async {
                let response = match frame(&stream, MAX_FRAME).await.and_then(|bytes| {
                    serde_json::from_slice::<Operation>(&bytes).map_err(io::Error::from)
                }) {
                    Ok(request) => respond(request, docs, setup).await,
                    Err(_) => Response::error("invalid_request"),
                };
                if response
                    .results
                    .iter()
                    .any(|result| result.canonical.is_some())
                {
                    crate::opening::focus(&app);
                }
                if drop_reply.swap(false, Ordering::SeqCst) {
                    return;
                }
                write_reply(&stream, &response).await;
            };
            let _ = tokio::time::timeout(DEADLINE, work).await;
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::TempDir;
    use mastermind_launch_check::protocol::{MAX_FILES, Request};

    #[test]
    fn replies_for_requests_within_the_frame_limit_are_accepted() {
        let path = format!("/{}", "p".repeat(699));
        let request = serde_json::to_vec(&Operation::Open(Request {
            language: None,
            version: VERSION,
            paths: vec![path.clone(); MAX_FILES],
        }))
        .unwrap();
        assert!(request.len() < MAX_FRAME);
        let mut reply = serde_json::to_vec(&Response {
            results: (0..MAX_FILES)
                .map(|_| mastermind_launch_check::protocol::FileResult {
                    path: path.clone(),
                    canonical: Some(path.clone()),
                    status: "already_open".into(),
                    error: None,
                    message: None,
                })
                .collect(),
            error: None,
            ..Response::error("")
        })
        .unwrap();
        reply.push(b'\n');
        assert!(reply.len() > MAX_FRAME);
        let runtime = tokio::runtime::Builder::new_current_thread()
            .build()
            .unwrap();
        assert_eq!(
            runtime
                .block_on(frame(&reply[..], MAX_REPLY_FRAME))
                .unwrap(),
            reply
        );
        assert!(runtime.block_on(frame(&reply[..], MAX_FRAME)).is_err());
    }

    #[test]
    fn accept_failures_do_not_stop_the_listener() {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_time()
            .build()
            .unwrap();
        let mut attempts = 0;
        let connection = runtime.block_on(next_connection(|| {
            attempts += 1;
            let result = if attempts < 3 {
                Err(io::Error::from(io::ErrorKind::ConnectionAborted))
            } else {
                Ok(attempts)
            };
            async move { result }
        }));
        assert_eq!(connection, 3);
    }

    #[test]
    fn repeated_accept_failures_back_off_to_a_cap() {
        let delays: Vec<_> = [1, 2, 3, 6, 7, 40, u32::MAX].map(accept_retry_delay).into();
        assert_eq!(
            delays[..4],
            [100, 200, 400, 3200].map(std::time::Duration::from_millis)
        );
        assert!(delays[4..].iter().all(|delay| *delay == ACCEPT_RETRY_CAP));
    }

    #[test]
    fn rejected_requests_report_unknown_setup_state() {
        let dir = TempDir::new("transport-rejected");
        let setup = crate::setup::Setup::new(dir.join("preferences.json"));
        let docs = Mutex::new(Documents::default());
        let response = dispatch(
            Operation::Open(Request {
                language: None,
                version: VERSION + 1,
                paths: vec![],
            }),
            &docs,
            &setup,
        );
        assert_eq!(response.error.as_deref(), Some("incompatible_version"));
        assert_eq!(response.onboarding_needed, None);
    }

    #[test]
    fn setup_operations_do_not_wait_for_the_document_registry() {
        let dir = TempDir::new("transport-missing-preferences");
        let setup = Arc::new(crate::setup::Setup::new(dir.join("preferences.json")));
        let docs = Arc::new(Mutex::new(Documents::default()));
        let guard = docs.lock().unwrap();
        let (sender, receiver) = std::sync::mpsc::channel();
        let worker_docs = docs.clone();
        let thread = std::thread::spawn(move || {
            let request = Operation::Setup(mastermind_launch_check::protocol::SetupRequest {
                version: VERSION,
                setup: serde_json::from_value(serde_json::json!({"authorTag":"Reader"})).unwrap(),
            });
            sender
                .send(dispatch(request, &worker_docs, &setup))
                .unwrap();
        });
        let result = receiver.recv_timeout(std::time::Duration::from_secs(2));
        drop(guard);
        thread.join().unwrap();
        assert!(result.unwrap().error.is_none());
    }

    #[test]
    fn admission_remains_successful_when_completion_is_unknown_and_reports_saved_completion() {
        let root = TempDir::new("transport");
        let path = root.join("document.md");
        let preferences = root.join("preferences.json");
        std::fs::write(&path, b"# Exact\r\n").unwrap();
        let setup = crate::setup::Setup::new(preferences.clone());
        let docs = Mutex::new(Documents::default());
        let request = || {
            Operation::Open(Request {
                language: None,
                version: VERSION,
                paths: vec![path.to_str().unwrap().into()],
            })
        };
        let initial = dispatch(request(), &docs, &setup);
        assert_eq!(initial.onboarding_needed, Some(true));
        std::fs::write(&preferences, b"invalid JSON").unwrap();
        let response = dispatch(request(), &docs, &setup);
        assert_eq!(response.onboarding_needed, None);
        assert_eq!(response.results[0].status, "already_open");
        assert!(response.error.is_none());
        std::fs::write(
            &preferences,
            b"{\"onboardingCompleted\":true,\"authorTag\":\"Reader\",\"uiLang\":\"en\"}",
        )
        .unwrap();
        assert_eq!(
            dispatch(request(), &docs, &setup).onboarding_needed,
            Some(false)
        );
        assert_eq!(std::fs::read(&path).unwrap(), b"# Exact\r\n");
    }

    #[test]
    fn a_stalled_admission_leaves_gate_capacity_for_other_commands() {
        use std::time::Duration;
        let dir = TempDir::new("transport-stalled-admission");
        let setup = Arc::new(crate::setup::Setup::new(dir.join("preferences.json")));
        let docs = Arc::new(Mutex::new(Documents::default()));
        let open = || {
            Operation::Open(Request {
                language: None,
                version: VERSION,
                paths: vec![dir.join("missing.md").to_str().unwrap().into()],
            })
        };
        let runtime = tokio::runtime::Runtime::new().unwrap();
        runtime.block_on(async {
            let (started_tx, started_rx) = tokio::sync::oneshot::channel();
            let (release_tx, release_rx) = std::sync::mpsc::channel::<()>();
            let stalled = tokio::spawn(lane(&open()).run(move || {
                started_tx.send(()).unwrap();
                release_rx.recv_timeout(Duration::from_secs(5)).unwrap();
            }));
            tokio::time::timeout(Duration::from_secs(2), started_rx)
                .await
                .unwrap()
                .unwrap();
            let queued = tokio::spawn(respond(open(), docs.clone(), setup.clone()));
            let setup_request = Operation::Setup(mastermind_launch_check::protocol::SetupRequest {
                version: VERSION,
                setup: serde_json::from_value(serde_json::json!({"authorTag":"Reader"})).unwrap(),
            });
            let command = respond(setup_request, docs.clone(), setup.clone());
            let response = tokio::time::timeout(Duration::from_secs(2), command)
                .await
                .unwrap();
            assert!(response.error.is_none());
            assert!(!queued.is_finished());
            release_tx.send(()).unwrap();
            stalled.await.unwrap().unwrap();
            let admitted = tokio::time::timeout(Duration::from_secs(2), queued)
                .await
                .unwrap()
                .unwrap();
            assert_eq!(admitted.results[0].error.as_deref(), Some("file_not_found"));
        });
    }

    #[test]
    fn a_full_host_replies_busy_instead_of_dropping_the_connection() {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_time()
            .build()
            .unwrap();
        runtime.block_on(async {
            let slots = Arc::new(Semaphore::new(1));
            let held = take_slot(&slots, tokio::io::sink()).await.unwrap();
            let (mut launcher, host) = tokio::io::duplex(4096);
            assert!(take_slot(&slots, host).await.is_none());
            let reply: Response =
                serde_json::from_slice(&frame(&mut launcher, MAX_REPLY_FRAME).await.unwrap())
                    .unwrap();
            assert_eq!(reply.error.as_deref(), Some("busy"));
            assert_eq!(reply.version, VERSION);
            drop(held);
            assert!(take_slot(&slots, tokio::io::sink()).await.is_some());
        });
    }

    #[test]
    fn a_failed_worker_replies_host_failure() {
        let dir = TempDir::new("transport-host-failure");
        let setup = Arc::new(crate::setup::Setup::new(dir.join("preferences.json")));
        let docs = Arc::new(Mutex::new(Documents::default()));
        let poison = docs.clone();
        // A registry poisoned by an earlier panic makes the admission worker panic.
        let _ = std::thread::spawn(move || {
            let _guard = poison.lock().unwrap();
            panic!("registry poisoned");
        })
        .join();
        let request = Operation::Open(Request {
            language: None,
            version: VERSION,
            paths: vec![dir.join("document.md").to_str().unwrap().into()],
        });
        let runtime = tokio::runtime::Runtime::new().unwrap();
        let response = runtime.block_on(respond(request, docs, setup));
        assert_eq!(response.error.as_deref(), Some("host_failure"));
    }
}
