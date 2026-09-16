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
// Ending a command — at its time limit, or because its agent run was stopped
// (`shell_cancel`) — ends what it started too: it runs in a process group of
// its own on macOS and Linux, and as a process tree on Windows. Honest limit:
// a process that deliberately leaves its group, as a daemon does, is not
// followed. This is not a process supervisor, and docs/SECURITY.md must not
// imply that it is.
// ==============================================================

use crate::security::denylist;
use serde::{Deserialize, Serialize};
use std::io::{BufRead, BufReader, Read};
use std::collections::{HashMap, VecDeque};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
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
/// Said when a run is stopped while its command is going, or before it starts.
const STOPPED_NOTE: &str = "\n\n[Stopped from the app — the command and anything it started were ended.]";
const STOPPED_BEFORE_START: &str = "The run was stopped before this command started.";

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
    /// The run it belonged to was stopped from the app, and it was ended.
    stopped: bool,
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
fn prepare(command: &str, args: &[String], cwd: &Option<String>, caller: Caller) -> Result<Command, String> {
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

    // An agent's command runs inside the system sandbox where there is one
    // (security/agent_sandbox.rs); a command a person types does not.
    let mut cmd = match caller {
        Caller::Person => Command::new(command),
        Caller::Agent => crate::security::agent_sandbox::command(command)?,
    };
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
    // A process group of its own, so ending the command ends what it started
    // too (see `kill_tree`).
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        cmd.process_group(0);
    }
    Ok(cmd)
}

/// Who a command is run for.
#[derive(Clone, Copy, PartialEq, Debug)]
enum Caller {
    /// A person typing in the terminal: the whole environment, no sandbox.
    Person,
    /// The agent: no settings named like a secret, and on macOS the system
    /// sandbox (security/agent_sandbox.rs).
    Agent,
}

/// Words that mark an environment setting as a secret, when one of them is a
/// whole word of its name: `OPENAI_API_KEY`, `GH_TOKEN`, `DB_PASSWORD`.
const SECRET_WORDS: &[&str] = &[
    "KEY", "KEYS", "APIKEY", "TOKEN", "TOKENS", "SECRET", "SECRETS", "PASSWORD",
    "PASSWD", "PASS", "PASSPHRASE", "CREDENTIAL", "CREDENTIALS", "AUTH", "PAT",
];
/// Whole names that carry a secret without saying so: a connection string
/// holds its password.
const SECRET_NAMES: &[&str] = &["DATABASE_URL"];
/// Named like a secret, and not one: the path of the SSH agent's socket. It
/// holds no key, and git over SSH needs it.
const NOT_SECRET: &[&str] = &["SSH_AUTH_SOCK"];

/// Whether an environment setting's name marks it as a secret.
///
/// A command's output goes back to the model, and so to its provider, so an
/// agent command starts without these. A name is judged by its words, not by
/// what it contains: `GIT_AUTHOR_NAME` holds a name, not a credential.
fn is_secret_name(name: &str) -> bool {
    let upper = name.to_ascii_uppercase();
    if NOT_SECRET.contains(&upper.as_str()) {
        return false;
    }
    SECRET_NAMES.contains(&upper.as_str())
        || upper.split(['_', '-', '.']).any(|word| SECRET_WORDS.contains(&word))
}

/// Leave out of `cmd`'s environment every setting of this process named like a
/// secret.
fn without_secrets(cmd: &mut Command) {
    for (name, _) in std::env::vars_os() {
        if name.to_str().is_some_and(is_secret_name) {
            cmd.env_remove(&name);
        }
    }
}

// ── Stopping a run's commands ─────────────────────────────────────────────
//
// An agent run in the app passes a stop key with every command it starts. When
// the run is stopped, `shell_cancel` ends every command still running under
// that key. The terminal passes no key, so a command typed there is never
// ended by stopping an agent. A key only reaches commands this app started for
// that run.

/// Flags for the commands running under each stop key.
fn running() -> &'static Mutex<HashMap<String, Vec<Arc<AtomicBool>>>> {
    static RUNNING: OnceLock<Mutex<HashMap<String, Vec<Arc<AtomicBool>>>>> = OnceLock::new();
    RUNNING.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Keys stopped recently. A command can be asked for a moment before its run
/// is stopped and start a moment after; it finds its key here and never starts.
fn stopped_keys() -> &'static Mutex<VecDeque<String>> {
    static STOPPED: OnceLock<Mutex<VecDeque<String>>> = OnceLock::new();
    STOPPED.get_or_init(|| Mutex::new(VecDeque::new()))
}
const STOPPED_KEYS_KEPT: usize = 32;

