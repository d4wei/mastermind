use crate::admission::Documents;
use serde::{Deserialize, Serialize};
use std::{
    io::Write,
    path::PathBuf,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
};
use tauri::Manager;

const TRACE_ENV: &str = "MM_LAUNCH_CHECK_READY_TRACE";
const HEADING: &str = "Readiness measurement fixture";
const BODY: &str =
    "This public disposable document measures readiness of the requested original text.";

#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Config {
    nonce: String,
    target: PathBuf,
    output: PathBuf,
}

impl Config {
    fn parse(raw: &str) -> Result<Self, String> {
        if raw.len() > crate::admission::MAX_FRAME {
            return Err("invalid_readiness_config".into());
        }
        let config: Self = serde_json::from_str(raw).map_err(|_| "invalid_readiness_config")?;
        if config.nonce.len() != 32
            || !config.nonce.bytes().all(|byte| byte.is_ascii_hexdigit())
            || !config.target.is_absolute()
            || !config.output.is_absolute()
            || config.target == config.output
        {
            return Err("invalid_readiness_config".into());
        }
        Ok(config)
    }
}

pub struct Readiness {
    config: Option<Config>,
    signalled: AtomicBool,
}

impl Readiness {
    pub fn from_environment() -> Result<Self, String> {
        let config = match std::env::var(TRACE_ENV) {
            Ok(raw) => Some(Config::parse(&raw)?),
            Err(std::env::VarError::NotPresent) => None,
            Err(_) => return Err("invalid_readiness_config".into()),
        };
        Ok(Self {
            config,
            signalled: AtomicBool::new(false),
        })
    }

    pub fn initialization_script(&self) -> Option<String> {
        let config = self.config.as_ref()?;
        let config = serde_json::json!({
            "nonce": config.nonce, "target": config.target, "heading": HEADING, "body": BODY,
        });
        Some(format!(
            "const readinessConfig = {config};\n{}",
            include_str!("readiness.js")
        ))
    }

    fn signal(&self, docs: &Documents, nonce: &str, session_id: &str) -> Result<(), String> {
        let config = self.config.as_ref().ok_or("readiness_disabled")?;
        let path = session_id
            .parse::<usize>()
            .ok()
            .and_then(|id| docs.order.get(id));
        if nonce != config.nonce || path.map(PathBuf::from).as_ref() != Some(&config.target) {
            return Err("readiness_identity_mismatch".into());
        }
        if self
            .signalled
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .is_err()
        {
            return Err("readiness_already_signalled".into());
        }
        let record = serde_json::json!({
            "nonce": config.nonce, "pid": std::process::id(), "session_id": session_id,
            "target": config.target, "stage": "document_layout_two_frames",
        });
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&config.output)
            .map_err(|error| error.to_string())?;
        writeln!(file, "{record}").map_err(|error| error.to_string())
    }
}

#[tauri::command]
pub async fn report_readiness(
    app: tauri::AppHandle,
    nonce: String,
    session_id: String,
    docs: tauri::State<'_, Arc<Mutex<Documents>>>,
    readiness: tauri::State<'_, Arc<Readiness>>,
) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or("readiness_window_missing")?;
    if !window.is_visible().map_err(|error| error.to_string())?
        || window.is_minimized().map_err(|error| error.to_string())?
    {
        return Err("readiness_window_hidden".into());
    }
    let docs = docs.inner().clone();
    let readiness = readiness.inner().clone();
    crate::worker::blocking_work()
        .run(move || readiness.signal(&docs.lock().unwrap(), &nonce, &session_id))
        .await
        .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn config_value() -> serde_json::Value {
        serde_json::json!({
            "nonce": "0123456789abcdef0123456789abcdef",
            "target": std::env::temp_dir().join("fixture.md"),
            "output": std::env::temp_dir().join("ready.json"),
        })
    }

    #[test]
    fn public_fixture_matches_the_rendered_content_gate() {
        let fixture = include_str!("../fixtures/readiness.md");
        let mut paragraphs = fixture.trim().split("\n\n");
        assert_eq!(paragraphs.next(), Some(format!("# {HEADING}").as_str()));
        let body = paragraphs.next().unwrap();
        assert_eq!(body, BODY);
        assert!(paragraphs.next().is_none());
    }

    #[test]
    fn malformed_configuration_is_rejected() {
        assert!(Config::parse("not JSON").is_err());
        for (key, value) in [
            ("nonce", "short"),
            ("target", "relative.md"),
            ("output", "relative.json"),
        ] {
            let mut config = config_value();
            config[key] = value.into();
            assert!(Config::parse(&config.to_string()).is_err());
        }
        let mut config = config_value();
        config["unexpected"] = true.into();
        assert!(Config::parse(&config.to_string()).is_err());
        let mut config = config_value();
        config["output"] = config["target"].clone();
        assert!(Config::parse(&config.to_string()).is_err());
    }

    #[test]
    fn only_matching_admission_and_nonce_can_signal_once() {
        let mut config = Config::parse(&config_value().to_string()).unwrap();
        config.output = std::env::temp_dir().join(format!(
            "mastermind-ready-{}-{}.json",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let readiness = Readiness {
            config: Some(config.clone()),
            signalled: AtomicBool::new(false),
        };
        let mut docs = Documents::default();
        docs.order.push(config.target.to_str().unwrap().into());
        docs.order.push(
            std::env::temp_dir()
                .join("other.md")
                .to_str()
                .unwrap()
                .into(),
        );
        for (nonce, id) in [
            ("wrong", "0"),
            (&*config.nonce, "1"),
            (&*config.nonce, "invalid"),
        ] {
            assert_eq!(
                readiness.signal(&docs, nonce, id).unwrap_err(),
                "readiness_identity_mismatch"
            );
            assert!(!config.output.exists());
        }
        readiness.signal(&docs, &config.nonce, "0").unwrap();
        let bytes = std::fs::read(&config.output).unwrap();
        let record: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(record["nonce"], config.nonce);
        assert_eq!(record["target"], config.target.to_str().unwrap());
        assert_eq!(record["stage"], "document_layout_two_frames");
        assert_eq!(
            readiness.signal(&docs, &config.nonce, "0").unwrap_err(),
            "readiness_already_signalled"
        );
        assert_eq!(std::fs::read(&config.output).unwrap(), bytes);
        std::fs::remove_file(&config.output).unwrap();
    }

    #[test]
    fn disabled_trace_neither_injects_script_nor_writes_a_signal() {
        let readiness = Readiness {
            config: None,
            signalled: AtomicBool::new(false),
        };
        assert!(readiness.initialization_script().is_none());
        assert_eq!(
            readiness
                .signal(&Documents::default(), "nonce", "0")
                .unwrap_err(),
            "readiness_disabled"
        );
    }
}
