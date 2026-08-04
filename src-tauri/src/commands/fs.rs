// ==============================================================
// Phase 4 — Real Filesystem bridge (Code Mode)
//
// All operations check the denylist BEFORE touching the disk.
// The JS permission guard must also approve the action before
// calling these commands — this is the second layer of defense.
//
// JS calls:
//   invoke("fs_read_file",    { path })
//   invoke("fs_write_file",   { path, content })
//   invoke("fs_list_dir",     { path })
//   invoke("fs_delete_file",  { path })
//   invoke("fs_search_files", { dir, pattern })
// ==============================================================

use crate::security::denylist;
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Serialize)]
pub struct DirEntry {
    name:     String,
    path:     String,
    is_dir:   bool,
    size:     u64,
}

pub(crate) fn guard_path(path: &str) -> Result<(), String> {
    // Reject any path that contains .. components — prevents traversal attacks
    // even on non-existent paths where canonicalize() would silently succeed.
    if Path::new(path).components().any(|c| c == std::path::Component::ParentDir) {
        return Err(format!("Path traversal sequences (..) are not allowed: {path}"));
    }
    // Check the literal path first (catches obvious attempts before any I/O).
    if denylist::is_path_denied(path) {
        return Err(format!("Path is protected and cannot be accessed: {path}"));
    }
    // Resolve symlinks and check the real destination too, preventing an attacker
    // from creating a symlink inside the project that points to ~/.ssh or /etc.
    if let Ok(canonical) = std::fs::canonicalize(path) {
        let real = canonical.to_string_lossy();
        if denylist::is_path_denied(&real) {
            return Err(format!("Path resolves to a protected location and cannot be accessed: {real}"));
        }
    }
    Ok(())
}

/// Where a path really is, even when nothing is there yet.
///
/// `canonicalize` needs the file to exist, and half the paths this is asked
/// about are files about to be written. So the nearest ancestor that does exist
/// is resolved and the remaining names are appended to it. A symlink in the part
/// that exists is therefore followed, which is the entire point: a new file
/// under a link that leads out of the project is not a path inside the project,
/// however it is spelled.
///
/// `None` on anything that cannot be judged — a `..` component has no file name,
/// and a path that resolves to nothing has no location. Callers treat `None` as
/// "not inside", so an unanswerable question refuses rather than allows.
fn resolve_for_containment(path: &Path) -> Option<PathBuf> {
    if let Ok(real) = fs::canonicalize(path) {
        return Some(real);
    }
    let mut tail: Vec<std::ffi::OsString> = Vec::new();
    let mut cursor = path;
    loop {
        let parent = cursor.parent()?;
        tail.push(cursor.file_name()?.to_os_string());
        if let Ok(real) = fs::canonicalize(parent) {
            let mut out = real;
            for name in tail.iter().rev() {
                out.push(name);
            }
            return Some(out);
        }
        cursor = parent;
    }
}

/// Is `path` genuinely inside `root`, once every link in it has been followed?
///
/// The Permission Guard auto-approves reading, listing, searching and writing
/// inside the folder the user opened, and asks about everything else. It decided
/// that by comparing the two strings, which a symlink defeats completely: a link
/// inside the project is spelled like a path inside the project, so a file
/// anywhere on the disk could be read or written with no dialog at all. The
/// renderer cannot resolve a link, so the question is answered here.
///
/// `false` on anything unresolvable, which makes the guard ask rather than
/// assume — the safe direction for a check that decides whether to show a
/// dialog.
#[tauri::command]
pub fn fs_path_inside_root(root: String, path: String) -> bool {
    if root.trim().is_empty() || path.trim().is_empty() {
        return false;
    }
    let Ok(real_root) = fs::canonicalize(&root) else {
        return false;
    };
    match resolve_for_containment(Path::new(&path)) {
        Some(real) => real.starts_with(&real_root),
        None => false,
    }
}

