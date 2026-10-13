use crate::reviewer::{read_preferences_file, write_preferences_file};
use mastermind_launch_check::protocol::{Response, SetupRequest, VERSION};
use serde::Serialize;
use serde_json::{Map, Value, json};
use std::{
    collections::{BTreeMap, BTreeSet},
    io::Read,
    path::PathBuf,
    sync::{Arc, Mutex},
};

const FIELDS: [&str; 3] = ["authorTag", "uiLang", "translationLanguage"];
const COMPLETED: &str = "onboardingCompleted";
const MAX_AUTHOR_UTF16_UNITS: usize = 64;
const GIT_NAME_OUTPUT_BYTES: usize = 4096;
const GIT_NAME_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(1);

#[derive(Default)]
struct Transient {
    suggestions: BTreeMap<String, Value>,
    protected: BTreeSet<String>,
    revision: u64,
    git_name: Option<String>,
    ui_default: Option<String>,
}

pub struct Setup {
    path: PathBuf,
    transient: Mutex<Transient>,
}

#[derive(Serialize)]
pub struct Snapshot {
    completed: bool,
    revision: u64,
    values: Map<String, Value>,
    saved: BTreeMap<String, bool>,
    protected: BTreeMap<String, bool>,
}

fn validate(fields: &Map<String, Value>, complete: bool) -> Result<Map<String, Value>, String> {
    if fields.is_empty()
        || fields.keys().any(|key| !FIELDS.contains(&key.as_str()))
        || (complete && fields.len() != FIELDS.len())
    {
        return Err("invalid_setup_fields".into());
    }
    let mut normalized = fields.clone();
    for (key, value) in fields {
        let valid = match key.as_str() {
            "authorTag" => value
                .as_str()
                .is_some_and(|name| usable_name(&normalize_name(name))),
            "uiLang" => matches!(value.as_str(), Some("en" | "zh-CN")),
            "translationLanguage" => value.is_null() || value.as_str().is_some_and(language_code),
            _ => false,
        };
        if !valid {
            return Err(format!("invalid_setup_field:{key}"));
        }
        if key == "authorTag" {
            normalized.insert(key.clone(), normalize_name(value.as_str().unwrap()).into());
        }
    }
    Ok(normalized)
}

fn ecmascript_whitespace(character: char) -> bool {
    matches!(character, '\u{0009}'..='\u{000d}' | '\u{0020}' | '\u{00a0}' | '\u{1680}' |
        '\u{2000}'..='\u{200a}' | '\u{2028}' | '\u{2029}' | '\u{202f}' | '\u{205f}' |
        '\u{3000}' | '\u{feff}')
}

fn normalize_name(name: &str) -> String {
    let trimmed = name.trim_matches(ecmascript_whitespace);
    trimmed
        .strip_prefix('@')
        .unwrap_or(trimmed)
        .trim_matches(ecmascript_whitespace)
        .into()
}

fn forbidden_author_character(character: char) -> bool {
    matches!(
        character,
        ':' | '@' | '{' | '}' | '<' | '>' | '=' | '|' | '\u{2028}' | '\u{2029}'
    ) || character <= '\u{001f}'
}

fn usable_name(name: &str) -> bool {
    !name.trim_matches(ecmascript_whitespace).is_empty()
        && (1..=MAX_AUTHOR_UTF16_UNITS).contains(&name.encode_utf16().count())
        && !name.chars().any(forbidden_author_character)
}

fn git_default_name(raw: &str) -> String {
    let mut name = String::new();
    let mut units = 0;
    for character in normalize_name(raw).chars() {
        let character = if forbidden_author_character(character) {
            '-'
        } else {
            character
        };
        if units + character.len_utf16() > MAX_AUTHOR_UTF16_UNITS {
            break;
        }
        units += character.len_utf16();
        name.push(character);
    }
    let name = name
        .trim_matches(ecmascript_whitespace)
        .trim_matches('-')
        .trim_matches(ecmascript_whitespace);
    if usable_name(name) {
        name.into()
    } else {
        "reviewer".into()
    }
}

fn language_code(code: &str) -> bool {
    let mut bytes = code.bytes();
    bytes.next().is_some_and(|byte| byte.is_ascii_alphabetic())
        && bytes.all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
}

