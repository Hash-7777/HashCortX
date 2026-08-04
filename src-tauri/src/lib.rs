// ==============================================================
// HashCortx — Rust library entry point
// ==============================================================

mod commands;
mod security;

use commands::{
    audit::{audit_log_append, audit_log_read},
    checkpoint::{checkpoint_drop, checkpoint_read, checkpoint_save},
    embed::{embed_available, embed_texts},
    export::export_write_file,
    fs::{
        fs_delete_file, fs_fuzzy_find, fs_grep, fs_list_dir, fs_path_inside_root, fs_read_file,
        fs_search_files, fs_write_file,
    },
    keychain::{
        keychain_delete, keychain_retrieve, keychain_retrieve_bundle, keychain_store,
        keychain_store_bundle,
    },
    net::net_resolve_is_public,
    notch::notch_activity_post,
    shell::{shell_platform, shell_run, shell_run_line, shell_run_line_stream, shell_run_stream},
    usage_log::usage_log_append,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![
            // Phase 6 — Keychain (bundle = one prompt for all keys)
            keychain_store,
            keychain_retrieve,
            keychain_delete,
            keychain_store_bundle,
            keychain_retrieve_bundle,
            // Phase 3 — Audit log
            audit_log_append,
            audit_log_read,
            // Phase 4 — Filesystem
            fs_read_file,
            fs_write_file,
            fs_list_dir,
            fs_delete_file,
            fs_search_files,
            fs_fuzzy_find,
            fs_grep,
            // Does a path really lead inside the open project, links and all —
            // the question the Permission Guard used to answer with a string
            // comparison a symlink walked straight past.
            fs_path_inside_root,
            // Phase 4 — Shell
            shell_run,
            shell_run_stream,
            shell_run_line,
            shell_run_line_stream,
            shell_platform,
            // Local embeddings — bundled bge-small-en-v1.5, run natively
            embed_texts,
            embed_available,
            // HashMeter ecosystem — token-usage log
            usage_log_append,
            // Hash D Island — "finished" live-activity ping
            notch_activity_post,
            // Where a hostname actually leads, before the agent fetches it
            net_resolve_is_public,
            // Undo — what a file held before the agent changed it
            checkpoint_save,
            checkpoint_read,
            checkpoint_drop,
            // Export — write a file the user named in a native save dialog
            export_write_file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running HashCortx");
}
