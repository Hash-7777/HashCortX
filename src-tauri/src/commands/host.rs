// ==============================================================
// Which programs this computer has, found without running any
//
// A model was told the system in one line (name, shell, separator) and not
// which programs were there, so on a computer without `rg`, `make` or
// `python3` it spent a step finding that out by running one and reading the
// error. Here each name of a fixed list is looked for, as a file, in the
// folders a command looks in for programs: on macOS and Linux the search
// path the app gives every command (shell.rs `tool_path`), with the folders
// tools are usually installed in; on Windows the search path itself, since
// that is all a command started there searches, so "found" always means a
// command could start it. Nothing is run, no file is read, and only the
// names that were found go back: never a path, which could carry the name of
// the account.
//
// One stand-in is passed over: on Windows `python.exe` and `python3.exe` in
// the WindowsApps folder are placeholders that open the store when Python is
// not installed, and saying Python is here because of them would send a
// model straight into that.
//
// JS call: invoke("which_programs", { names }) -> the names found, in the
// order of NAMES. Called once a session by src/js/code/host-tools.js.
// ==============================================================

use std::path::{Path, PathBuf};

/// The only names asked about: programs a coding run commonly reaches for.
pub const NAMES: &[&str] = &[
    "git", "node", "npm", "pnpm", "yarn", "bun", "python", "python3", "py", "pip", "uv", "cargo",
    "rustc", "go", "dotnet", "java", "rg", "pwsh", "powershell", "wsl", "winget", "make", "cmake",
    "docker",
];

/// Whether `dir` holds only a stand-in for `name`: the Windows store's placeholder for Python.
fn store_stub(name: &str, dir: &Path) -> bool {
    if name != "python" && name != "python3" {
        return false;
    }
    let d = dir.to_string_lossy().replace('/', "\\").to_lowercase();
    d.trim_end_matches('\\').ends_with("\\microsoft\\windowsapps")
}

/// Where `name` is in `dirs`, trying each ending of `exts` in turn, or None.
/// `runnable` says whether a path is a program that could be started.
fn find_in(name: &str, dirs: &[PathBuf], exts: &[String], runnable: &dyn Fn(&Path) -> bool) -> Option<PathBuf> {
    for dir in dirs {
        if store_stub(name, dir) {
            continue;
        }
        for ext in exts {
            let p = dir.join(format!("{name}{ext}"));
            if runnable(&p) {
                return Some(p);
            }
        }
    }
    None
}

/// The names of `asked` that are on the fixed list, each once, in the list's order.
fn known(asked: &[String]) -> Vec<&'static str> {
    NAMES.iter().copied().filter(|n| asked.iter().any(|a| a == n)).collect()
}

#[cfg(unix)]
fn search_dirs() -> Vec<PathBuf> {
    let path = super::shell::tool_path().cloned().unwrap_or_else(|| std::env::var("PATH").unwrap_or_default());
    std::env::split_paths(&path).collect()
}

#[cfg(windows)]
fn search_dirs() -> Vec<PathBuf> {
    std::env::var_os("PATH").map(|p| std::env::split_paths(&p).collect()).unwrap_or_default()
}

#[cfg(unix)]
fn endings() -> Vec<String> {
    vec![String::new()]
}

/// The endings Windows starts a program by: those of PATHEXT a command can start without a shell.
#[cfg(windows)]
fn endings() -> Vec<String> {
    let from_env: Vec<String> = std::env::var("PATHEXT")
        .unwrap_or_default()
        .split(';')
        .map(|e| e.trim().to_lowercase())
        .filter(|e| [".exe", ".cmd", ".bat", ".com"].contains(&e.as_str()))
        .collect();
    if from_env.is_empty() { vec![".exe".into(), ".cmd".into(), ".bat".into(), ".com".into()] } else { from_env }
}

#[cfg(unix)]
fn runnable(p: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    std::fs::metadata(p).map(|m| m.is_file() && m.permissions().mode() & 0o111 != 0).unwrap_or(false)
}

#[cfg(windows)]
fn runnable(p: &Path) -> bool {
    std::fs::metadata(p).map(|m| m.is_file()).unwrap_or(false)
}

/// The names of `names` on the fixed list that are installed here, without running anything.
#[tauri::command]
pub async fn which_programs(names: Vec<String>) -> Result<Vec<String>, String> {
    super::off_main(move || {
        let dirs = search_dirs();
        let exts = endings();
        Ok(known(&names).into_iter().filter(|n| find_in(n, &dirs, &exts, &runnable).is_some()).map(String::from).collect())
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dirs(list: &[&str]) -> Vec<PathBuf> {
        list.iter().map(PathBuf::from).collect()
    }

    #[test]
    fn finds_a_program_in_a_later_folder() {
        let have = |p: &Path| p == Path::new("/b/node");
        assert_eq!(find_in("node", &dirs(&["/a", "/b"]), &[String::new()], &have), Some(PathBuf::from("/b/node")));
        assert_eq!(find_in("rg", &dirs(&["/a", "/b"]), &[String::new()], &have), None);
    }

    #[test]
    fn tries_each_ending_in_order() {
        let have = |p: &Path| p == Path::new("/a/npm.cmd");
        let exts: Vec<String> = [".exe", ".cmd"].iter().map(|s| s.to_string()).collect();
        assert_eq!(find_in("npm", &dirs(&["/a"]), &exts, &have), Some(PathBuf::from("/a/npm.cmd")));
    }

    #[test]
    fn the_store_placeholder_for_python_is_not_python() {
        let stub = r"C:\Users\a\AppData\Local\Microsoft\WindowsApps";
        assert!(store_stub("python", Path::new(stub)));
        assert!(store_stub("python3", Path::new(&format!("{stub}\\"))));
        assert!(!store_stub("winget", Path::new(stub)));
        assert!(!store_stub("python", Path::new(r"C:\Python312")));
        let have = |p: &Path| p.to_string_lossy().contains("WindowsApps");
        assert_eq!(find_in("python", &dirs(&[stub]), &[".exe".to_string()], &have), None);
    }

    #[test]
    fn only_names_on_the_list_are_looked_for_each_once_in_its_order() {
        let asked: Vec<String> = ["rg", "curl", "git", "git", "/bin/sh"].iter().map(|s| s.to_string()).collect();
        assert_eq!(known(&asked), vec!["git", "rg"]);
    }
}
