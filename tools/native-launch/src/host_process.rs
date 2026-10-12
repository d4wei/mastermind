#[cfg(unix)]
pub fn spawn() -> std::io::Result<std::process::Child> {
    use std::process::{Command, Stdio};
    Command::new(std::env::current_exe()?)
        .arg("host")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
}

#[cfg(windows)]
pub use windows::spawn;

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
        pub fn try_wait(&mut self) -> io::Result<Option<u32>> {
            let mut code = 0;
            if unsafe { GetExitCodeProcess(self.0.as_raw_handle(), &mut code) } == 0 {
                return Err(io::Error::last_os_error());
            }
            Ok((code != STILL_ACTIVE as u32).then_some(code))
        }
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
