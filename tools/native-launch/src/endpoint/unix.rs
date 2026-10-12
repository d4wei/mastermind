use interprocess::local_socket::{
    GenericFilePath, ListenerOptions,
    tokio::{Listener, Stream, prelude::*},
};
use std::{
    fs::{self, File},
    io,
    path::{Path, PathBuf},
};

pub fn discover() -> io::Result<PathBuf> {
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
