// ==============================================================
// Shell execution bridge (Code Mode)
//
// Runs shell commands in a subprocess and returns stdout/stderr.
// Every command is checked against the denylist before execution.
// The JS permission guard must also approve the action.
//
// JS call (blocking):
//   invoke("shell_run", { command, args, cwd, timeoutMs })
//   → { stdout, stderr, code, timedOut, truncated }
//
// JS call (streaming):
//   invoke("shell_run_stream", { command, args, cwd, timeoutMs })
//   → channel receives { kind: "stdout"|"stderr"|"done", data, code? }
//
// THREE LIMITS APPLY TO EVERY RUN
// -------------------------------
// A coding agent hands this function a command a language model wrote.
// Unbounded, that meant a run could hang forever with no way to stop it,
// or bury the renderer under gigabytes of output.
//
//   • timeout   — the child is killed once it expires (default 5 min)
//   • stdin     — closed, so a command that prompts fails fast instead of
//                 waiting for input that can never arrive
//   • output    — capped per stream; the rest is dropped with a notice
//
// Honest limit: killing the child kills the process the shell became. A
// command that spawns background grandchildren (`sh -c 'x & y &'`) can leave
// them running — this is not a process supervisor, and docs/SECURITY.md
// must not imply that it is.
// ==============================================================

use crate::security::denylist;
use serde::{Deserialize, Serialize};
use std::io::{BufRead, BufReader, Read};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant};
use tauri::ipc::Channel;

/// How long a command may run before it is killed, when the caller says nothing.
///
/// Five minutes, chosen so that a cold `npm install` or `cargo build` — the
/// commands an agent legitimately runs and then waits on — finishes rather than
/// being cut off. A caller that knows it needs longer passes `timeoutMs`.
const DEFAULT_TIMEOUT_MS: u64 = 300_000;
/// Floor and ceiling for a caller-supplied timeout.
const MIN_TIMEOUT_MS: u64 = 1_000;
const MAX_TIMEOUT_MS: u64 = 600_000;
/// Most output one stream may return before the remainder is dropped.
const MAX_STREAM_BYTES: usize = 512 * 1024;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShellOutput {
    stdout: String,
    stderr: String,
    code: i32,
    /// The command hit the time limit and was killed.
    timed_out: bool,
    /// Output exceeded the cap and was cut short.
    truncated: bool,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct StreamChunk {
    pub kind: String, // "stdout", "stderr", "done"
    pub data: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code: Option<i32>,
}

/// The program and flag this platform uses to run a whole command line.
///
/// The renderer used to hard-code `sh -c`, which simply does not exist on
/// Windows — every terminal command and the home-directory probe would have
/// failed there. Choosing the shell in Rust means the JavaScript never has to
/// know which OS it is on, and there is one place to be wrong instead of four.
#[cfg(windows)]
pub const fn platform_shell() -> (&'static str, &'static str) {
    ("cmd", "/C")
}
#[cfg(not(windows))]
pub const fn platform_shell() -> (&'static str, &'static str) {
    ("sh", "-c")
}

/// The command that prints the user's home directory on this platform.
#[cfg(windows)]
const HOME_PROBE: &str = "echo %USERPROFILE%";
#[cfg(not(windows))]
const HOME_PROBE: &str = "echo $HOME";

/// What the frontend needs to know about the platform it is running on, so it
/// can describe commands to the model correctly rather than assuming Unix.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlatformInfo {
    /// "windows" | "macos" | "linux" | …
    pub os: String,
    /// The shell used to run a command line, e.g. "sh" or "cmd".
    pub shell: String,
    /// Path separator, "/" or "\\".
    pub separator: String,
    /// A command line that prints the home directory.
    pub home_probe: String,
}

#[tauri::command]
pub fn shell_platform() -> PlatformInfo {
    let (shell, _) = platform_shell();
    PlatformInfo {
        os: std::env::consts::OS.to_string(),
        shell: shell.to_string(),
        separator: std::path::MAIN_SEPARATOR.to_string(),
        home_probe: HOME_PROBE.to_string(),
    }
}

