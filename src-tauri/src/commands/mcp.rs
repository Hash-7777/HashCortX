// ==============================================================
// Connected systems: a company's own system, reached over MCP
//
// A business system such as an ERP can offer its records to an AI agent as
// tools, over the Model Context Protocol. This file is the only way the app
// reaches one, and it is written so that what the person gives it — the
// system's address and its sign-in secret — stays where the page cannot use
// it for anything else.
//
// WHAT IS KEPT, AND WHERE
// -----------------------
// Each connection is an id the page chose, the address, how it signs in, and
// the secret, or for one that signs in through the browser the tokens it was
// handed (mcp/oauth.rs). They are kept together in ~/.hashcortx/connections.json, a file
// readable by this account only, inside the app's own folder, which the
// coding agent's file and shell tools refuse to open. The page can save a
// connection and remove one; saving tells it whether a secret is set. It can
// never read a secret back: nothing in this file returns one.
//
// WHERE A REQUEST GOES
// --------------------
// A request names a connection by id, never an address. It goes to the
// address kept with that connection's secret, and nowhere else: a secret is
// bound to the address it was given for, so changing the address, or how the
// connection signs in, drops the secret until it is entered again. Only
// https is used, except to this computer itself. A redirect is never
// followed. Only the five protocol methods the app uses can be sent, and the
// request body is a single JSON-RPC object.
//
// This does not widen the Content Security Policy: the page reaches these
// systems only through this file, one connection at a time.
//
// JS calls:
//   invoke("mcp_server_save",    { id, url, auth, header, secret })  → info
//   invoke("mcp_server_remove",  { id })
//   invoke("mcp_request",        { id, body, version })              → { status, mime, body }
//   invoke("mcp_oauth_sign_in",  { id })                             → info
//     info = { url, auth, header, hasSecret, signedIn }
// ==============================================================

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;
use ureq::config::Config;
use ureq::http::Uri;
use ureq::tls::{TlsConfig, TlsProvider};
use ureq::Agent;

mod oauth;

const STORE_FILE: &str = "connections.json";
const MAX_CONNECTIONS: usize = 32;
const MAX_URL_CHARS: usize = 2048;
const MAX_SECRET_CHARS: usize = 4096;
const MAX_BODY_BYTES: usize = 1024 * 1024;
const MAX_REPLY_BYTES: u64 = 4 * 1024 * 1024;
const TIMEOUT_CONNECT: Duration = Duration::from_secs(10);
const TIMEOUT_TOTAL: Duration = Duration::from_secs(120);

/// The protocol methods the app sends. Nothing else can be.
const METHODS: [&str; 5] = [
    "server/discover",
    "initialize",
    "notifications/initialized",
    "tools/list",
    "tools/call",
];

/// Protocol versions the app speaks, newest first.
const VERSIONS: [&str; 4] = ["2026-07-28", "2025-11-25", "2025-06-18", "2025-03-26"];

/// Headers the app sets itself, which a connection's own sign-in header may
/// not replace.
const RESERVED_HEADERS: [&str; 16] = [
    "host",
    "content-type",
    "content-length",
    "transfer-encoding",
    "connection",
    "accept",
    "accept-encoding",
    "te",
    "upgrade",
    "cookie",
    "origin",
    "user-agent",
    "mcp-protocol-version",
    "mcp-session-id",
    "mcp-method",
    "mcp-name",
];

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
struct Connection {
    url: String,
    auth: String,
    header: String,
    secret: String,
    /// What signing in through the browser left: tokens, never shown to the page.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    oauth: Option<oauth::OAuth>,
}

#[derive(Serialize, Deserialize, Default)]
struct Store {
    connections: HashMap<String, Connection>,
}

/// What the page may know about a connection. There is no secret in it.
#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionInfo {
    url: String,
    auth: String,
    header: String,
    has_secret: bool,
    signed_in: bool,
}

impl From<&Connection> for ConnectionInfo {
    fn from(c: &Connection) -> Self {
        ConnectionInfo {
            url: c.url.clone(),
            auth: c.auth.clone(),
            header: c.header.clone(),
            has_secret: !c.secret.is_empty(),
            signed_in: c.oauth.as_ref().is_some_and(|o| o.signed_in()),
        }
    }
}

#[derive(Serialize, Debug)]
pub struct Reply {
    status: u16,
    mime: String,
    body: String,
}

// ── Checks ─────────────────────────────────────────────────────────────────

