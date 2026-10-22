#[cfg(unix)]
pub type Child = std::process::Child;

#[cfg(unix)]
fn detached(command: &mut std::process::Command) -> &mut std::process::Command {
    use std::{os::unix::process::CommandExt, process::Stdio};
    // A separate process group keeps terminal interrupts and group signals aimed at the launcher
    // from reaching a host that may hold unsaved edits.
    command
        .process_group(0)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
}

#[cfg(unix)]
pub fn spawn() -> std::io::Result<Child> {
    detached(std::process::Command::new(std::env::current_exe()?).arg("host")).spawn()
}

/// Whether a spawned host has exited unsuccessfully. A host that loses the endpoint lock to a
/// concurrent startup exits successfully while the winner is still binding, so only a failure
/// means no host is coming.
#[cfg(unix)]
pub fn startup_failed(child: &mut Child) -> std::io::Result<bool> {
    Ok(child.try_wait()?.is_some_and(|status| !status.success()))
}

#[cfg(windows)]
pub use windows::{Child, spawn, startup_failed};

#[cfg(windows)]
mod windows {
    use std::{
        io,
        os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle},
    };
    use widestring::U16CString;
    use windows_sys::Win32::{
        Foundation::STILL_ACTIVE,
        System::Threading::{
            CREATE_NO_WINDOW, CreateProcessW, GetExitCodeProcess, PROCESS_INFORMATION, STARTUPINFOW,
        },
    };

    pub struct Child(OwnedHandle);

    impl Child {
        fn try_wait(&mut self) -> io::Result<Option<u32>> {
            let mut code = 0;
            if unsafe { GetExitCodeProcess(self.0.as_raw_handle(), &mut code) } == 0 {
                return Err(io::Error::last_os_error());
            }
            Ok((code != STILL_ACTIVE as u32).then_some(code))
        }
    }

    pub fn startup_failed(child: &mut Child) -> io::Result<bool> {
        Ok(child.try_wait()?.is_some_and(|code| code != 0))
    }

    pub fn spawn() -> io::Result<Child> {
        let executable =
            U16CString::from_os_str(std::env::current_exe()?).map_err(io::Error::other)?;
        let mut arguments: Vec<u16> = "mastermind-launch-check host\0".encode_utf16().collect();
        let startup = STARTUPINFOW {
            cb: size_of::<STARTUPINFOW>() as u32,
            ..Default::default()
        };
        let mut process = PROCESS_INFORMATION::default();
        // Redirecting stdout alone leaves other inheritable handles in the GUI child. Disable
        // inheritance so an agent capturing launcher output can receive EOF while the app lives.
        let success = unsafe {
            CreateProcessW(
                executable.as_ptr(),
                arguments.as_mut_ptr(),
                std::ptr::null(),
                std::ptr::null(),
                0,
                CREATE_NO_WINDOW,
                std::ptr::null(),
                std::ptr::null(),
                &startup,
                &mut process,
            )
        };
        if success == 0 {
            return Err(io::Error::last_os_error());
        }
        // A successful creation transfers both handles; closing them does not stop the child.
        let _thread = unsafe { OwnedHandle::from_raw_handle(process.hThread) };
        Ok(Child(unsafe {
            OwnedHandle::from_raw_handle(process.hProcess)
        }))
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::process::Command;

    #[test]
    fn hosts_run_in_their_own_process_group() {
        let mut child = detached(Command::new("sleep").arg("5")).spawn().unwrap();
        let pid = child.id() as libc::pid_t;
        // getpgid and getpgrp only read process-group identities.
        assert_eq!(unsafe { libc::getpgid(pid) }, pid);
        assert_ne!(unsafe { libc::getpgrp() }, pid);
        child.kill().unwrap();
        child.wait().unwrap();
    }

    #[test]
    fn only_an_unsuccessful_exit_is_a_startup_failure() {
        for (script, failed) in [("exit 2", true), ("exit 0", false)] {
            let mut child = Command::new("sh").args(["-c", script]).spawn().unwrap();
            child.wait().unwrap();
            assert_eq!(startup_failed(&mut child).unwrap(), failed);
        }
        let mut running = Command::new("sleep").arg("5").spawn().unwrap();
        assert!(!startup_failed(&mut running).unwrap());
        running.kill().unwrap();
        running.wait().unwrap();
    }
}
