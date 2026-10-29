use serde::{Serialize, ser::SerializeStruct};
use sha2::{Digest, Sha256};
use std::{
    fs::{File, Metadata, OpenOptions},
    io::{self, Read, Seek, SeekFrom, Write},
    path::Path,
};

pub const MAX_FILE_BYTES: u64 = 16 * 1024 * 1024;

#[derive(Debug, Clone)]
pub struct Snapshot {
    pub version: String,
    pub bytes: Vec<u8>,
    /// The bytes are not valid UTF-8, so `content` replaced invalid sequences and edits cannot be
    /// saved in place.
    pub lossy: bool,
}

impl Snapshot {
    pub fn content(&self) -> std::borrow::Cow<'_, str> {
        String::from_utf8_lossy(&self.bytes)
    }
}

/// The UI receives decoded `content`, never the raw bytes.
impl Serialize for Snapshot {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut snapshot = serializer.serialize_struct("Snapshot", 3)?;
        snapshot.serialize_field("version", &self.version)?;
        snapshot.serialize_field("content", &self.content())?;
        snapshot.serialize_field("lossy", &self.lossy)?;
        snapshot.end()
    }
}

/// The failure class the document store acts on; it serializes as the UI's `HostFailure`. Only a
/// missing file is deletion evidence, so other not-found errors, such as a released document, are
/// plain failures.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum FailureKind {
    Conflict,
    Missing,
    NotUtf8,
    Failure,
}

#[derive(Debug, Serialize)]
pub struct FileError {
    pub status: u16,
    pub kind: FailureKind,
    pub error: String,
    pub message: String,
}

impl FileError {
    pub fn new(status: u16, code: &str, message: impl Into<String>) -> Self {
        Self {
            status,
            kind: FailureKind::Failure,
            error: code.into(),
            message: message.into(),
        }
    }

    fn with_kind(self, kind: FailureKind) -> Self {
        Self { kind, ..self }
    }

    fn conflict() -> Self {
        Self::new(
            409,
            "file_changed",
            "The file changed or was replaced. Compare the current file before saving.",
        )
        .with_kind(FailureKind::Conflict)
    }

    fn too_large() -> Self {
        Self::new(
            413,
            "file_too_large",
            "The file exceeds the supported size limit.",
        )
    }

    fn replacement_as_conflict(self) -> Self {
        if matches!(self.error.as_str(), "file_not_found" | "not_supported_file") {
            Self::conflict()
        } else {
            self
        }
    }
}

impl From<io::Error> for FileError {
    fn from(error: io::Error) -> Self {
        let (status, code, kind) = match error.kind() {
            io::ErrorKind::NotFound | io::ErrorKind::NotADirectory => {
                (404, "file_not_found", FailureKind::Missing)
            }
            io::ErrorKind::PermissionDenied => (403, "permission_denied", FailureKind::Failure),
            _ => (500, "file_io_error", FailureKind::Failure),
        };
        Self::new(status, code, error.to_string()).with_kind(kind)
    }
}

impl From<tokio::task::JoinError> for FileError {
    fn from(error: tokio::task::JoinError) -> Self {
        Self::new(500, "file_io_error", error.to_string())
    }
}

impl std::fmt::Display for FileError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.message)
    }
}

impl std::error::Error for FileError {}

fn validate_metadata(metadata: &Metadata) -> Result<(), FileError> {
    if metadata.file_type().is_symlink() {
        return Err(FileError::conflict());
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        use windows_sys::Win32::Storage::FileSystem::FILE_ATTRIBUTE_REPARSE_POINT;
        if metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
            return Err(FileError::conflict());
        }
    }
    if !metadata.is_file() {
        return Err(FileError::new(
            400,
            "not_supported_file",
            "The path does not refer to a regular file.",
        ));
    }
    if metadata.len() > MAX_FILE_BYTES {
        return Err(FileError::too_large());
    }
    Ok(())
}

