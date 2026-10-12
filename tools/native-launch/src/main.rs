mod admission;
mod endpoint;
mod files;
mod reviewer;
use tauri::{Emitter, Manager};
mod host_process;
mod termination;
mod transport;
use admission::{Documents, MAX_FILES, MAX_FRAME, Request, Response, VERSION};
use std::{
    io,
    path::PathBuf,
    sync::{Arc, Mutex},
};

#[derive(serde::Serialize)]
struct Snapshot {
    pid: u32,
    files: Vec<String>,
}

#[tauri::command]
fn snapshot(state: tauri::State<'_, Arc<Mutex<Documents>>>) -> Snapshot {
    Snapshot {
        pid: std::process::id(),
        files: state.lock().unwrap().order.clone(),
    }
}

fn request(args: Vec<std::ffi::OsString>) -> io::Result<Request> {
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
    Ok(request)
}

async fn launch(root: PathBuf, request: Request) -> io::Result<Response> {
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

fn main() {
    let args: Vec<_> = std::env::args_os().skip(1).collect();
    let root = match endpoint::discover() {
        Ok(root) => root,
        Err(error) => {
            eprintln!("{error}");
            std::process::exit(2);
        }
    };
    if !args.is_empty() && args[0] != "host" {
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
        let result = runtime.block_on(async {
            tokio::time::timeout(transport::DEADLINE, launch(root, request)).await
        });
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
    let (_owner, listener) = match tauri::async_runtime::block_on(async { endpoint::bind(&root) }) {
        Ok(bound) => bound,
        Err(error) if error.kind() == io::ErrorKind::WouldBlock => return,
        Err(error) => {
            eprintln!("{error}");
            std::process::exit(2);
        }
    };
    let docs = Arc::new(Mutex::new(Documents::default()));
    let builder = tauri::Builder::default();
    #[cfg(target_os = "macos")]
    let builder = builder.on_web_content_process_terminate(|webview| {
        termination::renderer_lost(webview.app_handle());
    });
    builder
        .on_page_load(|webview, payload| {
            if matches!(payload.event(), tauri::webview::PageLoadEvent::Started) {
                termination::renderer_lost(webview.app_handle());
            }
        })
        .manage(docs.clone())
        .manage(reviewer::CloseGate::default())
        .invoke_handler(tauri::generate_handler![
            snapshot,
            reviewer::document_meta,
            reviewer::read_document,
            reviewer::write_document,
            reviewer::watch_document,
            reviewer::read_translation,
            reviewer::read_preferences,
            reviewer::write_preferences,
            reviewer::finish_close,
            reviewer::cancel_close,
            termination::close_ready
        ])
        .setup(move |app| {
            app.manage(Mutex::new(reviewer::FileWatch::new(app.handle().clone())?));
            if cfg!(feature = "reviewer") {
                termination::install(app.handle())?;
                app.set_menu(reviewer::menu(app.handle())?)?;
            }
            let runtime = tauri::async_runtime::handle();
            runtime.spawn(transport::serve(listener, docs));
            let handle = app.handle().clone();
            let delay = std::env::var("MM_LAUNCH_CHECK_UI_DELAY_MS")
                .ok()
                .and_then(|s| s.parse::<u64>().ok())
                .unwrap_or(0)
                .min(5_000);
            runtime.spawn(async move {
                tokio::time::sleep(std::time::Duration::from_millis(delay)).await;
                let main_handle = handle.clone();
                let _ =
                    handle.run_on_main_thread(move || {
                        match tauri::WebviewWindowBuilder::new(
                            &main_handle,
                            "main",
                            tauri::WebviewUrl::App(
                                if cfg!(feature = "reviewer") {
                                    "native.html"
                                } else {
                                    "index.html"
                                }
                                .into(),
                            ),
                        )
                        .title("mastermind — native launch check")
                        .inner_size(1100.0, 760.0)
                        .build()
                        {
                            Ok(window) => {
                                let _ = window.set_focus();
                            }
                            Err(error) => eprintln!("{error}"),
                        }
                    });
            });
            Ok(())
        })
        .on_menu_event(|app, event| {
            if event.id().as_ref() == "quit-reviewer" {
                let _ = app.emit("close-requested", ());
            }
        })
        .on_window_event(|window, event| {
            if cfg!(feature = "reviewer")
                && let tauri::WindowEvent::CloseRequested { api, .. } = event
            {
                api.prevent_close();
                let _ = window.emit("close-requested", ());
            }
        })
        .build(tauri::generate_context!())
        .expect("native host failed")
        .run(|app, event| {
            if cfg!(feature = "reviewer")
                && let tauri::RunEvent::ExitRequested { api, .. } = event
            {
                if app
                    .state::<reviewer::CloseGate>()
                    .0
                    .load(std::sync::atomic::Ordering::SeqCst)
                {
                    return;
                }
                api.prevent_exit();
                let _ = app.emit("close-requested", ());
            }
        });
}