fn check_id(id: &str) -> Result<(), String> {
    let ok = !id.is_empty()
        && id.len() <= 40
        && !id.starts_with('-')
        && id.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-');
    if ok {
        Ok(())
    } else {
        Err("that is not a connection id this app makes.".into())
    }
}

/// The address a connection may be reached at: https, or http only to this
/// computer itself. Returned as written, once it has passed.
fn check_url(raw: &str) -> Result<String, String> {
    let url = raw.trim();
    if url.is_empty() || url.chars().count() > MAX_URL_CHARS {
        return Err("give the system's address, as its administrator gave it.".into());
    }
    if url.chars().any(|c| c.is_control() || c.is_whitespace()) {
        return Err("an address cannot contain spaces or line breaks.".into());
    }
    let uri: Uri = url
        .parse()
        .map_err(|_| format!("\"{url}\" is not an address that can be reached."))?;
    let scheme = uri.scheme_str().unwrap_or("").to_ascii_lowercase();
    let authority = uri.authority().ok_or("that address names no host.")?;
    // A name and password in an address can make one host read as another,
    // and would keep a secret where it can be seen.
    if authority.as_str().contains('@') {
        return Err("an address carrying a username or password is refused; use the sign-in fields.".into());
    }
    let host = authority.host().to_ascii_lowercase();
    if host.is_empty() {
        return Err("that address names no host.".into());
    }
    let this_computer = matches!(host.as_str(), "127.0.0.1" | "localhost" | "[::1]" | "::1");
    match scheme.as_str() {
        "https" => Ok(url.to_string()),
        "http" if this_computer => Ok(url.to_string()),
        "http" => Err("only a secure (https) address is used for another computer, so what is sent cannot be read on the way.".into()),
        _ => Err("only https addresses can be connected.".into()),
    }
}

/// How a connection signs in: "none", "bearer" (a token), "header" (a
/// secret in a header the system names), or "oauth" (through the browser).
fn check_auth(auth: &str, header: &str) -> Result<(), String> {
    match auth {
        "none" | "bearer" | "oauth" => Ok(()),
        "header" => {
            let name = header.trim();
            let shaped = !name.is_empty()
                && name.len() <= 64
                && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '-');
            if !shaped {
                return Err("a header name is letters, digits and dashes.".into());
            }
            if RESERVED_HEADERS.contains(&name.to_ascii_lowercase().as_str()) {
                return Err(format!("the app sets \"{name}\" itself; name the system's sign-in header."));
            }
            Ok(())
        }
        _ => Err("that is not a way this app signs in.".into()),
    }
}

/// A secret is sent in one header, so it must be one line of plain text.
fn check_secret(secret: &str) -> Result<(), String> {
    if secret.is_empty() || secret.chars().count() > MAX_SECRET_CHARS {
        return Err("the secret is empty or too long.".into());
    }
    if !secret.chars().all(|c| (' '..='~').contains(&c)) {
        return Err("a secret is one line of plain characters.".into());
    }
    Ok(())
}

/// The connection to keep, given the one kept before and what was saved now.
///
/// A secret belongs to the address and sign-in it was given for: when either
/// changes and no secret comes with the change, the old one is dropped rather
/// than sent somewhere it was never meant for. Tokens from signing in through
/// the browser are kept only while both stay the same.
fn merged(
    before: Option<&Connection>,
    url: String,
    auth: String,
    header: String,
    secret: Option<String>,
) -> Connection {
    let header = if auth == "header" { header.trim().to_string() } else { String::new() };
    let same_place = before
        .map(|b| b.url == url && b.auth == auth && b.header == header)
        .unwrap_or(false);
    let secret = match secret {
        _ if auth == "none" || auth == "oauth" => String::new(),
        Some(s) => s,
        None if same_place => before.map(|b| b.secret.clone()).unwrap_or_default(),
        None => String::new(),
    };
    let oauth = if auth == "oauth" && same_place { before.and_then(|b| b.oauth.clone()) } else { None };
    Connection { url, auth, header, secret, oauth }
}