fn resolve_timeout(timeout_ms: Option<u64>) -> Duration {
    Duration::from_millis(
        timeout_ms
            .unwrap_or(DEFAULT_TIMEOUT_MS)
            .clamp(MIN_TIMEOUT_MS, MAX_TIMEOUT_MS),
    )
}

/// Refuse the command, or hand back a `Command` configured with the limits.
///
/// Both entry points share this so a check can never be added to one and
/// forgotten in the other.
fn prepare(command: &str, args: &[String], cwd: &Option<String>) -> Result<Command, String> {
    let full = format!("{} {}", command, args.join(" "));

    if denylist::is_command_denied(&full) {
        return Err(format!(
            "Command is blocked by the security denylist: {command}"
        ));
    }
    // The command text is checked against protected locations too. Without this,
    // `fs_read_file` refusing ~/.ssh/id_ed25519 meant nothing: `cat` read it.
    if denylist::command_touches_denied_path(&full) {
        return Err(
            "Command references a protected location (keys, credentials, or HashCortX's own \
             stored data) and was refused."
                .to_string(),
        );
    }

    let mut cmd = Command::new(command);
    cmd.args(args);
    if let Some(dir) = cwd {
        // The working directory decides what every relative path in the command
        // means, so it gets the same gate a file operation gets rather than a
        // bare denylist lookup.
        //
        // `is_path_denied` matches the spelling it is handed. Half of that list
        // is prefixes — /etc, /System, /usr/bin — and a directory written with
        // `..` matches none of them: `<project>/../../../etc` is not spelled
        // /etc, so it was accepted, and the shell then ran there. `guard_path`
        // refuses `..` outright and resolves links before deciding.
        crate::commands::fs::guard_path(dir)
            .map_err(|why| format!("Working directory refused: {why}"))?;
        cmd.current_dir(dir);
    }
    // A command that asks a question gets EOF rather than an inherited terminal
    // it could block on forever.
    cmd.stdin(Stdio::null());
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());
    Ok(cmd)
}

/// Wait for the child, killing it if it outlives `timeout`.
///
/// Returns `(exit_code, timed_out)`.
fn wait_with_timeout(child: &mut Child, timeout: Duration) -> (i32, bool) {
    let start = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(status)) => return (status.code().unwrap_or(-1), false),
            Ok(None) => {
                if start.elapsed() >= timeout {
                    let _ = child.kill();
                    let _ = child.wait();
                    return (-1, true);
                }
                thread::sleep(Duration::from_millis(50));
            }
            Err(_) => return (-1, false),
        }
    }
}

/// Read a stream into a string, stopping once the cap is reached.
fn read_capped<R: Read>(reader: R) -> (String, bool) {
    let mut out = Vec::with_capacity(8 * 1024);
    let mut buf = [0u8; 8 * 1024];
    let mut reader = reader;
    let mut truncated = false;
    loop {
        match reader.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => {
                if out.len() >= MAX_STREAM_BYTES {
                    truncated = true;
                    // Keep draining so the child is never blocked on a full pipe.
                    continue;
                }
                let room = MAX_STREAM_BYTES - out.len();
                out.extend_from_slice(&buf[..n.min(room)]);
                if n > room {
                    truncated = true;
                }
            }
            Err(_) => break,
        }
    }
    let mut text = String::from_utf8_lossy(&out).into_owned();
    if truncated {
        text.push_str("\n\n[Output truncated — exceeded 512 KB. Narrow the command, or pipe through `head`, `tail`, or `grep`.]");
    }
    (text, truncated)
}

/// Run a whole command line through this platform's shell.
///
/// Callers that have a command line rather than a program plus arguments — the
/// terminal, the home-directory probe — use this instead of guessing at `sh`.
#[tauri::command]
pub fn shell_run_line(
    line: String,
    cwd: Option<String>,
    timeout_ms: Option<u64>,
) -> Result<ShellOutput, String> {
    let (shell, flag) = platform_shell();
    shell_run(
        shell.to_string(),
        vec![flag.to_string(), line],
        cwd,
        timeout_ms,
    )
}