/// One command's stop flag, listed under its key while it runs.
struct StopFlag {
    key: Option<String>,
    flag: Arc<AtomicBool>,
}

impl StopFlag {
    fn register(key: Option<String>) -> Self {
        let key = key.filter(|k| !k.is_empty());
        let flag = Arc::new(AtomicBool::new(false));
        if let Some(k) = &key {
            let already = stopped_keys().lock().map(|s| s.contains(k)).unwrap_or(false);
            flag.store(already, Ordering::Relaxed);
            if let Ok(mut table) = running().lock() {
                table.entry(k.clone()).or_default().push(Arc::clone(&flag));
            }
        }
        StopFlag { key, flag }
    }

    fn is_set(&self) -> bool {
        self.flag.load(Ordering::Relaxed)
    }
}

impl Drop for StopFlag {
    fn drop(&mut self) {
        let Some(k) = &self.key else { return };
        if let Ok(mut table) = running().lock() {
            if let Some(list) = table.get_mut(k) {
                list.retain(|f| !Arc::ptr_eq(f, &self.flag));
                if list.is_empty() {
                    table.remove(k);
                }
            }
        }
    }
}

/// End every command running under `cancel_key`, and whatever each started.
#[tauri::command]
pub fn shell_cancel(cancel_key: String) {
    if cancel_key.is_empty() {
        return;
    }
    if let Ok(mut stopped) = stopped_keys().lock() {
        if !stopped.contains(&cancel_key) {
            stopped.push_back(cancel_key.clone());
            while stopped.len() > STOPPED_KEYS_KEPT {
                stopped.pop_front();
            }
        }
    }
    if let Ok(table) = running().lock() {
        for flag in table.get(&cancel_key).into_iter().flatten() {
            flag.store(true, Ordering::Relaxed);
        }
    }
}

/// End the child and everything it started. The child leads a process group
/// of its own (see `prepare`), so a compiler a build started, or a server a
/// script launched, goes with it, and the output pipes they held close.
#[cfg(unix)]
fn kill_tree(child: &mut Child) {
    let _ = Command::new("sh")
        .arg("-c")
        .arg(format!("kill -s KILL -- -{}", child.id()))
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
    let _ = child.kill();
}

#[cfg(windows)]
fn kill_tree(child: &mut Child) {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let _ = Command::new("taskkill")
        .args(["/T", "/F", "/PID", &child.id().to_string()])
        .creation_flags(CREATE_NO_WINDOW)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
    let _ = child.kill();
}

/// Wait for the child, ending it if it outlives `timeout` or its run is stopped.
///
/// Returns `(exit_code, timed_out, stopped)`.
fn wait_with_timeout(child: &mut Child, timeout: Duration, stop: &StopFlag) -> (i32, bool, bool) {
    let start = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(status)) => return (status.code().unwrap_or(-1), false, false),
            Ok(None) => {
                let stopped = stop.is_set();
                if stopped || start.elapsed() >= timeout {
                    kill_tree(child);
                    let _ = child.wait();
                    return (-1, !stopped, stopped);
                }
                thread::sleep(Duration::from_millis(50));
            }
            Err(_) => return (-1, false, false),
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
pub async fn shell_run_line(
    line: String,
    cwd: Option<String>,
    timeout_ms: Option<u64>,
) -> Result<ShellOutput, String> {
    let (shell, flag) = platform_shell();
    let args = vec![flag.to_string(), line];
    super::off_main(move || run_blocking(shell.to_string(), args, cwd, timeout_ms, None, Caller::Person)).await
}

#[tauri::command]
pub async fn shell_run_line_stream(
    line: String,
    cwd: Option<String>,
    timeout_ms: Option<u64>,
    on_chunk: Channel<StreamChunk>,
) -> Result<(), String> {
    let (shell, flag) = platform_shell();
    let args = vec![flag.to_string(), line];
    super::off_main(move || run_stream_blocking(shell.to_string(), args, cwd, timeout_ms, None, Caller::Person, on_chunk)).await
}

