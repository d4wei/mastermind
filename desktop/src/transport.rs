use crate::admission::{Documents, MAX_FRAME, Response};
use interprocess::local_socket::tokio::{Listener, Stream, prelude::*};
use mastermind_launch_check::protocol::Operation;
use std::{
    io,
    path::Path,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};

pub const DEADLINE: std::time::Duration = std::time::Duration::from_secs(10);

async fn frame(stream: &Stream) -> io::Result<Vec<u8>> {
    let mut bytes = Vec::new();
    BufReader::new(stream.take((MAX_FRAME + 1) as u64))
        .read_until(b'\n', &mut bytes)
        .await?;
    if bytes.len() > MAX_FRAME || bytes.last() != Some(&b'\n') {
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
    let response: Response = serde_json::from_slice(&frame(&stream).await?)?;
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
    response.onboarding_needed = setup.onboarding_needed().ok();
    response
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
    while let Ok(stream) = listener.accept().await {
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
                let response = match frame(&stream).await.and_then(|bytes| {
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
