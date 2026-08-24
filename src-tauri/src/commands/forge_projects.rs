// ==============================================================
// Saved Forge projects
//
// A person's saved models live at:
//   ~/.hashcortx/forge/projects.json
//
// JS calls:
//   invoke("forge_projects_read")           → String  ("" when nothing saved)
//   invoke("forge_projects_write", { content })
//
// WHY THIS IS A FILE AND NOT localStorage
// ---------------------------------------
// They were in the renderer's localStorage, which is the wrong home for
// anything a person would be upset to lose. It has a quota, the quota is not
// large, and a plan holding a few hundred parts is not small — so a full store
// fails the write. Worse, the failure was caught and thrown away, so the app
// said the project was saved and it was not. localStorage also lives in the
// WebKit data directory, which is keyed to the bundle identifier and cleared
// by anything that clears website data.
//
// A file in the user's own home directory has none of those properties: no
// quota to exhaust, nothing that treats it as a browser cache, and a failure
// that can be reported rather than guessed at.
//
// WHY IT IS A COMMAND AND NOT `fs_write_file`
// -------------------------------------------
// `~/.hashcortx` is in the filesystem denylist, so `fs_write_file` refuses it
// and so does the shell. That is deliberate — it keeps the coding agent out of
// the audit log and out of the undo history — and a person's saved models
// belong on the same side of that line. These commands take no caller-supplied
// path, so there is nothing here to point somewhere else.
//
// WHY THE CONTENT IS A STRING
// ---------------------------
// The renderer already holds the exact JSON it means to keep. Parsing it into a
// value here and serialising it back could only change it. It IS checked for
// being a JSON array before it is stored, so a corrupt write cannot replace a
// good file with something that will not load.
// ==============================================================

use std::fs;
use std::path::{Path, PathBuf};

/// The largest store that will be written.
///
/// Generous: the panel keeps a bounded number of projects and a plan is text.
/// This exists so a runaway caller cannot fill a person's disk, not to be a
/// budget anyone is expected to meet. Refusing loudly at a limit is the whole
/// point — the behaviour being replaced was a silent failure.
const MAX_STORE_BYTES: usize = 16_000_000;

fn store_dir_in(home: &Path) -> PathBuf {
    home.join(".hashcortx").join("forge")
}

fn store_dir() -> PathBuf {
    store_dir_in(&dirs::home_dir().unwrap_or_else(|| PathBuf::from(".")))
}

fn store_path() -> PathBuf {
    store_dir().join("projects.json")
}

/// Everything saved, as the renderer wrote it.
///
/// An empty string means "nothing is saved here", which is a different answer
/// from an error and the caller treats it differently: nothing saved is an
/// ordinary first run, while an error means a store may exist and could not be
/// read, and overwriting it would destroy it.
#[tauri::command]
pub fn forge_projects_read() -> Result<String, String> {
    read_from(&store_path())
}

/// Split from the command so the round trip can be exercised against a real
/// directory in a test, rather than against whatever this machine happens to
/// have in its home folder.
fn read_from(path: &Path) -> Result<String, String> {
    match fs::read_to_string(path) {
        Ok(text) => Ok(text),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(String::new()),
        Err(e) => Err(format!("saved projects could not be read: {e}")),
    }
}

/// Replace the store, or say why it could not be replaced.
///
/// Written atomically — a temporary file beside it, then a rename over the top
/// — so a crash or a full disk mid-write leaves the previous store intact. A
/// half-written projects file is indistinguishable from a corrupt one, and it
/// would take every saved model with it.
#[tauri::command]
pub fn forge_projects_write(content: String) -> Result<(), String> {
    write_to(&store_dir(), content)
}

/// Split from the command for the same reason as `read_from`.
fn write_to(dir: &Path, content: String) -> Result<(), String> {
    if content.len() > MAX_STORE_BYTES {
        return Err(format!(
            "saved projects are too large to write ({} bytes, limit {MAX_STORE_BYTES})",
            content.len()
        ));
    }
    // A store that is not a list is not a store. Checked before anything is
    // touched, so a bad write cannot replace a good file.
    match serde_json::from_str::<serde_json::Value>(&content) {
        Ok(serde_json::Value::Array(_)) => {}
        Ok(_) => return Err("saved projects must be a list".to_string()),
        Err(e) => return Err(format!("saved projects are not valid JSON: {e}")),
    }

    fs::create_dir_all(dir).map_err(|e| format!("the projects folder could not be made: {e}"))?;

    let tmp = dir.join(format!(".projects.{}.tmp", std::process::id()));
    fs::write(&tmp, content.as_bytes())
        .map_err(|e| format!("saved projects could not be written: {e}"))?;
    fs::rename(&tmp, dir.join("projects.json")).map_err(|e| {
        // Leaving the temporary file behind after a failed rename would grow a
        // litter of them in the user's home directory, one per attempt.
        let _ = fs::remove_file(&tmp);
        format!("saved projects could not be put in place: {e}")
    })?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("hashcortx-forge-projects-{name}"));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn the_store_sits_in_the_apps_own_folder_and_not_somewhere_a_caller_chose() {
        let home = scratch("location");
        let dir = store_dir_in(&home);
        assert!(dir.starts_with(&home));
        assert!(dir.ends_with("forge"));
        assert!(dir.parent().unwrap().ends_with(".hashcortx"));
    }

    #[test]
    fn nothing_saved_yet_reads_as_nothing_rather_than_as_a_failure() {
        // The difference the renderer depends on: nothing found is a first
        // run, an error means a store may exist and must not be written over.
        let home = scratch("empty");
        assert_eq!(read_from(&store_dir_in(&home).join("projects.json")).unwrap(), "");
    }

    #[test]
    fn what_goes_in_comes_back_out_byte_for_byte() {
        let dir = scratch("roundtrip").join("store");
        let written = r#"[{"id":"p1","name":"A saved model","plan":{"nodes":[{"id":"a"}]}}]"#;
        write_to(&dir, written.to_string()).unwrap();
        assert_eq!(read_from(&dir.join("projects.json")).unwrap(), written);

        // And replacing it leaves one file, not a growing pile of attempts.
        write_to(&dir, "[]".to_string()).unwrap();
        assert_eq!(read_from(&dir.join("projects.json")).unwrap(), "[]");
        let left: Vec<_> = fs::read_dir(&dir).unwrap().map(|e| e.unwrap().file_name()).collect();
        assert_eq!(left.len(), 1, "one file expected, found {left:?}");
    }

    #[test]
    fn something_that_is_not_a_list_is_refused_and_the_old_store_survives_it() {
        let dir = scratch("refusal").join("store");
        let good = r#"[{"id":"keep","plan":{"nodes":[]}}]"#;
        write_to(&dir, good.to_string()).unwrap();

        assert!(write_to(&dir, "{\"a\":1}".to_string()).is_err());
        assert!(write_to(&dir, "not json at all".to_string()).is_err());
        let huge = format!("[\"{}\"]", "x".repeat(MAX_STORE_BYTES));
        assert!(write_to(&dir, huge).unwrap_err().contains("too large"));

        // The whole reason the content is judged before anything is touched.
        assert_eq!(read_from(&dir.join("projects.json")).unwrap(), good);
        let left: Vec<_> = fs::read_dir(&dir).unwrap().map(|e| e.unwrap().file_name()).collect();
        assert_eq!(left.len(), 1, "a refused write left something behind: {left:?}");
    }
}