#[tauri::command]
pub fn shell_run_line_stream(
    line: String,
    cwd: Option<String>,
    timeout_ms: Option<u64>,
    on_chunk: Channel<StreamChunk>,
) -> Result<(), String> {
    let (shell, flag) = platform_shell();
    shell_run_stream(
        shell.to_string(),
        vec![flag.to_string(), line],
        cwd,
        timeout_ms,
        on_chunk,
    )
}

#[tauri::command]
pub fn shell_run(
    command: String,
    args: Vec<String>,
    cwd: Option<String>,
    timeout_ms: Option<u64>,
) -> Result<ShellOutput, String> {
    let mut cmd = prepare(&command, &args, &cwd)?;
    let timeout = resolve_timeout(timeout_ms);

    let mut child = cmd.spawn().map_err(|e| e.to_string())?;
    let stdout = child.stdout.take().ok_or("Failed to capture stdout")?;
    let stderr = child.stderr.take().ok_or("Failed to capture stderr")?;

    // Both pipes are drained on their own threads. Reading them in sequence
    // deadlocks as soon as the child fills the one that is not being read.
    let out_handle = thread::spawn(move || read_capped(stdout));
    let err_handle = thread::spawn(move || read_capped(stderr));

    let (code, timed_out) = wait_with_timeout(&mut child, timeout);

    let (stdout_text, out_cut) = out_handle.join().unwrap_or_else(|_| (String::new(), false));
    let (mut stderr_text, err_cut) = err_handle.join().unwrap_or_else(|_| (String::new(), false));

    if timed_out {
        stderr_text.push_str(&format!(
            "\n\n[Killed after {} s — the command exceeded its time limit. \
             Long builds should be given a larger timeoutMs, or run in the background.]",
            timeout.as_secs()
        ));
    }

    Ok(ShellOutput {
        stdout: stdout_text,
        stderr: stderr_text,
        code,
        timed_out,
        truncated: out_cut || err_cut,
    })
}