/// Returns `true` when a directory entry is a symlink the walk must not follow:
/// one leading somewhere the denylist refuses, or simply out of the folder the
/// caller asked about.
///
/// The recursive walkers below descend with `is_dir()`, which follows symlinks,
/// and only the directory the caller named was ever checked. A link inside the
/// project pointing at a credential store was therefore walked like any other
/// folder, and `fs_grep` returned what it found in the files there.
///
/// Refusing only denylisted destinations was not enough. The denylist is a list
/// of secrets; the boundary the guard actually promises is the folder the user
/// opened, and a link to any ordinary directory outside it — a home folder, a
/// sibling project — was followed and its file contents returned, through a
/// search that raises no dialog. So a link is judged against the searched root,
/// not only against the denylist.
///
/// Only links are resolved, so an ordinary tree costs nothing extra. A link that
/// cannot be resolved is treated as one to avoid: it cannot be read anyway.
fn link_escapes_root(root: &Path, entry: &fs::DirEntry) -> bool {
    match entry.file_type() {
        Ok(kind) if kind.is_symlink() => match fs::canonicalize(entry.path()) {
            Ok(real) => denylist::is_path_denied(&real.to_string_lossy()) || !real.starts_with(root),
            Err(_) => true,
        },
        _ => false,
    }
}

/// The folder a walk may not leave: the caller's directory with every link in it
/// already followed, so the comparisons below are between real locations.
fn walk_root(dir: &str) -> Result<PathBuf, String> {
    fs::canonicalize(dir).map_err(|e| format!("Cannot access \"{dir}\": {e}"))
}

#[tauri::command]
pub fn fs_read_file(path: String) -> Result<String, String> {
    guard_path(&path)?;
    let p = Path::new(&path);

    let meta = fs::metadata(p).map_err(|e| format!("Cannot access \"{path}\": {e}"))?;
    let size = meta.len();
    let ext  = p.extension().unwrap_or_default().to_string_lossy().to_lowercase();
    let name = p.file_name().unwrap_or_default().to_string_lossy();

    // Known binary formats — return metadata rather than garbled bytes
    const BINARY_EXTS: &[&str] = &[
        "png","jpg","jpeg","gif","webp","ico","bmp","tiff","avif","heic",
        "pdf","doc","docx","xls","xlsx","ppt","pptx","odt","ods",
        "zip","tar","gz","bz2","xz","7z","rar","dmg","pkg","iso","deb","rpm",
        "exe","dll","so","dylib","bin","class","pyc","wasm","o","a",
        "mp3","mp4","avi","mov","mkv","wav","flac","aac","ogg","opus","m4a","m4v",
        "ttf","otf","woff","woff2","eot",
        "db","sqlite","sqlite3",
    ];
    if BINARY_EXTS.contains(&ext.as_str()) {
        let kb = (size + 1023) / 1024;
        return Ok(format!(
            "[Binary file: \"{name}\" · {ext} · {kb}KB] Not text-readable. \
             Use shell_run to inspect: `file \"{path}\"`. \
             For archives: `unzip -l` or `tar -tf`. \
             For images: `sips -g all \"{path}\"`. \
             For databases: `sqlite3 \"{path}\" .tables`."
        ));
    }

    // Safety cap — don't load huge files into memory at all
    const MAX_LOAD: u64 = 8_000_000; // 8MB
    if size > MAX_LOAD {
        return Ok(format!(
            "[File too large: {name} is {}MB. Use shell_run with `grep -n \"pattern\" \"{path}\"`, \
             `head -200 \"{path}\"`, or `wc -l \"{path}\"` to work with it in sections.]",
            size / 1_000_000
        ));
    }

    // Read raw bytes and detect binary by null-byte density
    let raw = fs::read(p).map_err(|e| e.to_string())?;
    let null_count = raw.iter().filter(|&&b| b == 0).count();
    if raw.len() > 512 && null_count > raw.len() / 50 {
        let kb = (size + 1023) / 1024;
        return Ok(format!(
            "[Binary file: \"{name}\" · {kb}KB — contains non-text data (detected {null_count} null bytes). \
             Use shell_run with `file`, `xxd -l 128`, or appropriate tools to inspect.]"
        ));
    }

    let content = String::from_utf8_lossy(&raw).into_owned();

    // Truncate large text files — show first 100KB with hint
    const SHOW_CHARS: usize = 100_000;
    if content.len() > SHOW_CHARS {
        let truncated: String = content.chars().take(SHOW_CHARS).collect();
        let total_lines = content.lines().count();
        let shown_lines = truncated.lines().count();
        return Ok(format!(
            "{truncated}\n\n\
             [TRUNCATED — showing first {shown_lines} of ~{total_lines} lines \
             ({}KB shown of {}KB total). \
             Use grep_code to search for specific symbols, or shell_run with \
             `grep -n \"pattern\" \"{path}\"` to jump to specific lines.]",
            SHOW_CHARS / 1024,
            (size + 1023) / 1024
        ));
    }

    Ok(content)
}