/// The request body: one JSON-RPC 2.0 object with a method the app sends.
/// Returns the method, and for a tool call the tool's name.
fn check_body(body: &str) -> Result<(String, Option<String>), String> {
    if body.len() > MAX_BODY_BYTES {
        return Err("that request is too large to send.".into());
    }
    let value: serde_json::Value =
        serde_json::from_str(body).map_err(|_| "the request is not JSON.".to_string())?;
    let obj = value.as_object().ok_or("the request is not one JSON object.")?;
    if obj.get("jsonrpc").and_then(|v| v.as_str()) != Some("2.0") {
        return Err("the request is not JSON-RPC 2.0.".into());
    }
    let method = obj.get("method").and_then(|v| v.as_str()).unwrap_or("");
    if !METHODS.contains(&method) {
        return Err(format!("the app does not send \"{method}\"."));
    }
    let name = if method == "tools/call" {
        let name = obj
            .get("params")
            .and_then(|p| p.get("name"))
            .and_then(|n| n.as_str())
            .unwrap_or("");
        let shaped = !name.is_empty() && name.len() <= 128 && name.chars().all(|c| c.is_ascii_graphic());
        if !shaped {
            return Err("a tool call names its tool in plain characters.".into());
        }
        Some(name.to_string())
    } else {
        None
    };
    Ok((method.to_string(), name))
}

fn check_version(version: &str) -> Result<(), String> {
    if VERSIONS.contains(&version) {
        Ok(())
    } else {
        Err(format!("the app does not speak protocol version \"{version}\"."))
    }
}

// ── The store ──────────────────────────────────────────────────────────────

fn store_path() -> Result<PathBuf, String> {
    dirs::home_dir()
        .map(|h| h.join(".hashcortx").join(STORE_FILE))
        .ok_or_else(|| "there is no home folder to keep connections in.".to_string())
}

/// One reader or writer of the store at a time.
fn store_lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
}

fn load(path: &Path) -> Result<Store, String> {
    match fs::read_to_string(path) {
        Ok(text) => serde_json::from_str(&text).map_err(|_| "the saved connections could not be read.".to_string()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Store::default()),
        Err(e) => Err(format!("the saved connections could not be read: {e}")),
    }
}

/// Written whole to a file readable by this account only, then moved into
/// place, so a half-written store is never read.
fn save(path: &Path, store: &Store) -> Result<(), String> {
    if let Some(dir) = path.parent() {
        crate::security::private_dir::create(dir).map_err(|e| e.to_string())?;
    }
    let text = serde_json::to_string(store).map_err(|e| e.to_string())?;
    let temp = path.with_extension("json.tmp");
    {
        let mut options = fs::OpenOptions::new();
        options.write(true).create(true).truncate(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options.open(&temp).map_err(|e| e.to_string())?;
        std::io::Write::write_all(&mut file, text.as_bytes()).map_err(|e| e.to_string())?;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&temp, fs::Permissions::from_mode(0o600));
    }
    fs::rename(&temp, path).map_err(|e| e.to_string())
}

fn save_connection(
    path: &Path,
    id: &str,
    url: &str,
    auth: &str,
    header: &str,
    secret: Option<String>,
) -> Result<ConnectionInfo, String> {
    check_id(id)?;
    let url = check_url(url)?;
    check_auth(auth, header)?;
    if let Some(s) = secret.as_deref() {
        if auth != "none" && auth != "oauth" {
            check_secret(s)?;
        }
    }
    let _guard = store_lock().lock().map_err(|_| "the connections are busy.".to_string())?;
    let mut store = load(path)?;
    if !store.connections.contains_key(id) && store.connections.len() >= MAX_CONNECTIONS {
        return Err(format!("at most {MAX_CONNECTIONS} systems can be connected."));
    }
    let next = merged(store.connections.get(id), url, auth.to_string(), header.to_string(), secret);
    let info = ConnectionInfo::from(&next);
    if store.connections.get(id) != Some(&next) {
        forget_session(id);
    }
    store.connections.insert(id.to_string(), next);
    save(path, &store)?;
    Ok(info)
}

fn connection(path: &Path, id: &str) -> Result<Connection, String> {
    check_id(id)?;
    let _guard = store_lock().lock().map_err(|_| "the connections are busy.".to_string())?;
    load(path)?
        .connections
        .get(id)
        .cloned()
        .ok_or_else(|| "that system is not connected.".to_string())
}

fn remove_connection(path: &Path, id: &str) -> Result<(), String> {
    check_id(id)?;
    let _guard = store_lock().lock().map_err(|_| "the connections are busy.".to_string())?;
    let mut store = load(path)?;
    forget_session(id);
    if store.connections.remove(id).is_some() {
        save(path, &store)?;
    }
    Ok(())
}

