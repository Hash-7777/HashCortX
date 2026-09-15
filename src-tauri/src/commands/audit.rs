// ==============================================================
// Phase 3 — Append-only audit log
//
// Every agent action (file read/write, shell exec, permission
// decision) is logged here. The log lives at:
//   ~/.hashcortx/audit.log
//
// Format (one line per entry):
//   2026-05-11 14:23:01 [allow-once]    read   /home/user/project/auth.js
//   2026-05-11 14:23:14 [allow-session] write  /home/user/project/auth.js
//   2026-05-11 14:23:30 [deny]          shell  rm -rf node_modules
//
// The log is bounded. Every entry is exactly one printable line of limited
// length, and once the file passes ROTATE_AT_BYTES it becomes audit.log.1
// (replacing the previous one) and a new file starts. audit_log_read hands
// the window only the newest part, which is the part it shows.
// ==============================================================

use chrono::Local;
use std::fs::{self, File, OpenOptions};
use std::io::{ErrorKind, Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};

/// Longest scope or action kept. Both are short words the app chooses.
const MAX_LABEL_CHARS: usize = 32;

/// Longest target kept. A target is a path or a whole shell command; a longer
/// one is cut, and the entry says how much was left out.
const MAX_TARGET_CHARS: usize = 16 * 1024;

/// Past this size the log is moved to audit.log.1 and a new one begins, so at
/// most two files' worth is ever kept.
const ROTATE_AT_BYTES: u64 = 8 * 1024 * 1024;

/// How much of the newest log audit_log_read returns.
const READ_TAIL_BYTES: u64 = 512 * 1024;

fn log_path() -> PathBuf {
    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
    home.join(".hashcortx").join("audit.log")
}

/// Characters written out as escapes rather than kept: anything that would
/// end the line or rearrange how it reads on screen.
fn needs_escape(c: char) -> bool {
    c.is_control()
        || matches!(c, '\u{2028}' | '\u{2029}' | '\u{202A}'..='\u{202E}' | '\u{2066}'..='\u{2069}')
}

/// One field as it goes on the line: one line, at most `max` characters of
/// the original, with a note when some were left out.
fn field(text: &str, max: usize) -> String {
    let mut out = String::new();
    for c in text.chars().take(max) {
        match c {
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if needs_escape(c) => out.push_str(&format!("\\u{{{:04x}}}", c as u32)),
            c => out.push(c),
        }
    }
    let total = text.chars().count();
    if total > max {
        out.push_str(&format!(" … [{} more characters not logged]", total - max));
    }
    out
}

fn entry(scope: &str, action: &str, target: &str) -> String {
    let ts = Local::now().format("%Y-%m-%d %H:%M:%S");
    let scope = field(scope, MAX_LABEL_CHARS);
    let action = field(action, MAX_LABEL_CHARS);
    let target = field(target, MAX_TARGET_CHARS);
    format!("{ts} [{scope:<14}] {action:<6} {target}\n")
}

/// Append one line, first moving a full log aside. A failed move does not
/// cost the entry: the record matters more than the size.
fn append_line(path: &Path, line: &str, rotate_at: u64) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        crate::security::private_dir::create(parent).map_err(|e| e.to_string())?;
    }
    if fs::metadata(path).map(|m| m.len() >= rotate_at).unwrap_or(false) {
        let _ = fs::rename(path, path.with_extension("log.1"));
    }
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .map_err(|e| e.to_string())?;
    file.write_all(line.as_bytes()).map_err(|e| e.to_string())
}

/// The newest `max` bytes of the log, starting at a whole line. When older
/// entries are left out, the first line says where they are.
fn read_tail(path: &Path, max: u64) -> Result<String, String> {
    let mut file = match File::open(path) {
        Ok(file) => file,
        Err(e) if e.kind() == ErrorKind::NotFound => return Ok(String::new()),
        Err(e) => return Err(e.to_string()),
    };
    let len = file.metadata().map_err(|e| e.to_string())?.len();
    let mut bytes = Vec::new();
    if len <= max {
        file.read_to_end(&mut bytes).map_err(|e| e.to_string())?;
        return Ok(String::from_utf8_lossy(&bytes).into_owned());
    }
    file.seek(SeekFrom::Start(len - max)).map_err(|e| e.to_string())?;
    file.take(max).read_to_end(&mut bytes).map_err(|e| e.to_string())?;
    let start = bytes.iter().position(|&b| b == b'\n').map_or(0, |i| i + 1);
    Ok(format!(
        "[Showing the newest entries. The whole log is ~/.hashcortx/audit.log, and audit.log.1 beside it holds the one before.]\n{}",
        String::from_utf8_lossy(&bytes[start..])
    ))
}

