use serde::{Deserialize, Serialize};

pub const VERSION: u32 = 1;
pub const MAX_FRAME: usize = 64 * 1024;
pub const MAX_FILES: usize = 64;

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Request {
    pub version: u32,
    pub paths: Vec<String>,
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct SetupRequest {
    pub version: u32,
    pub setup: std::collections::BTreeMap<String, serde_json::Value>,
}

#[derive(Deserialize, Serialize)]
#[serde(untagged)]
pub enum Operation {
    Open(Request),
    Setup(SetupRequest),
}

#[derive(Deserialize, Serialize, Debug)]
pub struct FileResult {
    pub path: String,
    pub canonical: Option<String>,
    pub status: String,
    pub error: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

#[derive(Deserialize, Serialize, Debug)]
pub struct Response {
    pub version: u32,
    pub pid: u32,
    pub onboarding_needed: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub setup_results: Option<std::collections::BTreeMap<String, String>>,
    pub results: Vec<FileResult>,
    pub error: Option<String>,
}

impl Response {
    pub fn error(error: &str) -> Self {
        Self {
            version: VERSION,
            pid: std::process::id(),
            onboarding_needed: None,
            setup_results: None,
            results: vec![],
            error: Some(error.into()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unknown_outcome_has_the_shared_response_envelope() {
        let response = Response::error("outcome_unknown");
        assert_eq!(
            serde_json::to_value(&response).unwrap(),
            serde_json::json!({
                "version": VERSION,
                "pid": std::process::id(),
                "onboarding_needed": null,
                "results": [],
                "error": "outcome_unknown"
            })
        );
        let decoded: Response =
            serde_json::from_str(&serde_json::to_string(&response).unwrap()).unwrap();
        assert_eq!(decoded.version, VERSION);
        assert_eq!(decoded.error.as_deref(), Some("outcome_unknown"));
    }

    #[test]
    fn operations_have_exclusive_strict_envelopes() {
        assert!(matches!(
            serde_json::from_value::<Operation>(
                serde_json::json!({"version":VERSION,"paths":["/document.md"]})
            )
            .unwrap(),
            Operation::Open(_)
        ));
        assert!(matches!(
            serde_json::from_value::<Operation>(
                serde_json::json!({"version":VERSION,"setup":{"translationLanguage":null}})
            )
            .unwrap(),
            Operation::Setup(_)
        ));
        for invalid in [
            serde_json::json!({"version":VERSION,"paths":[],"setup":{}}),
            serde_json::json!({"version":VERSION,"setup":{},"extra":true}),
        ] {
            assert!(serde_json::from_value::<Operation>(invalid).is_err());
        }
    }

    #[test]
    fn request_decoder_rejects_unknown_fields() {
        assert!(
            serde_json::from_value::<Request>(serde_json::json!({
                "version": VERSION,
                "paths": ["/document.md"],
                "unexpected": true
            }))
            .is_err()
        );
    }
}
