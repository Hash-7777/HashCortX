// ==============================================================
// The system sandbox around the agent's shell commands (macOS)
//
// denylist.rs judges a command by its text, and a command can spell a path in
// ways no text match foresees. On macOS every command the agent runs is
// started inside the system sandbox (sandbox-exec) with the profile below. The
// kernel applies it to the command and to everything the command starts, to
// the path as it resolves, however the command wrote it:
//   · the credential and private-data locations denylist.rs names cannot be
//     read or written — keys, cloud and tool credentials, keychains, browser,
//     mail and message data, the shell's start-up files, and HashCortX's own
//     data, where the API keys are;
//   · the places that start a program by themselves cannot be written.
// Everything else a command could do before, it can still do. Commands a
// person types in the terminal are not put in the sandbox.
//
// Without the sandbox tool an agent's command is refused, not run with less.
//
// Linux and Windows have no equivalent without extra software, so there the
// agent's commands run as before, under the denylist alone (docs/SECURITY.md).
// ==============================================================

// The profile is built and tested everywhere, and used only on macOS.
#![cfg_attr(not(target_os = "macos"), allow(dead_code))]

use std::path::Path;
use std::process::Command;

/// macOS's sandbox tool.
#[cfg(target_os = "macos")]
pub const TOOL: &str = "/usr/bin/sandbox-exec";

/// Folders in the home directory that are neither read nor written.
const PRIVATE_DIRS: &[&str] = &[
    ".ssh",
    ".aws",
    ".gnupg",
    ".azure",
    ".config/gh",
    ".config/gcloud",
    ".config/op",
    ".password-store",
    ".hashcortx",
    "Library/Keychains",
    "Library/Cookies",
    "Library/Safari",
    "Library/Mail",
    "Library/Messages",
    "Library/Application Support/Google/Chrome",
    "Library/Application Support/BraveSoftware",
    "Library/Application Support/Firefox",
    "Library/Application Support/Microsoft Edge",
    "Library/Application Support/com.hashcortx.app",
    "Library/WebKit/com.hashcortx.app",
    "Library/Caches/com.hashcortx.app",
];

/// Files in the home directory that are neither read nor written: credentials,
/// and the shell's start-up files, where people export their API keys.
const PRIVATE_FILES: &[&str] = &[
    ".netrc",
    ".npmrc",
    ".pypirc",
    ".kube/config",
    ".docker/config.json",
    ".git-credentials",
    ".config/git/credentials",
    ".pgpass",
    ".cargo/credentials",
    ".cargo/credentials.toml",
    ".vault-token",
    ".terraform.d/credentials.tfrc.json",
    ".gem/credentials",
    ".zshrc",
    ".zshenv",
    ".zprofile",
    ".zlogin",
    ".bashrc",
    ".bash_profile",
    ".bash_login",
    ".profile",
];

/// Places in the home directory where a file starts a program by itself.
const START_UP_DIRS: &[&str] = &["Library/LaunchAgents", "Library/StartupItems", ".config/autostart"];
const START_UP_FILES: &[&str] = &[".config/fish/config.fish"];

/// The same, for the whole machine, and the system keychains.
const SYSTEM_START_UP_DIRS: &[&str] = &["/Library/LaunchAgents", "/Library/LaunchDaemons", "/Library/StartupItems", "/private/var/at"];
const SYSTEM_PRIVATE_DIRS: &[&str] = &["/Library/Keychains"];

/// A path as a sandbox profile string.
fn quoted(path: &str) -> String {
    format!("\"{}\"", path.replace('\\', "\\\\").replace('"', "\\\""))
}

