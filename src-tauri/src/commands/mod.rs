pub mod audit;
pub mod checkpoint;
pub mod embed;
pub mod export;
pub mod forge_projects;
pub mod fs;
pub mod keychain;
pub mod net;
pub mod notch;
pub mod provider;
pub mod shell;
pub mod swarm_site;
pub mod usage_log;

/// Run blocking work on a worker thread and wait for it without holding the
/// window.
///
/// A command written without `async` runs on the main thread, and the whole
/// window waits for it: a shell command that takes minutes, a page read, a
/// search over a large project or a large export all held every click and
/// redraw still until they finished.
pub(crate) async fn off_main<T, F>(work: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|e| format!("the task stopped unexpectedly: {e}"))?
}
