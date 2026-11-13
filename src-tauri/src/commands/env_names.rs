// ==============================================================
// The names in a project's environment file, never its values
//
// A model writing an example settings file, wiring a setting into code, or
// explaining what is missing needs to know which settings a project's .env
// file sets, not what they are set to. Reading the file would hand it every
// key in it. So the file is read here, in Rust, and only the names go back,
// each with whether it is empty: the page never holds a value either.
//
// Only a file named like an environment file is read (.env, .env.local,
// production.env and the like), inside the open project, through the same
// folder boundary as every other file the agent reaches.
//
// JS call: invoke("env_names", { path }) -> [{ name, empty }].
// Called only by HC.code's env_names tool (platform/tauri/hashcoder.js).
// ==============================================================

use serde::Serialize;

/// The most names given back, and the largest file read.
const MOST_NAMES: usize = 200;
const MOST_BYTES: u64 = 256 * 1024;

#[derive(Serialize, Debug, PartialEq)]
pub struct EnvName {
    name: String,
    empty: bool,
}

/// Whether a file's name is that of an environment file.
pub fn is_env_file(path: &str) -> bool {
    let name = std::path::Path::new(path)
        .file_name()
        .map(|n| n.to_string_lossy().to_ascii_lowercase())
        .unwrap_or_default();
    name == ".env" || name.starts_with(".env.") || (name.ends_with(".env") && name.len() > 4)
}

/// The names an environment file sets, in order, each once, with whether its value is empty.
pub fn names_in(text: &str) -> Vec<EnvName> {
    let mut out: Vec<EnvName> = Vec::new();
    for raw in text.lines() {
        let line = raw.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let line = line.strip_prefix("export ").unwrap_or(line).trim_start();
        let Some((name, value)) = line.split_once('=') else {
            continue;
        };
        let name = name.trim();
        let ok = name
            .chars()
            .next()
            .is_some_and(|c| c.is_ascii_alphabetic() || c == '_')
            && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
            && name.len() <= 128;
        if !ok || out.iter().any(|n| n.name == name) {
            continue;
        }
        let v = value.split(" #").next().unwrap_or("").trim();
        let empty = v.is_empty() || v == "\"\"" || v == "''";
        out.push(EnvName {
            name: name.to_string(),
            empty,
        });
        if out.len() >= MOST_NAMES {
            break;
        }
    }
    out
}

#[tauri::command]
pub fn env_names(path: String) -> Result<Vec<EnvName>, String> {
    if !is_env_file(&path) {
        return Err(format!("{path} is not an environment file: only files named like .env are read for their names."));
    }
    crate::commands::fs::guard_agent_path(&path)?;
    let meta = std::fs::metadata(&path).map_err(|_| format!("There is no file at {path}."))?;
    if meta.len() > MOST_BYTES {
        return Err(format!(
            "{path} is larger than an environment file is, and was not read."
        ));
    }
    let text = std::fs::read_to_string(&path)
        .map_err(|_| format!("{path} is not text, and was not read."))?;
    Ok(names_in(&text))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn n(name: &str, empty: bool) -> EnvName {
        EnvName {
            name: name.to_string(),
            empty,
        }
    }

    #[test]
    fn gives_the_names_and_never_a_value() {
        let text = "# settings\nSHOP_TOKEN=abc123\nexport DATABASE_URL=\"postgres://x\"\nEMPTY=\nQUOTED=\"\"\n  SPACED = value # a note\nSHOP_TOKEN=again\nnot a line\n1BAD=x\n";
        let out = names_in(text);
        assert_eq!(
            out,
            vec![
                n("SHOP_TOKEN", false),
                n("DATABASE_URL", false),
                n("EMPTY", true),
                n("QUOTED", true),
                n("SPACED", false)
            ]
        );
        let shown = format!("{out:?}");
        for value in ["abc123", "postgres", "value", "again"] {
            assert!(
                !shown.contains(value),
                "a value reached the answer: {value}"
            );
        }
    }

    #[test]
    fn only_environment_files_are_read() {
        for yes in [
            ".env",
            "/p/.env",
            "/p/.env.local",
            "/p/config/production.env",
        ] {
            assert!(is_env_file(yes), "{yes}");
        }
        for no in [
            "/p/config.json",
            "/p/.envrc",
            "/p/env",
            "/p/notes.txt",
            "/p/.env/x",
        ] {
            assert!(!is_env_file(no), "{no}");
        }
    }
}
