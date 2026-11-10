use crate::{host_process, transport};
use mastermind_launch_check::protocol::{
    CloseRequest, FileResult, MAX_FILES, MAX_FRAME, Operation, Request, Response, SetupRequest,
    VERSION, exit_status,
};
use std::{io, path::PathBuf};

const USAGE: &str = "usage: mastermind-launch-check open [--language CODE] [--document-language CODE] -- FILE... | close -- FILE... | setup --suggest JSON_OBJECT";

/// Set by the repository launcher when it falls back to a debug binary, whose interface comes from
/// the development server's origin; such a launcher hands files only to a host already running.
const ATTACH_ONLY: &str = "MM_LAUNCH_CHECK_ATTACH_ONLY";

/// Paths after `--`, resolved against the invoking directory.
fn file_arguments(args: &[std::ffi::OsString]) -> io::Result<Vec<String>> {
    if args.is_empty() || args.len() > MAX_FILES {
        return Err(io::Error::other(USAGE));
    }
    let cwd = std::env::current_dir()?;
    args.iter()
        .map(|arg| {
            let path = cwd.join(arg);
            path.to_str()
                .map(str::to_owned)
                .ok_or_else(|| io::Error::other("unsupported_path_encoding"))
        })
        .collect()
}

fn within_frame(request: Operation) -> io::Result<Operation> {
    if serde_json::to_vec(&request)?.len() + 1 > MAX_FRAME {
        return Err(io::Error::other("request_too_large"));
    }
    Ok(request)
}

fn request(args: Vec<std::ffi::OsString>) -> io::Result<Operation> {
    if args.first().is_some_and(|arg| arg == "setup") {
        if args.len() != 3 || args[1] != "--suggest" {
            return Err(io::Error::other(USAGE));
        }
        let raw = args[2]
            .to_str()
            .ok_or_else(|| io::Error::other("unsupported_argument_encoding"))?;
        if raw.len() > MAX_FRAME {
            return Err(io::Error::other("request_too_large"));
        }
        let setup = serde_json::from_str(raw)?;
        return within_frame(Operation::Setup(SetupRequest {
            version: VERSION,
            setup,
        }));
    }
    if args.first().is_some_and(|arg| arg == "close") {
        if args.get(1).is_none_or(|arg| arg != "--") {
            return Err(io::Error::other(USAGE));
        }
        return within_frame(Operation::Close(CloseRequest {
            version: VERSION,
            close: file_arguments(&args[2..])?,
        }));
    }
    if args.first().is_none_or(|arg| arg != "open") {
        return Err(io::Error::other(USAGE));
    }
    let mut language = None;
    let mut document_language = None;
    let mut index = 1;
    // Options precede `--`, each at most once; everything after it is a path.
    loop {
        let option = args.get(index).and_then(|arg| arg.to_str());
        let (slot, valid, invalid): (_, fn(&str) -> bool, _) = match option {
            Some("--") => break,
            Some("--language") if language.is_none() => (
                &mut language,
                mastermind_launch_check::protocol::language_code,
                "invalid_language",
            ),
            Some("--document-language") if document_language.is_none() => (
                &mut document_language,
                mastermind_launch_check::protocol::language_tag,
                "invalid_document_language",
            ),
            _ => return Err(io::Error::other(USAGE)),
        };
        let code = args
            .get(index + 1)
            .and_then(|arg| arg.to_str())
            .filter(|code| valid(code))
            .ok_or_else(|| io::Error::other(invalid))?;
        *slot = Some(code.to_owned());
        index += 2;
    }
    within_frame(Operation::Open(Request {
        language,
        document_language,
        version: VERSION,
        paths: file_arguments(&args[index + 1..])?,
    }))
}

/// What the launcher does when no host accepts its first connection.
#[derive(Debug, PartialEq)]
enum WithoutHost {
    Spawn,
    /// No host holds documents, so a close has nothing to close.
    NothingOpen,
    /// Starting a host is not this launcher's to do.
    NotRunning,
}

fn without_host(request: &Operation, attach_only: bool) -> WithoutHost {
    if matches!(request, Operation::Close(_)) {
        WithoutHost::NothingOpen
    } else if attach_only {
        WithoutHost::NotRunning
    } else {
        WithoutHost::Spawn
    }
}

fn nothing_open(request: &Operation) -> Response {
    let Operation::Close(request) = request else {
        unreachable!("only a close request is answered without a host");
    };
    Response {
        results: request
            .close
            .iter()
            .map(|path| FileResult {
                path: path.clone(),
                canonical: None,
                status: "not_open".into(),
                error: None,
                message: None,
                reason: None,
            })
            .collect(),
        error: None,
        ..Response::error("")
    }
}