fn open(path: &Path, write: bool) -> Result<File, FileError> {
    // Reject unsupported types before opening: a pipe may block and directory opens vary by OS.
    validate_metadata(&std::fs::symlink_metadata(path)?)?;
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
    let file = options.open(path).map_err(|error| {
        #[cfg(unix)]
        if error.raw_os_error() == Some(libc::ELOOP) {
            return FileError::conflict();
        }
        FileError::from(error)
    })?;
    validate_metadata(&file.metadata()?)?;
    // O_NONBLOCK only guards the open against FIFOs; some network and FUSE filesystems honor it
    // for regular files and could fail a write midway with EAGAIN.
    #[cfg(unix)]
    {
        use std::os::fd::AsRawFd;
        let fd = file.as_raw_fd();
        // The descriptor is owned by `file` for both calls; fcntl reads and sets only its flags.
        let flags = unsafe { libc::fcntl(fd, libc::F_GETFL) };
        if flags < 0 || unsafe { libc::fcntl(fd, libc::F_SETFL, flags & !libc::O_NONBLOCK) } < 0 {
            return Err(io::Error::last_os_error().into());
        }
    }
    Ok(file)
}

/// Leading `stamp` fields that name the file rather than describe its metadata.
#[cfg(unix)]
const IDENTITY_FIELDS: usize = 2;
#[cfg(windows)]
const IDENTITY_FIELDS: usize = 1;

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

fn finish_snapshot(
    file: &File,
    path: &Path,
    before: &str,
    bytes: Vec<u8>,
) -> Result<Snapshot, FileError> {
    let after = file.metadata()?;
    if bytes.len() as u64 > MAX_FILE_BYTES {
        return Err(FileError::too_large());
    }
    let current = open(path, false).map_err(FileError::replacement_as_conflict)?;
    let token = stamp(file, &after)?;
    if before != token || token != stamp(&current, &current.metadata()?)? {
        return Err(FileError::conflict());
    }
    Ok(Snapshot {
        version: format!("{token}:{:x}", Sha256::digest(&bytes)),
        lossy: std::str::from_utf8(&bytes).is_err(),
        bytes,
    })
}

fn snapshot(file: &mut File, path: &Path) -> Result<Snapshot, FileError> {
    let before = stamp(file, &file.metadata()?)?;
    file.seek(SeekFrom::Start(0))?;
    let mut bytes = Vec::new();
    file.take(MAX_FILE_BYTES + 1).read_to_end(&mut bytes)?;
    finish_snapshot(file, path, &before, bytes)
}

pub fn read(path: &Path) -> Result<Snapshot, FileError> {
    snapshot(&mut open(path, false)?, path)
}

pub fn create_copy(path: &Path, content: &str) -> Result<Snapshot, FileError> {
    if content.len() as u64 > MAX_FILE_BYTES {
        return Err(FileError::too_large());
    }
    // Exclusive creation also rejects existing symlinks and hard-link aliases.
    let mut file = OpenOptions::new()
        .read(true)
        .write(true)
        .create_new(true)
        .open(path)?;
    file.write_all(content.as_bytes())?;
    file.sync_all()?;
    let saved = snapshot(&mut file, path)?;
    if saved.content() != content {
        return Err(FileError::conflict());
    }
    Ok(saved)
}

/// Whether two versions name the same file with the same bytes, whatever its metadata. A
/// metadata-only change, such as a mode or extended-attribute change, alters the Unix change time
/// but leaves the content the supplied base describes.
fn same_file_and_bytes(current: &str, supplied: &str) -> bool {
    let current: Vec<&str> = current.split(':').collect();
    let supplied: Vec<&str> = supplied.split(':').collect();
    current.len() == supplied.len()
        && current.len() > IDENTITY_FIELDS
        && current[..IDENTITY_FIELDS] == supplied[..IDENTITY_FIELDS]
        && current.last() == supplied.last()
}

// Callers hold one host-wide write lock. Other processes do not share it.
pub fn write(path: &Path, content: &str, base_version: &str) -> Result<Snapshot, FileError> {
    if content.len() as u64 > MAX_FILE_BYTES {
        return Err(FileError::too_large());
    }
    let mut file = open(path, true).map_err(FileError::replacement_as_conflict)?;
    let base = snapshot(&mut file, path).map_err(FileError::replacement_as_conflict)?;
    if base.version != base_version && !same_file_and_bytes(&base.version, base_version) {
        return Err(FileError::conflict());
    }
    // The UI edits lossy-decoded text: an unchanged string retains the original bytes, and a
    // changed one would replace every invalid sequence the person never touched.
    if content == base.content() {
        return Ok(base);
    }
    if base.lossy {
        return Err(FileError::new(
            422,
            "not_utf8",
            "The file is not valid UTF-8, so saving would change bytes outside your edits. Use Save As to write a UTF-8 copy.",
        )
        .with_kind(FailureKind::NotUtf8));
    }
    file.seek(SeekFrom::Start(0))?;
    file.write_all(content.as_bytes())?;
    file.set_len(content.len() as u64)?;
    file.sync_data()?;
    let written = snapshot(&mut file, path).map_err(FileError::replacement_as_conflict)?;
    if written.content() != content {
        return Err(FileError::conflict());
    }
    Ok(written)
}

