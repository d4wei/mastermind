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

#[derive(Deserialize, Serialize, Debug)]
pub struct FileResult {
    pub path: String,
    pub canonical: Option<String>,
    pub status: String,
    pub error: Option<String>,
}

#[derive(Deserialize, Serialize, Debug)]
pub struct Response {
    pub version: u32,
    pub pid: u32,
    pub onboarding_needed: bool,
    pub results: Vec<FileResult>,
    pub error: Option<String>,
}

impl Response {
    pub fn error(error: &str) -> Self {
        Self {
            version: VERSION,
            pid: std::process::id(),
            onboarding_needed: true,
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
                "onboarding_needed": true,
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
