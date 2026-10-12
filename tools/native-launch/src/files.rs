use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    fs::{File, Metadata, OpenOptions},
    io::{self, Read, Seek, SeekFrom, Write},
    path::Path,
    time::UNIX_EPOCH,
};

pub const MAX_FILE_BYTES: u64 = 16 * 1024 * 1024;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub content: String,
    pub mtime_ms: f64,
    pub version: String,
    #[serde(skip)]
    pub bytes: Vec<u8>,
}

#[derive(Debug, Serialize)]
pub struct FileError {
    pub status: u16,
    pub error: String,
}

impl FileError {
    pub fn conflict() -> Self {
        Self {
            status: 409,
            error: "file_changed".into(),
        }
    }
}

impl From<io::Error> for FileError {
    fn from(error: io::Error) -> Self {
        Self {
            status: if error.kind() == io::ErrorKind::NotFound {
                404
            } else {
                500
            },
            error: error.to_string(),
        }
    }
}

fn open(path: &Path, write: bool) -> io::Result<File> {
    let mut options = OpenOptions::new();
    options.read(true).write(write);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK);
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        use windows_sys::Win32::Storage::FileSystem::FILE_FLAG_OPEN_REPARSE_POINT;
        options.custom_flags(FILE_FLAG_OPEN_REPARSE_POINT);
    }
    let file = options.open(path)?;
    let metadata = file.metadata()?;
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        use windows_sys::Win32::Storage::FileSystem::FILE_ATTRIBUTE_REPARSE_POINT;
        if metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
            return Err(io::Error::other("file_replaced"));
        }
    }
    if !metadata.is_file() || metadata.len() > MAX_FILE_BYTES {
        return Err(io::Error::other("not_supported_file"));
    }
    Ok(file)
}

fn stamp(file: &File, meta: &Metadata) -> io::Result<String> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        let _ = file;
        Ok(format!(
            "{}:{}:{}:{}:{}:{}:{}",
            meta.dev(),
            meta.ino(),
            meta.len(),
            meta.mtime(),
            meta.mtime_nsec(),
            meta.ctime(),
            meta.ctime_nsec()
        ))
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        Ok(format!(
            "{:?}:{}:{}:{}",
            file_identity(file)?,
            meta.file_size(),
            meta.last_write_time(),
            meta.creation_time()
        ))
    }
}

fn finish_snapshot(file: &File, path: &Path, before: &str, bytes: Vec<u8>) -> io::Result<Snapshot> {
    let after = file.metadata()?;
    let current = open(path, false)?;
    let token = stamp(file, &after)?;
    if bytes.len() as u64 > MAX_FILE_BYTES
        || before != token
        || token != stamp(&current, &current.metadata()?)?
    {
        return Err(io::Error::other("file_changed"));
    }
    Ok(Snapshot {
        content: String::from_utf8_lossy(&bytes).into_owned(),
        mtime_ms: after
            .modified()?
            .duration_since(UNIX_EPOCH)
            .map_err(io::Error::other)?
            .as_secs_f64()
            * 1000.0,
        version: format!("{token}:{:x}", Sha256::digest(&bytes)),
        bytes,
    })
}

fn snapshot(file: &mut File, path: &Path) -> io::Result<Snapshot> {
    let before = stamp(file, &file.metadata()?)?;
    file.seek(SeekFrom::Start(0))?;
    let mut bytes = Vec::new();
    file.take(MAX_FILE_BYTES + 1).read_to_end(&mut bytes)?;
    finish_snapshot(file, path, &before, bytes)
}

pub fn read(path: &Path) -> io::Result<Snapshot> {
    snapshot(&mut open(path, false)?, path)
}