#[cfg(windows)]
fn file_identity(file: &File) -> io::Result<(u64, [u8; 16])> {
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
    use crate::test_support::TempDir;
    use std::fs;
    use std::sync::{Arc, Mutex};
    struct Fixture(TempDir);
    impl Fixture {
        fn new() -> Self {
            let dir = TempDir::new("files");
            fs::write(dir.join("document.md"), b"original\r\n").unwrap();
            Self(dir)
        }
        fn file(&self) -> std::path::PathBuf {
            self.0.join("document.md")
        }
    }

    #[test]
    fn copy_creation_preserves_bytes_and_never_overwrites_existing_paths() {
        let f = Fixture::new();
        let copy = f.0.join("copy.md");
        let text = "# 标题\r\n{>>@Alex: retained<<}\r\n";
        assert_eq!(create_copy(&copy, text).unwrap().bytes, text.as_bytes());
        assert!(create_copy(&copy, "overwrite").is_err());
        assert!(create_copy(&f.file(), "overwrite").is_err());
        assert_eq!(fs::read(&copy).unwrap(), text.as_bytes());
        assert_eq!(fs::read(f.file()).unwrap(), b"original\r\n");
        let alias = f.0.join("alias.md");
        fs::hard_link(f.file(), &alias).unwrap();
        assert!(create_copy(&alias, "overwrite").is_err());
        #[cfg(unix)]
        {
            let link = f.0.join("link.md");
            std::os::unix::fs::symlink(f.file(), &link).unwrap();
            assert!(create_copy(&link, "overwrite").is_err());
            let dangling = f.0.join("dangling.md");
            std::os::unix::fs::symlink(f.0.join("missing.md"), &dangling).unwrap();
            assert!(create_copy(&dangling, "overwrite").is_err());
        }
        assert_eq!(fs::read(f.file()).unwrap(), b"original\r\n");
        assert!(create_copy(&f.0.join("missing/copy.md"), text).is_err());
    }

    #[test]
    fn file_errors_have_stable_codes_and_readable_messages() {
        for (kind, status, code, failure) in [
            (io::ErrorKind::NotFound, 404, "file_not_found", "missing"),
            (
                io::ErrorKind::NotADirectory,
                404,
                "file_not_found",
                "missing",
            ),
            (
                io::ErrorKind::PermissionDenied,
                403,
                "permission_denied",
                "failure",
            ),
            (io::ErrorKind::Other, 500, "file_io_error", "failure"),
        ] {
            let error = FileError::from(io::Error::new(kind, "OS diagnostic"));
            assert_eq!(
                serde_json::to_value(&error).unwrap(),
                serde_json::json!({
                    "status": status, "kind": failure, "error": code, "message": "OS diagnostic"
                })
            );
            if status != 404 {
                assert_eq!(error.replacement_as_conflict().status, status);
            }
        }
    }

    #[test]
    fn failure_kinds_serialize_as_the_ui_host_failures() {
        let missing = FileError::from(io::Error::from(io::ErrorKind::NotFound));
        for (error, kind) in [
            (FileError::conflict(), "conflict"),
            (missing.replacement_as_conflict(), "conflict"),
            (
                FileError::from(io::Error::from(io::ErrorKind::NotFound)),
                "missing",
            ),
            (
                FileError::new(422, "not_utf8", "x").with_kind(FailureKind::NotUtf8),
                "notUtf8",
            ),
            (FileError::new(404, "document_not_open", "x"), "failure"),
            (FileError::new(409, "already_open", "x"), "failure"),
        ] {
            assert_eq!(serde_json::to_value(&error).unwrap()["kind"], kind);
        }
    }

    #[test]
    fn read_rejects_missing_nonregular_and_oversized_files_without_mutation() {
        let f = Fixture::new();
        assert_eq!(
            read(&f.0.join("missing")).unwrap_err().error,
            "file_not_found"
        );
        assert_eq!(read(f.0.path()).unwrap_err().error, "not_supported_file");
        let original = fs::read(f.file()).unwrap();
        let file = File::options().write(true).open(f.file()).unwrap();
        file.set_len(MAX_FILE_BYTES + 1).unwrap();
        let error = read(&f.file()).unwrap_err();
        assert_eq!(error.status, 413);
        assert_eq!(error.error, "file_too_large");
        assert!(!error.message.is_empty());
        assert_eq!(file.metadata().unwrap().len(), MAX_FILE_BYTES + 1);
        file.set_len(original.len() as u64).unwrap();
        assert_eq!(fs::read(f.file()).unwrap(), original);
    }

    #[cfg(unix)]
    #[test]
    fn a_final_symlink_replacement_is_a_conflict_and_does_not_write_its_target() {
        use std::os::unix::fs::symlink;
        let f = Fixture::new();
        let base = read(&f.file()).unwrap();
        let target = f.0.join("other.md");
        fs::write(&target, b"other bytes").unwrap();
        fs::remove_file(f.file()).unwrap();
        symlink(&target, f.file()).unwrap();
        for error in [
            read(&f.file()).unwrap_err(),
            write(&f.file(), "local", &base.version).unwrap_err(),
        ] {
            assert_eq!(error.status, 409);
            assert_eq!(error.kind, FailureKind::Conflict);
            assert_eq!(error.error, "file_changed");
        }
        assert_eq!(fs::read(&target).unwrap(), b"other bytes");
        assert!(fs::symlink_metadata(f.file()).unwrap().is_symlink());
    }

    #[test]
    fn snapshot_io_failures_are_not_conflicts() {
        let f = Fixture::new();
        let mut write_only = File::options().write(true).open(f.file()).unwrap();
        let error = snapshot(&mut write_only, &f.file())
            .unwrap_err()
            .replacement_as_conflict();
        assert_ne!(error.status, 409);
        assert_eq!(error.kind, FailureKind::Failure);
        assert!(matches!(
            error.error.as_str(),
            "file_io_error" | "permission_denied"
        ));
        assert!(!error.message.is_empty());
        assert_eq!(fs::read(f.file()).unwrap(), b"original\r\n");
    }

    #[cfg(unix)]
    #[test]
    fn permission_denial_keeps_its_classification_and_original_bytes() {
        use std::os::unix::fs::PermissionsExt;
        if unsafe { libc::geteuid() } == 0 {
            return;
        }
        let f = Fixture::new();
        let base = read(&f.file()).unwrap();
        fs::set_permissions(f.file(), fs::Permissions::from_mode(0o000)).unwrap();
        let read_error = read(&f.file()).unwrap_err();
        let write_error = write(&f.file(), "local", &base.version).unwrap_err();
        fs::set_permissions(f.file(), fs::Permissions::from_mode(0o600)).unwrap();
        for error in [read_error, write_error] {
            assert_eq!(error.status, 403);
            assert_eq!(error.error, "permission_denied");
            assert!(!error.message.is_empty());
        }
        assert_eq!(fs::read(f.file()).unwrap(), base.bytes);
    }

    #[test]
    fn unchanged_invalid_utf8_bom_and_crlf_are_byte_exact() {
        let f = Fixture::new();
        let bytes = [0xef, 0xbb, 0xbf, b'a', b'\r', b'\n', 0xff];
        fs::write(f.file(), bytes).unwrap();
        let base = read(&f.file()).unwrap();
        let payload = serde_json::to_value(&base).unwrap();
        assert_eq!(payload["content"], "\u{feff}a\r\n\u{fffd}");
        assert!(payload.get("bytes").is_none());
        assert_eq!(
            payload.as_object().unwrap().keys().collect::<Vec<_>>(),
            ["content", "lossy", "version"]
        );
        let saved = write(&f.file(), &base.content(), &base.version).unwrap();
        assert_eq!(saved.version, base.version);
        assert_eq!(fs::read(f.file()).unwrap(), bytes);
    }

    #[test]
    fn edits_to_a_file_that_is_not_utf8_are_refused_without_changing_it() {
        let f = Fixture::new();
        let latin1 = b"caf\xe9\r\n";
        fs::write(f.file(), latin1).unwrap();
        let base = read(&f.file()).unwrap();
        assert_eq!(base.content(), "caf\u{fffd}\r\n");
        let error = write(&f.file(), "caf\u{fffd}\r\nedit", &base.version).unwrap_err();
        assert_eq!((error.status, error.error.as_str()), (422, "not_utf8"));
        assert_eq!(error.kind, FailureKind::NotUtf8);
        assert!(!error.message.is_empty());
        assert_eq!(fs::read(f.file()).unwrap(), latin1);
    }

    #[test]
    fn snapshots_report_lossy_decoding_for_invalid_utf8_only() {
        let f = Fixture::new();
        fs::write(f.file(), b"caf\xe9\r\n").unwrap();
        assert_eq!(
            serde_json::to_value(read(&f.file()).unwrap()).unwrap()["lossy"],
            true
        );
        fs::write(f.file(), b"\xef\xbb\xbfcaf\xc3\xa9\r\n").unwrap();
        assert_eq!(
            serde_json::to_value(read(&f.file()).unwrap()).unwrap()["lossy"],
            false
        );
    }

    #[cfg(unix)]
    #[test]
    fn opened_regular_files_are_blocking() {
        use std::os::fd::AsRawFd;
        let f = Fixture::new();
        for write in [false, true] {
            let file = open(&f.file(), write).unwrap();
            let flags = unsafe { libc::fcntl(file.as_raw_fd(), libc::F_GETFL) };
            assert_eq!(flags & libc::O_NONBLOCK, 0);
        }
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
    fn a_file_modified_before_1970_can_be_read_and_saved() {
        let f = Fixture::new();
        let before_epoch = std::time::UNIX_EPOCH - std::time::Duration::from_secs(86_400);
        File::options()
            .write(true)
            .open(f.file())
            .unwrap()
            .set_modified(before_epoch)
            .unwrap();
        assert!(fs::metadata(f.file()).unwrap().modified().unwrap() < std::time::UNIX_EPOCH);
        let base = read(&f.file()).unwrap();
        assert_eq!(base.bytes, b"original\r\n");
        write(&f.file(), "edited\r\n", &base.version).unwrap();
        assert_eq!(fs::read(f.file()).unwrap(), b"edited\r\n");
    }

    #[cfg(unix)]
    #[test]
    fn a_metadata_only_change_does_not_reject_the_next_save() {
        use std::os::unix::fs::PermissionsExt;
        let f = Fixture::new();
        let base = read(&f.file()).unwrap();
        let saved = write(&f.file(), "first edit\r\n", &base.version).unwrap();
        fs::set_permissions(f.file(), fs::Permissions::from_mode(0o640)).unwrap();
        assert_ne!(read(&f.file()).unwrap().version, saved.version);
        write(&f.file(), "second edit\r\n", &saved.version).unwrap();
        assert_eq!(fs::read(f.file()).unwrap(), b"second edit\r\n");
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
        let changed =
            finish_snapshot(&file, &f.file(), &before, b"original\r\n".to_vec()).unwrap_err();
        assert_eq!(changed.status, 409);
        assert_eq!(changed.error, "file_changed");
        let before = stamp(&file, &file.metadata().unwrap()).unwrap();
        let replacement = f.0.join("replacement");
        fs::write(&replacement, b"mutated in place").unwrap();
        fs::rename(replacement, f.file()).unwrap();
        let replaced =
            finish_snapshot(&file, &f.file(), &before, b"mutated in place".to_vec()).unwrap_err();
        assert_eq!(replaced.status, 409);
        assert_eq!(replaced.error, "file_changed");
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
        let result = base.content().replace("{++新增++}", "新增");
        write(&f.file(), &result, &base.version).unwrap();
        assert_eq!(fs::read(f.file()).unwrap(), result.as_bytes());
    }

    #[test]
    fn saved_version_remains_valid_after_the_write_handle_closes() {
        let f = Fixture::new();
        let base = read(&f.file()).unwrap();
        let saved = write(&f.file(), "first edit\r\n", &base.version).unwrap();
        assert_eq!(saved.version, read(&f.file()).unwrap().version);
        let next = write(&f.file(), "second edit\r\n", &saved.version).unwrap();
        assert_eq!(next.version, read(&f.file()).unwrap().version);
        assert_eq!(fs::read(f.file()).unwrap(), b"second edit\r\n");
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

    #[cfg(windows)]
    #[test]
    fn identity_distinguishes_files_with_identical_content() {
        let dir = TempDir::new("identity");
        let (a, b) = (dir.join("a.md"), dir.join("b.md"));
        fs::write(&a, b"same").unwrap();
        fs::write(&b, b"same").unwrap();
        let original = File::open(&a).unwrap();
        assert_eq!(
            file_identity(&original).unwrap(),
            file_identity(&File::open(&a).unwrap()).unwrap()
        );
        assert_ne!(
            file_identity(&original).unwrap(),
            file_identity(&File::open(&b).unwrap()).unwrap()
        );
    }
}
