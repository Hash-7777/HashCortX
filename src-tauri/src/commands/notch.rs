// ==============================================================
// Hash D Island live-activity ping
//
// When a run finishes, HashCortX writes one short "finished" activity to
// Hash D Island's local feed so the notch lights up like the iPhone Dynamic
// Island — the same way Claude Code's hook does. Metadata only: a title and
// an optional model label, never any prompt or answer content.
//
// The feed is Hash D Island's documented merge-by-id contract:
//   ~/.hashdisland/activities.json  — an array of
//   { id, icon, title, subtitle?, endsAt? (ISO8601), dismissAfter?, image? }
//
// We replace our own previous activity, leave every other poster's alone,
// keep the file bounded, and write atomically so a reader never sees a
// half-written file. Best-effort: if Hash D Island isn't installed the file just
// sits there unread, and any failure is swallowed by the caller.
// ==============================================================

use serde_json::Value;
use std::fs;
use std::path::PathBuf;

/// Hash D Island itself only shows a handful; keep the file from ever growing.
const MAX_ACTIVITIES: usize = 8;

fn feed_path() -> PathBuf {
    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
    home.join(".hashdisland").join("activities.json")
}

/// Where this app's logo would live, if the user has put one there.
///
/// The notch shows a tool's own mark instead of a generic symbol when it can
/// find one. Nothing is shipped or created here: the path is simply offered,
/// and Hash D Island ignores it unless it names a readable image, in which case
/// the symbol is drawn as before.
fn logo_path(id: &str) -> PathBuf {
    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
    home.join(".hashdisland")
        .join("logos")
        .join(format!("{id}.png"))
}

#[tauri::command]
pub fn notch_activity_post(record: Value) -> Result<(), String> {
    let id = record
        .get("id")
        .and_then(Value::as_str)
        .map(str::to_owned)
        .filter(|s| !s.is_empty())
        .ok_or("notch activity needs a non-empty id")?;

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
