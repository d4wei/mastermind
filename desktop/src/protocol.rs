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
    /// The reading language to select once among prepared translations, as `translations.md` says.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub language: Option<String>,
    /// The language the documents are written in, for rendering only, as `protocol.md` says.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub document_language: Option<String>,
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

/// Whether `tag` is a well-formed BCP 47 language tag of the form a renderer's
/// `Intl.getCanonicalLocales` also accepts: a 2–3 or 5–8 letter language, then an optional script,
/// region, variants, extensions, and private use. Extended language subtags and the grandfathered
/// irregular tags are refused, since the renderer would ignore them.
pub fn language_tag(tag: &str) -> bool {
    if tag.is_empty() || tag.len() > 64 {
        return false;
    }
    let alpha = |s: &str| s.bytes().all(|b| b.is_ascii_alphabetic());
    let digits = |s: &str| s.bytes().all(|b| b.is_ascii_digit());
    if tag
        .split('-')
        .any(|s| s.is_empty() || s.len() > 8 || !s.bytes().all(|b| b.is_ascii_alphanumeric()))
    {
        return false;
    }
    let mut rest = tag.split('-').peekable();
    let language = rest.next().unwrap_or_default();
    if !(alpha(language) && matches!(language.len(), 2..=3 | 5..=8)) {
        return false;
    }
    rest.next_if(|s| s.len() == 4 && alpha(s));
    rest.next_if(|s| (s.len() == 2 && alpha(s)) || (s.len() == 3 && digits(s)));
    while rest
        .next_if(|s| s.len() >= 5 || (s.len() == 4 && s.as_bytes()[0].is_ascii_digit()))
        .is_some()
    {}
    while rest
        .next_if(|s| s.len() == 1 && !s.eq_ignore_ascii_case("x"))
        .is_some()
    {
        if rest.next_if(|s| s.len() >= 2).is_none() {
            return false;
        }
        while rest.next_if(|s| s.len() >= 2).is_some() {}
    }
    match rest.next() {
        None => true,
        Some(x) if x.eq_ignore_ascii_case("x") => rest.next().is_some(),
        Some(_) => false,
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
    fn language_tags_are_well_formed_bcp47() {
        for tag in [
            "ja",
            "zh-TW",
            "zh-Hant-HK",
            "ko-KR",
            "es-419",
            "de-CH-1996",
            "sl-rozaj-biske",
            "en-u-ca-gregory",
            "en-x-private",
            "haw",
        ] {
            assert!(language_tag(tag), "{tag}");
        }
        for tag in [
            "",
            "e",
            "en_US",
            "zh--TW",
            "zh-",
            "-zh",
            "x-private",
            "zh-yue",
            "en-u",
            "en-x",
            "en-US-u",
            "toolongtag",
            "ja-JP-x-abcdefghi",
            "../fr",
            "zh TW",
        ] {
            assert!(!language_tag(tag), "{tag}");
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
