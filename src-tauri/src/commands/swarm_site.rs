// ==============================================================
// Opening a site the Agent Swarm built, in the browser
//
// The Swarm Workspace can show a site's files but cannot run the site: a
// preview inside the app inherits the app's security policy, which in a
// release allows none of a page's inline styles or scripts. So the site is
// opened where it can run as it was written — the system's browser.
//
// JS calls:
//   invoke("swarm_site_open", { html })
//
// The page is written to one fixed file, ~/.hashcortx/swarm/site.html, and
// that file is opened with whatever the system opens .html files with.
//
// WHY THE CALLER CANNOT NAME THE PATH
// -----------------------------------
// This writes a file without a save dialog, so where it writes is decided
// here and nowhere else. The caller hands over the page and nothing about
// where it goes, so there is nothing to point at a different file.
//
// WHY ~/.hashcortx
// ----------------
// That folder is on the filesystem denylist, so the coding agent's file tools
// and the shell cannot read or replace what is written there between writing
// it and the browser opening it.
//
// WHAT THE PAGE CAN DO
// --------------------
// It is a page the agents wrote, opened in the browser the way a person opens
// a downloaded site: it runs there with the browser's rules, as a local file,
// with no access to this app, its storage or its keys.
// ==============================================================

use std::fs;
use std::path::{Path, PathBuf};

/// The largest page that will be written. A single page with its styles and
/// scripts inside is text; past this, something built it in a loop.
const MAX_SITE_BYTES: usize = 32 * 1024 * 1024;

fn site_path_in(home: &Path) -> PathBuf {
    home.join(".hashcortx").join("swarm").join("site.html")
}

fn site_path() -> PathBuf {
    site_path_in(&dirs::home_dir().unwrap_or_else(|| PathBuf::from(".")))
}

/// Write the page, replacing the last one atomically: a temporary file beside
/// it, then a rename over the top, so a failure part way leaves the previous
/// page whole rather than half written.
fn write_site(path: &Path, html: &str) -> Result<(), String> {
    if html.len() > MAX_SITE_BYTES {
        return Err(format!(
            "the site is {} MB, more than the {} MB that can be opened",
            html.len() / (1024 * 1024),
            MAX_SITE_BYTES / (1024 * 1024)
        ));
    }
    if html.trim().is_empty() {
        return Err("there is no page to open".into());
    }
    let dir = path.parent().ok_or("the site has no folder")?;
    fs::create_dir_all(dir).map_err(|e| format!("could not make {}: {e}", dir.display()))?;
    let tmp = path.with_extension("html.tmp");
    fs::write(&tmp, html).map_err(|e| format!("could not write the site: {e}"))?;
    fs::rename(&tmp, path).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        format!("could not replace the site: {e}")
    })
}

/// Write the page and open it in the system's browser.
#[tauri::command]
pub fn swarm_site_open(html: String) -> Result<(), String> {
    let path = site_path();
    write_site(&path, &html)?;
    tauri_plugin_opener::open_path(&path, None::<&str>)
        .map_err(|e| format!("the site was saved but could not be opened: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("hc-swarm-site-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn the_page_goes_to_one_fixed_file_under_hashcortx() {
        let p = site_path_in(Path::new("/home/someone"));
        assert_eq!(p, Path::new("/home/someone/.hashcortx/swarm/site.html"));
    }

    #[test]
    fn a_page_is_written_and_the_folder_made() {
        let home = scratch("write");
        let path = site_path_in(&home);
        write_site(&path, "<h1>hi</h1>").unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "<h1>hi</h1>");
        let _ = fs::remove_dir_all(&home);
    }

    #[test]
    fn a_new_page_replaces_the_last_and_leaves_no_temporary_file() {
        let home = scratch("replace");
        let path = site_path_in(&home);
        write_site(&path, "<p>one</p>").unwrap();
        write_site(&path, "<p>two</p>").unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "<p>two</p>");
        assert!(!path.with_extension("html.tmp").exists());
        let _ = fs::remove_dir_all(&home);
    }

    #[test]
    fn an_empty_page_is_refused_and_the_last_one_kept() {
        let home = scratch("empty");
        let path = site_path_in(&home);
        write_site(&path, "<p>kept</p>").unwrap();
        assert!(write_site(&path, "   \n").is_err());
        assert_eq!(fs::read_to_string(&path).unwrap(), "<p>kept</p>");
        let _ = fs::remove_dir_all(&home);
    }

    #[test]
    fn a_page_past_the_limit_is_refused() {
        let home = scratch("big");
        let path = site_path_in(&home);
        let huge = "x".repeat(MAX_SITE_BYTES + 1);
        assert!(write_site(&path, &huge).is_err());
        assert!(!path.exists());
        let _ = fs::remove_dir_all(&home);
    }
}
