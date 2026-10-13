use crate::admission::{Documents, MAX_FILES, MAX_FRAME, Request, Response, VERSION};
use std::{
    path::PathBuf,
    sync::{Arc, Mutex},
};
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;

pub fn focus(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn admit_graphical(docs: &mut Documents, paths: Vec<Result<PathBuf, String>>) {
    let mut errors = Vec::new();
    if paths.len() > MAX_FILES {
        docs.opening_errors = vec![format!("Open at most {MAX_FILES} files at once.")];
        return;
    }
    let paths = paths
        .into_iter()
        .filter_map(|path| {
            match path.and_then(|path| {
                path.to_str()
                    .map(str::to_owned)
                    .ok_or_else(|| "A file path uses an unsupported encoding.".into())
            }) {
                Ok(path) => Some(path),
                Err(error) => {
                    errors.push(error);
                    None
                }
            }
        })
        .collect::<Vec<_>>();
    if !paths.is_empty() {
        let request = Request {
            version: VERSION,
            paths,
        };
        let response = if serde_json::to_vec(&request).unwrap().len() + 1 > MAX_FRAME {
            Response::error("request_too_large")
        } else {
            docs.admit(request)
        };
        errors.extend(response.error);
        errors.extend(response.results.into_iter().filter_map(|result| {
            result
                .error
                .map(|error| format!("{}: {error}", result.path))
        }));
    }
    docs.opening_errors = errors;
}

pub fn open(app: &tauri::AppHandle, paths: Vec<Result<PathBuf, String>>) {
    let docs = app.state::<Arc<Mutex<Documents>>>().inner().clone();
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        admit_graphical(&mut docs.lock().unwrap(), paths);
        focus(&app);
    });
}

#[tauri::command]
pub fn choose_files(app: tauri::AppHandle) {
    let mut dialog = app.dialog().file();
    if let Some(window) = app.get_webview_window("main") {
        dialog = dialog.set_parent(&window);
    }
    dialog.pick_files(move |paths| {
        if let Some(paths) = paths {
            open(
                &app,
                paths
                    .into_iter()
                    .map(|path| path.into_path().map_err(|error| error.to_string()))
                    .collect(),
            );
        }
    });
}

#[tauri::command]
pub fn dismiss_opening_errors(docs: tauri::State<'_, Arc<Mutex<Documents>>>) {
    docs.lock().unwrap().opening_errors.clear();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn graphical_opening_shares_admission_and_reports_partial_failures() {
        let path =
            std::env::temp_dir().join(format!("mastermind-graphical-{}.md", std::process::id()));
        std::fs::write(&path, b"original\r\n").unwrap();
        let mut docs = Documents::default();
        admit_graphical(
            &mut docs,
            vec![Err("Not a local file.".into()), Ok(path.clone())],
        );
        assert_eq!(docs.opening_errors, ["Not a local file."]);
        assert_eq!(docs.active_id, Some(0));
        assert_eq!(docs.activation_revision, 1);
        assert_eq!(
            docs.files.values().next().unwrap().as_ref().unwrap().bytes,
            b"original\r\n"
        );
        std::fs::write(&path, b"external change").unwrap();
        admit_graphical(&mut docs, vec![Ok(path.clone())]);
        assert!(docs.opening_errors.is_empty());
        assert_eq!(docs.order.len(), 1);
        assert_eq!(docs.activation_revision, 2);
        assert_eq!(
            docs.files.values().next().unwrap().as_ref().unwrap().bytes,
            b"original\r\n"
        );
        std::fs::remove_file(&path).unwrap();
    }

    #[test]
    fn graphical_failures_are_retained_without_discarding_other_documents() {
        let mut docs = Documents::default();
        docs.order.push("retained".into());
        docs.active_id = Some(0);
        admit_graphical(&mut docs, vec![Err("Not a local file.".into())]);
        assert_eq!(docs.opening_errors, ["Not a local file."]);
        assert_eq!(docs.order, ["retained"]);
        assert_eq!(docs.active_id, Some(0));
        admit_graphical(
            &mut docs,
            (0..=MAX_FILES)
                .map(|_| Ok(PathBuf::from("/file")))
                .collect(),
        );
        assert_eq!(docs.opening_errors.len(), 1);
        assert!(docs.opening_errors[0].starts_with("Open at most"));
        assert_eq!(docs.order, ["retained"]);
    }
}
