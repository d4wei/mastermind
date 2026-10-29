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

/// The directory under which every launch path of one user resolves the same endpoint.
///
/// `TMPDIR` is per process, so a launcher run from a shell that overrides it would otherwise look
/// beside a different endpoint than a desktop-launched host and start a second one. macOS reports
/// the user's temporary directory through `confstr`, which ignores the environment; Linux session
/// managers publish `XDG_RUNTIME_DIR`, which only its user can create. Without either, the process
/// temporary directory remains the root, and `discover` still refuses a directory another user
/// pre-created there.
fn user_runtime_root(env: impl Fn(&str) -> Option<OsString>) -> PathBuf {
    #[cfg(target_os = "macos")]
    if let Some(root) = darwin_user_temp_dir() {
        return root;
    }
    #[cfg(not(target_os = "macos"))]
    if let Some(root) = env("XDG_RUNTIME_DIR")
        .map(PathBuf::from)
        .filter(|r| r.is_absolute())
    {
        return root;
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
            user_runtime_root(|name| std::env::var_os(name))
                .join(format!("mastermind-launch-check-{uid}"))
        });
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

pub async fn connect(root: &Path) -> io::Result<Stream> {
    Stream::connect(root.join("launch.sock").to_fs_name::<GenericFilePath>()?).await
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

    #[cfg(target_os = "macos")]
    #[test]
    fn runtime_root_ignores_tmpdir_on_macos() {
        let system = darwin_user_temp_dir().expect("confstr reports the user temporary directory");
        assert!(system.is_absolute());
        assert_eq!(user_runtime_root(env_with(&[("TMPDIR", "/one")])), system);
        assert_eq!(user_runtime_root(env_with(&[("TMPDIR", "/two")])), system);
        assert_eq!(user_runtime_root(env_with(&[])), system);
    }

    #[cfg(not(target_os = "macos"))]
    #[test]
    fn runtime_root_prefers_the_session_runtime_directory() {
        assert_eq!(
            user_runtime_root(env_with(&[
                ("XDG_RUNTIME_DIR", "/run/user/1000"),
                ("TMPDIR", "/one")
            ])),
            PathBuf::from("/run/user/1000")
        );
        assert_eq!(
            user_runtime_root(env_with(&[
                ("XDG_RUNTIME_DIR", "relative"),
                ("TMPDIR", "/one")
            ])),
            PathBuf::from("/one")
        );
    }

    #[test]
    fn runtime_root_falls_back_to_the_process_temporary_directory() {
        #[cfg(target_os = "macos")]
        if darwin_user_temp_dir().is_some() {
            return;
        }
        assert_eq!(
            user_runtime_root(env_with(&[("TMPDIR", "/one")])),
            PathBuf::from("/one")
        );
        assert_eq!(
            user_runtime_root(env_with(&[("TMPDIR", "")])),
            PathBuf::from("/tmp")
        );
        assert_eq!(user_runtime_root(env_with(&[])), PathBuf::from("/tmp"));
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
