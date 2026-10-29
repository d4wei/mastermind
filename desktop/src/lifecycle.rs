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

/// The origin the interface loads from: the development server in a development build, otherwise
/// Tauri's app protocol, which Wry serves as `http://tauri.localhost` on Windows.
fn app_origin(app: &tauri::AppHandle) -> tauri::Url {
    if tauri::is_dev()
        && let Some(url) = app.config().build.dev_url.clone()
    {
        return url;
    }
    let origin = if cfg!(windows) {
        "http://tauri.localhost"
    } else {
        "tauri://localhost"
    };
    tauri::Url::parse(origin).unwrap()
}

/// Whether the window may navigate to `url`. Only the app's own origin carries the command bridge,
/// so a link or script in a document cannot replace the interface with another page.
fn same_origin(url: &tauri::Url, origin: &tauri::Url) -> bool {
    url.scheme() == origin.scheme()
        && url.host_str() == origin.host_str()
        && url.port_or_known_default() == origin.port_or_known_default()
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
            let origin = app_origin(&main_handle);
            let window_builder = tauri::WebviewWindowBuilder::new(
                &main_handle,
                "main",
                tauri::WebviewUrl::App("desktop.html".into()),
            )
            .on_navigation(move |url| same_origin(url, &origin))
            .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny)
            .title("mastermind")
            .inner_size(1100.0, 760.0);
            #[cfg(target_os = "macos")]
            let window_builder = window_builder
                .title_bar_style(tauri::TitleBarStyle::Overlay)
                .hidden_title(true)
                .traffic_light_position(tauri::LogicalPosition::new(16.0, 25.0));
            match window_builder.build() {
                Ok(window) => {
                    let _ = window.set_focus();
                }
                Err(error) => eprintln!("{error}"),
            }
        });
    });
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn navigation_stays_within_the_app_origin() {
        let parse = |url: &str| tauri::Url::parse(url).unwrap();
        for (origin, allowed, denied) in [
            (
                "tauri://localhost",
                &["tauri://localhost", "tauri://localhost/desktop.html?x#y"][..],
                &[
                    "tauri://evil",
                    "https://localhost/desktop.html",
                    "http://localhost:5173/",
                    "file:///etc/passwd",
                    "about:blank",
                ][..],
            ),
            (
                "http://tauri.localhost",
                &[
                    "http://tauri.localhost/desktop.html",
                    "http://tauri.localhost:80/",
                ][..],
                &[
                    "https://tauri.localhost/",
                    "http://tauri.localhost.example/",
                ][..],
            ),
            (
                "http://localhost:5173",
                &["http://localhost:5173/desktop.html"][..],
                &[
                    "http://localhost:5174/desktop.html",
                    "http://127.0.0.1:5173/desktop.html",
                    "https://localhost:5173/",
                    "https://example.com/",
                ][..],
            ),
        ] {
            let origin = parse(origin);
            for url in allowed {
                assert!(same_origin(&parse(url), &origin), "{url} denied");
            }
            for url in denied {
                assert!(!same_origin(&parse(url), &origin), "{url} allowed");
            }
        }
    }
}
