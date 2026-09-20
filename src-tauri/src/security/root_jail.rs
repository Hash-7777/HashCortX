// ==============================================================
// The folder the agent may touch, enforced here rather than asked about
//
// WHAT THIS ADDS
// --------------
// The Permission Guard in the renderer already decides this: paths inside the
// folder the person opened are allowed, everything else raises a dialog. But
// the guard is renderer code. It is the same argument the denylist beside this
// file makes about itself — a decision that only exists in JavaScript is not a
// floor, it is a convention, and the file commands underneath it would happily
// read anything the denylist did not name. `~/Documents`, a sibling project,
// a folder of invoices: all readable, if anything ever went wrong one layer up.
//
// So the boundary is kept here too. The agent's file commands refuse a path
// that does not resolve inside the open folder, unless the person approved
// that exact path — and it is Rust that remembers the approval, not the caller.
//
// WHAT IT DOES NOT ADD, AND docs/SECURITY.md MUST SAY SO
// -----------------------------------------------------
// This is defence in depth against a MISBEHAVING MODEL, not against code
// running in the renderer. A model drives tools; it cannot invoke commands
// itself, so it cannot grant itself a path — a person has to approve one. Code
// running in the renderer could call `fs_grant_path` directly and grant
// whatever it liked. That is not a hole this file can close, and the Content
// Security Policy is what stands in the way of it.
//
// What it does buy is exact:
//   · the default is closed. Before, a path outside the project was refused
//     only by a dialog in JavaScript; now it is refused by this file too.
//   · a bug in that dialog — a path levelled wrongly, a promise not awaited,
//     a race between two approvals — no longer opens the whole disk.
//   · the approval is for ONE path. Approving a file does not approve its
//     folder, and approving a folder does not approve its parent.
//
// Symlinks are resolved before anything is compared, so a link inside the
// project pointing at a home folder is judged by where it lands.
// ==============================================================

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

/// The most paths a person may approve in one session.
///
/// A dialog per path means this is a count of deliberate clicks, so the cap is
/// generous. It is here so that a loop approving paths cannot grow without end.
const MAX_GRANTS: usize = 512;

struct State {
    root: Option<PathBuf>,
    grants: HashSet<PathBuf>,
}

fn state() -> &'static Mutex<State> {
    static STATE: OnceLock<Mutex<State>> = OnceLock::new();
    STATE.get_or_init(|| {
        Mutex::new(State {
            root: None,
            grants: HashSet::new(),
        })
    })
}

/// The user's home directory, if the platform names one.
fn home() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
        .and_then(|p| std::fs::canonicalize(p).ok())
}

/// Whether a folder is too wide to be a project.
///
/// A jail around everything is not a jail. The filesystem root and the home
/// directory itself are refused: opening either as "the project" would grant
/// the agent the whole disk in one click while looking like a boundary.
fn too_wide(real: &Path) -> bool {
    if real.parent().is_none() {
        return true; // "/" or a drive root
    }
    match home() {
        Some(h) => real == h,
        None => false,
    }
}

/// Open a folder as the project. Replaces any previous one and forgets every
/// path approved for it, because an approval was given about a different piece
/// of work.
pub fn set_root(path: &str) -> Result<PathBuf, String> {
    if path.trim().is_empty() {
        return Err("no folder was given.".into());
    }
    if super::denylist::is_path_denied(path) {
        return Err("that folder is protected and cannot be opened.".into());
    }
    let real = std::fs::canonicalize(path)
        .map_err(|e| format!("that folder cannot be opened: {e}"))?;
    if !real.is_dir() {
        return Err("that is a file, not a folder.".into());
    }
    if super::denylist::is_path_denied(&real.to_string_lossy()) {
        return Err("that folder resolves to a protected location.".into());
    }
    if too_wide(&real) {
        return Err(
            "a whole home directory or disk cannot be opened as a project — choose the folder the work is in."
                .into(),
        );
    }
    let mut s = state().lock().map_err(|_| "the path table is unavailable.".to_string())?;
    s.root = Some(real.clone());
    s.grants.clear();
    Ok(real)
}

