use interprocess::local_socket::{
    GenericFilePath, ListenerOptions,
    tokio::{Listener, Stream, prelude::*},
};
use std::{
    ffi::OsString,
    fs::{self, File},
    io,
    path::{Path, PathBuf},
};

/// The user's temporary directory as the system reports it, independent of the environment.
#[cfg(target_os = "macos")]
fn darwin_user_temp_dir() -> Option<PathBuf> {
    use std::os::unix::ffi::OsStringExt;
    let mut buffer = vec![0u8; libc::PATH_MAX as usize];
    // confstr writes a terminated path into the buffer and returns the length it needs, so a
    // zero result is a failure and a larger one is a truncated path.
    let needed = unsafe {
        libc::confstr(
            libc::_CS_DARWIN_USER_TEMP_DIR,
            buffer.as_mut_ptr().cast(),
            buffer.len(),
        )
    };
    if needed == 0 || needed > buffer.len() {
        return None;
    }
    buffer.truncate(needed - 1);
    Some(PathBuf::from(OsString::from_vec(buffer)))
}

/// The owner of `path` when it is a directory rather than a symlink to one.
fn directory_owner(path: &Path) -> Option<u32> {
    use std::os::unix::fs::MetadataExt;
    fs::symlink_metadata(path)
        .ok()
        .filter(|meta| meta.is_dir())
        .map(|meta| meta.uid())
}

