// ==============================================================
// Undo checkpoints for the coding agent
//
// Before the agent writes or deletes a file, the previous contents are saved
// here so the change can be put back. Records live at:
//   ~/.hashcortx/checkpoints/<id>.json
//
// JS calls:
//   invoke("checkpoint_save", { path })  → record   (reads the file itself)
//   invoke("checkpoint_read", { id })    → record
//   invoke("checkpoint_drop", { id })
//
// WHY THE FILE IS READ HERE RATHER THAN PASSED IN
// -----------------------------------------------
// `fs_read_file` does not always return a file's contents. For a binary file or
// one over its size cap it returns a human-readable note about the file
// instead. That is right for a model reading code and catastrophic for a
// checkpoint: restoring one would overwrite the user's file with a sentence
// describing it. Reading here means the record either holds the real text or
// is honestly marked as something that cannot be restored.
//
// The path still goes through the same guard as `fs_read_file` — without it,
// saving a checkpoint of a protected file and reading it straight back would
// be a way around the filesystem denylist.
//
// WHY THIS IS A RUST COMMAND AND NOT A FILE WRITE
// -----------------------------------------------
// `~/.hashcortx` is in the filesystem denylist, so `fs_write_file` refuses it
// and so does the shell. That is deliberate: it keeps the agent out of the
// audit log. It has to keep the agent out of the undo history too — an agent
// that can delete the record of what a file used to be can make a change
// unrecoverable. These commands take no caller-supplied directory, only an id
// this file generated, so there is nothing here to point somewhere else.
//
// Restoring is NOT done here. The renderer reads the record back and writes it
// through `fs_write_file`, which means a restore passes the same denylist and
// the same permission guard as any other write. This file only remembers.
// ==============================================================

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};

/// Largest file whose previous contents are kept.
///
/// Matches the read cap in `fs.rs`: past this size the agent is working with
/// excerpts anyway, and copying hundreds of megabytes into the home directory
/// to make a button work is a worse outcome than saying the button cannot.
const MAX_CHECKPOINT_BYTES: usize = 8_000_000;

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Checkpoint {
    pub id: String,
    /// The file this record can restore.
    pub path: String,
    /// The contents before the change. `None` when the file did not exist, so
    /// undoing means deleting it rather than writing something back.
    pub content: Option<String>,
    /// Whether the file was there at all before the change.
    pub existed: bool,
    /// Set when the file existed but its contents could not be kept — too
    /// large, or not text. Recorded rather than skipped silently, so the panel
    /// can say the change cannot be undone instead of offering a button that
    /// would write the wrong thing.
    #[serde(default)]
    pub unrestorable: Option<String>,
    pub saved_at: String,
}

fn checkpoint_dir() -> PathBuf {
    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
    home.join(".hashcortx").join("checkpoints")
}

/// Ids are generated here and used as a filename, so they must not be able to
/// name anything but a file in the checkpoint directory.
fn is_safe_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
}

fn record_path(id: &str) -> Result<PathBuf, String> {
    if !is_safe_id(id) {
        return Err("Invalid checkpoint id.".to_string());
    }
    Ok(checkpoint_dir().join(format!("{id}.json")))
}

fn new_id() -> String {
    // Unique per write without pulling in a uuid crate: the time in
    // nanoseconds, plus a counter for the case where two writes land inside the
    // same tick — which a batch of parallel tool calls can genuinely do.
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let seq = COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("{nanos:x}-{seq:x}")
}

/// Read what a file holds right now, ready to be put back later.
///
/// Returns `(content, existed, unrestorable)`.
fn capture(path: &str) -> (Option<String>, bool, Option<String>) {
    let meta = match fs::metadata(path) {
        Ok(m) => m,
        // No file is a perfectly good thing to remember: undoing the creation
        // of a file means deleting it again.
        Err(_) => return (None, false, None),
    };
    if meta.is_dir() {
        return (None, true, Some("that path is a directory".into()));
    }
    if meta.len() as usize > MAX_CHECKPOINT_BYTES {
        return (None, true, Some("the file is too large to keep a copy of".into()));
    }
    match fs::read(path) {
        // Only valid UTF-8 is kept. Writing back a lossy conversion of a binary
        // file would corrupt it, and a corrupted restore is worse than none.
        Ok(bytes) => match String::from_utf8(bytes) {
            Ok(text) => (Some(text), true, None),
            Err(_) => (None, true, Some("the file is not text".into())),
        },
        Err(e) => (None, true, Some(format!("the file could not be read: {e}"))),
    }
}

#[tauri::command]
pub fn checkpoint_save(path: String) -> Result<Checkpoint, String> {
    // The same gate `fs_read_file` applies. Without it this command would read
    // any protected file into a record that `checkpoint_read` hands straight
    // back, which is the filesystem denylist undone.
    crate::commands::fs::guard_path(&path)?;

    let dir = checkpoint_dir();
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    let (content, existed, unrestorable) = capture(&path);
    let record = Checkpoint {
        id: new_id(),
        path,
        content,
        existed,
        unrestorable,
        saved_at: chrono::Local::now().to_rfc3339(),
    };

    let file = record_path(&record.id)?;
    let json = serde_json::to_string(&record).map_err(|e| e.to_string())?;
    fs::write(&file, json).map_err(|e| e.to_string())?;
    Ok(record)
}

