#![cfg_attr(windows, windows_subsystem = "windows")]

mod admission;
mod appearance;
mod document_io;
mod translations;
mod endpoint;
mod files;
mod launcher;
mod lifecycle;
mod opening;
mod preferences;
mod setup;
use tauri::{Emitter, Manager};
mod host_process;
mod termination;
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
    let builder = tauri::Builder::default();
    #[cfg(target_os = "macos")]
    let builder = builder.on_web_content_process_terminate(|webview| {
        termination::renderer_lost(webview.app_handle());
    });
    builder
        .plugin(tauri_plugin_dialog::init())
        .on_page_load(|webview, payload| {
            if matches!(payload.event(), tauri::webview::PageLoadEvent::Started) {
                termination::renderer_lost(webview.app_handle());
            }
        })
        .manage(docs.clone())
        .manage(lifecycle::CloseGate::default())
        .invoke_handler(tauri::generate_handler![
            appearance::set_appearance,
            appearance::set_window_title,
            lifecycle::set_find_enabled,
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
        ])
        .setup(move |app| {
            let setup = Arc::new(setup::Setup::new(preferences::preference_path(
                app.handle(),
            )?));
            app.manage(setup.clone());
            let invalidations = app.handle().clone();
            app.manage(Arc::new(Mutex::new(document_io::FileWatch::new(move || {
                let _ = invalidations.emit("document-invalidated", ());
            })?)));
            termination::install(app.handle())?;
            app.set_menu(lifecycle::menu(app.handle())?)?;
            let runtime = tauri::async_runtime::handle();
            runtime.spawn(transport::serve(
                listener,
                docs,
                setup,
                app.handle().clone(),
            ));
            lifecycle::create_window(app.handle());
            Ok(())
        })
        .on_menu_event(lifecycle::menu_event)
        .on_window_event(lifecycle::window_event)
        .build(tauri::generate_context!())
        .expect("native host failed")
        .run(lifecycle::run_event);
}