fn git_name() -> String {
    use std::process::{Command, Stdio};
    let mut command = Command::new("git");
    command
        .args(["config", "--global", "--get", "user.name"])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(windows_sys::Win32::System::Threading::CREATE_NO_WINDOW);
    }
    git_name_from(command)
}

fn git_name_from(mut command: std::process::Command) -> String {
    let Ok(mut child) = command.spawn() else {
        return "reviewer".into();
    };
    let deadline = std::time::Instant::now() + GIT_NAME_TIMEOUT;
    loop {
        match child.try_wait() {
            Ok(Some(status)) if status.success() => {
                let mut bytes = Vec::new();
                if child
                    .stdout
                    .take()
                    .unwrap()
                    .take((GIT_NAME_OUTPUT_BYTES + 1) as u64)
                    .read_to_end(&mut bytes)
                    .is_ok()
                    && bytes.len() <= GIT_NAME_OUTPUT_BYTES
                    && let Ok(raw) = String::from_utf8(bytes)
                {
                    return git_default_name(&raw);
                }
                return "reviewer".into();
            }
            Ok(Some(_)) => return "reviewer".into(),
            Ok(None) if std::time::Instant::now() < deadline => {
                std::thread::sleep(std::time::Duration::from_millis(10));
            }
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return "reviewer".into();
            }
        }
    }
}

impl Setup {
    pub fn new(path: PathBuf) -> Self {
        Self {
            path,
            transient: Mutex::new(Transient::default()),
        }
    }

    fn read_raw(&self) -> Result<Option<Value>, String> {
        let raw = read_preferences_file(self.path.clone())?;
        if raw.as_ref().is_some_and(|value| !value.is_object()) {
            return Err("invalid_preferences".into());
        }
        if let Some(object) = raw.as_ref().and_then(Value::as_object) {
            if object
                .get("authorTag")
                .is_some_and(|value| !value.as_str().is_some_and(usable_name))
            {
                return Err("invalid_setup_field:authorTag".into());
            }
            let fields: Map<String, Value> = object
                .iter()
                .filter(|(key, _)| FIELDS.contains(&key.as_str()))
                .map(|(key, value)| (key.clone(), value.clone()))
                .collect();
            if !fields.is_empty() {
                validate(
                    &fields,
                    object.get(COMPLETED).and_then(Value::as_bool) == Some(true),
                )?;
            } else if object.get(COMPLETED).and_then(Value::as_bool) == Some(true) {
                return Err("invalid_setup_fields".into());
            }
            if object
                .get(COMPLETED)
                .is_some_and(|value| !value.is_boolean())
            {
                return Err("invalid_preferences".into());
            }
        }
        Ok(raw)
    }

    pub fn read_preferences(&self) -> Result<Option<Value>, String> {
        let _state = self.transient.lock().unwrap();
        self.read_raw()
    }

    pub fn onboarding_needed(&self) -> Result<bool, String> {
        let _state = self.transient.lock().unwrap();
        Ok(!self
            .read_raw()?
            .as_ref()
            .and_then(|raw| raw.get(COMPLETED))
            .and_then(Value::as_bool)
            .unwrap_or(false))
    }

    fn snapshot_locked(
        &self,
        state: &mut Transient,
        raw: &Map<String, Value>,
        ui_default: Option<&str>,
    ) -> Snapshot {
        if let Some(language) = ui_default {
            state.ui_default = Some(language.into());
        }
        let name = if raw.contains_key("authorTag") || state.suggestions.contains_key("authorTag") {
            "reviewer".into()
        } else {
            state.git_name.get_or_insert_with(git_name).clone()
        };
        let defaults = json!({"authorTag":name,"uiLang":state.ui_default.as_deref().unwrap_or("en"),"translationLanguage":null});
        let values = FIELDS
            .into_iter()
            .map(|key| {
                (
                    key.into(),
                    raw.get(key)
                        .or_else(|| state.suggestions.get(key))
                        .unwrap_or(&defaults[key])
                        .clone(),
                )
            })
            .collect();
        Snapshot {
            completed: raw.get(COMPLETED).and_then(Value::as_bool).unwrap_or(false),
            revision: state.revision,
            values,
            saved: FIELDS
                .into_iter()
                .map(|key| (key.into(), raw.contains_key(key)))
                .collect(),
            protected: FIELDS
                .into_iter()
                .map(|key| (key.into(), state.protected.contains(key)))
                .collect(),
        }
    }

