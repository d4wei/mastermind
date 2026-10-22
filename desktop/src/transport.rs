use crate::admission::{Documents, MAX_FRAME, Response};
use mastermind_launch_check::protocol::MAX_REPLY_FRAME;
use interprocess::local_socket::tokio::{Listener, prelude::*};
use mastermind_launch_check::protocol::Operation;
use std::{
    io,
    path::Path,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
};
use tokio::io::{AsyncBufReadExt, AsyncRead, AsyncReadExt, AsyncWriteExt, BufReader};

pub const DEADLINE: std::time::Duration = std::time::Duration::from_secs(10);
const ACCEPT_RETRY: std::time::Duration = std::time::Duration::from_millis(100);
const ACCEPT_RETRY_CAP: std::time::Duration = std::time::Duration::from_secs(5);

/// Doubles the pause after each consecutive accept failure, up to the cap.
fn accept_retry_delay(failures: u32) -> std::time::Duration {
    ACCEPT_RETRY.saturating_mul(1 << failures.saturating_sub(1).min(16)).min(ACCEPT_RETRY_CAP)
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
    if response.version != crate::admission::VERSION {
        return Err(io::Error::other("incompatible_version"));
    }
    Ok(response)
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

pub async fn serve(
    listener: Listener,
    docs: Arc<Mutex<Documents>>,
    setup: Arc<crate::setup::Setup>,
    app: tauri::AppHandle,
) {
    let drop_reply = Arc::new(AtomicBool::new(
        std::env::var_os("MM_LAUNCH_CHECK_DROP_REPLY").is_some(),
    ));
    let slots = Arc::new(tokio::sync::Semaphore::new(16));
    loop {
        let stream = next_connection(|| listener.accept()).await;
        let Ok(permit) = slots.clone().try_acquire_owned() else {
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
                    Ok(request) => crate::worker::blocking_work()
                        .run(move || dispatch(request, &docs, &setup))
                        .await
                        .unwrap(),
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
                let mut bytes = serde_json::to_vec(&response).unwrap();
                bytes.push(b'\n');
                let _ = (&stream).write_all(&bytes).await;
            };
            let _ = tokio::time::timeout(DEADLINE, work).await;
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::admission::{Request, VERSION};

    #[test]
    fn replies_for_requests_within_the_frame_limit_are_accepted() {
        let path = format!("/{}", "p".repeat(699));
        let request = serde_json::to_vec(&Operation::Open(Request {
            language: None,
            version: VERSION,
            paths: vec![path.clone(); crate::admission::MAX_FILES],
        }))
        .unwrap();
        assert!(request.len() < MAX_FRAME);
        let mut reply = serde_json::to_vec(&Response {
            results: (0..crate::admission::MAX_FILES)
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
        let runtime = tokio::runtime::Builder::new_current_thread().build().unwrap();
        assert_eq!(runtime.block_on(frame(&reply[..], MAX_REPLY_FRAME)).unwrap(), reply);
        assert!(runtime.block_on(frame(&reply[..], MAX_FRAME)).is_err());
    }

    #[test]
    fn accept_failures_do_not_stop_the_listener() {
        let runtime = tokio::runtime::Builder::new_current_thread().enable_time().build().unwrap();
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
        assert_eq!(delays[..4], [100, 200, 400, 3200].map(std::time::Duration::from_millis));
        assert!(delays[4..].iter().all(|delay| *delay == ACCEPT_RETRY_CAP));
    }

    #[test]
    fn rejected_requests_report_unknown_setup_state() {
        let path = std::env::temp_dir().join(format!(
            "mastermind-transport-rejected-{}.json",
            std::process::id()
        ));
        let setup = crate::setup::Setup::new(path);
        let docs = Mutex::new(Documents::default());
        let response = dispatch(
            Operation::Open(Request { language: None, version: VERSION + 1, paths: vec![] }),
            &docs,
            &setup,
        );
        assert_eq!(response.error.as_deref(), Some("incompatible_version"));
        assert_eq!(response.onboarding_needed, None);
    }

    #[test]
    fn setup_operations_do_not_wait_for_the_document_registry() {
        let path = std::env::temp_dir().join(format!(
            "mastermind-transport-missing-preferences-{}.json",
            std::process::id()
        ));
        let setup = Arc::new(crate::setup::Setup::new(path));
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
        let root = std::env::temp_dir().join(format!(
            "mastermind-transport-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir(&root).unwrap();
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
        std::fs::write(&preferences, b"{\"onboardingCompleted\":true,\"authorTag\":\"Reader\",\"uiLang\":\"en\"}").unwrap();
        assert_eq!(
            dispatch(request(), &docs, &setup).onboarding_needed,
            Some(false)
        );
        assert_eq!(std::fs::read(&path).unwrap(), b"# Exact\r\n");
        std::fs::remove_dir_all(root).unwrap();
    }
}
