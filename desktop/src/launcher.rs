use crate::{
    admission::{MAX_FILES, MAX_FRAME, Request, Response, VERSION},
    host_process, transport,
};
use mastermind_launch_check::protocol::{Operation, SetupRequest};
use std::{io, path::PathBuf};

fn request(args: Vec<std::ffi::OsString>) -> io::Result<Operation> {
    if args.first().is_some_and(|arg| arg == "setup") {
        if args.len() != 3 || args[1] != "--suggest" {
            return Err(io::Error::other(
                "usage: mastermind-launch-check setup --suggest JSON_OBJECT",
            ));
        }
        let raw = args[2]
            .to_str()
            .ok_or_else(|| io::Error::other("unsupported_argument_encoding"))?;
        if raw.len() > MAX_FRAME {
            return Err(io::Error::other("request_too_large"));
        }
        let setup = serde_json::from_str(raw)?;
        let request = Operation::Setup(SetupRequest {
            version: VERSION,
            setup,
        });
        if serde_json::to_vec(&request)?.len() + 1 > MAX_FRAME {
            return Err(io::Error::other("request_too_large"));
        }
        return Ok(request);
    }
    let (offset, language) = if args.get(1).is_some_and(|arg| arg == "--language") {
        let language = args
            .get(2)
            .and_then(|arg| arg.to_str())
            .filter(|code| mastermind_launch_check::protocol::language_code(code))
            .ok_or_else(|| io::Error::other("invalid_language"))?;
        (4, Some(language.to_owned()))
    } else {
        (2, None)
    };
    if args.first().is_none_or(|arg| arg != "open")
        || args.get(offset - 1).is_none_or(|arg| arg != "--")
        || args.len() <= offset
        || args.len() - offset > MAX_FILES
    {
        return Err(io::Error::other(
            "usage: mastermind-launch-check open [--language CODE] -- FILE...",
        ));
    }
    let cwd = std::env::current_dir()?;
    let paths = args[offset..]
        .iter()
        .map(|arg| {
            let path = cwd.join(arg);
            path.to_str()
                .map(str::to_owned)
                .ok_or_else(|| io::Error::other("unsupported_path_encoding"))
        })
        .collect::<io::Result<Vec<_>>>()?;
    let request = Request {
        language,
        version: VERSION,
        paths,
    };
    if serde_json::to_vec(&request)?.len() + 1 > MAX_FRAME {
        return Err(io::Error::other("request_too_large"));
    }
    Ok(Operation::Open(request))
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
            let code = if response.error.is_some() {
                2
            } else if response.results.iter().any(|r| r.status == "error") {
                1
            } else {
                0
            };
            (response, code)
        }
        result => {
            eprintln!("Opening outcome unknown: {result:?}");
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
