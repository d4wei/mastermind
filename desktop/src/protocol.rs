use serde::{Deserialize, Serialize};

pub const VERSION: u32 = 1;
pub const MAX_FRAME: usize = 64 * 1024;
pub const MAX_FILES: usize = 64;
/// Replies echo each requested path beside its canonical target and message, so the launcher
/// reads them under a larger bound than requests.
pub const MAX_REPLY_FRAME: usize = MAX_FILES * MAX_FRAME;

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Request {
    pub version: u32,
    pub paths: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub language: Option<String>,
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct SetupRequest {
    pub version: u32,
    pub setup: std::collections::BTreeMap<String, serde_json::Value>,
}

/// Asks the reader to close the admitted documents these paths name, as `protocol.md` describes.
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct CloseRequest {
    pub version: u32,
    pub close: Vec<String>,
}

#[derive(Deserialize, Serialize)]
#[serde(untagged)]
pub enum Operation {
    Open(Request),
    Setup(SetupRequest),
    Close(CloseRequest),
}

#[derive(Deserialize, Serialize, Debug)]
pub struct FileResult {
    pub path: String,
    pub canonical: Option<String>,
    pub status: String,
    pub error: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    /// Why a close is `blocked`; absent for every other status.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
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

/// The launcher's exit status for a reply: two for a request-level error, one when any file failed
/// or a close was blocked, zero otherwise.
pub fn exit_status(response: &Response) -> i32 {
    if response.error.is_some() {
        2
    } else if response
        .results
        .iter()
        .any(|result| matches!(result.status.as_str(), "error" | "blocked"))
    {
        1
    } else {
        0
    }
}

pub fn language_code(code: &str) -> bool {
    let mut bytes = code.bytes();
    !code.is_empty()
        && code.len() <= 64
        && bytes.next().is_some_and(|byte| byte.is_ascii_alphabetic())
        && bytes.all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
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
                serde_json::json!({"version":VERSION,"setup":{"uiLang":"en"}})
            )
            .unwrap(),
            Operation::Setup(_)
        ));
        let Operation::Close(close) = serde_json::from_value::<Operation>(
            serde_json::json!({"version":VERSION,"close":["/document.md"]}),
        )
        .unwrap() else {
            panic!("expected close");
        };
        assert_eq!(close.close, ["/document.md"]);
        for invalid in [
            serde_json::json!({"version":VERSION,"paths":[],"setup":{}}),
            serde_json::json!({"version":VERSION,"setup":{},"extra":true}),
            serde_json::json!({"version":VERSION,"close":[],"paths":[]}),
            serde_json::json!({"version":VERSION,"close":[],"force":true}),
            serde_json::json!({"close":["/document.md"]}),
        ] {
            assert!(serde_json::from_value::<Operation>(invalid).is_err());
        }
    }

    #[test]
    fn exit_status_counts_blocked_closes_as_failures() {
        let result = |status: &str| FileResult {
            path: "/document.md".into(),
            canonical: None,
            status: status.into(),
            error: None,
            message: None,
            reason: (status == "blocked").then(|| "unsaved_edits".into()),
        };
        let reply = |statuses: &[&str]| Response {
            results: statuses.iter().map(|status| result(status)).collect(),
            error: None,
            ..Response::error("")
        };
        assert_eq!(exit_status(&reply(&["closed", "not_open"])), 0);
        assert_eq!(exit_status(&reply(&["opened", "already_open"])), 0);
        assert_eq!(exit_status(&reply(&["closed", "blocked"])), 1);
        assert_eq!(exit_status(&reply(&["error", "closed"])), 1);
        assert_eq!(exit_status(&Response::error("host_not_running")), 2);
        let blocked = serde_json::to_value(result("blocked")).unwrap();
        assert_eq!(blocked["reason"], "unsaved_edits");
        assert!(
            serde_json::to_value(result("closed"))
                .unwrap()
                .get("reason")
                .is_none()
        );
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
