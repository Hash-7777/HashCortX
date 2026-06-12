// ==============================================================
// Phase 3 — Hardcoded security denylist
//
// These paths and commands are ALWAYS blocked, regardless of any
// user approval. They cannot be overridden at runtime.
// ==============================================================

/// Path prefixes that are always denied.
/// Checked against the absolute, expanded path.
pub const BLOCKED_PATH_PREFIXES: &[&str] = &[
    "/.ssh",
    "/.aws",
    "/.gnupg",
    "/Library/Keychains",
    "/System",
    "/usr/bin",
    "/usr/sbin",
    "/usr/lib",
    "/etc",
    "/bin",
    "/sbin",
    "/private/etc",
    "/private/var",
];

/// Substrings that are never allowed inside a path.
pub const BLOCKED_PATH_SUBSTRINGS: &[&str] = &[
    ".ssh",
    ".aws",
    ".gnupg",
    "id_rsa",
    "id_ed25519",
    "credentials",
    "Keychains",
];

/// Shell command prefixes/tokens that are always blocked.
pub const BLOCKED_COMMANDS: &[&str] = &[
    "sudo",
    "su ",
    "rm -rf",
    "rm -fr",
    "rm -r ",
    "dd ",
    "mkfs",
    "fdisk",
    "parted",
    "diskutil eraseDisk",
    "format ",
    "shutdown",
    "reboot",
    "halt",
    "poweroff",
    "kill -9",
    "pkill",
    "launchctl",
    "chmod 777",
    "chown root",
    // Pipe-to-shell: executing downloaded/piped content in an interpreter.
    "| sh",
    "| bash",
    "| zsh",
    "| fish",
    "| python",
    "| node",
    "| perl",
    "| ruby",
    // Process substitution executing remote content.
    "bash <(",
    "sh <(",
    "zsh <(",
];

/// Returns `true` if the path is explicitly denied.
pub fn is_path_denied(path: &str) -> bool {
    let expanded = shellexpand::tilde(path).to_string();
    for prefix in BLOCKED_PATH_PREFIXES {
        if expanded.starts_with(prefix) {
            return true;
        }
    }
    for sub in BLOCKED_PATH_SUBSTRINGS {
        if expanded.contains(sub) {
            return true;
        }
    }
    false
}

/// Returns `true` if the shell command is explicitly denied.
pub fn is_command_denied(command: &str) -> bool {
    let lower = command.to_lowercase();
    for blocked in BLOCKED_COMMANDS {
        if lower.contains(blocked) {
            return true;
        }
    }
    false
}
