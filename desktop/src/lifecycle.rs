use tauri::{Emitter, Manager};

#[derive(Default)]
pub struct CloseGate(pub std::sync::atomic::AtomicBool);

#[tauri::command]
pub fn finish_close(
    app: tauri::AppHandle,
    gate: tauri::State<'_, CloseGate>,
) -> Result<(), String> {
    gate.0.store(true, std::sync::atomic::Ordering::SeqCst);
    crate::termination::complete(app, true).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn cancel_close(
    app: tauri::AppHandle,
    gate: tauri::State<'_, CloseGate>,
) -> Result<(), String> {
    gate.0.store(false, std::sync::atomic::Ordering::SeqCst);
    crate::termination::complete(app, false).map_err(|e| e.to_string())
}

pub fn menu(app: &tauri::AppHandle) -> tauri::Result<tauri::menu::Menu<tauri::Wry>> {
    use tauri::menu::{Menu, SubmenuBuilder};
    #[cfg(not(target_os = "macos"))]
    let quit = tauri::menu::MenuItem::with_id(
        app,
        "quit-reviewer",
        "Quit mastermind",
        true,
        Some("CmdOrCtrl+Q"),
    )?;
    let application = SubmenuBuilder::new(app, "mastermind");
    #[cfg(target_os = "macos")]
    let application = application.quit();
    #[cfg(not(target_os = "macos"))]
    let application = application.item(&quit);
    let application = application.build()?;
    let open = tauri::menu::MenuItem::with_id(
        app,
        "open-files",
        "Open files…",
        true,
        Some("CmdOrCtrl+O"),
    )?;
    let file = SubmenuBuilder::new(app, "File").item(&open).build()?;
    let edit = SubmenuBuilder::new(app, "Edit");
    #[cfg(target_os = "macos")]
    let edit = edit.undo().redo().separator();
    let edit = edit.cut().copy().paste().select_all().build()?;
    Menu::with_items(app, &[&application, &file, &edit])
}

pub fn create_window(app: &tauri::AppHandle) {
    let handle = app.clone();
    let delay = std::env::var("MM_LAUNCH_CHECK_UI_DELAY_MS")
        .ok()
        .and_then(|s| s.parse::<u64>().ok())
        .unwrap_or(0)
        .min(5_000);
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_millis(delay)).await;
        let main_handle = handle.clone();
        let _ = handle.run_on_main_thread(move || {
            let window_builder = tauri::WebviewWindowBuilder::new(
                &main_handle,
                "main",
                tauri::WebviewUrl::App("desktop.html".into()),
            )
            .title("mastermind")
            .inner_size(1100.0, 760.0);
            #[cfg(target_os = "macos")]
            let window_builder = window_builder
                .title_bar_style(tauri::TitleBarStyle::Overlay)
                .hidden_title(true)
                .traffic_light_position(tauri::LogicalPosition::new(16.0, 32.0));
            #[cfg(feature = "readiness-trace")]
            let window_builder = if let Some(script) = main_handle
                .state::<std::sync::Arc<crate::readiness::Readiness>>()
                .initialization_script()
            {
                window_builder.initialization_script(script)
            } else {
                window_builder
            };
            match window_builder.build() {
                Ok(window) => {
                    let _ = window.set_focus();
                }
                Err(error) => eprintln!("{error}"),
            }
        });
    });
}

pub fn menu_event(app: &tauri::AppHandle, event: tauri::menu::MenuEvent) {
    if event.id().as_ref() == "open-files" {
        crate::opening::choose_files(app.clone());
    }
    if event.id().as_ref() == "quit-reviewer" {
        let _ = app.emit("close-requested", ());
    }
}

pub fn window_event(window: &tauri::Window, event: &tauri::WindowEvent) {
    if let tauri::WindowEvent::DragDrop(tauri::DragDropEvent::Drop { paths, .. }) = event {
        crate::opening::open(window.app_handle(), paths.iter().cloned().map(Ok).collect());
    }
    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
        api.prevent_close();
        let _ = window.emit("close-requested", ());
    }
}

pub fn run_event(app: &tauri::AppHandle, event: tauri::RunEvent) {
    #[cfg(target_os = "macos")]
    if let tauri::RunEvent::Opened { ref urls } = event {
        crate::opening::open(
            app,
            urls.iter()
                .map(|url| {
                    url.to_file_path()
                        .map_err(|_| format!("Not a local file: {url}"))
                })
                .collect(),
        );
    }
    if let tauri::RunEvent::ExitRequested { api, .. } = event {
        if app
            .state::<CloseGate>()
            .0
            .load(std::sync::atomic::Ordering::SeqCst)
        {
            return;
        }
        api.prevent_exit();
        let _ = app.emit("close-requested", ());
    }
}
