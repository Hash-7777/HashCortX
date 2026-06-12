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
use std::path::Path;

#[derive(Serialize)]
pub struct DirEntry {
    name:     String,
    path:     String,
    is_dir:   bool,
    size:     u64,
}

fn guard_path(path: &str) -> Result<(), String> {
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
    let pattern_lower = pattern.to_lowercase();
    let mut results   = Vec::new();
    search_recursive(Path::new(&dir), &pattern_lower, &mut results, 0)?;
    Ok(results)
}

fn search_recursive(
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
        if name.contains(pattern) {
            results.push(p.to_string_lossy().into_owned());
        }
        if p.is_dir() && results.len() < 200 {
            let _ = search_recursive(&p, pattern, results, depth + 1);
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
    let q = query.to_lowercase();
    let mut results = Vec::new();
    fuzzy_recursive(Path::new(&dir), &q, &mut results, 0)?;
    results.sort_by_key(|r| r.score);
    results.truncate(15);
    Ok(results)
}

fn fuzzy_recursive(dir: &Path, query: &str, results: &mut Vec<FuzzyMatch>, depth: usize) -> Result<(), String> {
    if depth > 7 || results.len() >= 100 { return Ok(()); }
    let entries = fs::read_dir(dir).map_err(|e| e.to_string())?;
    for entry in entries.flatten() {
        let p    = entry.path();
        let name = p.file_name().unwrap_or_default().to_string_lossy().to_lowercase();
        if name.starts_with('.') || name == "node_modules" || name == "target" || name == ".git" { continue; }
        if p.is_dir() {
            let _ = fuzzy_recursive(&p, query, results, depth + 1);
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
    let pat_lower  = pattern.to_lowercase();
    let ext_filter = file_ext.map(|e| e.to_lowercase());
    let mut results = Vec::new();
    grep_recursive(Path::new(&dir), &pat_lower, &ext_filter, &mut results, 0)?;
    Ok(results)
}

fn grep_recursive(
    dir: &Path, pattern: &str, ext_filter: &Option<String>,
    results: &mut Vec<GrepMatch>, depth: usize,
) -> Result<(), String> {
    if depth > 8 || results.len() >= 300 { return Ok(()); }
    let entries = fs::read_dir(dir).map_err(|e| e.to_string())?;
    for entry in entries.flatten() {
        let p    = entry.path();
        let name = p.file_name().unwrap_or_default().to_string_lossy().to_lowercase();
        if name.starts_with('.') || name == "node_modules" || name == "target" || name == ".git" { continue; }
        if p.is_dir() {
            let _ = grep_recursive(&p, pattern, ext_filter, results, depth + 1);
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
