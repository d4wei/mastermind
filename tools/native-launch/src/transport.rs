use crate::admission::{Documents, MAX_FRAME, Request, Response};
use interprocess::local_socket::{
    GenericFilePath, ListenerOptions,
    tokio::{Listener, Stream, prelude::*},
};
use std::{
    fs::{self, File},
    io,
    path::{Path, PathBuf},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};

pub const DEADLINE: std::time::Duration = std::time::Duration::from_secs(10);

#[cfg(unix)]
pub fn runtime_dir() -> io::Result<PathBuf> {
    use std::os::unix::fs::{DirBuilderExt, MetadataExt};
    // This syscall has no arguments or borrowed memory and only reads the effective user identity.
    let uid = unsafe { libc::geteuid() };
    let path = std::env::var_os("MM_LAUNCH_CHECK_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| std::env::temp_dir().join(format!("mastermind-launch-check-{uid}")));
    match fs::DirBuilder::new().mode(0o700).create(&path) {
        Ok(()) => {}
        Err(e) if e.kind() == io::ErrorKind::AlreadyExists => {}
        Err(e) => return Err(e),
    }
    let meta = fs::symlink_metadata(&path)?;
    if !meta.is_dir() || meta.uid() != uid || meta.mode() & 0o077 != 0 {
        return Err(io::Error::other("runtime_directory_not_private"));
    }
    fs::canonicalize(path)
}

#[cfg(not(unix))]
pub fn runtime_dir() -> io::Result<PathBuf> {
    Err(io::Error::other(
        "Windows endpoint ownership validation is not implemented in this experiment",
    ))
}

pub fn ownership(root: &Path) -> io::Result<File> {
    let mut options = fs::OpenOptions::new();
    options.create(true).truncate(false).read(true).write(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options
            .mode(0o600)
            .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK);
    }
    let file = options.open(root.join("owner.lock"))?;
    if !file.metadata()?.is_file() {
        return Err(io::Error::other("invalid_owner_lock"));
    }
    file.try_lock().map_err(io::Error::from)?;
    Ok(file)
}

pub fn listen(root: &Path) -> io::Result<Listener> {
    let path = root.join("launch.sock");
    if let Ok(meta) = fs::symlink_metadata(&path) {
        #[cfg(unix)]
        {
            use std::os::unix::fs::{FileTypeExt, MetadataExt};
            if !meta.file_type().is_socket() || meta.uid() != fs::metadata(root)?.uid() {
                return Err(io::Error::other("unexpected_endpoint_owner_or_type"));
            }
        }
        // The lifetime lock prevents cooperating hosts from unlinking each other's listener.
        fs::remove_file(&path)?;
    }
    ListenerOptions::new()
        .name(path.to_fs_name::<GenericFilePath>()?)
        .create_tokio()
}

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
    let stream = Stream::connect(root.join("launch.sock").to_fs_name::<GenericFilePath>()?).await?;
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

pub async fn serve(listener: Listener, docs: Arc<Mutex<Documents>>) {
    let drop_reply = Arc::new(AtomicBool::new(
        std::env::var_os("MM_LAUNCH_CHECK_DROP_REPLY").is_some(),
    ));
    let slots = Arc::new(tokio::sync::Semaphore::new(16));
    while let Ok(stream) = listener.accept().await {
        let Ok(permit) = slots.clone().try_acquire_owned() else {
            continue;
        };
        let docs = docs.clone();
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
