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
    if args.len() < 3 || args[0] != "open" || args[1] != "--" || args.len() - 2 > MAX_FILES {
        return Err(io::Error::other(
            "usage: mastermind-launch-check open -- FILE...",
        ));
    }
    let cwd = std::env::current_dir()?;
    let paths = args[2..]
        .iter()
        .map(|arg| {
            let path = cwd.join(arg);
            path.to_str()
                .map(str::to_owned)
                .ok_or_else(|| io::Error::other("unsupported_path_encoding"))
        })
        .collect::<io::Result<Vec<_>>>()?;
    let request = Request {
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
        // Reap a losing startup process while another process finishes creating the endpoint.
        let _ = child.try_wait()?;
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
    fn setup_cli_is_separate_from_open_and_preserves_explicit_null() {
        let args = |values: &[&str]| values.iter().map(std::ffi::OsString::from).collect();
        let Operation::Setup(request) = request(args(&[
            "setup",
            "--suggest",
            "{\"authorTag\":\"Reader\",\"translationLanguage\":null}",
        ]))
        .unwrap() else {
            panic!("expected setup request");
        };
        assert_eq!(
            request.setup["translationLanguage"],
            serde_json::Value::Null
        );
        assert!(super::request(args(&["open", "--name", "Reader", "--", "file.md"])).is_err());
        assert!(super::request(args(&["setup", "--suggest", "[]"])).is_err());
        assert!(super::request(args(&["setup", "--suggest", "{}", "extra"])).is_err());
    }
}
