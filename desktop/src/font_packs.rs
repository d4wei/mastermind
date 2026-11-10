use base64::Engine;
use sha2::{Digest, Sha512};
use std::{
    collections::{BTreeMap, HashMap, HashSet},
    fs,
    io::{self, Read},
    path::{Path, PathBuf},
    sync::{
        Arc, Condvar, Mutex, OnceLock,
        atomic::{AtomicU64, Ordering},
    },
    time::Duration,
};

/// The manifest `tools/fonts/vendor-fonts.mts` writes; `font_packs.md` describes the contract.
const MANIFEST: &str = include_str!("../../themes/fonts/packs/manifest.json");

/// The largest tarball the host downloads.
pub const MAX_BYTES: u64 = 32 * 1024 * 1024;
/// How long one download may take, from connecting to the last byte.
pub const TIMEOUT: Duration = Duration::from_secs(120);

/// One pack as the manifest names it; the manifest's other fields serve the renderer.
#[derive(serde::Deserialize, Clone, Debug)]
pub struct Pack {
    pub version: String,
    pub url: String,
    pub integrity: String,
    pub files: Vec<String>,
}

#[derive(serde::Deserialize)]
struct Manifest {
    packs: BTreeMap<String, Pack>,
}

/// A file name the pack may keep: a plain name, so extraction can only write inside its directory.
fn plain_file_name(name: &str) -> bool {
    !name.is_empty()
        && !name.starts_with('.')
        && name
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || b"-.".contains(&byte))
}

/// The packs compiled into this build, by name.
pub fn manifest() -> &'static BTreeMap<String, Pack> {
    static PACKS: OnceLock<BTreeMap<String, Pack>> = OnceLock::new();
    PACKS.get_or_init(|| {
        let manifest: Manifest = serde_json::from_str(MANIFEST).expect("pack manifest parses");
        for (name, pack) in &manifest.packs {
            // The generator writes only plain names; any other could place a file outside its
            // pack's directory, so it stops the host rather than being used.
            assert!(
                plain_file_name(name) && pack.files.iter().all(|file| plain_file_name(file)),
                "pack {name} names a file outside its directory"
            );
        }
        manifest.packs
    })
}

/// What a request for a pack came to. `Offline` means the network did not answer; `Failed` means
/// it answered with something the host refused.
#[derive(Clone, Debug, PartialEq)]
pub enum Outcome {
    Ready(PathBuf),
    Offline,
    Failed,
}

enum Failure {
    Offline(String),
    Failed(String),
}

impl From<io::Error> for Failure {
    fn from(error: io::Error) -> Self {
        Failure::Failed(error.to_string())
    }
}

/// One download that every concurrent request for its pack waits on.
#[derive(Default)]
struct Flight {
    outcome: Mutex<Option<Outcome>>,
    done: Condvar,
}

/// The pack cache under `root`, and the downloads in progress.
pub struct Packs {
    root: PathBuf,
    max_bytes: u64,
    timeout: Duration,
    flights: Mutex<HashMap<String, Arc<Flight>>>,
}

impl Packs {
    pub fn new(root: PathBuf) -> Self {
        Self::with_limits(root, MAX_BYTES, TIMEOUT)
    }

    fn with_limits(root: PathBuf, max_bytes: u64, timeout: Duration) -> Self {
        Self {
            root,
            max_bytes,
            timeout,
            flights: Mutex::default(),
        }
    }

    /// Each pinned version has its own directory, so a new pin never reads an older pack's files.
    fn directory(&self, name: &str, pack: &Pack) -> PathBuf {
        self.root.join(format!("{name}-{}", pack.version))
    }

    /// The pack's directory when it holds every file the pack keeps; entries appear only by a
    /// rename after verification.
    pub fn cached(&self, name: &str, pack: &Pack) -> Option<PathBuf> {
        let directory = self.directory(name, pack);
        pack.files
            .iter()
            .all(|file| fs::symlink_metadata(directory.join(file)).is_ok_and(|meta| meta.is_file()))
            .then_some(directory)
    }