// Callers serialize writes for each admitted path. Other processes do not share that lock.
pub fn write(path: &Path, content: &str, base_version: &str) -> Result<Snapshot, FileError> {
    if content.len() as u64 > MAX_FILE_BYTES {
        return Err(FileError {
            status: 413,
            error: "file_too_large".into(),
        });
    }
    let mut file = open(path, true).map_err(|error| {
        if matches!(
            error.kind(),
            io::ErrorKind::NotFound | io::ErrorKind::NotADirectory
        ) {
            FileError::conflict()
        } else {
            error.into()
        }
    })?;
    let base = snapshot(&mut file, path).map_err(|_| FileError::conflict())?;
    if base.version != base_version {
        return Err(FileError::conflict());
    }
    // Lossy decoding must not rewrite unedited bytes that are not valid UTF-8.
    if content == base.content {
        return Ok(base);
    }
    file.seek(SeekFrom::Start(0))?;
    file.write_all(content.as_bytes())?;
    file.set_len(content.len() as u64)?;
    let written = snapshot(&mut file, path).map_err(|_| FileError::conflict())?;
    if written.content != content {
        return Err(FileError::conflict());
    }
    Ok(written)
}
#[cfg(windows)]
pub fn file_identity(file: &File) -> io::Result<(u64, [u8; 16])> {
    use std::os::windows::io::AsRawHandle;
    use windows_sys::Win32::Storage::FileSystem::{
        FILE_ID_INFO, FileIdInfo, GetFileInformationByHandleEx,
    };
    let mut info = std::mem::MaybeUninit::<FILE_ID_INFO>::uninit();
    // Query the open handle rather than its path; a pathname can already refer to a replacement.
    if unsafe {
        GetFileInformationByHandleEx(
            file.as_raw_handle(),
            FileIdInfo,
            info.as_mut_ptr().cast(),
            size_of::<FILE_ID_INFO>() as u32,
        )
    } == 0
    {
        return Err(io::Error::last_os_error());
    }
    let info = unsafe { info.assume_init() };
    Ok((info.VolumeSerialNumber, info.FileId.Identifier))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::sync::{
        Arc, Mutex,
        atomic::{AtomicU64, Ordering},
    };
    static NEXT: AtomicU64 = AtomicU64::new(0);
    struct Fixture(std::path::PathBuf);
    impl Fixture {
        fn new() -> Self {
            let dir = std::env::temp_dir().join(format!(
                "mastermind-files-{}-{}",
                std::process::id(),
                NEXT.fetch_add(1, Ordering::Relaxed)
            ));
            fs::create_dir(&dir).unwrap();
            fs::write(dir.join("document.md"), b"original\r\n").unwrap();
            Self(dir)
        }
        fn file(&self) -> std::path::PathBuf {
            self.0.join("document.md")
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn unchanged_invalid_utf8_bom_and_crlf_are_byte_exact() {
        let f = Fixture::new();
        let bytes = [0xef, 0xbb, 0xbf, b'a', b'\r', b'\n', 0xff];
        fs::write(f.file(), bytes).unwrap();
        let base = read(&f.file()).unwrap();
        let saved = write(&f.file(), &base.content, &base.version).unwrap();
        assert_eq!(saved.version, base.version);
        assert_eq!(fs::read(f.file()).unwrap(), bytes);
    }

    #[test]
    fn missing_path_is_never_recreated() {
        let f = Fixture::new();
        let base = read(&f.file()).unwrap();
        fs::remove_file(f.file()).unwrap();
        assert_eq!(
            write(&f.file(), "local", &base.version).unwrap_err().status,
            409
        );
        assert!(!f.file().exists());
    }

    #[test]
    fn changed_content_with_restored_mtime_rejects_stale_base() {
        let f = Fixture::new();
        let base = read(&f.file()).unwrap();
        let modified = fs::metadata(f.file()).unwrap().modified().unwrap();
        fs::write(f.file(), b"external\r\n").unwrap();
        File::options()
            .write(true)
            .open(f.file())
            .unwrap()
            .set_modified(modified)
            .unwrap();
        assert_eq!(
            write(&f.file(), "local", &base.version).unwrap_err().status,
            409
        );
        assert_eq!(fs::read(f.file()).unwrap(), b"external\r\n");
    }

    #[test]
    fn identical_replacement_is_a_different_version() {
        let f = Fixture::new();
        let base = read(&f.file()).unwrap();
        let modified = fs::metadata(f.file()).unwrap().modified().unwrap();
        let replacement = f.0.join("replacement.md");
        fs::write(&replacement, &base.bytes).unwrap();
        File::options()
            .write(true)
            .open(&replacement)
            .unwrap()
            .set_modified(modified)
            .unwrap();
        fs::rename(replacement, f.file()).unwrap();
        assert_eq!(
            write(&f.file(), "local", &base.version).unwrap_err().status,
            409
        );
        assert_eq!(fs::read(f.file()).unwrap(), base.bytes);
    }

    #[test]
    fn snapshot_rejects_descriptor_change_and_path_replacement() {
        let f = Fixture::new();
        let file = open(&f.file(), false).unwrap();
        let before = stamp(&file, &file.metadata().unwrap()).unwrap();
        fs::write(f.file(), b"mutated in place").unwrap();
        assert!(finish_snapshot(&file, &f.file(), &before, b"original\r\n".to_vec()).is_err());
        let before = stamp(&file, &file.metadata().unwrap()).unwrap();
        let replacement = f.0.join("replacement");
        fs::write(&replacement, b"mutated in place").unwrap();
        fs::rename(replacement, f.file()).unwrap();
        assert!(finish_snapshot(&file, &f.file(), &before, b"mutated in place".to_vec()).is_err());
    }

    #[test]
    fn serialized_competing_writes_accept_only_one_base() {
        let f = Fixture::new();
        let base = read(&f.file()).unwrap();
        let gate = Arc::new(Mutex::new(()));
        let handles: Vec<_> = ["first", "second"]
            .into_iter()
            .map(|content| {
                let gate = gate.clone();
                let path = f.file();
                let version = base.version.clone();
                std::thread::spawn(move || {
                    let _guard = gate.lock().unwrap();
                    write(&path, content, &version).is_ok()
                })
            })
            .collect();
        assert_eq!(
            handles
                .into_iter()
                .map(|h| h.join().unwrap() as usize)
                .sum::<usize>(),
            1
        );
    }

    #[test]
    fn exact_multilingual_splice_and_truncation() {
        let f = Fixture::new();
        fs::write(f.file(), "标题\r\n{++新增++} {>>@Alex: 保留<<}\r\n").unwrap();
        let base = read(&f.file()).unwrap();
        let result = base.content.replace("{++新增++}", "新增");
        write(&f.file(), &result, &base.version).unwrap();
        assert_eq!(fs::read(f.file()).unwrap(), result.as_bytes());
    }

    #[cfg(unix)]
    #[test]
    fn canonical_writes_preserve_links_permissions_and_inode() {
        use std::os::unix::fs::{MetadataExt, PermissionsExt, symlink};
        let f = Fixture::new();
        let link = f.0.join("alias.md");
        symlink(f.file(), &link).unwrap();
        fs::set_permissions(f.file(), fs::Permissions::from_mode(0o640)).unwrap();
        let inode = fs::metadata(f.file()).unwrap().ino();
        let canonical = fs::canonicalize(&link).unwrap();
        let base = read(&canonical).unwrap();
        write(&canonical, "更新\r\n", &base.version).unwrap();
        assert!(fs::symlink_metadata(link).unwrap().is_symlink());
        let meta = fs::metadata(f.file()).unwrap();
        assert_eq!(meta.ino(), inode);
        assert_eq!(meta.mode() & 0o777, 0o640);
    }

    #[test]
    fn empty_version_and_oversized_write_do_not_change_disk() {
        let f = Fixture::new();
        assert_eq!(write(&f.file(), "unsafe", "").unwrap_err().status, 409);
        let base = read(&f.file()).unwrap();
        assert_eq!(
            write(
                &f.file(),
                &"a".repeat(MAX_FILE_BYTES as usize + 1),
                &base.version
            )
            .unwrap_err()
            .status,
            413
        );
        assert_eq!(fs::read(f.file()).unwrap(), base.bytes);
    }
}