#[tauri::command]
pub fn checkpoint_read(id: String) -> Result<Checkpoint, String> {
    let file = record_path(&id)?;
    let raw = fs::read_to_string(&file).map_err(|_| "That checkpoint is no longer available.")?;
    serde_json::from_str(&raw).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn checkpoint_drop(id: String) -> Result<(), String> {
    let file = record_path(&id)?;
    // Already gone is the state the caller wanted.
    let _ = fs::remove_file(file);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_id_cannot_name_a_file_outside_the_checkpoint_directory() {
        // The id becomes a filename, so traversal and separators are the whole
        // risk. Ids this file generates are hex and a dash.
        assert!(!is_safe_id("../../etc/passwd"));
        assert!(!is_safe_id("a/b"));
        assert!(!is_safe_id("a\\b"));
        assert!(!is_safe_id(".."));
        assert!(!is_safe_id(""));
        assert!(!is_safe_id(&"a".repeat(65)));
        assert!(record_path("../secret").is_err());
    }

    #[test]
    fn a_generated_id_is_accepted_and_ids_do_not_repeat() {
        let a = new_id();
        let b = new_id();
        assert!(is_safe_id(&a), "generated id must pass its own check: {a}");
        assert_ne!(a, b, "two checkpoints in a row must not share an id");
    }

    #[test]
    fn a_record_round_trips_including_the_file_did_not_exist_case() {
        let created = Checkpoint {
            id: "abc123".into(),
            path: "/tmp/x.txt".into(),
            content: None,
            existed: false,
            unrestorable: None,
            saved_at: "2026-08-03T00:00:00+00:00".into(),
        };
        let json = serde_json::to_string(&created).unwrap();
        let back: Checkpoint = serde_json::from_str(&json).unwrap();
        // `existed: false` is what tells the panel to undo by deleting the file
        // rather than writing something back into it.
        assert!(!back.existed);
        assert!(back.content.is_none());
        assert!(back.unrestorable.is_none());
        assert_eq!(back.path, "/tmp/x.txt");
    }

    // ── What `capture` must never do ─────────────────────────────────────────

    fn scratch(name: &str) -> std::path::PathBuf {
        // Not the OS temp dir: on macOS it resolves under /private/var, which
        // the denylist refuses, so these would fail for an unrelated reason.
        let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("target")
            .join("checkpoint-scratch")
            .join(format!("{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn a_missing_file_is_remembered_as_missing_rather_than_empty() {
        let dir = scratch("missing");
        let (content, existed, why) = capture(&dir.join("not-here.txt").to_string_lossy());
        assert!(!existed, "a file that is not there did not exist");
        assert!(content.is_none());
        assert!(why.is_none(), "this is a normal case, not a failure");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn text_is_kept_byte_for_byte() {
        let dir = scratch("text");
        let file = dir.join("a.txt");
        let original = "line one\nline two\r\n\ttabbed\n";
        fs::write(&file, original).unwrap();
        let (content, existed, why) = capture(&file.to_string_lossy());
        assert!(existed);
        assert!(why.is_none());
        // Line endings and whitespace must survive: a restore that "tidies" the
        // file is not a restore.
        assert_eq!(content.as_deref(), Some(original));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_binary_file_is_marked_unrestorable_rather_than_mangled() {
        let dir = scratch("binary");
        let file = dir.join("a.bin");
        fs::write(&file, [0xff, 0xfe, 0x00, 0x01, 0x80]).unwrap();
        let (content, existed, why) = capture(&file.to_string_lossy());
        assert!(existed);
        // Keeping a lossy conversion would let the panel offer an undo that
        // corrupts the file. Refusing is the only safe answer.
        assert!(content.is_none(), "binary contents must not be kept as text");
        assert!(why.is_some(), "the reason has to reach the user");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_checkpoint_survives_being_written_read_back_and_dropped() {
        // The whole point of the feature: what the file held has to come back
        // out of the record byte for byte, from disk, after the file itself has
        // moved on.
        let dir = scratch("roundtrip");
        let file = dir.join("main.rs");
        let original = "fn main() {\n    println!(\"before\");\n}\n";
        fs::write(&file, original).unwrap();

        let saved = checkpoint_save(file.to_string_lossy().into_owned()).unwrap();
        assert!(saved.existed);
        assert!(saved.unrestorable.is_none());

        // The agent's change lands.
        fs::write(&file, "fn main() {}\n").unwrap();

        let read_back = checkpoint_read(saved.id.clone()).unwrap();
        assert_eq!(read_back.content.as_deref(), Some(original));
        assert_eq!(read_back.path, file.to_string_lossy());

        checkpoint_drop(saved.id.clone()).unwrap();
        assert!(
            checkpoint_read(saved.id).is_err(),
            "a dropped checkpoint must not still be readable"
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn dropping_a_checkpoint_that_is_already_gone_is_not_an_error() {
        // Keeping and undoing both drop the record, and the panel may do either
        // twice on a double click. Being asked to remove nothing is success.
        assert!(checkpoint_drop("deadbeef-0".to_string()).is_ok());
    }

    #[test]
    fn a_protected_path_cannot_be_copied_into_a_checkpoint() {
        // Otherwise saving a checkpoint and reading it back would be a way
        // around the filesystem denylist.
        assert!(checkpoint_save("~/.ssh/id_ed25519".to_string()).is_err());
        assert!(checkpoint_save("/etc/passwd".to_string()).is_err());
    }
}