/// Forget the open folder and everything approved for it.
pub fn clear_root() {
    if let Ok(mut s) = state().lock() {
        s.root = None;
        s.grants.clear();
    }
}

/// Remember that the person approved this exact path.
///
/// Called after the dialog says yes. The path is resolved first, so approving
/// a link approves where it lands rather than the name it was written as.
pub fn grant(path: &str) -> Result<(), String> {
    if path.trim().is_empty() {
        return Err("no path was given.".into());
    }
    if super::denylist::is_path_denied(path) {
        return Err("that path is protected and cannot be approved.".into());
    }
    let real = resolve(Path::new(path)).ok_or_else(|| "that path cannot be resolved.".to_string())?;
    if super::denylist::is_path_denied(&real.to_string_lossy()) {
        return Err("that path resolves to a protected location.".into());
    }
    if too_wide(&real) {
        return Err("a whole home directory or disk cannot be approved at once.".into());
    }
    let mut s = state().lock().map_err(|_| "the path table is unavailable.".to_string())?;
    if s.grants.len() >= MAX_GRANTS && !s.grants.contains(&real) {
        return Err("too many paths have been approved in this session.".into());
    }
    s.grants.insert(real);
    Ok(())
}

/// Where a path really is, resolving what exists and keeping the rest.
///
/// A file being created is not there yet, so the nearest folder that does exist
/// is resolved and the remainder put back on it — the same rule the file
/// commands use, kept here so a path is judged one way only.
fn resolve(path: &Path) -> Option<PathBuf> {
    if let Ok(real) = std::fs::canonicalize(path) {
        return Some(real);
    }
    let mut rest = Vec::new();
    let mut here = path;
    loop {
        let parent = here.parent()?;
        rest.push(here.file_name()?.to_owned());
        if let Ok(real) = std::fs::canonicalize(parent) {
            let mut out = real;
            for part in rest.iter().rev() {
                out.push(part);
            }
            return Some(out);
        }
        here = parent;
    }
}

/// Whether the agent may touch this path.
///
/// `Ok(())` or a refusal saying which boundary it fell outside, in the words a
/// person would use about their own folders.
pub fn check(path: &str) -> Result<(), String> {
    let s = state().lock().map_err(|_| "the path table is unavailable.".to_string())?;
    let Some(real) = resolve(Path::new(path)) else {
        return Err(format!("\"{path}\" cannot be resolved, so it is refused."));
    };
    if let Some(root) = &s.root {
        if real.starts_with(root) {
            return Ok(());
        }
    }
    if s.grants.iter().any(|g| real.starts_with(g)) {
        return Ok(());
    }
    Err(match &s.root {
        Some(root) => format!(
            "\"{path}\" is outside the open project ({}), and has not been approved.",
            root.display()
        ),
        None => format!("\"{path}\" has not been approved, and no project folder is open."),
    })
}

/// A turn at the one path table, for tests.
///
/// The root and the approvals are process-wide, as they are in a running app,
/// and `cargo test` runs tests side by side. Without this, one test opening a
/// folder — which forgets what another had approved — makes its neighbour fail
/// at random. Every test that touches this table takes a turn; they are
/// millisecond tests, so the cost is nothing and the alternative is a suite
/// that fails once a fortnight for no reason anyone can reproduce.
#[cfg(test)]
pub fn test_turn() -> std::sync::MutexGuard<'static, ()> {
    static TURN: Mutex<()> = Mutex::new(());
    // A failing test poisons the lock, and a poisoned lock turns one real
    // failure into a page of identical ones that say nothing about the cause.
    TURN.lock().unwrap_or_else(|e| e.into_inner())
}

#[cfg(test)]
mod tests {
    use super::*;

    use super::test_turn as turn;

