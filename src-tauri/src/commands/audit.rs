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
// ==============================================================

use chrono::Local;
use std::fs::{create_dir_all, OpenOptions};
use std::io::Write;
use std::path::PathBuf;

fn log_path() -> PathBuf {
    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
    home.join(".hashcortx").join("audit.log")
}

#[tauri::command]
pub fn audit_log_append(scope: String, action: String, target: String) -> Result<(), String> {
    let path = log_path();
    if let Some(parent) = path.parent() {
        create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|e| e.to_string())?;

    let ts     = Local::now().format("%Y-%m-%d %H:%M:%S");
    let scope  = scope.replace('\n', "\\n").replace('\r', "\\r");
    let action = action.replace('\n', "\\n").replace('\r', "\\r");
    let target = target.replace('\n', "\\n").replace('\r', "\\r");
    let line   = format!("{ts} [{scope:<14}] {action:<6} {target}\n");
    file.write_all(line.as_bytes()).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn audit_log_read() -> Result<String, String> {
    let path = log_path();
    if !path.exists() {
        return Ok(String::new());
    }
    std::fs::read_to_string(&path).map_err(|e| e.to_string())
}
