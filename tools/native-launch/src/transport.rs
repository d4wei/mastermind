use crate::admission::{Documents, MAX_FRAME, Request, Response};
use interprocess::local_socket::tokio::{Listener, Stream, prelude::*};
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

pub async fn exchange(root: &Path, request: &Request) -> io::Result<Response> {
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

pub async fn serve(listener: Listener, docs: Arc<Mutex<Documents>>, app: tauri::AppHandle) {
    let drop_reply = Arc::new(AtomicBool::new(
        std::env::var_os("MM_LAUNCH_CHECK_DROP_REPLY").is_some(),
    ));
    let slots = Arc::new(tokio::sync::Semaphore::new(16));
    while let Ok(stream) = listener.accept().await {
        let Ok(permit) = slots.clone().try_acquire_owned() else {
            continue;
        };
        let docs = docs.clone();
        let app = app.clone();
        let drop_reply = drop_reply.clone();
        tokio::spawn(async move {
            let _permit = permit;
            let work = async {
                let response = match frame(&stream).await.and_then(|bytes| {
                    serde_json::from_slice::<Request>(&bytes).map_err(io::Error::from)
                }) {
                    Ok(request) => {
                        tokio::task::spawn_blocking(move || docs.lock().unwrap().admit(request))
                            .await
                            .unwrap()
                    }
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
