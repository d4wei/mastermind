#[cfg(target_os = "macos")]
mod macos;

pub fn install(app: &tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    #[cfg(target_os = "macos")]
    macos::install(app)?;
    #[cfg(not(target_os = "macos"))]
    let _ = app;
    Ok(())
}

pub fn complete(app: tauri::AppHandle, allowed: bool) -> tauri::Result<()> {
    let handle = app.clone();
    app.run_on_main_thread(move || {
        #[cfg(target_os = "macos")]
        if macos::reply(allowed) {
            return;
        }
        if allowed {
            handle.exit(0);
        }
    })
}

#[tauri::command]
pub fn close_ready() {
    #[cfg(target_os = "macos")]
    macos::ready();
}
