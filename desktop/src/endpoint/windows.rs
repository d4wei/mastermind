use interprocess::{
    local_socket::{
        GenericFilePath, ListenerOptions,
        tokio::{Listener, Stream, prelude::*},
    },
    os::windows::{local_socket::ListenerOptionsExt, security_descriptor::SecurityDescriptor},
};
use std::{
    fs::File,
    io,
    os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle},
    path::{Path, PathBuf},
};
use widestring::U16CString;
use windows_sys::Win32::{
    Foundation::{ERROR_ACCESS_DENIED, ERROR_INSUFFICIENT_BUFFER, HANDLE, LocalFree},
    Security::{
        Authorization::ConvertSidToStringSidW, GetTokenInformation, TOKEN_QUERY, TOKEN_USER,
        TokenUser,
    },
    System::Threading::{
        GetCurrentProcess, OpenProcess, OpenProcessToken, PROCESS_QUERY_LIMITED_INFORMATION,
    },
};

fn process_user(process: HANDLE) -> io::Result<String> {
    let mut raw_token = std::ptr::null_mut();
    // The caller keeps the process handle alive; ownership of a successful token transfers here.
    if unsafe { OpenProcessToken(process, TOKEN_QUERY, &mut raw_token) } == 0 {
        return Err(io::Error::last_os_error());
    }
    let token = unsafe { OwnedHandle::from_raw_handle(raw_token) };
    let mut size = 0;
    unsafe {
        GetTokenInformation(
            token.as_raw_handle(),
            TokenUser,
            std::ptr::null_mut(),
            0,
            &mut size,
        )
    };
    if io::Error::last_os_error().raw_os_error() != Some(ERROR_INSUFFICIENT_BUFFER as i32) {
        return Err(io::Error::last_os_error());
    }
    // TOKEN_USER contains pointers, so its variable-sized buffer needs pointer alignment.
    let mut buffer = vec![0usize; (size as usize).div_ceil(size_of::<usize>())];
    if unsafe {
        GetTokenInformation(
            token.as_raw_handle(),
            TokenUser,
            buffer.as_mut_ptr().cast(),
            size,
            &mut size,
        )
    } == 0
    {
        return Err(io::Error::last_os_error());
    }
    let user = unsafe { &*buffer.as_ptr().cast::<TOKEN_USER>() };
    let mut text = std::ptr::null_mut();
    if unsafe { ConvertSidToStringSidW(user.User.Sid, &mut text) } == 0 {
        return Err(io::Error::last_os_error());
    }
    // ConvertSidToStringSidW returns a terminated string allocated with LocalAlloc.
    let sid = unsafe { widestring::U16CStr::from_ptr_str(text) }.to_string_lossy();
    unsafe { LocalFree(text.cast()) };
    Ok(sid)
}

fn current_user() -> io::Result<String> {
    process_user(unsafe { GetCurrentProcess() })
}

pub fn discover() -> io::Result<PathBuf> {
    let id = std::env::var("MM_LAUNCH_CHECK_ID").unwrap_or_else(|_| "default".into());
    if id.is_empty() || id.len() > 64 || !id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
    {
        return Err(io::Error::other("invalid_experiment_id"));
    }
    Ok(PathBuf::from(format!(
        r"\\.\pipe\mastermind-launch-check-{}-{id}",
        current_user()?
    )))
}

fn descriptor() -> io::Result<SecurityDescriptor> {
    let sid = current_user()?;
    let sddl =
        U16CString::from_str(format!("O:{sid}D:P(A;;GA;;;{sid})")).map_err(io::Error::other)?;
    SecurityDescriptor::deserialize(&sddl)
}

pub fn bind(path: &Path) -> io::Result<(Option<File>, Listener)> {
    // Interprocess reserves the first pipe instance and rejects remote clients. Windows releases
    // the endpoint with its last handle, so it needs neither a lock file nor stale-file cleanup.
    let listener = ListenerOptions::new()
        .name(path.to_fs_name::<GenericFilePath>()?)
        .security_descriptor(descriptor()?)
        .create_tokio()
        .map_err(|error| {
            if error.raw_os_error() == Some(ERROR_ACCESS_DENIED as i32) {
                io::Error::new(io::ErrorKind::WouldBlock, error)
            } else {
                error
            }
        })?;
    Ok((None, listener))
}

/// The pipe's security descriptor admits only this user, so accepted clients need no further
/// check; `connect` verifies the server's identity.
pub fn authorize_peer(_: &Stream) -> io::Result<()> {
    Ok(())
}

pub async fn connect(path: &Path) -> io::Result<Stream> {
    let stream = Stream::connect(path.to_fs_name::<GenericFilePath>()?).await?;
    let pid = stream
        .peer_creds()?
        .pid()
        .ok_or_else(|| io::Error::other("missing_peer_identity"))?;
    let process = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid) };
    if process.is_null() {
        return Err(io::Error::last_os_error());
    }
    let process = unsafe { OwnedHandle::from_raw_handle(process) };
    if process_user(process.as_raw_handle())? != current_user()? {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "unexpected_endpoint_owner",
        ));
    }
    Ok(stream)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn listener_is_exclusive_and_released_with_its_handle() {
        let runtime = tokio::runtime::Runtime::new().unwrap();
        runtime.block_on(async {
            let path = PathBuf::from(format!(r"\\.\pipe\mastermind-unit-{}", std::process::id()));
            let first = bind(&path).unwrap();
            assert_eq!(bind(&path).unwrap_err().kind(), io::ErrorKind::WouldBlock);
            drop(first);
            assert!(bind(&path).is_ok());
        });
    }

    #[test]
    fn client_verifies_server_identity_and_exchanges_bytes() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let runtime = tokio::runtime::Runtime::new().unwrap();
        runtime.block_on(async {
            let path = PathBuf::from(format!(
                r"\\.\pipe\mastermind-peer-unit-{}",
                std::process::id()
            ));
            let (_, listener) = bind(&path).unwrap();
            let server = tokio::spawn(async move {
                let mut stream = listener.accept().await.unwrap();
                stream.write_all(b"hello").await.unwrap();
                let mut reply = [0; 2];
                stream.read_exact(&mut reply).await.unwrap();
                assert_eq!(&reply, b"ok");
            });
            let mut client = connect(&path).await.unwrap();
            let mut message = [0; 5];
            client.read_exact(&mut message).await.unwrap();
            assert_eq!(&message, b"hello");
            client.write_all(b"ok").await.unwrap();
            server.await.unwrap();
        });
    }
}
