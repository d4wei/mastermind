use crate::files::{self, FileError};
use mastermind_launch_check::protocol::language_code;
use serde_json::Value;
use std::{
    fs,
    path::{Path, PathBuf},
};

const MAX_TRANSLATIONS: usize = 64;
const MAX_TOTAL_BYTES: usize = 32 * 1024 * 1024;

pub fn watch_paths(source: &Path) -> Vec<PathBuf> {
    let parent = source.parent().unwrap();
    let mut paths = vec![parent.to_owned()];
    for suffix in [".mastermind", ".mastermind/translations"] {
        let candidate = parent.join(suffix);
        if fs::canonicalize(&candidate).ok().as_ref() == Some(&candidate) && candidate.is_dir() {
            paths.push(candidate);
        }
    }
    paths
}

fn directory(source: &Path) -> Result<PathBuf, FileError> {
    let path = source.parent().unwrap().join(".mastermind/translations");
    if fs::canonicalize(&path)? != path {
        return Err(FileError::new(
            400,
            "invalid_translation_path",
            "Translation directories must not redirect outside their location.",
        ));
    }
    Ok(path)
}

/// Reads one artifact from the canonical `directory` and returns it with its size on disk.
fn read(directory: &Path, source: &Path, language: &str) -> Result<(Value, usize), FileError> {
    if !language_code(language) {
        return Err(FileError::new(
            400,
            "invalid_language",
            "The translation language is invalid.",
        ));
    }
    let path = directory.join(format!(
        "{}.{}.json",
        source.file_name().unwrap().to_string_lossy(),
        language
    ));
    if fs::canonicalize(&path)? != path {
        return Err(FileError::new(
            400,
            "invalid_translation_path",
            "Translation files must not be symbolic links.",
        ));
    }
    let raw = files::read(&path, None)?;
    let value: Value = serde_json::from_str(&raw.content()).map_err(|_| {
        FileError::new(
            409,
            "invalid_translation",
            "The translation is not valid JSON.",
        )
    })?;
    if value["targetLang"].as_str() != Some(language) {
        return Err(FileError::new(
            409,
            "invalid_translation",
            "The translation language does not match its filename.",
        ));
    }
    Ok((value, raw.bytes.len()))
}

pub fn list(source: &Path) -> Result<Vec<Value>, FileError> {
    let dir = match directory(source) {
        Ok(dir) => dir,
        Err(error) if error.status == 404 => return Ok(vec![]),
        Err(error) => return Err(error),
    };
    let prefix = format!("{}.", source.file_name().unwrap().to_string_lossy());
    let mut languages = Vec::new();
    for entry in fs::read_dir(&dir)? {
        let Ok(entry) = entry else { continue };
        let name = entry.file_name();
        let Some(name) = name.to_str() else { continue };
        if let Some(language) = name
            .strip_prefix(&prefix)
            .and_then(|s| s.strip_suffix(".json"))
            && language_code(language)
        {
            languages.push(language.to_owned());
        }
    }
    languages.sort();
    let mut bytes = 0;
    let mut artifacts = Vec::new();
    for language in languages {
        if let Ok((value, size)) = read(&dir, source, &language) {
            bytes += size;
            if bytes > MAX_TOTAL_BYTES || artifacts.len() == MAX_TRANSLATIONS {
                break;
            }
            artifacts.push(value);
        }
    }
    Ok(artifacts)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn discovers_independent_languages_and_directory_creation() {
        let root = crate::test_support::TempDir::new("translations");
        let root = root.path();
        let source = root.join("doc.md");
        assert!(list(&source).unwrap().is_empty());
        assert_eq!(watch_paths(&source), [root]);
        let dir = root.join(".mastermind/translations");
        fs::create_dir_all(&dir).unwrap();
        assert_eq!(watch_paths(&source).len(), 3);
        for language in ["fr", "zh-CN"] {
            fs::write(
                dir.join(format!("doc.md.{language}.json")),
                format!(r#"{{"targetLang":"{language}"}}"#),
            )
            .unwrap();
        }
        fs::write(dir.join("doc.md.ja.json"), "malformed").unwrap();
        fs::write(dir.join("doc.md.de.json"), r#"{"targetLang":"en"}"#).unwrap();
        fs::write(dir.join("other.md.it.json"), r#"{"targetLang":"it"}"#).unwrap();
        assert_eq!(list(&source).unwrap().len(), 2);
        fs::write(
            dir.join("replacement"),
            r#"{"targetLang":"fr","replacement":true}"#,
        )
        .unwrap();
        fs::rename(dir.join("replacement"), dir.join("doc.md.fr.json")).unwrap();
        assert_eq!(read(&dir, &source, "fr").unwrap().0["replacement"], true);
        assert!(read(&dir, &source, "../fr").is_err());
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(dir.join("doc.md.fr.json"), dir.join("doc.md.it.json"))
                .unwrap();
            assert!(read(&dir, &source, "it").is_err());
        }
    }
}