async fn launch(root: PathBuf, request: Operation) -> io::Result<Response> {
    let result = transport::exchange(&root, &request).await;
    match result {
        Ok(response) => return Ok(response),
        Err(error)
            if matches!(
                error.kind(),
                io::ErrorKind::NotFound | io::ErrorKind::ConnectionRefused
            ) => {}
        Err(error) => return Err(error),
    }
    match without_host(&request, std::env::var_os(ATTACH_ONLY).is_some()) {
        WithoutHost::Spawn => {}
        WithoutHost::NothingOpen => return Ok(nothing_open(&request)),
        WithoutHost::NotRunning => {
            eprintln!(
                "No mastermind host is running. Start one with `npm run dev`, or build the app with `npm run desktop:build`."
            );
            return Ok(Response::error("host_not_running"));
        }
    }
    let mut child = host_process::spawn()?;
    loop {
        match transport::exchange(&root, &request).await {
            Ok(response) => return Ok(response),
            Err(error)
                if matches!(
                    error.kind(),
                    io::ErrorKind::NotFound | io::ErrorKind::ConnectionRefused
                ) => {}
            Err(error) => return Err(error),
        }
        if host_process::startup_failed(&mut child)? {
            return Err(io::Error::other("host_startup_failed"));
        }
        tokio::time::sleep(std::time::Duration::from_millis(30)).await;
    }
}

