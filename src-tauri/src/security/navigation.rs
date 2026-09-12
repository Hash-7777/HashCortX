// ==============================================================
// The window shows the app and nothing else
//
// The app is one page. Nothing in it ever means to replace that page with
// another address, so any attempt to is refused here, before the web view
// acts on it: a link that was not meant to open inside the window, a refresh
// or redirect written into markup, a script setting location. The page keeps
// running as it was.
//
// Links a person clicks open in their own browser instead — see
// src/platform/index.js — so refusing here costs nothing that worked.
//
// What counts as the app: its own scheme, which is tauri://localhost on macOS
// and Linux and http(s)://tauri.localhost on Windows, plus about:blank and
// about:srcdoc, which are not addresses at all.
// ==============================================================

use tauri::plugin::{Builder, TauriPlugin};
use tauri::{Runtime, Url};

/// Whether a window may be taken to this address.
pub fn is_app_address(url: &Url) -> bool {
    match url.scheme() {
        "tauri" => url.host_str() == Some("localhost"),
        "http" | "https" => url.host_str() == Some("tauri.localhost"),
        "about" => matches!(url.path(), "blank" | "srcdoc"),
        _ => false,
    }
}

/// Refuses every navigation away from the app, in every window.
pub fn guard<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("navigation-guard")
        .on_navigation(|_webview, url| is_app_address(url))
        .build()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn allowed(s: &str) -> bool {
        is_app_address(&Url::parse(s).expect("a URL"))
    }

    #[test]
    fn the_app_itself_may_load_and_reload() {
        assert!(allowed("tauri://localhost"));
        assert!(allowed("tauri://localhost/index.html"));
        assert!(allowed("tauri://localhost/index.html?x=1#top"));
        assert!(allowed("http://tauri.localhost/index.html"));
        assert!(allowed("https://tauri.localhost/"));
        assert!(allowed("about:blank"));
        assert!(allowed("about:srcdoc"));
    }

    #[test]
    fn anywhere_else_is_refused() {
        for s in [
            "https://example.com/",
            "http://localhost:1430/",
            "https://tauri.localhost.attacker.test/",
            "https://attacker.test/tauri.localhost",
            "tauri://attacker.test/",
            "file:///etc/passwd",
            "data:text/html,<p>x</p>",
            "blob:tauri://localhost/1234",
            "javascript:alert(1)",
            "about:config",
            "ipc://localhost/cmd",
        ] {
            assert!(!allowed(s), "{s} must be refused");
        }
    }
}