#[tauri::command]
pub fn shell_run_stream(
    command: String,
    args: Vec<String>,
    cwd: Option<String>,
    timeout_ms: Option<u64>,
    on_chunk: Channel<StreamChunk>,
) -> Result<(), String> {
    let mut cmd = prepare(&command, &args, &cwd)?;
    let timeout = resolve_timeout(timeout_ms);

    let mut child = cmd.spawn().map_err(|e| e.to_string())?;
    let stdout = child.stdout.take().ok_or("Failed to capture stdout")?;
    let stderr = child.stderr.take().ok_or("Failed to capture stderr")?;

    // One shared budget across both streams, so a chatty command cannot flood
    // the renderer through stderr after stdout has been capped.
    let sent = Arc::new(AtomicUsize::new(0));

    fn pump<R: Read + Send + 'static>(
        reader: R,
        kind: &'static str,
        channel: Channel<StreamChunk>,
        sent: Arc<AtomicUsize>,
    ) -> thread::JoinHandle<()> {
        thread::spawn(move || {
            let mut notified = false;
            for line in BufReader::new(reader).lines().map_while(Result::ok) {
                let used = sent.fetch_add(line.len() + 1, Ordering::Relaxed);
                if used >= MAX_STREAM_BYTES {
                    if !notified {
                        notified = true;
                        let _ = channel.send(StreamChunk {
                            kind: kind.into(),
                            data: "[Output truncated — exceeded 512 KB.]".into(),
                            code: None,
                        });
                    }
                    continue; // keep draining so the child never blocks on a full pipe
                }
                let _ = channel.send(StreamChunk {
                    kind: kind.into(),
                    data: line,
                    code: None,
                });
            }
        })
    }

    let out_handle = pump(stdout, "stdout", on_chunk.clone(), Arc::clone(&sent));
    let err_handle = pump(stderr, "stderr", on_chunk.clone(), Arc::clone(&sent));

    let (code, timed_out) = wait_with_timeout(&mut child, timeout);

    let _ = out_handle.join();
    let _ = err_handle.join();

    if timed_out {
        let _ = on_chunk.send(StreamChunk {
            kind: "stderr".into(),
            data: format!(
                "[Killed after {} s — the command exceeded its time limit.]",
                timeout.as_secs()
            ),
            code: None,
        });
    }

    let _ = on_chunk.send(StreamChunk {
        kind: "done".into(),
        data: String::new(),
        code: Some(code),
    });

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn timeout_is_clamped_into_a_sane_range() {
        assert_eq!(resolve_timeout(None).as_millis(), DEFAULT_TIMEOUT_MS as u128);
        assert_eq!(resolve_timeout(Some(0)).as_millis(), MIN_TIMEOUT_MS as u128);
        assert_eq!(
            resolve_timeout(Some(u64::MAX)).as_millis(),
            MAX_TIMEOUT_MS as u128
        );
        assert_eq!(resolve_timeout(Some(5_000)).as_millis(), 5_000);
    }

    #[test]
    fn prepare_refuses_a_denylisted_command() {
        let err = prepare("sh", &["-c".into(), "sudo rm -rf /".into()], &None).unwrap_err();
        assert!(err.contains("denylist"));
    }

    #[test]
    fn prepare_refuses_a_command_that_reaches_for_a_key() {
        // The hole this closes: the filesystem denylist refuses this path, and
        // before now the shell handler happily read it anyway.
        let err = prepare("sh", &["-c".into(), "cat ~/.ssh/id_ed25519".into()], &None).unwrap_err();
        assert!(err.contains("protected location"));
    }

    #[test]
    fn prepare_allows_ordinary_work() {
        assert!(prepare("git", &["status".into()], &None).is_ok());
        assert!(prepare("npm", &["test".into()], &None).is_ok());
    }

    #[test]
    fn a_working_directory_written_with_dot_dot_is_refused() {
        // The denylist matches the spelling it is given, and half of it is
        // prefixes. A directory that climbs out with `..` is spelled like
        // nothing on that list, so the shell used to start there — the command
        // text never mentions the destination, so nothing else would catch it.
        let escape = Some(format!("{}/../../../etc", env!("CARGO_MANIFEST_DIR")));
        let err = prepare("ls", &[], &escape).unwrap_err();
        assert!(
            err.contains("Working directory refused"),
            "unexpected refusal: {err}"
        );

        // And the plain spelling stays refused, which it always was.
        let err = prepare("ls", &[], &Some("/etc".to_string())).unwrap_err();
        assert!(
            err.contains("Working directory refused"),
            "unexpected refusal: {err}"
        );
    }

    #[test]
    fn an_ordinary_working_directory_is_still_accepted() {
        // The rule has to hold in both directions, or it becomes the next thing
        // that refuses real work.
        let here = Some(env!("CARGO_MANIFEST_DIR").to_string());
        assert!(prepare("git", &["status".into()], &here).is_ok());
    }

    #[test]
    fn a_hanging_command_is_killed_rather_than_waited_on_forever() {
        let mut cmd = prepare("sleep", &["30".into()], &None).unwrap();
        let mut child = cmd.spawn().expect("sleep should spawn");
        let start = Instant::now();
        let (_, timed_out) = wait_with_timeout(&mut child, Duration::from_millis(300));
        assert!(timed_out, "the command should have hit the time limit");
        assert!(
            start.elapsed() < Duration::from_secs(5),
            "it should have been killed promptly, not waited out"
        );
    }

    #[test]
    fn a_command_that_reads_stdin_gets_eof_instead_of_hanging() {
        // stdin is null, so `cat` sees end-of-file immediately. Before this it
        // inherited the app's stdin and could block until the app was killed.
        let mut cmd = prepare("cat", &[], &None).unwrap();
        let mut child = cmd.spawn().expect("cat should spawn");
        let (code, timed_out) = wait_with_timeout(&mut child, Duration::from_secs(5));
        assert!(!timed_out, "cat should have exited on its own");
        assert_eq!(code, 0);
    }
}