pub fn dispatch(root: PathBuf, args: Vec<std::ffi::OsString>) -> ! {
    let request = match request(args) {
        Ok(request) => request,
        Err(error) => {
            eprintln!("{error}");
            println!(
                "{}",
                serde_json::to_string(&Response::error("invalid_invocation")).unwrap()
            );
            std::process::exit(2);
        }
    };
    let runtime = tokio::runtime::Runtime::new().unwrap();
    let result = runtime
        .block_on(async { tokio::time::timeout(transport::DEADLINE, launch(root, request)).await });
    let (response, code) = match result {
        Ok(Ok(response)) => {
            let code = exit_status(&response);
            (response, code)
        }
        result => {
            eprintln!("Outcome unknown: {result:?}");
            (Response::error("outcome_unknown"), 3)
        }
    };
    println!("{}", serde_json::to_string(&response).unwrap());
    std::process::exit(code);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn opening_language_is_optional_and_does_not_consume_a_file_path() {
        let args = |values: &[&str]| values.iter().map(std::ffi::OsString::from).collect();
        let Operation::Open(open) = request(args(&[
            "open",
            "--language",
            "zh-CN",
            "--",
            "one.md",
            "two.md",
        ]))
        .unwrap() else {
            panic!("expected open");
        };
        assert_eq!(open.language.as_deref(), Some("zh-CN"));
        assert_eq!(open.paths.len(), 2);
        let Operation::Open(open) = request(args(&["open", "--", "--language"])).unwrap() else {
            panic!("expected open");
        };
        assert!(open.language.is_none());
        assert!(open.paths[0].ends_with("--language"));
        for args in [
            args(&["open", "--language", "../fr", "--", "file.md"]),
            args(&["open", "--language", "fr", "--"]),
        ] {
            assert!(request(args).is_err());
        }
    }

    #[test]
    fn opening_document_language_is_a_well_formed_tag_given_once() {
        let args = |values: &[&str]| values.iter().map(std::ffi::OsString::from).collect();
        let Operation::Open(open) = request(args(&[
            "open",
            "--document-language",
            "zh-Hant-TW",
            "--language",
            "en",
            "--",
            "one.md",
        ]))
        .unwrap() else {
            panic!("expected open");
        };
        assert_eq!(open.document_language.as_deref(), Some("zh-Hant-TW"));
        assert_eq!(open.language.as_deref(), Some("en"));
        assert_eq!(open.paths.len(), 1);
        let Operation::Open(open) = request(args(&["open", "--", "--document-language"])).unwrap()
        else {
            panic!("expected open");
        };
        assert!(open.document_language.is_none());
        assert!(open.paths[0].ends_with("--document-language"));
        for (invalid, error) in [
            (
                args(&["open", "--document-language", "zh_TW", "--", "a.md"]),
                "invalid_document_language",
            ),
            (
                args(&["open", "--document-language", "--", "a.md"]),
                "invalid_document_language",
            ),
            (
                args(&["open", "--document-language"]),
                "invalid_document_language",
            ),
            (
                args(&[
                    "open",
                    "--document-language",
                    "ko",
                    "--document-language",
                    "ja",
                    "--",
                    "a.md",
                ]),
                USAGE,
            ),
            (
                args(&["close", "--document-language", "ko", "--", "a.md"]),
                USAGE,
            ),
            (args(&["open", "--document-language", "ko", "a.md"]), USAGE),
        ] {
            assert_eq!(request(invalid).err().unwrap().to_string(), error);
        }
    }

    #[test]
    fn the_document_language_hint_reaches_admission() {
        let dir = crate::test_support::TempDir::new("launcher-hint");
        let path = dir.join("plan.md");
        std::fs::write(&path, "計畫\n").unwrap();
        let operation = request(
            [
                "open",
                "--document-language",
                "zh-TW",
                "--",
                path.to_str().unwrap(),
            ]
            .iter()
            .map(std::ffi::OsString::from)
            .collect(),
        )
        .unwrap();
        // The request crosses the transport as JSON.
        let wire = serde_json::to_vec(&operation).unwrap();
        let Operation::Open(received) = serde_json::from_slice(&wire).unwrap() else {
            panic!("expected open");
        };
        let mut docs = crate::admission::Documents::default();
        let response = docs.admit(received);
        assert_eq!(exit_status(&response), 0);
        assert_eq!(
            docs.get(0).unwrap().document_language.as_deref(),
            Some("zh-TW")
        );
    }

    #[test]
    fn close_cli_resolves_paths_without_requiring_markdown() {
        let args = |values: &[&str]| values.iter().map(std::ffi::OsString::from).collect();
        let Operation::Close(close) =
            request(args(&["close", "--", "notes.txt", "a b.md"])).unwrap()
        else {
            panic!("expected close");
        };
        let cwd = std::env::current_dir().unwrap();
        assert_eq!(
            close.close,
            [cwd.join("notes.txt"), cwd.join("a b.md")]
                .map(|path| path.to_str().unwrap().to_owned())
        );
        let too_many: Vec<String> = (0..=MAX_FILES).map(|index| format!("{index}.md")).collect();
        let mut over = vec!["close", "--"];
        over.extend(too_many.iter().map(String::as_str));
        for invalid in [
            args(&["close", "--"]),
            args(&["close", "file.md"]),
            args(&["close", "--language", "fr", "--", "file.md"]),
            args(&over),
        ] {
            assert!(request(invalid).is_err());
        }
    }

    #[test]
    fn only_a_launcher_allowed_to_start_a_host_spawns_one() {
        let open = Operation::Open(Request {
            language: None,
            document_language: None,
            version: VERSION,
            paths: vec!["/document.md".into()],
        });
        let setup = Operation::Setup(SetupRequest {
            version: VERSION,
            setup: Default::default(),
        });
        let close = Operation::Close(CloseRequest {
            version: VERSION,
            close: vec!["/one.md".into(), "/two.md".into()],
        });
        assert_eq!(without_host(&open, false), WithoutHost::Spawn);
        assert_eq!(without_host(&setup, false), WithoutHost::Spawn);
        assert_eq!(without_host(&open, true), WithoutHost::NotRunning);
        assert_eq!(without_host(&setup, true), WithoutHost::NotRunning);
        for attach_only in [false, true] {
            assert_eq!(without_host(&close, attach_only), WithoutHost::NothingOpen);
        }
        let reply = nothing_open(&close);
        assert_eq!(exit_status(&reply), 0);
        assert_eq!(
            reply
                .results
                .iter()
                .map(|result| (result.path.as_str(), result.status.as_str()))
                .collect::<Vec<_>>(),
            [("/one.md", "not_open"), ("/two.md", "not_open")]
        );
        assert_eq!(exit_status(&Response::error("host_not_running")), 2);
    }

    #[test]
    fn setup_cli_is_separate_from_open() {
        let args = |values: &[&str]| values.iter().map(std::ffi::OsString::from).collect();
        let Operation::Setup(request) = request(args(&[
            "setup",
            "--suggest",
            "{\"authorTag\":\"Reader\",\"uiLang\":\"en\"}",
        ]))
        .unwrap() else {
            panic!("expected setup request");
        };
        assert_eq!(request.setup["uiLang"], "en");
        assert!(super::request(args(&["open", "--name", "Reader", "--", "file.md"])).is_err());
        assert!(super::request(args(&["setup", "--suggest", "[]"])).is_err());
        assert!(super::request(args(&["setup", "--suggest", "{}", "extra"])).is_err());
    }
}