    pub fn snapshot(&self, ui_default: Option<&str>) -> Result<Snapshot, String> {
        if ui_default.is_some_and(|language| !matches!(language, "en" | "zh-CN")) {
            return Err("invalid_ui_language_default".into());
        }
        let mut state = self.transient.lock().unwrap();
        let raw = self.read_raw()?.unwrap_or(json!({}));
        Ok(self.snapshot_locked(&mut state, raw.as_object().unwrap(), ui_default))
    }

    pub fn protect(&self, fields: Vec<String>) -> Result<Snapshot, String> {
        if fields.iter().any(|field| !FIELDS.contains(&field.as_str())) {
            return Err("invalid_setup_fields".into());
        }
        let mut state = self.transient.lock().unwrap();
        let raw = self.read_raw()?.unwrap_or(json!({}));
        let mut changed = false;
        for field in fields {
            changed |= state.protected.insert(field);
        }
        if changed {
            state.revision += 1;
        }
        Ok(self.snapshot_locked(&mut state, raw.as_object().unwrap(), None))
    }

    pub fn suggest(&self, request: SetupRequest) -> Response {
        if request.version != VERSION {
            return Response::error("incompatible_version");
        }
        let fields: Map<String, Value> = request.setup.into_iter().collect();
        let fields = match validate(&fields, false) {
            Ok(fields) => fields,
            Err(error) => return Response::error(&error),
        };
        let mut state = self.transient.lock().unwrap();
        let raw = match self.read_raw() {
            Ok(raw) => raw.unwrap_or(json!({})),
            Err(error) => return Response::error(&error),
        };
        let completed = raw[COMPLETED].as_bool().unwrap_or(false);
        let mut results = BTreeMap::new();
        let mut changed = false;
        for (key, value) in fields {
            let ignored = completed || raw.get(&key).is_some() || state.protected.contains(&key);
            results.insert(
                key.clone(),
                if ignored { "ignored" } else { "accepted" }.into(),
            );
            if !ignored {
                changed |= state.suggestions.get(&key) != Some(&value);
                state.suggestions.insert(key, value);
            }
        }
        if changed {
            state.revision += 1;
        }
        Response {
            version: VERSION,
            pid: std::process::id(),
            onboarding_needed: Some(!completed),
            setup_results: Some(results),
            results: vec![],
            error: None,
        }
    }

    pub fn confirm(&self, values: Value) -> Result<Snapshot, String> {
        let values = validate(values.as_object().ok_or("invalid_setup_fields")?, true)?;
        let mut state = self.transient.lock().unwrap();
        let mut raw = self.read_raw()?.unwrap_or(json!({}));
        let object = raw.as_object_mut().unwrap();
        object.extend(values);
        object.insert(COMPLETED.into(), true.into());
        write_preferences_file(self.path.clone(), raw.clone())?;
        state.revision += 1;
        state.suggestions.clear();
        Ok(self.snapshot_locked(&mut state, raw.as_object().unwrap(), None))
    }

    pub fn patch_preferences(&self, patch: Value) -> Result<(), String> {
        let patch = patch.as_object().ok_or("invalid_preferences")?;
        if patch.contains_key(COMPLETED) {
            return Err("invalid_preferences".into());
        }
        let setup_fields: Map<String, Value> = patch
            .iter()
            .filter(|(key, _)| FIELDS.contains(&key.as_str()))
            .map(|(key, value)| (key.clone(), value.clone()))
            .collect();
        let normalized = if setup_fields.is_empty() {
            Map::new()
        } else {
            validate(&setup_fields, false)?
        };
        let mut state = self.transient.lock().unwrap();
        let mut raw = self.read_raw()?.unwrap_or(json!({}));
        raw.as_object_mut().unwrap().extend(patch.clone());
        raw.as_object_mut().unwrap().extend(normalized);
        write_preferences_file(self.path.clone(), raw)?;
        state.revision += 1;
        Ok(())
    }
}