#[tauri::command]
pub fn fs_write_file(path: String, content: String) -> Result<(), String> {
    guard_path(&path)?;
    if let Some(parent) = Path::new(&path).parent() {
        // Guard the parent dir too — create_dir_all would otherwise bypass denylist
        let parent_str = parent.to_string_lossy();
        if !parent_str.is_empty() {
            guard_path(&parent_str)?;
        }
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(&path, content).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn fs_list_dir(path: String) -> Result<Vec<DirEntry>, String> {
    guard_path(&path)?;
    let entries = fs::read_dir(&path).map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for entry in entries.flatten() {
        let meta    = entry.metadata().map_err(|e| e.to_string())?;
        let is_dir  = meta.is_dir();
        let size    = if is_dir { 0 } else { meta.len() };
        let name    = entry.file_name().to_string_lossy().into_owned();
        let path_s  = entry.path().to_string_lossy().into_owned();
        out.push(DirEntry { name, path: path_s, is_dir, size });
    }
    out.sort_by(|a, b| b.is_dir.cmp(&a.is_dir).then(a.name.cmp(&b.name)));
    Ok(out)
}

#[tauri::command]
pub fn fs_delete_file(path: String) -> Result<(), String> {
    guard_path(&path)?;
    let p = Path::new(&path);
    if p.is_dir() {
        return Err(format!("Cannot delete a directory with fs_delete_file: {path}"));
    }
    fs::remove_file(p).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn fs_search_files(dir: String, pattern: String) -> Result<Vec<String>, String> {
    guard_path(&dir)?;
    let root = walk_root(&dir)?;
    let pattern_lower = pattern.to_lowercase();
    let mut results   = Vec::new();
    // The walk starts at the path the caller wrote, not at its resolved form, so
    // the paths handed back are the ones they asked about. `root` is only there
    // to say where the walk may not go.
    search_recursive(&root, Path::new(&dir), &pattern_lower, &mut results, 0)?;
    Ok(results)
}

fn search_recursive(
    root:    &Path,
    dir:     &Path,
    pattern: &str,
    results: &mut Vec<String>,
    depth:   usize,
) -> Result<(), String> {
    if depth > 8 { return Ok(()); }
    let entries = fs::read_dir(dir).map_err(|e| e.to_string())?;
    for entry in entries.flatten() {
        let p    = entry.path();
        let name = p.file_name().unwrap_or_default().to_string_lossy().to_lowercase();
        if name.starts_with('.') || name == "node_modules" || name == "target" { continue; }
        if link_escapes_root(root, &entry) { continue; }
        if name.contains(pattern) {
            results.push(p.to_string_lossy().into_owned());
        }
        if p.is_dir() && results.len() < 200 {
            let _ = search_recursive(root, &p, pattern, results, depth + 1);
        }
    }
    Ok(())
}

// ── Fuzzy file finder ─────────────────────────────────────────────────────────

#[derive(Serialize)]
pub struct FuzzyMatch {
    pub path:  String,
    pub name:  String,
    pub score: u32,   // 0 = exact, lower is better
}

fn levenshtein(a: &str, b: &str) -> usize {
    let a: Vec<char> = a.chars().collect();
    let b: Vec<char> = b.chars().collect();
    let (la, lb) = (a.len(), b.len());
    if la == 0 { return lb; }
    if lb == 0 { return la; }
    let mut dp = vec![vec![0usize; lb + 1]; la + 1];
    for i in 0..=la { dp[i][0] = i; }
    for j in 0..=lb { dp[0][j] = j; }
    for i in 1..=la {
        for j in 1..=lb {
            let cost = if a[i-1] == b[j-1] { 0 } else { 1 };
            dp[i][j] = (dp[i-1][j] + 1).min((dp[i][j-1] + 1).min(dp[i-1][j-1] + cost));
        }
    }
    dp[la][lb]
}

fn is_subsequence(query: &str, text: &str) -> bool {
    let mut it = query.chars();
    let mut cur = it.next();
    for ch in text.chars() {
        if Some(ch) == cur { cur = it.next(); }
        if cur.is_none() { return true; }
    }
    false
}

fn fuzzy_score(query: &str, name: &str, stem: &str) -> u32 {
    if name == query           { return 0; }
    if name.starts_with(query) { return 1; }
    if name.contains(query)    { return 2; }
    if is_subsequence(query, name) { return 3; }
    let dist = levenshtein(query, stem).min(levenshtein(query, name));
    if dist <= 1 { return 10; }
    if dist <= 2 { return 20; }
    if dist <= 3 { return 30; }
    999
}

#[tauri::command]
pub fn fs_fuzzy_find(dir: String, query: String) -> Result<Vec<FuzzyMatch>, String> {
    guard_path(&dir)?;
    let root = walk_root(&dir)?;
    let q = query.to_lowercase();
    let mut results = Vec::new();
    fuzzy_recursive(&root, Path::new(&dir), &q, &mut results, 0)?;
    results.sort_by_key(|r| r.score);
    results.truncate(15);
    Ok(results)
}

fn fuzzy_recursive(root: &Path, dir: &Path, query: &str, results: &mut Vec<FuzzyMatch>, depth: usize) -> Result<(), String> {
    if depth > 7 || results.len() >= 100 { return Ok(()); }
    let entries = fs::read_dir(dir).map_err(|e| e.to_string())?;
    for entry in entries.flatten() {
        let p    = entry.path();
        let name = p.file_name().unwrap_or_default().to_string_lossy().to_lowercase();
        if name.starts_with('.') || name == "node_modules" || name == "target" || name == ".git" { continue; }
        if link_escapes_root(root, &entry) { continue; }
        if p.is_dir() {
            let _ = fuzzy_recursive(root, &p, query, results, depth + 1);
        } else {
            let stem = p.file_stem().unwrap_or_default().to_string_lossy().to_lowercase();
            let score = fuzzy_score(query, &name, &stem);
            if score < 999 {
                results.push(FuzzyMatch { path: p.to_string_lossy().into_owned(), name, score });
            }
        }
    }
    Ok(())
}

// ── Code grep (search inside file contents) ───────────────────────────────────

#[derive(Serialize)]
pub struct GrepMatch {
    pub path:    String,
    pub line_no: usize,
    pub line:    String,
    pub context: String,
}

const TEXT_EXTS: &[&str] = &[
    "js","ts","jsx","tsx","rs","py","go","java","c","cpp","h","hpp",
    "css","scss","sass","html","json","toml","yaml","yml","md","txt",
    "sh","bash","zsh","env","gitignore","lock","vue","svelte","rb","php",
];

#[tauri::command]
pub fn fs_grep(dir: String, pattern: String, file_ext: Option<String>) -> Result<Vec<GrepMatch>, String> {
    guard_path(&dir)?;
    let root = walk_root(&dir)?;
    let pat_lower  = pattern.to_lowercase();
    let ext_filter = file_ext.map(|e| e.to_lowercase());
    let mut results = Vec::new();
    grep_recursive(&root, Path::new(&dir), &pat_lower, &ext_filter, &mut results, 0)?;
    Ok(results)
}

fn grep_recursive(
    root: &Path, dir: &Path, pattern: &str, ext_filter: &Option<String>,
    results: &mut Vec<GrepMatch>, depth: usize,
) -> Result<(), String> {
    if depth > 8 || results.len() >= 300 { return Ok(()); }
    let entries = fs::read_dir(dir).map_err(|e| e.to_string())?;
    for entry in entries.flatten() {
        let p    = entry.path();
        let name = p.file_name().unwrap_or_default().to_string_lossy().to_lowercase();
        if name.starts_with('.') || name == "node_modules" || name == "target" || name == ".git" { continue; }
        if link_escapes_root(root, &entry) { continue; }
        if p.is_dir() {
            let _ = grep_recursive(root, &p, pattern, ext_filter, results, depth + 1);
        } else {
            let file_ext = p.extension().unwrap_or_default().to_string_lossy().to_lowercase();
            if let Some(ref want) = ext_filter {
                if &file_ext != want { continue; }
            } else if !TEXT_EXTS.contains(&file_ext.as_str()) {
                continue;
            }
            if let Ok(content) = fs::read_to_string(&p) {
                let lines: Vec<&str> = content.lines().collect();
                for (i, line) in lines.iter().enumerate() {
                    if !line.to_lowercase().contains(pattern) { continue; }
                    let ctx_start = i.saturating_sub(2);
                    let ctx_end   = (i + 3).min(lines.len());
                    let context   = lines[ctx_start..ctx_end]
                        .iter().enumerate()
                        .map(|(j, l)| format!("{:>4} {}{}", ctx_start + j + 1, if ctx_start + j == i { "▶ " } else { "  " }, l))
                        .collect::<Vec<_>>().join("\n");
                    results.push(GrepMatch {
                        path:    p.to_string_lossy().into_owned(),
                        line_no: i + 1,
                        line:    line.to_string(),
                        context,
                    });
                    if results.len() >= 300 { break; }
                }
            }
        }
    }
    Ok(())
}

// Symlinks are only creatable without privileges on Unix, so the escape these
// cover is a Unix-shaped one and the tests are too.
#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::os::unix::fs::symlink;

    /// A scratch tree under the build directory, named per test so two running
    /// at once cannot collide.
    ///
    /// Not the OS temp directory: on macOS that resolves under `/private/var`,
    /// which the denylist refuses outright, so every one of these tests would
    /// fail for a reason that has nothing to do with what it is checking.
    fn temp_root(name: &str) -> std::path::PathBuf {
        let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("target")
            .join("fs-check-scratch")
            .join(format!("{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn a_search_does_not_follow_a_link_out_to_a_protected_directory() {
        let root = temp_root("escape");
        // `.aws` anywhere in a path is refused by the denylist, so this stands
        // in for the real credential store without touching the user's own.
        let secrets = root.join(".aws");
        fs::create_dir_all(&secrets).unwrap();
        fs::write(secrets.join("credentials.txt"), "aws_secret_access_key = SENTINEL").unwrap();

        let project = root.join("project");
        fs::create_dir_all(&project).unwrap();
        fs::write(project.join("main.txt"), "ordinary source").unwrap();
        // The link is named like an ordinary folder: nothing about the name
        // itself gives away where it leads.
        symlink(&secrets, project.join("vendor")).unwrap();

        let hits = fs_grep(
            project.to_string_lossy().into_owned(),
            "sentinel".into(),
            Some("txt".into()),
        )
        .unwrap();
        assert_eq!(
            hits.len(),
            0,
            "a search of the project read a file through a link into a protected directory"
        );

        let found = fs_search_files(project.to_string_lossy().into_owned(), "credentials".into())
            .unwrap();
        assert_eq!(found.len(), 0, "a filename search walked through the same link");

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn a_search_does_not_follow_a_link_out_of_the_folder_it_was_given() {
        // The denylist is a list of secrets. The boundary the Permission Guard
        // actually promises is the folder the user opened — searching inside it
        // raises no dialog — so a link to any ordinary directory outside it was
        // enough to have file contents returned from somewhere the user was
        // never asked about. Nothing here is denylisted; the folder simply is
        // not the one being searched.
        let root = temp_root("outside");
        let elsewhere = root.join("elsewhere");
        fs::create_dir_all(&elsewhere).unwrap();
        fs::write(elsewhere.join("notes.txt"), "private SENTINEL").unwrap();

        let project = root.join("project");
        fs::create_dir_all(&project).unwrap();
        fs::write(project.join("main.txt"), "ordinary source").unwrap();
        symlink(&elsewhere, project.join("vendor")).unwrap();

        let hits = fs_grep(
            project.to_string_lossy().into_owned(),
            "sentinel".into(),
            Some("txt".into()),
        )
        .unwrap();
        assert_eq!(hits.len(), 0, "a search read a file outside the folder it was given");

        let found = fs_search_files(project.to_string_lossy().into_owned(), "notes".into()).unwrap();
        assert_eq!(found.len(), 0, "a filename search walked out through the same link");

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn an_ordinary_link_inside_the_searched_folder_is_still_followed() {
        // The rule refuses links by where they lead, not by being links. A
        // project that symlinks one of its own folders must keep working, or
        // the rule just becomes the next thing that breaks ordinary work.
        let root = temp_root("ordinary");
        let project = root.join("project");
        let real = project.join("packages").join("lib");
        fs::create_dir_all(&real).unwrap();
        fs::write(real.join("helper.txt"), "shared helper SENTINEL").unwrap();
        symlink(&real, project.join("lib")).unwrap();

        let hits = fs_grep(
            project.to_string_lossy().into_owned(),
            "sentinel".into(),
            Some("txt".into()),
        )
        .unwrap();
        // Twice: once at its real path, once through the link. Being reachable
        // both ways is the point — the walk was not cut short.
        assert_eq!(hits.len(), 2, "a link to a folder inside the project was skipped");

        let _ = fs::remove_dir_all(&root);
    }

    // ── The boundary the guard asks about ────────────────────────────────────

    #[test]
    fn a_link_out_of_the_project_is_not_a_path_inside_the_project() {
        // This is the question the Permission Guard used to answer by comparing
        // two strings. A link inside the project is spelled like a path inside
        // the project, so reading, writing, listing and searching through one
        // were auto-approved with no dialog at all.
        let root = temp_root("inside-root");
        let outside = root.join("outside");
        fs::create_dir_all(&outside).unwrap();
        fs::write(outside.join("tax.pdf"), "private").unwrap();

        let project = root.join("project");
        fs::create_dir_all(project.join("src")).unwrap();
        fs::write(project.join("src").join("main.rs"), "fn main() {}").unwrap();
        symlink(&outside, project.join("vendor")).unwrap();

        let p = project.to_string_lossy().into_owned();
        assert!(
            fs_path_inside_root(p.clone(), project.join("src/main.rs").to_string_lossy().into_owned()),
            "an ordinary file in the project must still be free of a dialog"
        );
        assert!(
            !fs_path_inside_root(p.clone(), project.join("vendor/tax.pdf").to_string_lossy().into_owned()),
            "a file reached through a link out of the project is not inside it"
        );
        // A file that does not exist yet is the write case, and it is the one
        // canonicalize cannot answer on its own.
        assert!(
            fs_path_inside_root(p.clone(), project.join("src/new.rs").to_string_lossy().into_owned()),
            "a new file in the project must not start asking"
        );
        assert!(
            !fs_path_inside_root(p.clone(), project.join("vendor/new.txt").to_string_lossy().into_owned()),
            "a new file written through the link lands outside the project"
        );
        // A sibling whose name merely begins the same way is not inside it.
        let sibling = root.join("project-notes");
        fs::create_dir_all(&sibling).unwrap();
        assert!(
            !fs_path_inside_root(p.clone(), sibling.join("a.md").to_string_lossy().into_owned()),
            "matching a prefix of the folder name is not being inside the folder"
        );

        let _ = fs::remove_dir_all(&root);
    }

}

// Containment has nothing platform-specific about it once links are out of the
// picture, and these run everywhere on purpose: a rule only exercised on macOS
// is a rule nobody notices rotting on the two platforms CI also builds for.
#[cfg(test)]
mod containment_tests {
    use super::*;

    fn scratch(name: &str) -> PathBuf {
        // Not env::temp_dir(): on macOS it resolves under /private/var, which
        // the denylist refuses outright.
        let dir = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("target")
            .join("fs-check-scratch")
            .join(format!("{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn a_question_that_cannot_be_answered_is_answered_no() {
        // The guard shows a dialog when this says no, so refusing on anything
        // unresolvable means an unanswerable case asks rather than assumes.
        let root = scratch("unanswerable");
        let project = root.join("project");
        fs::create_dir_all(&project).unwrap();
        let p = project.to_string_lossy().into_owned();

        assert!(!fs_path_inside_root(String::new(), p.clone()));
        assert!(!fs_path_inside_root(p.clone(), String::new()));
        assert!(!fs_path_inside_root(p.clone(), "   ".into()));
        // `..` has no file name to resolve, so containment cannot be judged and
        // the answer is no. `guard_path` refuses these outright as well.
        assert!(!fs_path_inside_root(p.clone(), format!("{p}/../escape.txt")));
        assert!(!fs_path_inside_root(
            root.join("not-here").to_string_lossy().into_owned(),
            p,
        ));

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn an_ordinary_path_in_the_folder_is_inside_it_and_a_sibling_is_not() {
        let root = scratch("plain");
        let project = root.join("project");
        fs::create_dir_all(project.join("src")).unwrap();
        fs::write(project.join("src").join("main.rs"), "fn main() {}").unwrap();
        let sibling = root.join("project-notes");
        fs::create_dir_all(&sibling).unwrap();

        let p = project.to_string_lossy().into_owned();
        assert!(fs_path_inside_root(p.clone(), project.join("src/main.rs").to_string_lossy().into_owned()));
        assert!(fs_path_inside_root(p.clone(), project.join("src/new.rs").to_string_lossy().into_owned()));
        assert!(fs_path_inside_root(p.clone(), p.clone()), "the folder is inside itself");
        // Sharing the first characters of the name is not being inside it.
        assert!(!fs_path_inside_root(p, sibling.join("a.md").to_string_lossy().into_owned()));

        let _ = fs::remove_dir_all(&root);
    }
}