    /// A folder to test in, under the build directory rather than the system
    /// temporary one — on macOS that resolves inside /private/var, which the
    /// denylist refuses outright, so every fixture there is correctly denied
    /// and every test fails for a reason that has nothing to do with the jail.
    fn scratch(name: &str) -> PathBuf {
        let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("target")
            .join(format!("hcx_jail_{name}_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("src")).unwrap();
        std::fs::write(dir.join("src").join("a.txt"), "hello").unwrap();
        std::fs::canonicalize(&dir).unwrap()
    }

    #[test]
    fn nothing_is_allowed_before_a_folder_is_opened() {
        let _t = turn();
        clear_root();
        let dir = scratch("closed");
        assert!(check(dir.join("src").join("a.txt").to_str().unwrap()).is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn inside_the_open_folder_is_allowed_and_outside_is_not() {
        let _t = turn();
        let dir = scratch("inside");
        set_root(dir.to_str().unwrap()).unwrap();
        assert!(check(dir.join("src").join("a.txt").to_str().unwrap()).is_ok());
        // A file that does not exist yet is judged by where it would land.
        assert!(check(dir.join("src").join("new.txt").to_str().unwrap()).is_ok());
        let outside = dir.parent().unwrap().join("somewhere-else.txt");
        assert!(check(outside.to_str().unwrap()).is_err());
        clear_root();
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn an_approved_path_is_allowed_and_only_that_path() {
        let _t = turn();
        let dir = scratch("granted");
        let outside_dir = scratch("granted_out");
        set_root(dir.to_str().unwrap()).unwrap();
        let file = outside_dir.join("src").join("a.txt");
        assert!(check(file.to_str().unwrap()).is_err());
        grant(file.to_str().unwrap()).unwrap();
        assert!(check(file.to_str().unwrap()).is_ok());
        // Approving a file does not approve its folder, nor anything beside it.
        assert!(check(outside_dir.join("src").to_str().unwrap()).is_err());
        assert!(check(outside_dir.join("src").join("b.txt").to_str().unwrap()).is_err());
        clear_root();
        let _ = std::fs::remove_dir_all(&dir);
        let _ = std::fs::remove_dir_all(&outside_dir);
    }

    #[test]
    fn opening_another_folder_forgets_what_was_approved_for_the_last() {
        let _t = turn();
        let first = scratch("first");
        let second = scratch("second");
        let other = scratch("other");
        let file = other.join("src").join("a.txt");
        set_root(first.to_str().unwrap()).unwrap();
        grant(file.to_str().unwrap()).unwrap();
        assert!(check(file.to_str().unwrap()).is_ok());
        set_root(second.to_str().unwrap()).unwrap();
        assert!(
            check(file.to_str().unwrap()).is_err(),
            "an approval given for one project must not carry into another"
        );
        clear_root();
        for d in [first, second, other] {
            let _ = std::fs::remove_dir_all(d);
        }
    }

    #[test]
    fn a_whole_disk_or_home_cannot_be_opened_as_a_project() {
        let _t = turn();
        clear_root();
        assert!(set_root("/").is_err());
        if let Some(h) = home() {
            assert!(set_root(h.to_str().unwrap()).is_err());
            // A folder inside home is perfectly ordinary.
            let inside = h.join("Desktop");
            if inside.is_dir() {
                assert!(set_root(inside.to_str().unwrap()).is_ok());
            }
        }
        clear_root();
    }

    #[test]
    fn a_protected_folder_is_neither_opened_nor_approved() {
        let _t = turn();
        clear_root();
        for p in ["/etc", "/usr/bin"] {
            assert!(set_root(p).is_err(), "{p} must not be opened as a project");
            assert!(grant(p).is_err(), "{p} must not be approvable");
        }
        clear_root();
    }

    #[test]
    fn a_link_out_of_the_project_is_judged_by_where_it_lands() {
        let _t = turn();
        let dir = scratch("link_in");
        let outside = scratch("link_out");
        set_root(dir.to_str().unwrap()).unwrap();
        let link = dir.join("escape");
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(&outside, &link).unwrap();
            assert!(
                check(link.join("src").join("a.txt").to_str().unwrap()).is_err(),
                "a link is spelled like a path inside the project and must be judged by its destination"
            );
        }
        let _ = link;
        clear_root();
        let _ = std::fs::remove_dir_all(&dir);
        let _ = std::fs::remove_dir_all(&outside);
    }
}