#[tauri::command]
pub async fn setup_snapshot(
    setup: tauri::State<'_, Arc<Setup>>,
    ui_lang_default: Option<String>,
) -> Result<Snapshot, String> {
    let setup = setup.inner().clone();
    crate::worker::blocking_work()
        .run(move || setup.snapshot(ui_lang_default.as_deref()))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn protect_setup_fields(
    setup: tauri::State<'_, Arc<Setup>>,
    fields: Vec<String>,
) -> Result<Snapshot, String> {
    let setup = setup.inner().clone();
    crate::worker::blocking_work()
        .run(move || setup.protect(fields))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn confirm_setup(
    setup: tauri::State<'_, Arc<Setup>>,
    values: Value,
) -> Result<Snapshot, String> {
    let setup = setup.inner().clone();
    crate::worker::blocking_work()
        .run(move || setup.confirm(values))
        .await
        .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};
    static NEXT: AtomicU64 = AtomicU64::new(0);
    struct Fixture(PathBuf);
    impl Fixture {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!(
                "mastermind-setup-{}-{}",
                std::process::id(),
                NEXT.fetch_add(1, Ordering::SeqCst)
            ));
            std::fs::create_dir_all(&path).unwrap();
            Self(path)
        }
        fn setup(&self) -> Setup {
            let setup = Setup::new(self.0.join("preferences.json"));
            setup.transient.lock().unwrap().git_name = Some("Default name".into());
            setup
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }
    fn suggestions(value: Value) -> SetupRequest {
        SetupRequest {
            version: VERSION,
            setup: serde_json::from_value(value).unwrap(),
        }
    }
    fn values() -> Value {
        json!({"authorTag":" @Reader ","uiLang":"zh-CN","translationLanguage":null})
    }

    #[test]
    fn defaults_suggestions_and_protection_are_transient_and_do_not_write() {
        let fixture = Fixture::new();
        let setup = fixture.setup();
        let snapshot = setup.snapshot(Some("zh-CN")).unwrap();
        assert!(!snapshot.completed);
        assert_eq!(snapshot.values["authorTag"], "Default name");
        assert_eq!(snapshot.values["uiLang"], "zh-CN");
        assert_eq!(snapshot.values["translationLanguage"], Value::Null);
        assert!(snapshot.saved.values().all(|saved| !saved));
        let result = setup.suggest(suggestions(
            json!({"authorTag":"Agent","translationLanguage":"zh-CN"}),
        ));
        assert_eq!(result.setup_results.unwrap()["authorTag"], "accepted");
        let snapshot = setup.protect(vec!["authorTag".into()]).unwrap();
        assert_eq!(snapshot.values["uiLang"], "zh-CN");
        let result = setup.suggest(suggestions(
            json!({"authorTag":"Replacement","uiLang":"en"}),
        ));
        assert_eq!(result.setup_results.unwrap()["authorTag"], "ignored");
        assert_eq!(setup.snapshot(None).unwrap().values["authorTag"], "Agent");
        assert!(!setup.path.exists());
        let fresh = fixture.setup().snapshot(None).unwrap();
        assert_eq!(fresh.values["authorTag"], "Default name");
        assert!(!fresh.protected["authorTag"]);
    }

    #[test]
    fn saved_fields_win_including_explicit_original_only_without_saving_defaults() {
        let fixture = Fixture::new();
        let setup = fixture.setup();
        setup
            .patch_preferences(json!({"translationLanguage":null,"theme":"serif"}))
            .unwrap();
        let response = setup.suggest(suggestions(
            json!({"authorTag":"Agent","translationLanguage":"zh-CN"}),
        ));
        let results = response.setup_results.unwrap();
        assert_eq!(results["authorTag"], "accepted");
        assert_eq!(results["translationLanguage"], "ignored");
        let snapshot = setup.snapshot(None).unwrap();
        assert!(snapshot.saved["translationLanguage"]);
        assert!(!snapshot.saved["authorTag"]);
        let raw = setup.read_preferences().unwrap().unwrap();
        assert_eq!(raw, json!({"theme":"serif","translationLanguage":null}));
        assert!(setup.onboarding_needed().unwrap());
    }

    #[test]
    fn malformed_suggestions_are_rejected_as_a_whole() {
        let fixture = Fixture::new();
        let setup = fixture.setup();
        for invalid in [
            json!({"authorTag":"Accepted?","uiLang":null}),
            json!({"authorTag":null}),
            json!({"authorTag":" "}),
            json!({"unknown":"value"}),
            json!({"translationLanguage":"bad code"}),
        ] {
            assert!(setup.suggest(suggestions(invalid)).error.is_some());
            assert_eq!(setup.snapshot(None).unwrap().revision, 0);
            assert!(setup.transient.lock().unwrap().suggestions.is_empty());
        }
        assert!(setup.confirm(json!({"authorTag":"Reader"})).is_err());
        assert!(setup.protect(vec!["unknown".into()]).is_err());
        assert!(setup.snapshot(Some("fr")).is_err());
        assert!(!setup.path.exists());
    }

    #[test]
    fn confirmation_saves_one_complete_record_and_restart_retains_completion() {
        let fixture = Fixture::new();
        let setup = fixture.setup();
        setup.patch_preferences(json!({"fontSize":20})).unwrap();
        let snapshot = setup.confirm(values()).unwrap();
        assert!(snapshot.completed);
        assert!(snapshot.saved.values().all(|saved| *saved));
        assert_eq!(snapshot.values["authorTag"], "Reader");
        assert_eq!(
            setup.read_preferences().unwrap().unwrap(),
            json!({"fontSize":20,"authorTag":"Reader","uiLang":"zh-CN","translationLanguage":null,"onboardingCompleted":true})
        );
        let fresh = fixture.setup();
        assert!(!fresh.onboarding_needed().unwrap());
        let response = fresh.suggest(suggestions(
            json!({"authorTag":"Agent","uiLang":"en","translationLanguage":"fr"}),
        ));
        assert!(
            response
                .setup_results
                .unwrap()
                .values()
                .all(|status| status == "ignored")
        );
        assert_eq!(fresh.snapshot(None).unwrap().values["authorTag"], "Reader");
        fresh.patch_preferences(json!({"uiLang":"en"})).unwrap();
        assert!(!fresh.onboarding_needed().unwrap());
        assert!(
            fresh
                .patch_preferences(json!({"onboardingCompleted":false}))
                .is_err()
        );
    }

    #[test]
    fn failed_confirmation_retains_suggestions_protection_and_retries() {
        let fixture = Fixture::new();
        let setup = fixture.setup();
        setup.suggest(suggestions(json!({"authorTag":"Agent"})));
        setup.protect(vec!["authorTag".into()]).unwrap();
        let before = setup.snapshot(None).unwrap().revision;
        let temporary = setup.path.with_extension("json.tmp");
        std::fs::create_dir(&temporary).unwrap();
        assert!(setup.confirm(values()).is_err());
        let snapshot = setup.snapshot(None).unwrap();
        assert_eq!(snapshot.revision, before);
        assert!(!snapshot.completed);
        assert_eq!(snapshot.values["authorTag"], "Agent");
        assert!(snapshot.protected["authorTag"]);
        assert!(!setup.path.exists());
        std::fs::remove_dir(temporary).unwrap();
        assert!(setup.confirm(values()).unwrap().completed);
    }

    #[test]
    fn unreadable_or_invalid_preferences_are_not_overwritten() {
        let fixture = Fixture::new();
        let setup = fixture.setup();
        std::fs::write(&setup.path, b"not JSON").unwrap();
        assert!(setup.snapshot(None).is_err());
        assert!(setup.onboarding_needed().is_err());
        assert!(setup.confirm(values()).is_err());
        assert!(setup.patch_preferences(json!({"theme":"grid"})).is_err());
        assert!(
            setup
                .suggest(suggestions(json!({"authorTag":"Agent"})))
                .error
                .is_some()
        );
        assert_eq!(std::fs::read(&setup.path).unwrap(), b"not JSON");
    }

    #[test]
    fn invalid_saved_choices_and_incomplete_completion_are_recoverable_errors() {
        let fixture = Fixture::new();
        let setup = fixture.setup();
        for invalid in [
            json!({"authorTag":null}),
            json!({"authorTag":" "}),
            json!({"authorTag":"@Reader"}),
            json!({"uiLang":"unsupported"}),
            json!({"translationLanguage":false}),
            json!({"onboardingCompleted":"true"}),
            json!({"onboardingCompleted":true}),
            json!({"onboardingCompleted":true,"authorTag":"Reader","uiLang":"en"}),
        ] {
            let bytes = serde_json::to_vec(&invalid).unwrap();
            std::fs::write(&setup.path, &bytes).unwrap();
            assert!(setup.snapshot(None).is_err());
            assert!(setup.confirm(values()).is_err());
            assert_eq!(std::fs::read(&setup.path).unwrap(), bytes);
        }
        std::fs::remove_file(&setup.path).unwrap();
        assert!(setup.suggest(suggestions(json!({}))).error.is_some());
        assert!(!setup.path.exists());
    }

    #[test]
    fn protecting_multiple_fields_does_not_short_circuit() {
        let fixture = Fixture::new();
        let setup = fixture.setup();
        let snapshot = setup
            .protect(FIELDS.into_iter().map(str::to_owned).collect())
            .unwrap();
        assert!(snapshot.protected.values().all(|protected| *protected));
        let before = snapshot.revision;
        assert_eq!(
            setup
                .protect(FIELDS.into_iter().map(str::to_owned).collect())
                .unwrap()
                .revision,
            before
        );
        assert!(
            setup
                .suggest(suggestions(values()))
                .setup_results
                .unwrap()
                .values()
                .all(|status| status == "ignored")
        );
    }

    #[test]
    fn names_follow_the_critic_author_contract_in_utf16_units() {
        let fixture = Fixture::new();
        let setup = fixture.setup();
        for name in ["中文 Reader".into(), "中".repeat(64), "😀".repeat(32)] {
            let normalized = validate(
                &serde_json::from_value(json!({"authorTag":name})).unwrap(),
                false,
            )
            .unwrap();
            assert_eq!(normalized["authorTag"], name);
        }
        for name in [
            "a:b".into(),
            "a@b".into(),
            "a{b".into(),
            "a}b".into(),
            "a<b".into(),
            "a>b".into(),
            "a=b".into(),
            "a|b".into(),
            "a\u{0000}b".into(),
            "a\u{001f}b".into(),
            "a\u{2028}b".into(),
            "a\u{2029}b".into(),
            "中".repeat(65),
            "😀".repeat(33),
        ] {
            assert!(
                setup
                    .suggest(suggestions(json!({"authorTag":name})))
                    .error
                    .is_some()
            );
            assert!(!setup.path.exists());
        }
        assert_eq!(
            git_default_name(" 中文 Reader@Company "),
            "中文 Reader-Company"
        );
        assert_eq!(git_default_name(&"😀".repeat(33)), "😀".repeat(32));
        assert_eq!(git_default_name("@:|"), "reviewer");
        assert_eq!(normalize_name("\u{feff} @中文 \u{feff}"), "中文");
        assert_eq!(
            normalize_name("\u{0085}Reader\u{0085}"),
            "\u{0085}Reader\u{0085}"
        );
        assert!(
            setup
                .suggest(suggestions(json!({"authorTag":"\u{feff}"})))
                .error
                .is_some()
        );
    }

    #[test]
    fn concurrent_setting_patches_preserve_each_other_without_saving_defaults() {
        let fixture = Fixture::new();
        let setup = Arc::new(fixture.setup());
        std::thread::scope(|scope| {
            for patch in [
                json!({"theme":"paper"}),
                json!({"uiLang":"zh-CN"}),
                json!({"fontSize":18}),
            ] {
                let setup = setup.clone();
                scope.spawn(move || setup.patch_preferences(patch).unwrap());
            }
        });
        assert_eq!(
            setup.read_preferences().unwrap().unwrap(),
            json!({"theme":"paper","uiLang":"zh-CN","fontSize":18})
        );
        let snapshot = setup.snapshot(None).unwrap();
        assert!(!snapshot.saved["authorTag"]);
        assert!(!snapshot.saved["translationLanguage"]);
        assert!(snapshot.saved["uiLang"]);
        assert!(!snapshot.completed);
    }

    #[test]
    fn global_git_default_ignores_repository_name() {
        use std::process::{Command, Stdio};
        let fixture = Fixture::new();
        let global = fixture.0.join("global.gitconfig");
        std::fs::write(&global, "[user]\n name = Global Reader\n").unwrap();
        std::fs::create_dir(fixture.0.join(".git")).unwrap();
        std::fs::write(
            fixture.0.join(".git/config"),
            "[user]\n name = Repository Reader\n",
        )
        .unwrap();
        let mut command = Command::new("git");
        command
            .args(["config", "--global", "--get", "user.name"])
            .current_dir(&fixture.0)
            .env("GIT_CONFIG_GLOBAL", global)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        assert_eq!(git_name_from(command), "Global Reader");
        assert_eq!(normalize_name(" @中文 Reader "), "中文 Reader");
    }
}