// The commands run on a worker thread (see `off_main`); the work itself is
// below, as ordinary blocking functions.
//
// shell_run and shell_run_stream are the agent's: the command starts without
// the settings `is_secret_name` picks out. The two line variants above are the
// terminal's, where a person types the command, and inherit everything.
#[tauri::command]
pub async fn shell_run(
    command: String,
    args: Vec<String>,
    cwd: Option<String>,
    timeout_ms: Option<u64>,
    cancel_key: Option<String>,
) -> Result<ShellOutput, String> {
    super::off_main(move || run_blocking(command, args, cwd, timeout_ms, cancel_key, Caller::Agent)).await
}

#[tauri::command]
pub async fn shell_run_stream(
    command: String,
    args: Vec<String>,
    cwd: Option<String>,
    timeout_ms: Option<u64>,
    cancel_key: Option<String>,
    on_chunk: Channel<StreamChunk>,
) -> Result<(), String> {
    super::off_main(move || run_stream_blocking(command, args, cwd, timeout_ms, cancel_key, Caller::Agent, on_chunk)).await
}

fn run_blocking(
    command: String,
    args: Vec<String>,
    cwd: Option<String>,
    timeout_ms: Option<u64>,
    cancel_key: Option<String>,
    caller: Caller,
) -> Result<ShellOutput, String> {
    let mut cmd = prepare(&command, &args, &cwd, caller)?;
    if caller == Caller::Agent {
        without_secrets(&mut cmd);
    }
    let timeout = resolve_timeout(timeout_ms);
    let stop = StopFlag::register(cancel_key);
    if stop.is_set() {
        return Err(STOPPED_BEFORE_START.to_string());
    }

    let mut child = cmd.spawn().map_err(|e| e.to_string())?;
    let stdout = child.stdout.take().ok_or("Failed to capture stdout")?;
    let stderr = child.stderr.take().ok_or("Failed to capture stderr")?;

    // Both pipes are drained on their own threads. Reading them in sequence
    // deadlocks as soon as the child fills the one that is not being read.
    let out_handle = thread::spawn(move || read_capped(stdout));
    let err_handle = thread::spawn(move || read_capped(stderr));

    let (code, timed_out, stopped) = wait_with_timeout(&mut child, timeout, &stop);

    let (stdout_text, out_cut) = out_handle.join().unwrap_or_else(|_| (String::new(), false));
    let (mut stderr_text, err_cut) = err_handle.join().unwrap_or_else(|_| (String::new(), false));

    if timed_out {
        stderr_text.push_str(&format!(
            "\n\n[Killed after {} s — the command exceeded its time limit. \
             Long builds should be given a larger timeoutMs, or run in the background.]",
            timeout.as_secs()
        ));
    }

    if stopped {
        stderr_text.push_str(STOPPED_NOTE);
    }

    Ok(ShellOutput {
        stdout: stdout_text,
        stderr: stderr_text,
        code,
        timed_out,
        truncated: out_cut || err_cut,
        stopped,
    })
}