/// The directory under which every launch path of one user resolves the same endpoint.
///
/// `TMPDIR` is per process, so a launcher run from a shell that overrides it would otherwise look
/// beside a different endpoint than a desktop-launched host and start a second one. macOS reports
/// the user's temporary directory through `confstr`, which ignores the environment. Linux tries the
/// session's `XDG_RUNTIME_DIR`, the systemd runtime directory `/run/user/<uid>` when the user owns
/// it, then the user's cache directory; none of these can be created by another user. Only when
/// every candidate is unavailable does the process temporary directory remain the root, and
/// `discover` still refuses a directory another user pre-created there.
fn user_runtime_root(
    env: impl Fn(&str) -> Option<OsString>,
    uid: u32,
    owner: impl Fn(&Path) -> Option<u32>,
) -> PathBuf {
    #[cfg(target_os = "macos")]
    {
        // The Linux candidates do not apply.
        let _ = (uid, owner);
        if let Some(root) = darwin_user_temp_dir() {
            return root;
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        let absolute = |name: &str| env(name).map(PathBuf::from).filter(|r| r.is_absolute());
        if let Some(root) = absolute("XDG_RUNTIME_DIR") {
            return root;
        }
        let systemd = PathBuf::from(format!("/run/user/{uid}"));
        if owner(&systemd) == Some(uid) {
            return systemd;
        }
        if let Some(root) =
            absolute("XDG_CACHE_HOME").or_else(|| absolute("HOME").map(|home| home.join(".cache")))
        {
            return root;
        }
    }
    env("TMPDIR")
        .filter(|dir| !dir.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("/tmp"))
}

pub fn discover() -> io::Result<PathBuf> {
    use std::os::unix::fs::{DirBuilderExt, MetadataExt};
    // This syscall has no arguments or borrowed memory and only reads the effective user identity.
    let uid = unsafe { libc::geteuid() };
    let path = std::env::var_os("MM_LAUNCH_CHECK_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            user_runtime_root(|name| std::env::var_os(name), uid, directory_owner)
                .join(format!("mastermind-launch-check-{uid}"))
        });
    // A cache root may not exist yet; missing parents are created private to the user.
    match fs::DirBuilder::new()
        .recursive(true)
        .mode(0o700)
        .create(&path)
    {
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

fn ownership(root: &Path) -> io::Result<File> {
    let mut options = fs::OpenOptions::new();
    options.create(true).truncate(false).read(true).write(true);
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

fn listen(root: &Path) -> io::Result<Listener> {
    let path = root.join("launch.sock");
    if let Ok(meta) = fs::symlink_metadata(&path) {
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

pub fn bind(root: &Path) -> io::Result<(Option<File>, Listener)> {
    let owner = ownership(root)?;
    let listener = listen(root)?;
    Ok((Some(owner), listener))
}

/// Refuses a peer whose effective user is not this process's. The private directory already keeps
/// other users from reaching the socket; this check holds even if that directory's permissions
/// are loosened or the socket is reached through an inherited descriptor.
fn require_same_user(peer: Option<u32>, uid: u32) -> io::Result<()> {
    if peer == Some(uid) {
        Ok(())
    } else {
        Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "unexpected_endpoint_owner",
        ))
    }
}

/// Checks that the other end of `stream` runs as this process's effective user.
pub fn authorize_peer(stream: &Stream) -> io::Result<()> {
    // geteuid has no arguments or borrowed memory and only reads the effective user identity.
    require_same_user(stream.peer_creds()?.euid(), unsafe { libc::geteuid() })
}

pub async fn connect(root: &Path) -> io::Result<Stream> {
    let stream = Stream::connect(root.join("launch.sock").to_fs_name::<GenericFilePath>()?).await?;
    authorize_peer(&stream)?;
    Ok(stream)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn env_with<'a>(vars: &'a [(&'a str, &'a str)]) -> impl Fn(&str) -> Option<OsString> + 'a {
        move |name| {
            vars.iter()
                .find(|(key, _)| *key == name)
                .map(|(_, value)| OsString::from(value))
        }
    }

    fn owned_by<'a>(dirs: &'a [(&'a str, u32)]) -> impl Fn(&Path) -> Option<u32> + 'a {
        move |path| {
            dirs.iter()
                .find(|(dir, _)| Path::new(dir) == path)
                .map(|(_, owner)| *owner)
        }
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn runtime_root_ignores_tmpdir_on_macos() {
        let system = darwin_user_temp_dir().expect("confstr reports the user temporary directory");
        assert!(system.is_absolute());
        let root = |vars| user_runtime_root(env_with(vars), 501, owned_by(&[]));
        assert_eq!(root(&[("TMPDIR", "/one")]), system);
        assert_eq!(
            root(&[("TMPDIR", "/two"), ("HOME", "/Users/reader")]),
            system
        );
        assert_eq!(root(&[]), system);
    }

    #[cfg(not(target_os = "macos"))]
    #[test]
    fn runtime_root_prefers_directories_only_the_user_can_create() {
        let root = |vars: &[(&str, &str)], dirs: &[(&str, u32)]| {
            user_runtime_root(env_with(vars), 1000, owned_by(dirs))
        };
        let session = [
            ("XDG_RUNTIME_DIR", "/session"),
            ("HOME", "/home/reader"),
            ("TMPDIR", "/one"),
        ];
        assert_eq!(
            root(&session, &[("/run/user/1000", 1000)]),
            PathBuf::from("/session")
        );
        let fallback = [
            ("XDG_RUNTIME_DIR", "relative"),
            ("HOME", "/home/reader"),
            ("TMPDIR", "/one"),
        ];
        assert_eq!(
            root(&fallback, &[("/run/user/1000", 1000)]),
            PathBuf::from("/run/user/1000")
        );
        // A runtime directory another user owns, or none at all, falls through to the cache.
        assert_eq!(
            root(&fallback, &[("/run/user/1000", 0)]),
            PathBuf::from("/home/reader/.cache")
        );
        assert_eq!(root(&fallback, &[]), PathBuf::from("/home/reader/.cache"));
        let cache = [
            ("XDG_CACHE_HOME", "/cache"),
            ("HOME", "/home/reader"),
            ("TMPDIR", "/one"),
        ];
        assert_eq!(root(&cache, &[]), PathBuf::from("/cache"));
        let relative = [
            ("XDG_CACHE_HOME", "cache"),
            ("HOME", "home"),
            ("TMPDIR", "/one"),
        ];
        assert_eq!(root(&relative, &[]), PathBuf::from("/one"));
    }

    #[test]
    fn runtime_root_falls_back_to_the_process_temporary_directory() {
        #[cfg(target_os = "macos")]
        if darwin_user_temp_dir().is_some() {
            return;
        }
        let root = |vars| user_runtime_root(env_with(vars), 1000, owned_by(&[]));
        assert_eq!(root(&[("TMPDIR", "/one")]), PathBuf::from("/one"));
        assert_eq!(root(&[("TMPDIR", "")]), PathBuf::from("/tmp"));
        assert_eq!(root(&[]), PathBuf::from("/tmp"));
    }

    #[test]
    fn the_runtime_directory_must_be_a_real_directory() {
        use std::os::unix::fs::MetadataExt;
        let dir = crate::test_support::TempDir::new("runtime-owner");
        let uid = fs::metadata(dir.path()).unwrap().uid();
        assert_eq!(directory_owner(dir.path()), Some(uid));
        std::os::unix::fs::symlink(dir.path(), dir.join("link")).unwrap();
        fs::write(dir.join("file"), b"").unwrap();
        for path in ["link", "file", "missing"] {
            assert_eq!(directory_owner(&dir.join(path)), None);
        }
    }

    #[test]
    fn peers_must_run_as_the_same_user() {
        assert!(require_same_user(Some(501), 501).is_ok());
        for peer in [Some(0), Some(502), None] {
            let error = require_same_user(peer, 501).unwrap_err();
            assert_eq!(error.kind(), io::ErrorKind::PermissionDenied);
            assert_eq!(error.to_string(), "unexpected_endpoint_owner");
        }
    }

    #[test]
    fn both_ends_of_a_loopback_exchange_verify_the_peer() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        // Socket paths are short-lived and bounded in length, so this root stays near `/tmp`.
        let root = PathBuf::from(format!("/tmp/mm-peer-{}", std::process::id()));
        fs::create_dir_all(&root).unwrap();
        let runtime = tokio::runtime::Runtime::new().unwrap();
        runtime.block_on(async {
            let (_owner, listener) = bind(&root).unwrap();
            let server = tokio::spawn(async move {
                let stream = listener.accept().await.unwrap();
                authorize_peer(&stream).unwrap();
                let mut stream = stream;
                stream.write_all(b"hello").await.unwrap();
            });
            let mut client = connect(&root).await.unwrap();
            let mut message = [0; 5];
            client.read_exact(&mut message).await.unwrap();
            assert_eq!(&message, b"hello");
            server.await.unwrap();
        });
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn discover_creates_a_private_directory_under_the_root() {
        use std::os::unix::fs::MetadataExt;
        let root = discover().unwrap();
        let meta = fs::metadata(&root).unwrap();
        assert!(meta.is_dir());
        assert_eq!(meta.mode() & 0o077, 0);
        assert_eq!(discover().unwrap(), root);
    }
}
