#![cfg_attr(windows, windows_subsystem = "windows")]

mod admission;
mod appearance;
mod closing;
mod document_io;
mod endpoint;
mod files;
mod launcher;
mod lifecycle;
mod menu;
mod opening;
mod preferences;
mod setup;
mod translations;
use tauri::{Emitter, Manager};
mod host_process;
mod termination;
#[cfg(test)]
mod test_support;
mod transport;
mod worker;
use admission::Documents;
use std::{
    io,
    sync::{Arc, Mutex},
};

fn main() {
    let mut args: Vec<_> = std::env::args_os().skip(1).collect();
    let console_launcher = cfg!(windows) && args.first().is_some_and(|arg| arg == "launcher");
    if console_launcher {
        args.remove(0);
    }
    let root = match endpoint::discover() {
        Ok(root) => root,
        Err(error) => {
            eprintln!("{error}");
            std::process::exit(2);
        }
    };
    if console_launcher || (!args.is_empty() && args[0] != "host") {
        launcher::dispatch(root, args);
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
    let close_requests = Arc::new(closing::CloseRequests::default());
    let builder = tauri::Builder::default();
    #[cfg(target_os = "macos")]
    let renderer_reloads = std::sync::Arc::new(std::sync::atomic::AtomicU32::new(0));
    #[cfg(target_os = "macos")]
    let builder = builder.on_web_content_process_terminate(move |webview| {
        termination::renderer_lost(webview.app_handle());
        webview
            .state::<Arc<closing::CloseRequests>>()
            .renderer_lost();
        // A reloaded renderer subscribes to close requests again, so the window can close.
        if termination::should_reload_renderer(&renderer_reloads) {
            let _ = webview.reload();
        }
    });
    builder
        .plugin(tauri_plugin_dialog::init())
        .on_page_load(|webview, payload| {
            if matches!(payload.event(), tauri::webview::PageLoadEvent::Started) {
                termination::renderer_lost(webview.app_handle());
                webview
                    .state::<Arc<closing::CloseRequests>>()
                    .renderer_lost();
            }
        })
        .manage(docs.clone())
        .manage(close_requests.clone())
        .manage(lifecycle::CloseGate::default())
        .invoke_handler(tauri::generate_handler![
            appearance::set_appearance,
            appearance::set_window_title,
            menu::set_menu_language,
            menu::set_menu_state,
            opening::snapshot,
            opening::close_document,
            opening::choose_files,
            opening::dismiss_opening_errors,
            document_io::document_meta,
            document_io::read_document,
            document_io::write_document,
            document_io::save_document_copy,
            document_io::watch_document,
            document_io::list_translations,
            setup::setup_snapshot,
            setup::protect_setup_fields,
            setup::confirm_setup,
            setup::read_preferences,
            setup::write_preferences,
            lifecycle::finish_close,
            lifecycle::cancel_close,
            termination::close_ready,
            closing::close_requests_ready,
            closing::complete_close_request,
        ])
        .setup(move |app| {
            let setup = Arc::new(setup::Setup::new(preferences::preference_path(
                app.handle(),
            )?));
            app.manage(setup.clone());
            let invalidations = app.handle().clone();
            let watch = document_io::FileWatch::new(move || {
                let _ = invalidations.emit("document-invalidated", ());
            })
            .inspect_err(|error| eprintln!("File watching is unavailable: {error}"))
            .ok();
            app.manage(Arc::new(Mutex::new(watch)));
            termination::install(app.handle())?;
            let (menu, menu_handles) = menu::build(app.handle(), menu::Language::default())?;
            app.set_menu(menu)?;
            app.manage(menu_handles);
            let runtime = tauri::async_runtime::handle();
            runtime.spawn(transport::serve(
                listener,
                docs,
                setup,
                close_requests,
                app.handle().clone(),
            ));
            lifecycle::create_window(app.handle());
            Ok(())
        })
        .on_menu_event(menu::menu_event)
        .on_window_event(lifecycle::window_event)
        .build(tauri::generate_context!())
        .expect("native host failed")
        .run(lifecycle::run_event);
}