fn run_stream_blocking(
    command: String,
    args: Vec<String>,
    cwd: Option<String>,
    timeout_ms: Option<u64>,
    cancel_key: Option<String>,
    caller: Caller,
    on_chunk: Channel<StreamChunk>,
) -> Result<(), String> {
    let mut cmd = prepare(&command, &args, &cwd, caller)?;
    if caller == Caller::Agent {
        without_secrets(&mut cmd);
    }
    let timeout = resolve_timeout(timeout_ms);
    let stop = StopFlag::register(cancel_key);
    if stop.is_set() {
        return Err(STOPPED_BEFORE_START.to_string());
    }

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

    let (code, timed_out, stopped) = wait_with_timeout(&mut child, timeout, &stop);

    let _ = out_handle.join();
    let _ = err_handle.join();

    if stopped {
        let _ = on_chunk.send(StreamChunk {
            kind: "stderr".into(),
            data: STOPPED_NOTE.trim().into(),
            code: None,
        });
    }

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
        let err = prepare("sh", &["-c".into(), "sudo rm -rf /".into()], &None, Caller::Person).unwrap_err();
        assert!(err.contains("denylist"));
    }

    #[test]
    fn prepare_refuses_a_command_that_reaches_for_a_key() {
        // The hole this closes: the filesystem denylist refuses this path, and
        // before now the shell handler happily read it anyway.
        let err = prepare("sh", &["-c".into(), "cat ~/.ssh/id_ed25519".into()], &None, Caller::Person).unwrap_err();
        assert!(err.contains("protected location"));
    }

    #[test]
    fn prepare_allows_ordinary_work() {
        assert!(prepare("git", &["status".into()], &None, Caller::Person).is_ok());
        assert!(prepare("npm", &["test".into()], &None, Caller::Person).is_ok());
    }

    #[test]
    fn a_working_directory_written_with_dot_dot_is_refused() {
        // The denylist matches the spelling it is given, and half of it is
        // prefixes. A directory that climbs out with `..` is spelled like
        // nothing on that list, so the shell used to start there — the command
        // text never mentions the destination, so nothing else would catch it.
        let escape = Some(format!("{}/../../../etc", env!("CARGO_MANIFEST_DIR")));
        let err = prepare("ls", &[], &escape, Caller::Person).unwrap_err();
        assert!(
            err.contains("Working directory refused"),
            "unexpected refusal: {err}"
        );

        // And the plain spelling stays refused, which it always was.
        let err = prepare("ls", &[], &Some("/etc".to_string()), Caller::Person).unwrap_err();
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
        assert!(prepare("git", &["status".into()], &here, Caller::Person).is_ok());
    }

    #[test]
    fn a_hanging_command_is_killed_rather_than_waited_on_forever() {
        let mut cmd = prepare("sleep", &["30".into()], &None, Caller::Person).unwrap();
        let mut child = cmd.spawn().expect("sleep should spawn");
        let start = Instant::now();
        let (_, timed_out, stopped) = wait_with_timeout(&mut child, Duration::from_millis(300), &StopFlag::register(None));
        assert!(timed_out && !stopped, "the command should have hit the time limit");
        assert!(
            start.elapsed() < Duration::from_secs(5),
            "it should have been killed promptly, not waited out"
        );
    }

    #[test]
    fn a_command_that_reads_stdin_gets_eof_instead_of_hanging() {
        // stdin is null, so `cat` sees end-of-file immediately. Before this it
        // inherited the app's stdin and could block until the app was killed.
        let mut cmd = prepare("cat", &[], &None, Caller::Person).unwrap();
        let mut child = cmd.spawn().expect("cat should spawn");
        let (code, timed_out, _) = wait_with_timeout(&mut child, Duration::from_secs(5), &StopFlag::register(None));
        assert!(!timed_out, "cat should have exited on its own");
        assert_eq!(code, 0);
    }

    // ── Stopping a run's commands ──────────────────────────────────────────
    // Each test uses a key of its own: the table is shared by the process, and
    // tests run side by side.

    #[test]
    fn a_flag_is_listed_under_its_key_only_while_its_command_runs() {
        let flag = StopFlag::register(Some("t-listed".into()));
        assert!(running().lock().unwrap().contains_key("t-listed"));
        assert!(!flag.is_set());
        shell_cancel("t-listed".into());
        assert!(flag.is_set(), "cancelling the key sets its command's flag");
        drop(flag);
        assert!(!running().lock().unwrap().contains_key("t-listed"), "a finished command leaves the table");
    }

    #[test]
    fn a_command_with_no_key_is_never_stopped_by_a_cancel() {
        let flag = StopFlag::register(None);
        shell_cancel(String::new());
        shell_cancel("t-other".into());
        assert!(!flag.is_set());
    }

    #[test]
    fn a_command_asked_for_after_its_run_was_stopped_does_not_start() {
        shell_cancel("t-late".into());
        let out = run_blocking("echo".into(), vec!["hi".into()], None, None, Some("t-late".into()), Caller::Person);
        assert_eq!(out.err().as_deref(), Some(STOPPED_BEFORE_START));
    }

    #[test]
    fn stopped_keys_are_kept_to_a_bounded_list() {
        for i in 0..(STOPPED_KEYS_KEPT + 10) {
            shell_cancel(format!("t-bound-{i}"));
        }
        assert!(stopped_keys().lock().unwrap().len() <= STOPPED_KEYS_KEPT);
    }

    /// Run `line` under `key` on another thread, stop the key after a moment,
    /// and return how long the run took and what it reported.
    #[cfg(unix)]
    fn stop_after(line: &str, key: &str) -> (Duration, ShellOutput) {
        let (line, k) = (line.to_string(), key.to_string());
        let start = Instant::now();
        let run = thread::spawn(move || run_blocking("sh".into(), vec!["-c".into(), line], None, None, Some(k), Caller::Person));
        thread::sleep(Duration::from_millis(400));
        shell_cancel(key.to_string());
        let out = run.join().unwrap().expect("the command should have run");
        (start.elapsed(), out)
    }

    #[cfg(unix)]
    #[test]
    fn stopping_a_run_ends_its_command_promptly() {
        let (took, out) = stop_after("sleep 30", "t-stop");
        assert!(out.stopped && !out.timed_out);
        assert!(took < Duration::from_secs(5), "it took {took:?}");
        assert!(out.stderr.contains("Stopped from the app"));
    }

    #[cfg(unix)]
    #[test]
    fn stopping_ends_what_the_command_started_too() {
        // The background sleep holds the output pipe open. Ending only the
        // shell left the run waiting on that pipe until the sleep finished.
        let (took, out) = stop_after("sleep 30 & sleep 30", "t-tree");
        assert!(out.stopped);
        assert!(took < Duration::from_secs(5), "it took {took:?}");
    }

    #[cfg(unix)]
    #[test]
    fn the_time_limit_ends_what_the_command_started_too() {
        let start = Instant::now();
        let out = run_blocking("sh".into(), vec!["-c".into(), "sleep 30 & sleep 30".into()], None, Some(1_000), None, Caller::Person).unwrap();
        assert!(out.timed_out && !out.stopped);
        assert!(start.elapsed() < Duration::from_secs(6), "it took {:?}", start.elapsed());
    }

    #[cfg(unix)]
    #[test]
    fn a_command_that_finishes_is_not_reported_as_stopped() {
        let out = run_blocking("sh".into(), vec!["-c".into(), "echo done".into()], None, None, Some("t-done".into()), Caller::Person).unwrap();
        assert!(!out.stopped && !out.timed_out && out.stdout.contains("done"));
    }

    #[test]
    fn settings_named_like_a_secret_are_recognised() {
        for name in [
            "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY",
            "AWS_SESSION_TOKEN", "GITHUB_TOKEN", "GH_TOKEN", "NPM_TOKEN", "DATABASE_URL",
            "GOOGLE_APPLICATION_CREDENTIALS", "DB_PASSWORD", "openai_api_key", "SMTP_PASS",
            "SOME_APIKEY", "GITLAB_PAT",
        ] {
            assert!(is_secret_name(name), "{name} should be treated as a secret");
        }
    }

    #[test]
    fn ordinary_settings_are_not_mistaken_for_secrets() {
        for name in [
            "PATH", "HOME", "PWD", "OLDPWD", "USER", "SHELL", "LANG", "TERM", "TMPDIR",
            "SSH_AUTH_SOCK", "GIT_AUTHOR_NAME", "KEYCHAIN_PATH", "TOKENIZERS_PARALLELISM",
            "NODE_ENV", "CARGO_HOME", "PASSAGE_DIR",
        ] {
            assert!(!is_secret_name(name), "{name} should be passed on");
        }
    }

    #[cfg(unix)]
    #[test]
    fn an_agent_command_starts_without_secrets_and_a_typed_one_keeps_them() {
        // Names used by no other test, so setting them here cannot change another.
        std::env::set_var("HC_SHELL_TEST_API_KEY", "value-a");
        std::env::set_var("HC_SHELL_TEST_PLAIN", "value-b");
        let line = "echo ${HC_SHELL_TEST_API_KEY:-absent} ${HC_SHELL_TEST_PLAIN:-absent}";
        let agent = run_blocking("sh".into(), vec!["-c".into(), line.into()], None, None, None, Caller::Agent).unwrap();
        let typed = run_blocking("sh".into(), vec!["-c".into(), line.into()], None, None, None, Caller::Person).unwrap();
        assert_eq!(agent.stdout.trim(), "absent value-b");
        assert_eq!(typed.stdout.trim(), "value-a value-b");
    }
    #[cfg(target_os = "macos")]
    #[test]
    fn an_agent_command_runs_in_the_sandbox_and_a_typed_one_does_not() {
        let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("target")
            .join("shell-sandbox-scratch")
            .join(format!("run-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("id_ed25519"), "secret").unwrap();
        // The name is put together at run time, so no text check sees it.
        let line = "cat \"$(printf %s id_ed)25519\"";
        let cwd = Some(dir.to_string_lossy().into_owned());
        let agent = run_blocking("sh".into(), vec!["-c".into(), line.into()], cwd.clone(), None, None, Caller::Agent).unwrap();
        let typed = run_blocking("sh".into(), vec!["-c".into(), line.into()], cwd, None, None, Caller::Person).unwrap();
        assert!(!agent.stdout.contains("secret") && agent.code != 0, "the agent read it: {} {}", agent.stdout, agent.stderr);
        assert_eq!(typed.stdout, "secret");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
