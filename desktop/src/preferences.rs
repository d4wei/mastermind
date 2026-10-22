use serde_json::Value;
use std::{
    fs,
    io::{Read, Write},
    path::PathBuf,
    sync::Mutex,
};
use tauri::Manager;

pub(crate) fn preference_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    if let Some(path) = std::env::var_os("MM_LAUNCH_CHECK_PREFERENCES") {
        let path = PathBuf::from(path);
        if !path.is_absolute() {
            return Err("invalid_preferences_path".into());
        }
        return Ok(path);
    }
    let root = app.path().app_config_dir().map_err(|e| e.to_string())?;
    Ok(root.join("reviewer.json"))
}

const MAX_PREFERENCE_BYTES: usize = 64 * 1024;

pub(crate) fn read_preferences_file(path: PathBuf) -> Result<Option<Value>, String> {
    let file = match fs::File::open(path) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error.to_string()),
    };
    let mut bytes = Vec::new();
    file.take((MAX_PREFERENCE_BYTES + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() > MAX_PREFERENCE_BYTES {
        return Err("preferences_too_large".into());
    }
    serde_json::from_slice(&bytes)
        .map(Some)
        .map_err(|e| e.to_string())
}

pub(crate) fn write_preferences_file(path: PathBuf, config: Value) -> Result<(), String> {
    static WRITES: Mutex<()> = Mutex::new(());
    let _write = WRITES.lock().unwrap();
    let bytes = serde_json::to_vec_pretty(&config).map_err(|e| e.to_string())?;
    if !config.is_object() || bytes.len() > MAX_PREFERENCE_BYTES {
        return Err("invalid_preferences".into());
    }
    fs::create_dir_all(path.parent().unwrap()).map_err(|e| e.to_string())?;
    let temp = path.with_extension("json.tmp");
    let mut file = fs::File::create(&temp).map_err(|e| e.to_string())?;
    // Sync before renaming so the replaced path never names an unwritten file after a crash.
    file.write_all(&bytes)
        .and_then(|()| file.sync_all())
        .map_err(|e| e.to_string())?;
    fs::rename(&temp, path).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::sync::Arc;

    #[test]
    fn preference_reads_accept_the_limit_and_reject_larger_files_without_changes() {
        let root = std::env::temp_dir().join(format!(
            "mastermind-preference-limit-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let path = root.join("reviewer.json");
        assert!(read_preferences_file(path.clone()).unwrap().is_none());
        fs::create_dir(&root).unwrap();
        let at_limit = format!(
            "{{\"value\":\"{}\"}}",
            "x".repeat(MAX_PREFERENCE_BYTES - 12)
        );
        assert_eq!(at_limit.len(), MAX_PREFERENCE_BYTES);
        fs::write(&path, &at_limit).unwrap();
        assert_eq!(
            read_preferences_file(path.clone()).unwrap().unwrap()["value"],
            "x".repeat(MAX_PREFERENCE_BYTES - 12)
        );
        let oversized = format!("{at_limit} ");
        fs::write(&path, &oversized).unwrap();
        assert_eq!(
            read_preferences_file(path.clone()).unwrap_err(),
            "preferences_too_large"
        );
        assert_eq!(fs::read(&path).unwrap(), oversized.as_bytes());
        fs::write(&path, b"invalid JSON").unwrap();
        assert!(read_preferences_file(path.clone()).is_err());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn concurrent_preferences_writes_leave_one_complete_object() {
        let root = std::env::temp_dir().join(format!(
            "mastermind-preferences-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let path = root.join("reviewer.json");
        let start = Arc::new(std::sync::Barrier::new(9));
        let writers = (0..8)
            .map(|index| {
                let path = path.clone();
                let start = start.clone();
                std::thread::spawn(move || {
                    start.wait();
                    write_preferences_file(path, json!({"index": index, "value": "x".repeat(1024)}))
                })
            })
            .collect::<Vec<_>>();
        start.wait();
        for writer in writers {
            writer.join().unwrap().unwrap();
        }
        let saved: Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        assert!(saved["index"].as_u64().unwrap() < 8);
        assert_eq!(saved["value"], "x".repeat(1024));
        assert!(!path.with_extension("json.tmp").exists());
        fs::remove_dir_all(root).unwrap();
    }
}
