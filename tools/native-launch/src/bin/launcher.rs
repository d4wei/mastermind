#[cfg(any(windows, test))]
use mastermind_launch_check::protocol::{Response, VERSION};
#[cfg(any(windows, test))]
use std::io;
#[cfg(windows)]
use std::{
    io::Write,
    process::{Command, Stdio},
};

#[cfg(windows)]
fn capture() -> io::Result<std::process::Output> {
    let executable = std::env::current_exe()?.with_file_name("mastermind-launch-check.exe");
    // Pipes keep console output independent of the GUI executable's subsystem and attachment.
    Command::new(executable)
        .arg("launcher")
        .args(std::env::args_os().skip(1))
        .stdin(Stdio::null())
        .output()
}

#[cfg(any(windows, test))]
fn result(output: io::Result<std::process::Output>) -> (Vec<u8>, Vec<u8>, i32) {
    let diagnostics = match output {
        Ok(output) => {
            if serde_json::from_slice::<Response>(&output.stdout)
                .is_ok_and(|response| response.version == VERSION)
                && let Some(code) = output.status.code()
            {
                return (output.stdout, output.stderr, code);
            }
            let mut diagnostics = output.stderr;
            diagnostics.extend_from_slice(b"GUI command returned no valid opening response.\n");
            diagnostics
        }
        Err(error) => format!("Launcher failed: {error}\n").into_bytes(),
    };
    let mut response = serde_json::to_vec(&Response::error("outcome_unknown")).unwrap();
    response.push(b'\n');
    (response, diagnostics, 3)
}

#[cfg(windows)]
fn main() {
    let (response, diagnostics, code) = result(capture());
    let mut stderr = io::stderr().lock();
    let _ = stderr.write_all(&diagnostics);
    let _ = stderr.flush();
    let mut stdout = io::stdout().lock();
    if let Err(error) = stdout.write_all(&response).and_then(|_| stdout.flush()) {
        // A partial frame cannot be repaired by appending a second response.
        let _ = writeln!(
            stderr,
            "Opening outcome unknown: response delivery failed: {error}"
        );
        std::process::exit(3);
    }
    std::process::exit(code);
}

#[cfg(not(windows))]
fn main() {
    eprintln!("The console companion is only used in Windows packages.");
    std::process::exit(2);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn status(code: i32) -> std::process::ExitStatus {
        #[cfg(windows)]
        {
            use std::os::windows::process::ExitStatusExt;
            std::process::ExitStatus::from_raw(code as u32)
        }
        #[cfg(unix)]
        {
            use std::os::unix::process::ExitStatusExt;
            std::process::ExitStatus::from_raw(code << 8)
        }
    }

    #[test]
    fn capture_failure_returns_one_unknown_response() {
        let (bytes, diagnostics, code) = result(Err(io::Error::other("missing GUI")));
        let response: Response = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(response.error.as_deref(), Some("outcome_unknown"));
        assert_eq!(code, 3);
        assert!(
            String::from_utf8(diagnostics)
                .unwrap()
                .contains("missing GUI")
        );
        assert_eq!(bytes.iter().filter(|byte| **byte == b'\n').count(), 1);
    }

    #[test]
    fn valid_response_and_status_are_byte_exact() {
        let mut bytes = serde_json::to_vec(&Response::error("invalid_invocation")).unwrap();
        bytes.push(b'\n');
        let (response, diagnostics, code) = result(Ok(std::process::Output {
            status: status(2),
            stdout: bytes.clone(),
            stderr: b"diagnostics\n".to_vec(),
        }));
        assert_eq!(response, bytes);
        assert_eq!(diagnostics, b"diagnostics\n");
        assert_eq!(code, 2);
    }

    #[test]
    fn empty_or_malformed_gui_output_becomes_unknown() {
        for stdout in [Vec::new(), b"not JSON\n".to_vec()] {
            let (bytes, diagnostics, code) = result(Ok(std::process::Output {
                status: status(1),
                stdout,
                stderr: b"GUI failure\n".to_vec(),
            }));
            let response: Response = serde_json::from_slice(&bytes).unwrap();
            assert_eq!(response.error.as_deref(), Some("outcome_unknown"));
            assert_eq!(code, 3);
            assert!(diagnostics.starts_with(b"GUI failure\n"));
        }
    }
}