    /// The pack, from the cache or else from one download shared by every concurrent request.
    /// A failed download is not remembered: the next request tries again.
    pub fn get(&self, name: &str, pack: &Pack) -> Outcome {
        if let Some(directory) = self.cached(name, pack) {
            return Outcome::Ready(directory);
        }
        let (flight, leads) = {
            let mut flights = self.flights.lock().unwrap();
            match flights.get(name) {
                Some(flight) => (flight.clone(), false),
                None => {
                    let flight = Arc::new(Flight::default());
                    flights.insert(name.to_owned(), flight.clone());
                    (flight, true)
                }
            }
        };
        if !leads {
            let mut outcome = flight.outcome.lock().unwrap();
            while outcome.is_none() {
                outcome = flight.done.wait(outcome).unwrap();
            }
            return outcome.clone().unwrap();
        }
        // A download that finished between the cache check and this one's start left its pack.
        let outcome = match self.cached(name, pack) {
            Some(directory) => Outcome::Ready(directory),
            None => match self.download(name, pack) {
                Ok(directory) => Outcome::Ready(directory),
                Err(Failure::Offline(reason)) => {
                    eprintln!("Font pack {name} is unavailable offline: {reason}");
                    Outcome::Offline
                }
                Err(Failure::Failed(reason)) => {
                    eprintln!("Font pack {name} could not be fetched: {reason}");
                    Outcome::Failed
                }
            },
        };
        *flight.outcome.lock().unwrap() = Some(outcome.clone());
        flight.done.notify_all();
        self.flights.lock().unwrap().remove(name);
        outcome
    }

    fn download(&self, name: &str, pack: &Pack) -> Result<PathBuf, Failure> {
        let bytes = self.fetch(pack)?;
        verify(&bytes, &pack.integrity)?;
        self.unpack(name, pack, &bytes)
    }

    /// The body of one GET to the pack's address. The request carries no cookies, credentials, or
    /// headers beyond the client's defaults; no redirect is followed.
    fn fetch(&self, pack: &Pack) -> Result<Vec<u8>, Failure> {
        let agent: ureq::Agent = ureq::Agent::config_builder()
            .max_redirects(0)
            .http_status_as_error(false)
            .timeout_global(Some(self.timeout))
            .build()
            .into();
        let response = agent.get(&pack.url).call().map_err(|error| match error {
            ureq::Error::Timeout(_)
            | ureq::Error::Io(_)
            | ureq::Error::HostNotFound
            | ureq::Error::ConnectionFailed => Failure::Offline(error.to_string()),
            error => Failure::Failed(error.to_string()),
        })?;
        let status = response.status();
        if status != 200 {
            return Err(Failure::Failed(format!("status {status}")));
        }
        if response
            .body()
            .content_length()
            .is_some_and(|length| length > self.max_bytes)
        {
            return Err(Failure::Failed("larger than the size cap".into()));
        }
        let mut bytes = Vec::new();
        response
            .into_body()
            .into_reader()
            .take(self.max_bytes + 1)
            .read_to_end(&mut bytes)
            .map_err(|error| Failure::Offline(error.to_string()))?;
        if bytes.len() as u64 > self.max_bytes {
            return Err(Failure::Failed("larger than the size cap".into()));
        }
        Ok(bytes)
    }