// ── Sessions (older protocol versions) ─────────────────────────────────────

/// A session id a server gave when it was greeted, held in memory only.
fn sessions() -> &'static Mutex<HashMap<String, String>> {
    static SESSIONS: OnceLock<Mutex<HashMap<String, String>>> = OnceLock::new();
    SESSIONS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn forget_session(id: &str) {
    if let Ok(mut s) = sessions().lock() {
        s.remove(id);
    }
}

// ── Reading a reply ────────────────────────────────────────────────────────

/// The JSON-RPC message a streamed reply carries for request `want`: the
/// one with that id, or, failing that, the last one with any id.
fn from_event_stream(text: &str, want: Option<&serde_json::Value>) -> Option<String> {
    let mut last: Option<String> = None;
    for event in text.replace("\r\n", "\n").split("\n\n") {
        let data: Vec<&str> = event
            .lines()
            .filter_map(|l| l.strip_prefix("data:"))
            .map(|l| l.strip_prefix(' ').unwrap_or(l))
            .collect();
        if data.is_empty() {
            continue;
        }
        let joined = data.join("\n");
        let Ok(value) = serde_json::from_str::<serde_json::Value>(&joined) else { continue };
        let Some(id) = value.get("id") else { continue };
        if want.is_some_and(|w| w == id) {
            return Some(joined);
        }
        last = Some(joined);
    }
    last
}

fn agent() -> Agent {
    let config = Config::builder()
        // rustls is not compiled into this build; see provider.rs.
        .tls_config(TlsConfig::builder().provider(TlsProvider::NativeTls).build())
        // A redirect would take the secret somewhere it was not given for.
        .max_redirects(0)
        .http_status_as_error(false)
        .timeout_connect(Some(TIMEOUT_CONNECT))
        .timeout_global(Some(TIMEOUT_TOTAL))
        .user_agent("HashCortx")
        .build();
    Agent::new_with_config(config)
}

fn send(id: &str, conn: &Connection, body: &str, version: &str) -> Result<Reply, String> {
    let (method, tool) = check_body(body)?;
    check_version(version)?;
    let want: Option<serde_json::Value> = serde_json::from_str::<serde_json::Value>(body)
        .ok()
        .and_then(|v| v.get("id").cloned());
    let mut req = agent()
        .post(&conn.url)
        .header("Content-Type", "application/json")
        .header("Accept", "application/json, text/event-stream")
        .header("MCP-Protocol-Version", version)
        .header("Mcp-Method", method.as_str());
    if let Some(name) = &tool {
        req = req.header("Mcp-Name", name.as_str());
    }
    if let Some(session) = sessions().lock().ok().and_then(|s| s.get(id).cloned()) {
        req = req.header("Mcp-Session-Id", session.as_str());
    }
    match conn.auth.as_str() {
        "bearer" if !conn.secret.is_empty() => req = req.header("Authorization", format!("Bearer {}", conn.secret)),
        "header" if !conn.secret.is_empty() => req = req.header(conn.header.as_str(), conn.secret.as_str()),
        "oauth" => {
            if let Some(o) = conn.oauth.as_ref().filter(|o| o.signed_in()) {
                req = req.header("Authorization", format!("Bearer {}", o.access_token));
            }
        }
        _ => {}
    }
    let mut response = req
        .send(body.to_string())
        .map_err(|e| format!("the system could not be reached: {e}"))?;
    let status = response.status().as_u16();
    let header = |name: &str| {
        response
            .headers()
            .get(name)
            .and_then(|v| v.to_str().ok())
            .map(|s| s.to_string())
    };
    let mime = header("content-type").unwrap_or_default();
    if method == "initialize" {
        if let Some(session) = header("mcp-session-id") {
            if !session.is_empty() && session.len() <= 256 && session.chars().all(|c| c.is_ascii_graphic()) {
                if let Ok(mut s) = sessions().lock() {
                    s.insert(id.to_string(), session);
                }
            }
        }
    }
    // A session the server no longer knows is started again by the page.
    if status == 404 {
        forget_session(id);
    }
    let mut text = String::new();
    response
        .body_mut()
        .with_config()
        .limit(MAX_REPLY_BYTES)
        .reader()
        .read_to_string(&mut text)
        .map_err(|e| format!("the reply could not be read whole: {e}"))?;
    let body = if mime.to_ascii_lowercase().starts_with("text/event-stream") {
        from_event_stream(&text, want.as_ref()).unwrap_or_default()
    } else {
        text
    };
    Ok(Reply { status, mime, body })
}