/// The sandbox profile for an agent's command, for the account whose home
/// directory is `home`.
pub fn profile(home: &Path) -> String {
    let home = home.to_string_lossy();
    let home = home.trim_end_matches('/');
    let under = |rel: &str| format!("{home}/{rel}");
    let mut private: Vec<String> = Vec::new();
    for d in PRIVATE_DIRS {
        private.push(format!("(subpath {})", quoted(&under(d))));
    }
    for f in PRIVATE_FILES {
        private.push(format!("(literal {})", quoted(&under(f))));
    }
    for d in SYSTEM_PRIVATE_DIRS {
        private.push(format!("(subpath {})", quoted(d)));
    }
    // A private key is refused by its name wherever it is kept.
    private.push("(regex #\"/id_(rsa|dsa|ecdsa|ed25519)[^/]*$\")".to_string());

    let mut start_up: Vec<String> = Vec::new();
    for d in START_UP_DIRS {
        start_up.push(format!("(subpath {})", quoted(&under(d))));
    }
    for f in START_UP_FILES {
        start_up.push(format!("(literal {})", quoted(&under(f))));
    }
    for d in SYSTEM_START_UP_DIRS {
        start_up.push(format!("(subpath {})", quoted(d)));
    }

    format!(
        "(version 1)\n(allow default)\n(deny file-read* file-write*\n  {})\n(deny file-write*\n  {})\n",
        private.join("\n  "),
        start_up.join("\n  ")
    )
}

/// The refusal when the sandbox cannot be used.
pub const UNAVAILABLE: &str = "Agent commands run inside macOS's sandbox, and this Mac does not have its \
sandbox tool, so the command was refused. Commands you type in the terminal still run.";

/// A `Command` that runs `program` inside the sandbox — or a refusal.
#[cfg(target_os = "macos")]
pub fn command(program: &str) -> Result<Command, String> {
    command_with(Path::new(TOOL), program, dirs::home_dir().as_deref())
}

#[cfg(target_os = "macos")]
fn command_with(tool: &Path, program: &str, home: Option<&Path>) -> Result<Command, String> {
    let home = home.filter(|h| h.is_absolute()).ok_or_else(|| UNAVAILABLE.to_string())?;
    if !tool.is_file() {
        return Err(UNAVAILABLE.to_string());
    }
    let mut cmd = Command::new(tool);
    cmd.arg("-p").arg(profile(home)).arg(program);
    Ok(cmd)
}

/// Elsewhere there is no sandbox to start the command in (see the top).
#[cfg(not(target_os = "macos"))]
pub fn command(program: &str) -> Result<Command, String> {
    Ok(Command::new(program))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_path_cannot_break_out_of_its_string_in_the_profile() {
        let p = profile(Path::new("/Users/a\"b\\c"));
        assert!(p.contains("(subpath \"/Users/a\\\"b\\\\c/.ssh\")"));
        assert!(!p.contains("/Users/a\"b"));
    }

    #[test]
    fn the_profile_covers_what_the_denylist_protects() {
        let p = profile(Path::new("/Users/someone"));
        for part in ["/.ssh\"", "/.aws\"", "/Library/Keychains\"", "/.zshrc\"", "com.hashcortx.app\"", "/.hashcortx\"", "/Library/LaunchAgents\"", "/Library/LaunchDaemons\""] {
            assert!(p.contains(part), "the profile should name {part}");
        }
        assert!(p.starts_with("(version 1)\n(allow default)\n"));
    }
}

