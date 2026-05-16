// ==============================================================
// Phase 4 — Shell execution bridge (Code Mode)
//
// Runs shell commands in a subprocess and returns stdout/stderr.
// Every command is checked against the denylist before execution.
// The JS permission guard must also approve the action.
//
// JS call (blocking):
//   invoke("shell_run", { command, args, cwd })
//   → { stdout, stderr, code }
//
// JS call (streaming):
//   invoke("shell_run_stream", { command, args, cwd })
//   → channel receives { kind: "stdout"|"stderr"|"done", data, code? }
// ==============================================================

use crate::security::denylist;
use serde::{Deserialize, Serialize};
use std::process::{Command, Stdio};
use std::io::{BufRead, BufReader};
use std::thread;
use tauri::ipc::Channel;

#[derive(Serialize)]
pub struct ShellOutput {
    stdout: String,
    stderr: String,
    code:   i32,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct StreamChunk {
    pub kind: String, // "stdout", "stderr", "done"
    pub data: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code: Option<i32>,
}

#[tauri::command]
pub fn shell_run(
    command: String,
    args:    Vec<String>,
    cwd:     Option<String>,
) -> Result<ShellOutput, String> {
    let full = format!("{} {}", command, args.join(" "));
    if denylist::is_command_denied(&full) {
        return Err(format!("Command is blocked by the security denylist: {command}"));
    }

    let mut cmd = Command::new(&command);
    cmd.args(&args);
    if let Some(dir) = &cwd {
        if denylist::is_path_denied(dir) {
            return Err(format!("Working directory is protected: {dir}"));
        }
        cmd.current_dir(dir);
    }

    let output = cmd.output().map_err(|e| e.to_string())?;
    Ok(ShellOutput {
        stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
        stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
        code:   output.status.code().unwrap_or(-1),
    })
}

#[tauri::command]
pub fn shell_run_stream(
    command: String,
    args:    Vec<String>,
    cwd:     Option<String>,
    on_chunk: Channel<StreamChunk>,
) -> Result<(), String> {
    let full = format!("{} {}", command, args.join(" "));
    if denylist::is_command_denied(&full) {
        return Err(format!("Command is blocked by the security denylist: {command}"));
    }

    let mut cmd = Command::new(&command);
    cmd.args(&args);
    if let Some(dir) = &cwd {
        if denylist::is_path_denied(dir) {
            return Err(format!("Working directory is protected: {dir}"));
        }
        cmd.current_dir(dir);
    }
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());

    let mut child = cmd.spawn().map_err(|e| e.to_string())?;

    let stdout = child.stdout.take().ok_or("Failed to capture stdout")?;
    let stderr = child.stderr.take().ok_or("Failed to capture stderr")?;

    let tx_out = on_chunk.clone();
    let tx_err = on_chunk.clone();

    thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines() {
            if let Ok(l) = line {
                let _ = tx_out.send(StreamChunk {
                    kind: "stdout".into(),
                    data: l,
                    code: None,
                });
            }
        }
    });

    thread::spawn(move || {
        let reader = BufReader::new(stderr);
        for line in reader.lines() {
            if let Ok(l) = line {
                let _ = tx_err.send(StreamChunk {
                    kind: "stderr".into(),
                    data: l,
                    code: None,
                });
            }
        }
    });

    // Wait for process to finish, then send done
    let code = child.wait().map(|s| s.code().unwrap_or(-1)).unwrap_or(-1);
    let _ = on_chunk.send(StreamChunk {
        kind: "done".into(),
        data: String::new(),
        code: Some(code),
    });

    Ok(())
}
