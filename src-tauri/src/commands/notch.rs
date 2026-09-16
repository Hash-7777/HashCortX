// ==============================================================
// HashNotch live-activity ping
//
// When a run finishes, HashCortX writes one short "finished" activity to
// HashNotch's local feed so the notch lights up. Metadata only: a title,
// never a model label and never any prompt or answer content.
//
// The feed is HashNotch's documented merge-by-id contract:
//   ~/.hashnotch/activities.json  — an array of
//   { id, icon, title, subtitle?, endsAt? (ISO8601), dismissAfter?, image? }
//
// We replace our own previous activity, leave every other poster's alone,
// keep the file bounded, and write atomically so a reader never sees a
// half-written file. Best-effort: if HashNotch isn't installed the file just
// sits there unread, and any failure is swallowed by the caller.
// ==============================================================

use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};

/// HashNotch itself only shows a handful; keep the file from ever growing.
const MAX_ACTIVITIES: usize = 8;

/// Longest id accepted. The id also names a file (the logo path below), so it
/// is held to letters, digits, '-' and '_' — never a path separator.
const MAX_ID_CHARS: usize = 64;

/// Largest record accepted, as JSON. A notice is an icon and a short title.
const MAX_RECORD_BYTES: usize = 4 * 1024;

/// The record's id, if the record is one this command will post.
fn checked_id(record: &Value) -> Result<String, String> {
    let id = record
        .get("id")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .ok_or("notch activity needs a non-empty id")?;
    let plain = id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
    if id.chars().count() > MAX_ID_CHARS || !plain {
        return Err("notch activity id must be a short name of letters, digits, '-' or '_'".into());
    }
    let size = serde_json::to_string(record).map_err(|e| e.to_string())?.len();
    if size > MAX_RECORD_BYTES {
        return Err("notch activity is too large".into());
    }
    Ok(id.to_owned())
}

/// The folder HashNotch reads, newest name first.
///
/// The app was renamed and its folder moved with it. A poster has to land where
/// the INSTALLED copy is looking, and this app cannot know which copy that is —
/// so it writes to whichever folder is already on the machine, preferring the
/// current name. Only when neither exists does it create the current one, which
/// is the right guess for anyone installing from here on.
const FEED_DIRS: [&str; 2] = [".hashnotch", ".hashdisland"];

fn feed_dir() -> PathBuf {
    feed_dir_in(&dirs::home_dir().unwrap_or_else(|| PathBuf::from(".")))
}

/// Split out from `feed_dir` so the choice can be tested against a real
/// directory rather than only against whatever this machine happens to have.
fn feed_dir_in(home: &Path) -> PathBuf {
    FEED_DIRS
        .iter()
        .map(|name| home.join(name))
        .find(|dir| dir.is_dir())
        .unwrap_or_else(|| home.join(FEED_DIRS[0]))
}

fn feed_path() -> PathBuf {
    feed_dir().join("activities.json")
}

/// Where this app's logo would live, if the user has put one there.
///
/// The notch shows a tool's own mark instead of a generic symbol when it can
/// find one. Nothing is shipped or created here: the path is simply offered,
/// and HashNotch ignores it unless it names a readable image, in which case
/// the symbol is drawn as before.
fn logo_path(id: &str) -> PathBuf {
    feed_dir().join("logos").join(format!("{id}.png"))
}

#[tauri::command]
pub fn notch_activity_post(record: Value) -> Result<(), String> {
    let id = checked_id(&record)?;

    let path = feed_path();

    // Whatever is already there, or an empty list if the file is missing or
    // not a JSON array (another poster mid-write, hand-edited, etc.).
    let mut items: Vec<Value> = fs::read_to_string(&path)
        .ok()
        .and_then(|text| serde_json::from_str::<Vec<Value>>(&text).ok())
        .unwrap_or_default();

    // Offer our logo, unless the caller named one itself.
    let mut record = record;
    if record.get("image").is_none() {
        if let Some(object) = record.as_object_mut() {
            object.insert(
                "image".to_string(),
                Value::String(logo_path(&id).to_string_lossy().into_owned()),
            );
        }
    }

    // Replace our own previous activity; never touch anyone else's.
    items.retain(|item| item.get("id").and_then(Value::as_str) != Some(id.as_str()));
    items.push(record);

    // Keep the file small regardless of how many posters share it.
    let len = items.len();
    if len > MAX_ACTIVITIES {
        items.drain(0..len - MAX_ACTIVITIES);
    }

    // Atomic write: a temp file in the same directory, then rename over the
    // target so a concurrent reader gets either the old file or the new one.
    let parent = path.parent().ok_or("bad feed path")?;
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let body = serde_json::to_string_pretty(&items).map_err(|e| e.to_string())?;
    let tmp = parent.join(format!(".activities.{}.tmp", std::process::id()));
    fs::write(&tmp, body.as_bytes()).map_err(|e| e.to_string())?;
    fs::rename(&tmp, &path).map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("hashcortx-notch-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn the_current_folder_is_used_when_nothing_exists_yet() {
        let home = scratch("fresh");
        assert_eq!(feed_dir_in(&home), home.join(".hashnotch"));
        let _ = fs::remove_dir_all(&home);
    }

    #[test]
    fn a_machine_still_on_the_old_folder_is_written_to_there() {
        let home = scratch("old");
        fs::create_dir_all(home.join(".hashdisland")).unwrap();
        assert_eq!(feed_dir_in(&home), home.join(".hashdisland"));
        let _ = fs::remove_dir_all(&home);
    }

    #[test]
    fn the_current_folder_wins_when_both_are_present() {
        let home = scratch("both");
        fs::create_dir_all(home.join(".hashdisland")).unwrap();
        fs::create_dir_all(home.join(".hashnotch")).unwrap();
        assert_eq!(feed_dir_in(&home), home.join(".hashnotch"));
        let _ = fs::remove_dir_all(&home);
    }

    #[test]
    fn the_notice_carries_no_model_and_no_content() {
        // The record the frontend now sends, verbatim.
        let record: Value = serde_json::from_str(
            r#"{"id":"hashcortx","icon":"checkmark.circle.fill","title":"HashCortX finished","dismissAfter":3}"#,
        )
        .unwrap();
        let line = serde_json::to_string(&record).unwrap();
        assert!(line.contains("HashCortX finished"));
        // The one field the model label used to travel in.
        assert!(!line.contains("subtitle"));
        // And it is a record this command accepts.
        assert_eq!(checked_id(&record).unwrap(), "hashcortx");
    }

    #[test]
    fn an_id_is_a_plain_name_and_never_a_path() {
        for bad in ["", "../logos/x", "a/b", "a\\b", "has space", "dot.ted"] {
            let record = serde_json::json!({ "id": bad, "title": "t" });
            assert!(checked_id(&record).is_err(), "accepted {bad:?}");
        }
        assert!(checked_id(&serde_json::json!({ "title": "no id" })).is_err());
        let longest = "a".repeat(MAX_ID_CHARS);
        assert!(checked_id(&serde_json::json!({ "id": longest })).is_ok());
        let too_long = "a".repeat(MAX_ID_CHARS + 1);
        assert!(checked_id(&serde_json::json!({ "id": too_long })).is_err());
    }

    #[test]
    fn an_oversized_record_is_refused() {
        let title = "t".repeat(MAX_RECORD_BYTES);
        let record = serde_json::json!({ "id": "hashcortx", "title": title });
        assert!(checked_id(&record).is_err());
    }
}