    /// Writes the pack's files into a hidden directory beside the cache entry, then renames it into
    /// place, so the entry never holds a partial pack.
    fn unpack(&self, name: &str, pack: &Pack, bytes: &[u8]) -> Result<PathBuf, Failure> {
        static NEXT: AtomicU64 = AtomicU64::new(0);
        fs::create_dir_all(&self.root)?;
        let prefix = format!(".partial-{name}-");
        // Downloads of one pack never overlap in a host, so another partial is a crashed run's.
        for entry in fs::read_dir(&self.root)?.flatten() {
            if entry.file_name().to_string_lossy().starts_with(&prefix) {
                let _ = fs::remove_dir_all(entry.path());
            }
        }
        let partial = self.root.join(format!(
            "{prefix}{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir(&partial)?;
        let directory = self.directory(name, pack);
        let placed = extract(bytes, pack, &partial).and_then(|()| {
            if directory.exists() {
                fs::remove_dir_all(&directory)?;
            }
            fs::rename(&partial, &directory).map_err(Failure::from)
        });
        if placed.is_err() {
            let _ = fs::remove_dir_all(&partial);
        }
        placed.map(|()| directory)
    }
}

/// Checks `bytes` against a `sha512-` Subresource Integrity string.
fn verify(bytes: &[u8], integrity: &str) -> Result<(), Failure> {
    let expected = integrity
        .strip_prefix("sha512-")
        .and_then(|digest| {
            base64::engine::general_purpose::STANDARD
                .decode(digest)
                .ok()
        })
        .ok_or_else(|| Failure::Failed("the manifest's integrity is not sha512".into()))?;
    if Sha512::digest(bytes).as_slice() != expected.as_slice() {
        return Err(Failure::Failed("hash mismatch".into()));
    }
    Ok(())
}

/// Copies the pack's files, and nothing else, from the npm tarball's `package/files/` into `into`.
fn extract(bytes: &[u8], pack: &Pack, into: &Path) -> Result<(), Failure> {
    let wanted: HashSet<&str> = pack.files.iter().map(String::as_str).collect();
    let mut found = HashSet::new();
    let mut archive = tar::Archive::new(flate2::read::GzDecoder::new(bytes));
    for entry in archive.entries()? {
        let mut entry = entry?;
        if entry.header().entry_type() != tar::EntryType::Regular {
            continue;
        }
        let path = entry.path()?.into_owned();
        let Some(file) = path
            .strip_prefix("package/files")
            .ok()
            .and_then(Path::to_str)
            .filter(|file| wanted.contains(file) && !found.contains(*file))
            .map(str::to_owned)
        else {
            continue;
        };
        let mut out = fs::File::create_new(into.join(&file))?;
        io::copy(&mut entry, &mut out)?;
        out.sync_all()?;
        found.insert(file);
    }
    if found.len() != wanted.len() {
        return Err(Failure::Failed(format!(
            "the archive lacks {} of the pack's files",
            wanted.len() - found.len()
        )));
    }
    Ok(())
}

/// The renderer's view of an outcome. `directory` ends with the platform's separator, so a file
/// name appended to it is the file's path.
#[derive(serde::Serialize, Debug, PartialEq)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum Reply {
    Ready { directory: String },
    Offline,
    Failed,
}

impl From<Outcome> for Reply {
    fn from(outcome: Outcome) -> Self {
        match outcome {
            Outcome::Ready(directory) => match directory.to_str() {
                Some(path) => Reply::Ready {
                    directory: format!("{path}{}", std::path::MAIN_SEPARATOR),
                },
                None => Reply::Failed,
            },
            Outcome::Offline => Reply::Offline,
            Outcome::Failed => Reply::Failed,
        }
    }
}

/// The renderer asks for a pack by name; nothing about a document is part of the request.
#[tauri::command]
pub async fn font_pack(name: String, packs: tauri::State<'_, Arc<Packs>>) -> Result<Reply, String> {
    let pack = manifest()
        .get(&name)
        .cloned()
        .ok_or_else(|| "unknown_font_pack".to_owned())?;
    let packs = packs.inner().clone();
    // A download waits on the network, not the filesystem, so it stays off the document lanes.
    tauri::async_runtime::spawn_blocking(move || packs.get(&name, &pack))
        .await
        .map(Reply::from)
        .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::TempDir;
    use std::{
        io::{BufRead, BufReader, Write},
        net::{TcpListener, TcpStream},
        sync::{atomic::AtomicUsize, mpsc},
        thread,
    };

    /// A local HTTP server answering every connection with `respond`, counting connections.
    struct Server {
        url: String,
        connections: Arc<AtomicUsize>,
    }

    fn serve(respond: impl Fn(&mut TcpStream) + Send + Sync + 'static) -> Server {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let connections = Arc::new(AtomicUsize::new(0));
        let counted = connections.clone();
        let respond = Arc::new(respond);
        thread::spawn(move || {
            for stream in listener.incoming() {
                let Ok(mut stream) = stream else { break };
                counted.fetch_add(1, Ordering::SeqCst);
                let respond = respond.clone();
                thread::spawn(move || {
                    let mut reader = BufReader::new(stream.try_clone().unwrap());
                    let mut line = String::new();
                    while reader.read_line(&mut line).is_ok_and(|read| read > 2) {
                        line.clear();
                    }
                    respond(&mut stream);
                });
            }
        });
        Server {
            url: format!("http://{address}/pack.tgz"),
            connections,
        }
    }

    fn ok(body: &[u8]) -> Vec<u8> {
        let mut response = format!(
            "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
            body.len()
        )
        .into_bytes();
        response.extend_from_slice(body);
        response
    }

    fn tarball(entries: &[(&str, &[u8])]) -> Vec<u8> {
        let mut builder = tar::Builder::new(flate2::write::GzEncoder::new(
            Vec::new(),
            flate2::Compression::fast(),
        ));
        for (path, data) in entries {
            let mut header = tar::Header::new_gnu();
            header.set_size(data.len() as u64);
            header.set_mode(0o644);
            header.set_cksum();
            builder.append_data(&mut header, path, *data).unwrap();
        }
        builder.into_inner().unwrap().finish().unwrap()
    }

    fn integrity(bytes: &[u8]) -> String {
        format!(
            "sha512-{}",
            base64::engine::general_purpose::STANDARD.encode(Sha512::digest(bytes))
        )
    }

    /// A pack of two files inside a tarball that also holds files the pack does not keep.
    fn fixture() -> (Vec<u8>, Pack) {
        let archive = tarball(&[
            ("package/package.json", b"{}"),
            ("package/LICENSE", b"OFL"),
            ("package/files/demo-0-wght-normal.woff2", b"zero"),
            ("package/files/demo-1-wght-normal.woff2", b"one"),
            ("package/files/demo-2-wght-normal.woff2", b"unkept"),
        ]);
        let pack = Pack {
            version: "5.3.1".into(),
            url: String::new(),
            integrity: integrity(&archive),
            files: vec![
                "demo-0-wght-normal.woff2".into(),
                "demo-1-wght-normal.woff2".into(),
            ],
        };
        (archive, pack)
    }

    fn entries(root: &Path) -> Vec<String> {
        let mut names: Vec<String> = fs::read_dir(root)
            .map(|dir| {
                dir.flatten()
                    .map(|entry| entry.file_name().to_string_lossy().into_owned())
                    .collect()
            })
            .unwrap_or_default();
        names.sort();
        names
    }

    fn closed_port() -> String {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        drop(listener);
        format!("http://{address}/pack.tgz")
    }

    #[test]
    fn a_verified_download_keeps_only_the_packs_files() {
        let (archive, mut pack) = fixture();
        let body = ok(&archive);
        let server = serve(move |stream| stream.write_all(&body).unwrap());
        pack.url = server.url.clone();
        let cache = TempDir::new("packs-success");
        let packs = Packs::new(cache.join("font-packs"));
        let Outcome::Ready(directory) = packs.get("demo", &pack) else {
            panic!("expected the pack");
        };
        assert_eq!(directory, cache.join("font-packs/demo-5.3.1"));
        assert_eq!(entries(&cache.join("font-packs")), ["demo-5.3.1"]);
        assert_eq!(entries(&directory), pack.files);
        assert_eq!(
            fs::read(directory.join("demo-1-wght-normal.woff2")).unwrap(),
            b"one"
        );
        // A second request reads the cache.
        assert_eq!(packs.get("demo", &pack), Outcome::Ready(directory.clone()));
        assert_eq!(server.connections.load(Ordering::SeqCst), 1);
        assert_eq!(
            serde_json::to_value(Reply::from(Outcome::Ready(directory.clone()))).unwrap(),
            serde_json::json!({
                "status": "ready",
                "directory": format!("{}{}", directory.to_str().unwrap(), std::path::MAIN_SEPARATOR)
            })
        );
    }

    #[test]
    fn a_hash_mismatch_stores_nothing() {
        let (archive, mut pack) = fixture();
        pack.integrity = integrity(b"another archive");
        let body = ok(&archive);
        let server = serve(move |stream| stream.write_all(&body).unwrap());
        pack.url = server.url;
        let cache = TempDir::new("packs-mismatch");
        let packs = Packs::new(cache.join("font-packs"));
        assert_eq!(packs.get("demo", &pack), Outcome::Failed);
        assert!(!cache.join("font-packs").exists());
        assert_eq!(
            serde_json::to_value(Reply::from(Outcome::Failed)).unwrap()["status"],
            "failed"
        );
    }

    #[test]
    fn an_oversize_body_is_refused_with_or_without_a_length() {
        let (_, mut pack) = fixture();
        let big = vec![7u8; 4096];
        pack.integrity = integrity(&big);
        for declared in [true, false] {
            let body = big.clone();
            let server = serve(move |stream| {
                if declared {
                    stream.write_all(&ok(&body)).unwrap();
                } else {
                    stream
                        .write_all(b"HTTP/1.1 200 OK\r\nConnection: close\r\n\r\n")
                        .unwrap();
                    let _ = stream.write_all(&body);
                }
            });
            pack.url = server.url;
            let cache = TempDir::new("packs-oversize");
            let packs = Packs::with_limits(cache.join("font-packs"), 1024, TIMEOUT);
            assert_eq!(
                packs.get("demo", &pack),
                Outcome::Failed,
                "declared {declared}"
            );
            assert!(!cache.join("font-packs").exists());
        }
    }

    #[test]
    fn a_stalled_server_times_out_as_offline() {
        let (_, mut pack) = fixture();
        let (release, released) = mpsc::channel::<()>();
        let released = Mutex::new(released);
        let server = serve(move |_| {
            let _ = released
                .lock()
                .unwrap()
                .recv_timeout(Duration::from_secs(10));
        });
        pack.url = server.url;
        let cache = TempDir::new("packs-timeout");
        let packs = Packs::with_limits(
            cache.join("font-packs"),
            MAX_BYTES,
            Duration::from_millis(200),
        );
        let started = std::time::Instant::now();
        assert_eq!(packs.get("demo", &pack), Outcome::Offline);
        assert!(started.elapsed() < Duration::from_secs(5));
        assert!(!cache.join("font-packs").exists());
        drop(release);
    }

    #[test]
    fn a_redirect_is_refused_and_never_followed() {
        let (archive, mut pack) = fixture();
        let body = ok(&archive);
        let elsewhere = serve(move |stream| stream.write_all(&body).unwrap());
        let location = elsewhere.url.clone();
        let server = serve(move |stream| {
            let response = format!(
                "HTTP/1.1 302 Found\r\nLocation: {location}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
            );
            stream.write_all(response.as_bytes()).unwrap();
        });
        pack.url = server.url;
        let cache = TempDir::new("packs-redirect");
        let packs = Packs::new(cache.join("font-packs"));
        assert_eq!(packs.get("demo", &pack), Outcome::Failed);
        assert_eq!(elsewhere.connections.load(Ordering::SeqCst), 0);
        assert!(!cache.join("font-packs").exists());
    }

    #[test]
    fn an_error_status_fails() {
        let (_, mut pack) = fixture();
        let server = serve(|stream| {
            stream
                .write_all(
                    b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
                )
                .unwrap();
        });
        pack.url = server.url;
        let cache = TempDir::new("packs-status");
        assert_eq!(
            Packs::new(cache.join("font-packs")).get("demo", &pack),
            Outcome::Failed
        );
    }

    #[test]
    fn an_unreachable_address_is_offline_and_the_next_request_tries_again() {
        let (archive, mut pack) = fixture();
        pack.url = closed_port();
        let cache = TempDir::new("packs-offline");
        let packs = Packs::new(cache.join("font-packs"));
        assert_eq!(packs.get("demo", &pack), Outcome::Offline);
        assert!(!cache.join("font-packs").exists());
        assert_eq!(
            serde_json::to_value(Reply::from(Outcome::Offline)).unwrap()["status"],
            "offline"
        );
        // The network returns: nothing about the failure was remembered.
        let body = ok(&archive);
        pack.url = serve(move |stream| stream.write_all(&body).unwrap()).url;
        assert!(matches!(packs.get("demo", &pack), Outcome::Ready(_)));
    }

    #[test]
    fn concurrent_requests_share_one_download() {
        let (archive, mut pack) = fixture();
        let body = ok(&archive);
        let server = serve(move |stream| {
            thread::sleep(Duration::from_millis(300));
            stream.write_all(&body).unwrap();
        });
        pack.url = server.url.clone();
        let cache = TempDir::new("packs-shared");
        let packs = Arc::new(Packs::new(cache.join("font-packs")));
        let requests: Vec<_> = (0..4)
            .map(|_| {
                let packs = packs.clone();
                let pack = pack.clone();
                thread::spawn(move || packs.get("demo", &pack))
            })
            .collect();
        let outcomes: Vec<_> = requests.into_iter().map(|r| r.join().unwrap()).collect();
        assert!(
            outcomes
                .iter()
                .all(|outcome| *outcome == Outcome::Ready(cache.join("font-packs/demo-5.3.1")))
        );
        assert_eq!(server.connections.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn a_pack_cached_by_an_earlier_launch_needs_no_request() {
        let (archive, mut pack) = fixture();
        let cache = TempDir::new("packs-startup");
        let directory = cache.join("font-packs/demo-5.3.1");
        fs::create_dir_all(&directory).unwrap();
        for file in &pack.files {
            fs::write(directory.join(file), b"cached").unwrap();
        }
        pack.url = closed_port();
        let packs = Packs::new(cache.join("font-packs"));
        assert_eq!(packs.get("demo", &pack), Outcome::Ready(directory.clone()));
        // An entry missing a file is not a pack; it is fetched again and replaced whole.
        fs::remove_file(directory.join(&pack.files[0])).unwrap();
        assert_eq!(packs.cached("demo", &pack), None);
        let body = ok(&archive);
        let server = serve(move |stream| stream.write_all(&body).unwrap());
        pack.url = server.url;
        assert_eq!(packs.get("demo", &pack), Outcome::Ready(directory.clone()));
        assert_eq!(fs::read(directory.join(&pack.files[1])).unwrap(), b"one");
    }

    #[test]
    fn a_partial_pack_is_never_visible() {
        let (archive, mut pack) = fixture();
        let (halfway, reached) = mpsc::channel::<()>();
        let (resume, resumed) = mpsc::channel::<()>();
        let resumed = Mutex::new(resumed);
        let halfway = Mutex::new(halfway);
        let body = archive.clone();
        let server = serve(move |stream| {
            let head = format!(
                "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                body.len()
            );
            stream.write_all(head.as_bytes()).unwrap();
            stream.write_all(&body[..body.len() / 2]).unwrap();
            stream.flush().unwrap();
            halfway.lock().unwrap().send(()).unwrap();
            resumed.lock().unwrap().recv().unwrap();
            stream.write_all(&body[body.len() / 2..]).unwrap();
        });
        pack.url = server.url;
        let cache = TempDir::new("packs-partial");
        let packs = Arc::new(Packs::new(cache.join("font-packs")));
        let downloading = {
            let packs = packs.clone();
            let pack = pack.clone();
            thread::spawn(move || packs.get("demo", &pack))
        };
        reached.recv_timeout(Duration::from_secs(5)).unwrap();
        assert_eq!(packs.cached("demo", &pack), None);
        assert!(!cache.join("font-packs/demo-5.3.1").exists());
        resume.send(()).unwrap();
        assert!(matches!(downloading.join().unwrap(), Outcome::Ready(_)));

        // An archive whose hash matches but lacks a kept file leaves neither the entry nor a
        // partial directory behind, and a crashed run's partial directory is cleared.
        let short = tarball(&[("package/files/demo-0-wght-normal.woff2", b"zero")]);
        let body = ok(&short);
        let server = serve(move |stream| stream.write_all(&body).unwrap());
        let mut lacking = pack.clone();
        lacking.version = "5.3.2".into();
        lacking.integrity = integrity(&short);
        lacking.url = server.url;
        fs::create_dir_all(cache.join("font-packs/.partial-demo-1-0")).unwrap();
        assert_eq!(packs.get("demo", &lacking), Outcome::Failed);
        assert_eq!(entries(&cache.join("font-packs")), ["demo-5.3.1"]);
    }

    #[test]
    fn the_compiled_manifest_names_registry_tarballs_by_hash() {
        let packs = manifest();
        assert_eq!(
            packs.keys().map(String::as_str).collect::<Vec<_>>(),
            [
                "noto-sans-hk",
                "noto-sans-kr",
                "noto-sans-tc",
                "noto-serif-hk",
                "noto-serif-kr",
                "noto-serif-tc"
            ]
        );
        for (name, pack) in packs {
            assert!(
                pack.url.starts_with(&format!(
                    "https://registry.npmjs.org/@fontsource-variable/{name}/-/{name}-"
                )),
                "{name}"
            );
            let digest = pack.integrity.strip_prefix("sha512-").unwrap();
            assert_eq!(
                base64::engine::general_purpose::STANDARD
                    .decode(digest)
                    .unwrap()
                    .len(),
                64
            );
            assert!(!pack.files.is_empty());
        }
        assert!(!plain_file_name("../escape.woff2"));
        assert!(!plain_file_name("nested/file.woff2"));
        assert!(!plain_file_name(".hidden"));
        assert!(!plain_file_name(""));
    }
}
