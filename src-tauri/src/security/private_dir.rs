// ==============================================================
// The app's own folder is private to the account that runs it
//
// ~/.hashcortx holds Undo's copies of project files, the audit log of what
// the agent did, the usage log, saved 3D Forge projects and the last Swarm
// site. The folders those files come from — Desktop, Documents — are usually
// readable by their owner only, so a copy of one kept here is too: this
// folder is made readable by this account only on macOS and Linux, and
// tightened to that at every launch if it exists with wider permissions.
//
// Only the top folder needs it. No other account can open anything inside a
// folder it cannot enter, whatever the files inside allow.
//
// Windows keeps a profile folder private to its account already, so there
// is nothing to do there.
// ==============================================================

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

/// The name of the app's own folder in the home directory.
const APP_DIR: &str = ".hashcortx";

/// `~/.hashcortx`, or None without a home directory.
fn app_root() -> Option<PathBuf> {
    dirs::home_dir().map(|home| home.join(APP_DIR))
}

/// Make `dir` and any folder missing above it, readable by this account only,
/// and keep the app's own folder that way if `dir` is inside it.
///
/// Use this instead of `fs::create_dir_all` for anything under ~/.hashcortx.
pub fn create(dir: &Path) -> io::Result<()> {
    let mut builder = fs::DirBuilder::new();
    builder.recursive(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        builder.mode(0o700);
    }
    builder.create(dir)?;
    if let Some(root) = dir.ancestors().find(|p| p.file_name().is_some_and(|n| n == APP_DIR)) {
        tighten(root);
    }
    Ok(())
}

/// Tighten the app's folder at launch, if it is there. Best effort: failing
/// to change a permission must not stop the app from starting.
pub fn tighten_app_root() {
    if let Some(root) = app_root() {
        if root.is_dir() {
            tighten(&root);
        }
    }
}

/// Remove every permission other accounts have on `dir`. Best effort.
#[cfg(unix)]
fn tighten(dir: &Path) {
    use std::os::unix::fs::PermissionsExt;
    // symlink_metadata, so a link standing in for the folder is not followed
    // to somewhere else and changed there.
    let Ok(meta) = fs::symlink_metadata(dir) else { return };
    if !meta.is_dir() {
        return;
    }
    let mode = meta.permissions().mode();
    if mode & 0o077 != 0 {
        let _ = fs::set_permissions(dir, fs::Permissions::from_mode(mode & 0o700));
    }
}

#[cfg(not(unix))]
fn tighten(_dir: &Path) {}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;

    fn scratch(name: &str) -> PathBuf {
        let dir = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("target")
            .join("private-dir-scratch")
            .join(format!("{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn mode(p: &Path) -> u32 {
        fs::metadata(p).unwrap().permissions().mode() & 0o777
    }

    #[test]
    fn a_new_app_folder_and_what_is_made_inside_it_are_owner_only() {
        let home = scratch("new");
        let inner = home.join(APP_DIR).join("checkpoints");
        create(&inner).unwrap();
        assert_eq!(mode(&home.join(APP_DIR)), 0o700);
        assert_eq!(mode(&inner), 0o700);
    }

    #[test]
    fn an_existing_app_folder_open_to_others_is_tightened() {
        let home = scratch("existing");
        let root = home.join(APP_DIR);
        fs::create_dir_all(root.join("forge")).unwrap();
        fs::set_permissions(&root, fs::Permissions::from_mode(0o755)).unwrap();
        create(&root.join("forge")).unwrap();
        assert_eq!(mode(&root), 0o700);
    }

    #[test]
    fn the_owner_keeps_every_permission_it_had() {
        let home = scratch("owner");
        let root = home.join(APP_DIR);
        fs::create_dir_all(&root).unwrap();
        fs::set_permissions(&root, fs::Permissions::from_mode(0o775)).unwrap();
        create(&root).unwrap();
        assert_eq!(mode(&root), 0o700);
    }

    #[test]
    fn a_folder_elsewhere_is_made_owner_only_and_nothing_above_it_changes() {
        let base = scratch("elsewhere");
        fs::set_permissions(&base, fs::Permissions::from_mode(0o755)).unwrap();
        let dir = base.join("logs");
        create(&dir).unwrap();
        assert_eq!(mode(&dir), 0o700);
        assert_eq!(mode(&base), 0o755);
    }

    #[test]
    fn a_link_in_place_of_the_app_folder_is_not_followed() {
        let home = scratch("link");
        let target = home.join("somewhere");
        fs::create_dir_all(&target).unwrap();
        fs::set_permissions(&target, fs::Permissions::from_mode(0o755)).unwrap();
        std::os::unix::fs::symlink(&target, home.join(APP_DIR)).unwrap();
        tighten(&home.join(APP_DIR));
        assert_eq!(mode(&target), 0o755);
    }
}