#[cfg(all(test, target_os = "macos"))]
mod macos_tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;

    fn scratch(name: &str) -> PathBuf {
        let dir = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("target")
            .join("agent-sandbox-scratch")
            .join(format!("{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir.canonicalize().unwrap()
    }

    /// Run `line` with `sh -c` in the sandbox for `home`; (exit ok, stdout, stderr).
    fn run(home: &Path, line: &str) -> (bool, String, String) {
        let out = command_with(Path::new(TOOL), "sh", Some(home))
            .unwrap()
            .args(["-c", line])
            .output()
            .unwrap();
        (out.status.success(), String::from_utf8_lossy(&out.stdout).into_owned(), String::from_utf8_lossy(&out.stderr).into_owned())
    }

    #[test]
    fn a_key_cannot_be_read_however_its_path_is_spelled() {
        let home = scratch("keys");
        fs::create_dir_all(home.join(".ssh")).unwrap();
        fs::write(home.join(".ssh/id_test"), "secret").unwrap();
        let h = home.to_string_lossy();
        for line in [
            format!("cat '{h}/.ssh/id_test'"),
            format!("cat \"$(printf '%s' '{h}/.s')sh/id_test\""),
            format!("cd '{h}' && cat ./.SSH/../.ssh/id_test"),
            format!("ln -s '{h}/.ssh' '{h}/link' && cat '{h}/link/id_test'"),
            format!("(cat '{h}/.ssh/id_test') & wait"),
        ] {
            let (_, out, _) = run(&home, &line);
            assert!(!out.contains("secret"), "read through: {line}");
        }
        let (ok, _, _) = run(&home, &format!("echo x > '{h}/.ssh/added'"));
        assert!(!ok && !home.join(".ssh/added").exists());
        let _ = fs::remove_dir_all(&home);
    }

    #[test]
    fn a_private_key_is_refused_by_name_anywhere() {
        let home = scratch("keyname");
        fs::write(home.join("id_ed25519"), "secret").unwrap();
        let (_, out, _) = run(&home, &format!("cat '{}/id_ed25519'", home.to_string_lossy()));
        assert!(!out.contains("secret"));
        let _ = fs::remove_dir_all(&home);
    }

    #[test]
    fn the_start_up_files_and_the_apps_own_data_are_closed() {
        let home = scratch("private");
        let h = home.to_string_lossy();
        fs::write(home.join(".zshrc"), "export KEY=secret").unwrap();
        let data = home.join("Library/Application Support/com.hashcortx.app");
        fs::create_dir_all(&data).unwrap();
        fs::write(data.join("store"), "secret").unwrap();
        let (_, out, _) = run(&home, &format!("cat '{h}/.zshrc'; cat '{h}/Library/Application Support/com.hashcortx.app/store'"));
        assert!(!out.contains("secret"));
        let (ok, _, _) = run(&home, &format!("echo 'run me' >> '{h}/.zshrc'"));
        assert!(!ok);
        assert_eq!(fs::read_to_string(home.join(".zshrc")).unwrap(), "export KEY=secret");
        let _ = fs::remove_dir_all(&home);
    }

    #[test]
    fn nothing_can_be_left_to_start_at_login_but_it_can_be_read() {
        let home = scratch("startup");
        let agents = home.join("Library/LaunchAgents");
        fs::create_dir_all(&agents).unwrap();
        fs::write(agents.join("existing.plist"), "plist").unwrap();
        let h = home.to_string_lossy();
        let (ok, _, _) = run(&home, &format!("echo x > '{h}/Library/LaunchAgents/new.plist'"));
        assert!(!ok && !agents.join("new.plist").exists());
        let (ok, out, _) = run(&home, &format!("cat '{h}/Library/LaunchAgents/existing.plist'"));
        assert!(ok && out == "plist");
        let _ = fs::remove_dir_all(&home);
    }

    #[test]
    fn ordinary_work_is_untouched() {
        let home = scratch("work");
        let project = home.join("project");
        fs::create_dir_all(&project).unwrap();
        let p = project.to_string_lossy();
        let (ok, out, err) = run(&home, &format!("cd '{p}' && echo hi > a.txt && mkdir -p src && mv a.txt src/b.txt && cat src/b.txt && rm src/b.txt && echo done"));
        assert!(ok, "{err}");
        assert_eq!(out, "hi\ndone\n");
        let _ = fs::remove_dir_all(&home);
    }

    #[test]
    fn without_the_sandbox_tool_the_command_is_refused() {
        let home = scratch("notool");
        let err = command_with(&home.join("no-such-tool"), "sh", Some(&home)).unwrap_err();
        assert_eq!(err, UNAVAILABLE);
        assert_eq!(command_with(Path::new(TOOL), "sh", None).unwrap_err(), UNAVAILABLE);
        let _ = fs::remove_dir_all(&home);
    }
}