#[tauri::command]
pub fn audit_log_append(scope: String, action: String, target: String) -> Result<(), String> {
    append_line(&log_path(), &entry(&scope, &action, &target), ROTATE_AT_BYTES)
}

#[tauri::command]
pub fn audit_log_read() -> Result<String, String> {
    read_tail(&log_path(), READ_TAIL_BYTES)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> PathBuf {
        // Not the OS temp dir: on macOS it resolves under /private/var, which
        // the denylist refuses.
        let dir = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("target")
            .join("audit-scratch")
            .join(format!("{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn an_entry_is_always_one_line() {
        let line = entry("deny\n", "shell\r", "a\nb\u{1b}[2Kc\u{202E}d\u{2028}e\tf");
        assert_eq!(line.matches('\n').count(), 1);
        assert!(line.ends_with('\n'));
        assert!(!line.trim_end_matches('\n').chars().any(needs_escape));
        assert!(line.contains("a\\nb\\u{001b}[2Kc\\u{202e}d\\u{2028}e\\tf"));
    }

    #[test]
    fn ordinary_text_is_kept_as_written() {
        let target = "/Users/someone/project/src/main.rs — ünïcode ok";
        assert_eq!(field(target, MAX_TARGET_CHARS), target);
    }

    #[test]
    fn a_long_target_is_cut_and_says_how_much_was_left_out() {
        let long = "x".repeat(MAX_TARGET_CHARS + 25);
        let kept = field(&long, MAX_TARGET_CHARS);
        assert!(kept.starts_with(&"x".repeat(MAX_TARGET_CHARS)));
        assert!(kept.ends_with("[25 more characters not logged]"));
        // Exactly at the limit, nothing is cut and nothing is added.
        let exact = "y".repeat(MAX_TARGET_CHARS);
        assert_eq!(field(&exact, MAX_TARGET_CHARS), exact);
    }

    #[test]
    fn the_limit_counts_characters_not_bytes() {
        let wide = "é".repeat(40);
        let kept = field(&wide, MAX_LABEL_CHARS);
        assert!(kept.starts_with(&"é".repeat(MAX_LABEL_CHARS)));
        assert!(kept.ends_with("[8 more characters not logged]"));
    }

    #[test]
    fn a_full_log_is_moved_aside_and_a_new_one_begins() {
        let dir = scratch("rotate");
        let log = dir.join("audit.log");
        append_line(&log, "first\n", 10).unwrap();
        append_line(&log, "second\n", 10).unwrap();
        // Still under the size: both lines in one file.
        assert_eq!(fs::read_to_string(&log).unwrap(), "first\nsecond\n");
        append_line(&log, "third\n", 10).unwrap();
        assert_eq!(fs::read_to_string(dir.join("audit.log.1")).unwrap(), "first\nsecond\n");
        assert_eq!(fs::read_to_string(&log).unwrap(), "third\n");
        // The next rotation replaces the older file rather than adding a third.
        append_line(&log, "fourth\n", 100).unwrap();
        append_line(&log, "fifth\n", 10).unwrap();
        assert_eq!(fs::read_to_string(dir.join("audit.log.1")).unwrap(), "third\nfourth\n");
        assert_eq!(fs::read_to_string(&log).unwrap(), "fifth\n");
        let files = fs::read_dir(&dir).unwrap().count();
        assert_eq!(files, 2);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn reading_a_small_log_returns_all_of_it() {
        let dir = scratch("small");
        let log = dir.join("audit.log");
        fs::write(&log, "one\ntwo\n").unwrap();
        assert_eq!(read_tail(&log, 1024).unwrap(), "one\ntwo\n");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn reading_a_missing_log_returns_nothing() {
        let dir = scratch("missing");
        assert_eq!(read_tail(&dir.join("audit.log"), 1024).unwrap(), "");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn reading_a_large_log_returns_the_newest_whole_lines() {
        let dir = scratch("large");
        let log = dir.join("audit.log");
        let body: String = (0..200).map(|i| format!("entry {i:03} é\n")).collect();
        fs::write(&log, &body).unwrap();
        let tail = read_tail(&log, 100).unwrap();
        let mut lines = tail.lines();
        assert!(lines.next().unwrap().starts_with("[Showing the newest entries."));
        let shown: Vec<&str> = lines.collect();
        // Every line shown is a whole entry, and the last one is the newest.
        assert!(!shown.is_empty());
        assert!(shown.iter().all(|l| l.starts_with("entry ") && l.ends_with(" é")));
        assert_eq!(*shown.last().unwrap(), "entry 199 é");
        let _ = fs::remove_dir_all(&dir);
    }
}