// ── Commands ───────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn mcp_server_save(
    id: String,
    url: String,
    auth: String,
    header: Option<String>,
    secret: Option<String>,
) -> Result<ConnectionInfo, String> {
    super::off_main(move || {
        save_connection(&store_path()?, &id, &url, &auth, header.as_deref().unwrap_or(""), secret)
    })
    .await
}

#[tauri::command]
pub async fn mcp_server_remove(id: String) -> Result<(), String> {
    super::off_main(move || remove_connection(&store_path()?, &id)).await
}

#[tauri::command]
pub async fn mcp_request(id: String, body: String, version: String) -> Result<Reply, String> {
    super::off_main(move || {
        let path = store_path()?;
        let conn = oauth::fresh(&path, &id, connection(&path, &id)?);
        let reply = send(&id, &conn, &body, &version)?;
        // A token the system no longer takes is renewed once, when it can be.
        if reply.status == 401 && conn.auth == "oauth" {
            if let Ok(renewed) = oauth::renew(&path, &id, &conn) {
                return send(&id, &renewed, &body, &version);
            }
        }
        Ok(reply)
    })
    .await
}

/// Sign a connection in through the person's browser (mcp/oauth.rs). The
/// page learns only whether it is signed in.
#[tauri::command]
pub async fn mcp_oauth_sign_in(app: tauri::AppHandle, id: String) -> Result<ConnectionInfo, String> {
    use tauri_plugin_opener::OpenerExt;
    super::off_main(move || {
        let open = |url: &str| {
            app.opener()
                .open_url(url, None::<&str>)
                .map_err(|e| format!("the browser could not be opened: {e}"))
        };
        let conn = oauth::sign_in(&store_path()?, &id, &open)?;
        Ok(ConnectionInfo::from(&conn))
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{BufRead, BufReader, Write};
    use std::net::TcpListener;

    fn temp_store(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("hc-mcp-test-{}-{name}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        dir.join(STORE_FILE)
    }

    #[test]
    fn only_secure_addresses_or_this_computer_are_kept() {
        assert!(check_url("https://erp.example.org/mcp").is_ok());
        assert!(check_url("https://erp.office.example:8443/mcp/").is_ok());
        assert!(check_url("http://127.0.0.1:8000/mcp/").is_ok());
        assert!(check_url("http://localhost:8000/mcp").is_ok());
        assert!(check_url("http://[::1]:8000/mcp").is_ok());
        assert!(check_url("http://erp.example.org/mcp").is_err());
        assert!(check_url("http://erp.office.example/mcp").is_err());
        assert!(check_url("ftp://erp.example.org/mcp").is_err());
        assert!(check_url("https://user:pass@erp.example.org/mcp").is_err());
        assert!(check_url("https://erp.example.org/mcp\nX: y").is_err());
        assert!(check_url("https://erp.example.org/ mcp").is_err());
        assert!(check_url("").is_err());
        assert!(check_url(&format!("https://e.org/{}", "a".repeat(3000))).is_err());
    }

    #[test]
    fn a_sign_in_header_cannot_replace_one_the_app_sets() {
        assert!(check_auth("none", "").is_ok());
        assert!(check_auth("bearer", "").is_ok());
        assert!(check_auth("header", "X-Api-Key").is_ok());
        assert!(check_auth("header", "Authorization").is_ok());
        for name in ["Host", "content-length", "Mcp-Session-Id", "MCP-Protocol-Version", "Cookie", "Origin"] {
            assert!(check_auth("header", name).is_err(), "{name}");
        }
        assert!(check_auth("header", "X-Key\r\nEvil").is_err());
        assert!(check_auth("header", "").is_err());
        assert!(check_auth("cookie", "").is_err());
    }

    #[test]
    fn a_secret_is_one_line_of_plain_characters() {
        assert!(check_secret("token abc:def").is_ok());
        assert!(check_secret("abc\r\nX-Evil: 1").is_err());
        assert!(check_secret("").is_err());
        assert!(check_secret(&"a".repeat(MAX_SECRET_CHARS + 1)).is_err());
    }

    #[test]
    fn a_secret_stays_with_the_address_it_was_given_for() {
        let before = Connection { url: "https://a.org/mcp".into(), auth: "bearer".into(), header: String::new(), secret: "s1".into(), oauth: None };
        // Saved again unchanged, with no secret: the secret stays.
        let same = merged(Some(&before), "https://a.org/mcp".into(), "bearer".into(), String::new(), None);
        assert_eq!(same.secret, "s1");
        // A new address with no secret: dropped, never sent to the new one.
        let moved = merged(Some(&before), "https://b.org/mcp".into(), "bearer".into(), String::new(), None);
        assert_eq!(moved.secret, "");
        // Another way of signing in with no secret: dropped too.
        let other = merged(Some(&before), "https://a.org/mcp".into(), "header".into(), "X-Key".into(), None);
        assert_eq!(other.secret, "");
        // A new secret is taken; none is kept for a system that needs none.
        assert_eq!(merged(Some(&before), "https://b.org/mcp".into(), "bearer".into(), String::new(), Some("s2".into())).secret, "s2");
        assert_eq!(merged(Some(&before), "https://a.org/mcp".into(), "none".into(), String::new(), Some("s3".into())).secret, "");
    }

    #[test]
    fn tokens_from_a_browser_sign_in_stay_with_the_place_they_were_given_for() {
        let tokens = oauth::OAuth { access_token: "at".into(), refresh_token: "rt".into(), ..Default::default() };
        let before = Connection { url: "https://a.org/mcp".into(), auth: "oauth".into(), header: String::new(), secret: String::new(), oauth: Some(tokens) };
        assert!(merged(Some(&before), "https://a.org/mcp".into(), "oauth".into(), String::new(), None).oauth.is_some());
        assert!(merged(Some(&before), "https://b.org/mcp".into(), "oauth".into(), String::new(), None).oauth.is_none());
        assert!(merged(Some(&before), "https://a.org/mcp".into(), "bearer".into(), String::new(), Some("k".into())).oauth.is_none());
        // A secret is never kept for a connection that signs in through the browser.
        assert_eq!(merged(None, "https://a.org/mcp".into(), "oauth".into(), String::new(), Some("k".into())).secret, "");
        let shown = serde_json::to_string(&ConnectionInfo::from(&before)).unwrap();
        assert!(shown.contains("\"signedIn\":true") && !shown.contains("\"at\"") && !shown.contains("rt"));
    }

    #[test]
    fn only_the_methods_the_app_uses_can_be_sent() {
        assert_eq!(check_body(r#"{"jsonrpc":"2.0","id":1,"method":"tools/list"}"#).unwrap().0, "tools/list");
        assert_eq!(
            check_body(r#"{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"search_records","arguments":{}}}"#).unwrap().1,
            Some("search_records".into())
        );
        assert!(check_body(r#"{"jsonrpc":"2.0","id":1,"method":"resources/read"}"#).is_err());
        assert!(check_body(r#"{"jsonrpc":"2.0","id":1,"method":"sampling/createMessage"}"#).is_err());
        assert!(check_body(r#"[{"jsonrpc":"2.0","id":1,"method":"tools/list"}]"#).is_err());
        assert!(check_body(r#"{"jsonrpc":"1.0","id":1,"method":"tools/list"}"#).is_err());
        assert!(check_body(r#"{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"a\nb"}}"#).is_err());
        assert!(check_body("not json").is_err());
        assert!(check_version("2026-07-28").is_ok());
        assert!(check_version("1999-01-01").is_err());
    }

    #[test]
    fn a_streamed_reply_gives_the_answer_to_the_request_sent() {
        let text = "event: message\ndata: {\"jsonrpc\":\"2.0\",\"method\":\"notifications/progress\"}\n\n\
                    data: {\"jsonrpc\":\"2.0\",\"id\":7,\"result\":{\"a\":1}}\n\n\
                    data: {\"jsonrpc\":\"2.0\",\"id\":8,\"result\":{\"b\":2}}\n\n";
        let got = from_event_stream(text, Some(&serde_json::json!(7))).unwrap();
        assert!(got.contains("\"a\":1"));
        assert!(from_event_stream("data: not json\n\n", None).is_none());
    }

    #[test]
    fn the_page_can_learn_a_secret_is_set_but_never_read_it() {
        let path = temp_store("info");
        let info = save_connection(&path, "erp-1", "https://erp.example.org/mcp", "bearer", "", Some("very-secret".into())).unwrap();
        assert!(info.has_secret);
        let shown = serde_json::to_string(&info).unwrap();
        assert!(!shown.contains("very-secret"));
        // Moving the connection without a new secret drops it.
        let moved = save_connection(&path, "erp-1", "https://other.example.org/mcp", "bearer", "", None).unwrap();
        assert!(!moved.has_secret);
        remove_connection(&path, "erp-1").unwrap();
        assert!(connection(&path, "erp-1").is_err());
        let _ = fs::remove_dir_all(path.parent().unwrap());
    }

    #[cfg(unix)]
    #[test]
    fn the_store_is_readable_by_this_account_only() {
        use std::os::unix::fs::PermissionsExt;
        let path = temp_store("mode");
        save_connection(&path, "erp-2", "https://erp.example.org/mcp", "bearer", "", Some("s".into())).unwrap();
        let mode = fs::metadata(&path).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600);
        let _ = fs::remove_dir_all(path.parent().unwrap());
    }

    /// A one-request server on this computer that records what it was sent
    /// and answers with `reply`.
    fn serve_once(reply: &'static str) -> (String, std::thread::JoinHandle<String>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://127.0.0.1:{}/mcp", listener.local_addr().unwrap().port());
        let handle = std::thread::spawn(move || {
            let (stream, _) = listener.accept().unwrap();
            let mut reader = BufReader::new(stream.try_clone().unwrap());
            let mut head = String::new();
            let mut length = 0usize;
            loop {
                let mut line = String::new();
                reader.read_line(&mut line).unwrap();
                if line == "\r\n" || line.is_empty() {
                    break;
                }
                if let Some(v) = line.to_ascii_lowercase().strip_prefix("content-length:") {
                    length = v.trim().parse().unwrap_or(0);
                }
                head.push_str(&line);
            }
            let mut body = vec![0u8; length];
            reader.read_exact(&mut body).unwrap();
            let mut out = stream;
            out.write_all(reply.as_bytes()).unwrap();
            head
        });
        (url, handle)
    }

    #[test]
    fn a_request_carries_the_sign_in_and_the_protocol_headers() {
        let (url, server) = serve_once(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 36\r\nConnection: close\r\n\r\n{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{}}",
        );
        let conn = Connection { url, auth: "header".into(), header: "X-Api-Key".into(), secret: "k-123".into(), oauth: None };
        let reply = send("erp-3", &conn, r#"{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_record","arguments":{}}}"#, "2026-07-28").unwrap();
        assert_eq!(reply.status, 200);
        assert!(reply.body.contains("\"result\""));
        let head = server.join().unwrap().to_ascii_lowercase();
        assert!(head.contains("x-api-key: k-123"));
        assert!(head.contains("mcp-protocol-version: 2026-07-28"));
        assert!(head.contains("mcp-method: tools/call"));
        assert!(head.contains("mcp-name: get_record"));
        assert!(!head.contains("authorization"));
    }

    #[test]
    fn a_redirect_is_reported_and_never_followed() {
        let (url, server) = serve_once(
            "HTTP/1.1 302 Found\r\nLocation: https://elsewhere.example.org/steal\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
        );
        let conn = Connection { url, auth: "bearer".into(), header: String::new(), secret: "t".into(), oauth: None };
        let reply = send("erp-4", &conn, r#"{"jsonrpc":"2.0","id":1,"method":"tools/list"}"#, "2025-11-25").unwrap();
        assert_eq!(reply.status, 302);
        server.join().unwrap();
    }

    #[test]
    fn a_session_the_server_gave_is_sent_back_and_forgotten_when_it_ends() {
        let (url, server) = serve_once(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nMcp-Session-Id: abc-123\r\nContent-Length: 36\r\nConnection: close\r\n\r\n{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{}}",
        );
        let conn = Connection { url, auth: "none".into(), header: String::new(), secret: String::new(), oauth: None };
        send("erp-5", &conn, r#"{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}"#, "2025-11-25").unwrap();
        server.join().unwrap();
        assert_eq!(sessions().lock().unwrap().get("erp-5").map(String::as_str), Some("abc-123"));
        let (url2, server2) = serve_once("HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
        let conn2 = Connection { url: url2, ..conn };
        send("erp-5", &conn2, r#"{"jsonrpc":"2.0","id":2,"method":"tools/list"}"#, "2025-11-25").unwrap();
        assert!(server2.join().unwrap().to_ascii_lowercase().contains("mcp-session-id: abc-123"));
        assert!(sessions().lock().unwrap().get("erp-5").is_none());
    }
}
