// ==============================================================
// Signing in to a connected system through the browser
//
// Some systems do not take a key: the person signs in on the system's own
// page, and the app is handed a token. This is how the app does that, as the
// Model Context Protocol's authorization rules describe (OAuth 2.1 with PKCE),
// and what it keeps. Nothing here returns a token to the page.
//
// WHERE TO SIGN IN
//   Asked without a token, the system answers 401, usually naming a document
//   that says which server signs its users in; without one, the two standard
//   addresses for that document are tried. The document must be about this
//   system: the same scheme and host, and a path the connection's address
//   starts with. The sign-in server's own document is read from the standard
//   addresses in the standard order, and is used only when it names itself
//   exactly as the issuer the system gave. A server that does not offer PKCE
//   with S256 is refused before the browser opens.
//
// HOW THE APP INTRODUCES ITSELF
//   With its public client document when the server reads those
//   (CLIENT_METADATA_URL); otherwise by registering
//   itself as a native app with no secret, when the server allows that;
//   otherwise it cannot, and the person is told.
//
// THE SIGN-IN
//   The browser opens the server's page. The answer comes back to a one-time
//   address on this computer (http://127.0.0.1:<port>/callback), which
//   listens for five minutes and only for an answer carrying the state this
//   sign-in made. Before anything in the answer is used, the server's name on
//   it is checked against the issuer recorded before the browser opened. The
//   code is then exchanged with the PKCE verifier, naming the system as the
//   resource the token is for.
//
// WHAT IS KEPT
//   The tokens are kept with the connection in the store mcp.rs keeps,
//   readable by this account only, sent only to the connection's own
//   address, and dropped when the address or the way it signs in changes.
//   An access token past its time is renewed with the refresh token, when
//   the server gave one.
// ==============================================================

use super::{agent, check_url, connection, load, save, store_lock, Connection};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::Path;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

/// The app's public client document, read by sign-in servers that support
/// them. It is published at this address, and says the app's name, that it
/// has no secret, and where the answer comes back: 127.0.0.1 on DOCUMENT_PORT,
/// or on any port, as the loopback rule allows.
const CLIENT_METADATA_URL: Option<&str> = Some("https://hashcortx.com/oauth/client-metadata.json");
/// The port the client document names. A sign-in introduced by the document
/// waits on it, so a server that holds the answer's address to the document
/// exactly finds it there; when it is taken, any free port is used, which a
/// server following the loopback rule accepts.
const DOCUMENT_PORT: u16 = 28574;
const CLIENT_NAME: &str = "HashCortx";
const CALLBACK_PATH: &str = "/callback";
const SIGN_IN_WAIT: Duration = Duration::from_secs(300);
const MAX_DOC_BYTES: u64 = 256 * 1024;
const MAX_HEAD_BYTES: usize = 16 * 1024;
/// An access token this close to its end is renewed before it is sent.
const RENEW_EARLY_SECS: u64 = 30;

/// What signing in left, kept with the connection. None of it reaches the page.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
pub(crate) struct OAuth {
    pub issuer: String,
    pub client_id: String,
    #[serde(default)]
    pub client_secret: String,
    #[serde(default)]
    pub redirect_uri: String,
    pub token_endpoint: String,
    pub resource: String,
    #[serde(default)]
    pub scope: String,
    #[serde(default)]
    pub access_token: String,
    #[serde(default)]
    pub refresh_token: String,
    /// Seconds since 1970 at which the access token ends; 0 when not said.
    #[serde(default)]
    pub expires_at: u64,
}

impl OAuth {
    pub fn signed_in(&self) -> bool {
        !self.access_token.is_empty()
    }
}

// ── Small pieces ───────────────────────────────────────────────────────────

fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// Base64 in the URL-safe alphabet, without padding.
fn b64url(bytes: &[u8]) -> String {
    const ABC: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let mut out = String::with_capacity(bytes.len() * 4 / 3 + 2);
    for chunk in bytes.chunks(3) {
        let n = (u32::from(chunk[0]) << 16)
            | (u32::from(*chunk.get(1).unwrap_or(&0)) << 8)
            | u32::from(*chunk.get(2).unwrap_or(&0));
        let take = chunk.len() + 1;
        for i in 0..take {
            out.push(ABC[((n >> (18 - 6 * i)) & 63) as usize] as char);
        }
    }
    out
}

fn random_text(bytes: usize) -> Result<String, String> {
    let mut buf = vec![0u8; bytes];
    getrandom::fill(&mut buf).map_err(|e| format!("this computer gave no random numbers: {e}"))?;
    Ok(b64url(&buf))
}

/// The PKCE challenge for a verifier: S256.
fn challenge_of(verifier: &str) -> String {
    b64url(&Sha256::digest(verifier.as_bytes()))
}

/// Text as it goes in an address or a form: unreserved characters as they
/// are, everything else as %XX of its UTF-8 bytes.
fn encode(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for b in text.bytes() {
        if b.is_ascii_alphanumeric() || matches!(b, b'-' | b'.' | b'_' | b'~') {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
}

fn form(pairs: &[(&str, &str)]) -> String {
    pairs
        .iter()
        .map(|(k, v)| format!("{}={}", encode(k), encode(v)))
        .collect::<Vec<_>>()
        .join("&")
}

fn decode(text: &str) -> String {
    let bytes = text.as_bytes();
    let hex = |b: u8| (b as char).to_digit(16).map(|d| d as u8);
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'+' => out.push(b' '),
            b'%' if i + 2 < bytes.len() => match (hex(bytes[i + 1]), hex(bytes[i + 2])) {
                (Some(h), Some(l)) => {
                    out.push(h * 16 + l);
                    i += 2;
                }
                _ => out.push(b'%'),
            },
            b => out.push(b),
        }
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// The pairs of a query string, decoded.
fn query_pairs(query: &str) -> Vec<(String, String)> {
    query
        .split('&')
        .filter(|p| !p.is_empty())
        .map(|p| match p.split_once('=') {
            Some((k, v)) => (decode(k), decode(v)),
            None => (decode(p), String::new()),
        })
        .collect()
}

/// What a server said, shown to the person: one line of plain characters.
fn plain(text: &str) -> String {
    text.chars()
        .filter(|c| (' '..='~').contains(c))
        .take(200)
        .collect()
}

/// The Bearer challenge in a WWW-Authenticate header: the address of the
/// system's resource document, and the scope it asks for.
fn challenge(header: &str) -> (Option<String>, Option<String>) {
    let s = header.as_bytes();
    let (mut in_bearer, mut metadata, mut scope) = (false, None, None);
    let mut i = 0;
    while i < s.len() {
        while i < s.len() && matches!(s[i], b' ' | b'\t' | b',') {
            i += 1;
        }
        let start = i;
        while i < s.len() && !matches!(s[i], b' ' | b'\t' | b',' | b'=') {
            i += 1;
        }
        let token = &header[start..i];
        if token.is_empty() {
            i += 1;
            continue;
        }
        let mut j = i;
        while j < s.len() && matches!(s[j], b' ' | b'\t') {
            j += 1;
        }
        if j < s.len() && s[j] == b'=' {
            j += 1;
            while j < s.len() && matches!(s[j], b' ' | b'\t') {
                j += 1;
            }
            let mut value = String::new();
            if j < s.len() && s[j] == b'"' {
                j += 1;
                while j < s.len() && s[j] != b'"' {
                    if s[j] == b'\\' && j + 1 < s.len() {
                        j += 1;
                    }
                    value.push(s[j] as char);
                    j += 1;
                }
                j += 1;
            } else {
                let from = j;
                while j < s.len() && s[j] != b',' {
                    j += 1;
                }
                value = header[from..j].trim().to_string();
            }
            if in_bearer {
                match token.to_ascii_lowercase().as_str() {
                    "resource_metadata" => metadata = Some(value),
                    "scope" => scope = Some(value),
                    _ => {}
                }
            }
            i = j;
        } else {
            in_bearer = token.eq_ignore_ascii_case("bearer");
            i = j;
        }
    }
    (metadata, scope)
}

/// An address split into its scheme and host part, and its path.
fn split(url: &str) -> Option<(String, String)> {
    let (scheme, rest) = url.split_once("://")?;
    let (authority, path) = match rest.find(['/', '?', '#']) {
        Some(at) => (&rest[..at], &rest[at..]),
        None => (rest, ""),
    };
    let path = path.split(['?', '#']).next().unwrap_or("");
    Some((
        format!(
            "{}://{}",
            scheme.to_ascii_lowercase(),
            authority.to_ascii_lowercase()
        ),
        path.to_string(),
    ))
}

/// Where a system's resource document may be: under its own path, then at the root.
fn resource_documents(url: &str) -> Vec<String> {
    let Some((origin, path)) = split(url) else {
        return vec![];
    };
    let path = path.trim_end_matches('/');
    let mut out = Vec::new();
    if !path.is_empty() {
        out.push(format!(
            "{origin}/.well-known/oauth-protected-resource{path}"
        ));
    }
    out.push(format!("{origin}/.well-known/oauth-protected-resource"));
    out
}

/// Whether a resource document is about this system: the same scheme and
/// host, and a path the connection's address starts with, whole segments.
fn resource_fits(resource: &str, url: &str) -> bool {
    let (Some((a, pa)), Some((b, pb))) = (split(resource), split(url)) else {
        return false;
    };
    let (pa, pb) = (pa.trim_end_matches('/'), pb.trim_end_matches('/'));
    a == b && (pa.is_empty() || pb == pa || pb.starts_with(&format!("{pa}/")))
}

/// Where a sign-in server's own document may be, in the order the rules give.
fn issuer_documents(issuer: &str) -> Vec<String> {
    let Some((origin, path)) = split(issuer) else {
        return vec![];
    };
    let path = path.trim_end_matches('/');
    if path.is_empty() {
        vec![
            format!("{origin}/.well-known/oauth-authorization-server"),
            format!("{origin}/.well-known/openid-configuration"),
        ]
    } else {
        vec![
            format!("{origin}/.well-known/oauth-authorization-server{path}"),
            format!("{origin}/.well-known/openid-configuration{path}"),
            format!("{origin}{path}/.well-known/openid-configuration"),
        ]
    }
}

/// A document read as JSON from an address the app may reach, with no
/// redirect followed.
fn get_json(url: &str) -> Result<Option<serde_json::Value>, String> {
    let url = check_url(url)?;
    let mut response = agent()
        .get(&url)
        .header("Accept", "application/json")
        .call()
        .map_err(|e| format!("{} could not be reached: {e}", plain(&url)))?;
    if response.status().as_u16() != 200 {
        return Ok(None);
    }
    let mut text = String::new();
    response
        .body_mut()
        .with_config()
        .limit(MAX_DOC_BYTES)
        .reader()
        .read_to_string(&mut text)
        .map_err(|e| format!("a sign-in document could not be read whole: {e}"))?;
    Ok(serde_json::from_str(&text).ok())
}

/// A form posted to a sign-in server; its JSON answer, or what it refused.
fn post(url: &str, content_type: &str, body: String) -> Result<(u16, serde_json::Value), String> {
    let url = check_url(url)?;
    let mut response = agent()
        .post(&url)
        .header("Content-Type", content_type)
        .header("Accept", "application/json")
        .send(body)
        .map_err(|e| format!("the sign-in server could not be reached: {e}"))?;
    let status = response.status().as_u16();
    let mut text = String::new();
    response
        .body_mut()
        .with_config()
        .limit(MAX_DOC_BYTES)
        .reader()
        .read_to_string(&mut text)
        .map_err(|e| format!("the sign-in server's answer could not be read whole: {e}"))?;
    Ok((
        status,
        serde_json::from_str(&text).unwrap_or(serde_json::Value::Null),
    ))
}

fn refused(what: &str, answer: &serde_json::Value) -> String {
    let error = answer.get("error").and_then(|v| v.as_str()).unwrap_or("");
    let said = answer
        .get("error_description")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    match (error.is_empty(), said.is_empty()) {
        (true, _) => format!("the sign-in server refused {what}."),
        (false, true) => format!("the sign-in server refused {what}: {}.", plain(error)),
        (false, false) => format!(
            "the sign-in server refused {what}: {} ({}).",
            plain(error),
            plain(said)
        ),
    }
}

fn text_field(v: &serde_json::Value, key: &str) -> String {
    v.get(key)
        .and_then(|x| x.as_str())
        .unwrap_or("")
        .to_string()
}

// ── What the servers say about themselves ──────────────────────────────────

struct Server {
    issuer: String,
    authorization_endpoint: String,
    token_endpoint: String,
    registration_endpoint: String,
    reads_client_documents: bool,
    names_itself: bool,
    offline_access: bool,
}

/// The sign-in server's own document, from the first standard address that
/// has one, used only if it names itself as `issuer`.
fn server_of(issuer: &str) -> Result<Server, String> {
    check_url(issuer)?;
    for address in issuer_documents(issuer) {
        let Some(doc) = get_json(&address)? else {
            continue;
        };
        if text_field(&doc, "issuer") != issuer {
            return Err(
                "the sign-in server's document names another server, so it is not used.".into(),
            );
        }
        let methods = doc
            .get("code_challenge_methods_supported")
            .and_then(|v| v.as_array());
        if !methods.is_some_and(|m| m.iter().any(|x| x.as_str() == Some("S256"))) {
            return Err("the sign-in server does not offer the protection this app requires (PKCE with S256), so it is not used.".into());
        }
        let endpoint = |key: &str| {
            let at = text_field(&doc, key);
            if at.is_empty() {
                Err(format!("the sign-in server's document gives no {key}."))
            } else {
                check_url(&at)
            }
        };
        let authorization_endpoint = endpoint("authorization_endpoint")?;
        let token_endpoint = endpoint("token_endpoint")?;
        let registration = text_field(&doc, "registration_endpoint");
        let registration_endpoint = if registration.is_empty() {
            String::new()
        } else {
            check_url(&registration)?
        };
        let scopes = doc.get("scopes_supported").and_then(|v| v.as_array());
        return Ok(Server {
            issuer: issuer.to_string(),
            authorization_endpoint,
            token_endpoint,
            registration_endpoint,
            reads_client_documents: doc
                .get("client_id_metadata_document_supported")
                .and_then(|v| v.as_bool())
                == Some(true),
            names_itself: doc
                .get("authorization_response_iss_parameter_supported")
                .and_then(|v| v.as_bool())
                == Some(true),
            offline_access: scopes
                .is_some_and(|s| s.iter().any(|x| x.as_str() == Some("offline_access"))),
        });
    }
    Err("the sign-in server has no document at the standard addresses.".into())
}

/// Ask the system without a token; its challenge, if it asks for a sign-in.
fn ask_unsigned(url: &str) -> Result<(Option<String>, Option<String>), String> {
    let mut response = agent()
        .post(url)
        .header("Content-Type", "application/json")
        .header("Accept", "application/json, text/event-stream")
        .send(r#"{"jsonrpc":"2.0","id":0,"method":"server/discover"}"#.to_string())
        .map_err(|e| format!("the system could not be reached: {e}"))?;
    let status = response.status().as_u16();
    let header = response
        .headers()
        .get("www-authenticate")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());
    let _ = response
        .body_mut()
        .with_config()
        .limit(MAX_DOC_BYTES)
        .reader()
        .read_to_end(&mut Vec::new());
    if status != 401 {
        return Err("this system did not ask for a sign-in, so there is none to make. Connect it with no key.".into());
    }
    Ok(header.as_deref().map(challenge).unwrap_or((None, None)))
}

// ── The answer, on this computer ───────────────────────────────────────────

#[derive(Debug, Default, PartialEq)]
struct Answer {
    code: String,
    iss: Option<String>,
    error: String,
    error_description: String,
}

const PAGE_DONE: &str = "Signed in. You can close this tab and go back to HashCortx.";
const PAGE_FAILED: &str = "The sign-in did not finish. HashCortx says why.";
const PAGE_NOT_OURS: &str = "HashCortx is not waiting for this.";

fn respond(stream: &mut TcpStream, status: &str, text: &str) {
    let body = format!(
        "<!doctype html><meta charset=\"utf-8\"><title>HashCortx</title><body style=\"font:16px -apple-system,system-ui,sans-serif;margin:3em\"><p>{text}</p></body>"
    );
    let _ = write!(
        stream,
        "HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
}

/// The request line's target, read from one connection to the one-time address.
fn target_of(stream: &mut TcpStream) -> Option<(String, String)> {
    stream.set_read_timeout(Some(Duration::from_secs(5))).ok()?;
    let mut head = Vec::new();
    let mut buf = [0u8; 1024];
    while !head.windows(4).any(|w| w == b"\r\n\r\n") && head.len() < MAX_HEAD_BYTES {
        let n = stream.read(&mut buf).ok()?;
        if n == 0 {
            break;
        }
        head.extend_from_slice(&buf[..n]);
    }
    let text = String::from_utf8_lossy(&head);
    let mut parts = text.lines().next()?.split_whitespace();
    Some((parts.next()?.to_string(), parts.next()?.to_string()))
}

/// Wait for the answer carrying `state`; anything else is turned away and
/// the wait goes on, until `deadline`.
fn wait_for_answer(
    listener: &TcpListener,
    state: &str,
    deadline: Instant,
) -> Result<Answer, String> {
    listener.set_nonblocking(true).map_err(|e| e.to_string())?;
    while Instant::now() < deadline {
        let mut stream = match listener.accept() {
            Ok((s, _)) => s,
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(Duration::from_millis(100));
                continue;
            }
            Err(e) => return Err(format!("the sign-in answer could not be received: {e}")),
        };
        let _ = stream.set_nonblocking(false);
        let Some((method, target)) = target_of(&mut stream) else {
            continue;
        };
        let (path, query) = target.split_once('?').unwrap_or((target.as_str(), ""));
        if method != "GET" || path != CALLBACK_PATH {
            respond(&mut stream, "404 Not Found", PAGE_NOT_OURS);
            continue;
        }
        let pairs = query_pairs(query);
        let get = |k: &str| pairs.iter().find(|(n, _)| n == k).map(|(_, v)| v.clone());
        if get("state").as_deref() != Some(state) {
            respond(&mut stream, "400 Bad Request", PAGE_NOT_OURS);
            continue;
        }
        let answer = Answer {
            code: get("code").unwrap_or_default(),
            iss: get("iss"),
            error: get("error").unwrap_or_default(),
            error_description: get("error_description").unwrap_or_default(),
        };
        let done = !answer.code.is_empty() && answer.error.is_empty();
        respond(
            &mut stream,
            "200 OK",
            if done { PAGE_DONE } else { PAGE_FAILED },
        );
        return Ok(answer);
    }
    Err("the sign-in was not finished within five minutes. Try again.".into())
}

/// Whether an answer may be used, by the server's name on it (RFC 9207 2.4).
fn issuer_checked(server: &Server, iss: Option<&str>) -> Result<(), String> {
    match (server.names_itself, iss) {
        (_, Some(said)) if said == server.issuer => Ok(()),
        (_, Some(_)) => {
            Err("the sign-in answer came from another server, so it was not used.".into())
        }
        (true, None) => {
            Err("the sign-in answer did not say which server sent it, so it was not used.".into())
        }
        (false, None) => Ok(()),
    }
}

// ── Tokens ─────────────────────────────────────────────────────────────────

struct Tokens {
    access: String,
    refresh: String,
    expires_at: u64,
    scope: String,
}

fn tokens_from(status: u16, answer: &serde_json::Value, what: &str) -> Result<Tokens, String> {
    if status != 200 {
        return Err(refused(what, answer));
    }
    let access = text_field(answer, "access_token");
    let kind = text_field(answer, "token_type");
    let plain_line = |t: &str| t.len() <= 8192 && t.chars().all(|c| (' '..='~').contains(&c));
    if access.is_empty() || !plain_line(&access) || !kind.eq_ignore_ascii_case("bearer") {
        return Err("the sign-in server's token is not one this app can use.".into());
    }
    let refresh = text_field(answer, "refresh_token");
    let expires_at = answer
        .get("expires_in")
        .and_then(|v| v.as_u64())
        .map(|s| now() + s)
        .unwrap_or(0);
    Ok(Tokens {
        access,
        refresh: if plain_line(&refresh) {
            refresh
        } else {
            String::new()
        },
        expires_at,
        scope: text_field(answer, "scope"),
    })
}

/// Keep what signing in or renewing left, if the connection is still the one
/// it was done for.
fn keep(path: &Path, id: &str, url: &str, oauth: OAuth) -> Result<Connection, String> {
    let _guard = store_lock()
        .lock()
        .map_err(|_| "the connections are busy.".to_string())?;
    let mut store = load(path)?;
    let conn = store
        .connections
        .get_mut(id)
        .ok_or("that system is no longer connected.")?;
    if conn.url != url || conn.auth != "oauth" {
        return Err(
            "the connection was changed while signing in, so the sign-in was not kept.".into(),
        );
    }
    conn.oauth = Some(oauth);
    let kept = conn.clone();
    save(path, &store)?;
    Ok(kept)
}

/// Renew an access token with the refresh token. The renewed tokens are kept.
pub(super) fn renew(path: &Path, id: &str, conn: &Connection) -> Result<Connection, String> {
    let Some(o) = conn.oauth.as_ref().filter(|o| !o.refresh_token.is_empty()) else {
        return Err("sign in again in Settings → Connections.".into());
    };
    let mut pairs = vec![
        ("grant_type", "refresh_token"),
        ("refresh_token", o.refresh_token.as_str()),
        ("client_id", o.client_id.as_str()),
        ("resource", o.resource.as_str()),
    ];
    if !o.client_secret.is_empty() {
        pairs.push(("client_secret", o.client_secret.as_str()));
    }
    let (status, answer) = post(
        &o.token_endpoint,
        "application/x-www-form-urlencoded",
        form(&pairs),
    )?;
    let t = tokens_from(status, &answer, "to renew the sign-in")?;
    let next = OAuth {
        access_token: t.access,
        // A server that rotates refresh tokens sends a new one; one that does not keeps the old.
        refresh_token: if t.refresh.is_empty() {
            o.refresh_token.clone()
        } else {
            t.refresh
        },
        expires_at: t.expires_at,
        scope: if t.scope.is_empty() {
            o.scope.clone()
        } else {
            t.scope
        },
        ..o.clone()
    };
    keep(path, id, &conn.url, next)
}

/// The connection with an access token that has not run out, renewed first
/// when it has and can be. A renewal that fails leaves it as it was; the
/// system then refuses it, and the person is asked to sign in again.
pub(super) fn fresh(path: &Path, id: &str, conn: Connection) -> Connection {
    let due = conn.oauth.as_ref().is_some_and(|o| {
        o.expires_at != 0 && now() + RENEW_EARLY_SECS >= o.expires_at && !o.refresh_token.is_empty()
    });
    if conn.auth == "oauth" && due {
        return renew(path, id, &conn).unwrap_or(conn);
    }
    conn
}

// ── Signing in ─────────────────────────────────────────────────────────────

/// Sign a connection in: find its sign-in server, introduce the app, open
/// the server's page with `open`, and keep the tokens it hands back.
pub(super) fn sign_in(
    path: &Path,
    id: &str,
    open: &dyn Fn(&str) -> Result<(), String>,
) -> Result<Connection, String> {
    let conn = connection(path, id)?;
    if conn.auth != "oauth" {
        return Err("this connection does not sign in through the browser.".into());
    }
    let (said_metadata, said_scope) = ask_unsigned(&conn.url)?;

    // The system's resource document, and the sign-in server it names.
    let mut resource_doc = None;
    for address in said_metadata
        .into_iter()
        .chain(resource_documents(&conn.url))
    {
        if let Some(doc) = get_json(&address)? {
            resource_doc = Some(doc);
            break;
        }
    }
    let doc = resource_doc
        .ok_or("the system did not say where to sign in, so it needs a key instead.")?;
    let resource = text_field(&doc, "resource");
    if !resource_fits(&resource, &conn.url) {
        return Err(
            "the system's sign-in document is about another address, so it was not used.".into(),
        );
    }
    let issuer = doc
        .get("authorization_servers")
        .and_then(|v| v.as_array())
        .and_then(|a| a.iter().find_map(|x| x.as_str()))
        .ok_or("the system's sign-in document names no sign-in server.")?
        .to_string();
    let server = server_of(&issuer)?;

    // What to ask for: what the system asked for, else what it lists.
    let mut scope = said_scope.unwrap_or_else(|| {
        doc.get("scopes_supported")
            .and_then(|v| v.as_array())
            .map(|a| {
                a.iter()
                    .filter_map(|x| x.as_str())
                    .collect::<Vec<_>>()
                    .join(" ")
            })
            .unwrap_or_default()
    });
    if server.offline_access && !scope.split(' ').any(|s| s == "offline_access") {
        scope = format!("{scope} offline_access").trim().to_string();
    }

    // The one-time address: on the port the client document names when the
    // server reads it, otherwise on the port this app registered before, when
    // either can be had.
    let before = conn.oauth.clone().filter(|o| o.issuer == server.issuer);
    let by_document = CLIENT_METADATA_URL.is_some() && server.reads_client_documents;
    let wanted_port = if by_document {
        Some(DOCUMENT_PORT)
    } else {
        before
            .as_ref()
            .and_then(|o| o.redirect_uri.rsplit_once(':'))
            .and_then(|(_, rest)| rest.split('/').next())
            .and_then(|p| p.parse::<u16>().ok())
    };
    let listener = wanted_port
        .and_then(|p| TcpListener::bind(("127.0.0.1", p)).ok())
        .map_or_else(|| TcpListener::bind(("127.0.0.1", 0)), Ok)
        .map_err(|e| format!("no address on this computer could wait for the sign-in: {e}"))?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let redirect_uri = format!("http://127.0.0.1:{port}{CALLBACK_PATH}");

    // Introducing the app.
    let (client_id, client_secret) = match (CLIENT_METADATA_URL, before) {
        (Some(document), _) if by_document => (document.to_string(), String::new()),
        (_, Some(o)) if o.redirect_uri == redirect_uri && !o.client_id.is_empty() => (o.client_id, o.client_secret),
        _ if !server.registration_endpoint.is_empty() => register(&server, &redirect_uri)?,
        _ => return Err("this system's sign-in server does not let new apps introduce themselves, so HashCortx cannot sign in to it yet. Use a key if it offers one.".into()),
    };

    let verifier = random_text(32)?;
    let state = random_text(16)?;
    let code_challenge = challenge_of(&verifier);
    let mut pairs = vec![
        ("response_type", "code"),
        ("client_id", client_id.as_str()),
        ("redirect_uri", redirect_uri.as_str()),
        ("code_challenge", code_challenge.as_str()),
        ("code_challenge_method", "S256"),
        ("state", state.as_str()),
        ("resource", resource.as_str()),
    ];
    if !scope.is_empty() {
        pairs.push(("scope", scope.as_str()));
    }
    let joiner = if server.authorization_endpoint.contains('?') {
        '&'
    } else {
        '?'
    };
    open(&format!(
        "{}{joiner}{}",
        server.authorization_endpoint,
        form(&pairs)
    ))?;

    let answer = wait_for_answer(&listener, &state, Instant::now() + SIGN_IN_WAIT)?;
    drop(listener);
    // Nothing in an answer is used, its error included, before its sender is known.
    issuer_checked(&server, answer.iss.as_deref())?;
    if !answer.error.is_empty() || answer.code.is_empty() {
        let said = if answer.error_description.is_empty() {
            answer.error.clone()
        } else {
            answer.error_description.clone()
        };
        return Err(if said.is_empty() {
            "the sign-in did not finish.".into()
        } else {
            format!("the sign-in did not finish: {}.", plain(&said))
        });
    }

    let mut exchange = vec![
        ("grant_type", "authorization_code"),
        ("code", answer.code.as_str()),
        ("redirect_uri", redirect_uri.as_str()),
        ("client_id", client_id.as_str()),
        ("code_verifier", verifier.as_str()),
        ("resource", resource.as_str()),
    ];
    if !client_secret.is_empty() {
        exchange.push(("client_secret", client_secret.as_str()));
    }
    let (status, reply) = post(
        &server.token_endpoint,
        "application/x-www-form-urlencoded",
        form(&exchange),
    )?;
    let t = tokens_from(status, &reply, "the sign-in")?;
    keep(
        path,
        id,
        &conn.url,
        OAuth {
            issuer: server.issuer,
            client_id,
            client_secret,
            redirect_uri,
            token_endpoint: server.token_endpoint,
            resource,
            scope: if t.scope.is_empty() { scope } else { t.scope },
            access_token: t.access,
            refresh_token: t.refresh,
            expires_at: t.expires_at,
        },
    )
}

/// Register the app with a sign-in server, as a native app with no secret.
fn register(server: &Server, redirect_uri: &str) -> Result<(String, String), String> {
    let request = serde_json::json!({
        "client_name": CLIENT_NAME,
        "redirect_uris": [redirect_uri],
        "grant_types": ["authorization_code", "refresh_token"],
        "response_types": ["code"],
        "token_endpoint_auth_method": "none",
        "application_type": "native",
    });
    let (status, answer) = post(
        &server.registration_endpoint,
        "application/json",
        request.to_string(),
    )?;
    if status != 200 && status != 201 {
        return Err(refused("to register HashCortx", &answer));
    }
    let id = text_field(&answer, "client_id");
    let shaped = |t: &str| t.len() <= 512 && t.chars().all(|c| (' '..='~').contains(&c));
    if id.is_empty() || !shaped(&id) {
        return Err("the sign-in server's registration gave no usable client id.".into());
    }
    let secret = text_field(&answer, "client_secret");
    Ok((
        id,
        if shaped(&secret) {
            secret
        } else {
            String::new()
        },
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{BufRead, BufReader};
    use std::sync::{Arc, Mutex};

    #[test]
    fn the_pkce_challenge_is_the_one_the_standard_gives() {
        // RFC 7636, Appendix B.
        assert_eq!(
            challenge_of("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
        );
        assert_eq!(b64url(b"f"), "Zg");
        assert_eq!(b64url(b"fo"), "Zm8");
        assert_eq!(b64url(b"foo"), "Zm9v");
        assert_eq!(b64url(&[0xfb, 0xff]), "-_8");
        let a = random_text(32).unwrap();
        assert_eq!(a.len(), 43);
        assert_ne!(a, random_text(32).unwrap());
    }

    #[test]
    fn text_goes_into_a_form_and_comes_back_out() {
        assert_eq!(encode("a b&c=d/é"), "a%20b%26c%3Dd%2F%C3%A9");
        assert_eq!(
            form(&[("scope", "read write"), ("x", "1")]),
            "scope=read%20write&x=1"
        );
        let back = query_pairs("code=abc%2F1&state=s+1&empty=&iss=https%3A%2F%2Fa.example");
        assert_eq!(back[0], ("code".into(), "abc/1".into()));
        assert_eq!(back[1], ("state".into(), "s 1".into()));
        assert_eq!(back[3].1, "https://a.example");
        assert_eq!(decode("100%"), "100%");
        assert_eq!(decode("%zz"), "%zz");
    }

    #[test]
    fn the_challenge_names_the_document_and_the_scope() {
        let (m, s) = challenge(
            r#"Bearer resource_metadata="https://mcp.example.com/.well-known/oauth-protected-resource", scope="files:read files:write""#,
        );
        assert_eq!(
            m.as_deref(),
            Some("https://mcp.example.com/.well-known/oauth-protected-resource")
        );
        assert_eq!(s.as_deref(), Some("files:read files:write"));
        let (m, _) = challenge(
            r#"Basic realm="x", Bearer error="invalid_token", resource_metadata="https://a.example/rm""#,
        );
        assert_eq!(m.as_deref(), Some("https://a.example/rm"));
        let (m, s) = challenge(r#"Basic resource_metadata="https://not-bearer.example""#);
        assert!(m.is_none() && s.is_none());
        assert_eq!(challenge("").0, None);
    }

    #[test]
    fn documents_are_looked_for_where_the_rules_say() {
        assert_eq!(
            resource_documents("https://mcp.example.com/public/mcp"),
            vec![
                "https://mcp.example.com/.well-known/oauth-protected-resource/public/mcp",
                "https://mcp.example.com/.well-known/oauth-protected-resource"
            ]
        );
        assert_eq!(
            resource_documents("https://mcp.example.com"),
            vec!["https://mcp.example.com/.well-known/oauth-protected-resource"]
        );
        assert_eq!(
            issuer_documents("https://auth.example.com/tenant1"),
            vec![
                "https://auth.example.com/.well-known/oauth-authorization-server/tenant1",
                "https://auth.example.com/.well-known/openid-configuration/tenant1",
                "https://auth.example.com/tenant1/.well-known/openid-configuration",
            ]
        );
        assert_eq!(
            issuer_documents("https://auth.example.com"),
            vec![
                "https://auth.example.com/.well-known/oauth-authorization-server",
                "https://auth.example.com/.well-known/openid-configuration"
            ]
        );
    }

    #[test]
    fn a_resource_document_must_be_about_this_system() {
        assert!(resource_fits(
            "https://mcp.example.com",
            "https://mcp.example.com/mcp"
        ));
        assert!(resource_fits(
            "https://mcp.example.com/mcp",
            "https://mcp.example.com/mcp"
        ));
        assert!(resource_fits(
            "https://MCP.example.com/mcp/",
            "https://mcp.example.com/mcp"
        ));
        assert!(!resource_fits(
            "https://other.example.com/mcp",
            "https://mcp.example.com/mcp"
        ));
        assert!(!resource_fits(
            "http://mcp.example.com/mcp",
            "https://mcp.example.com/mcp"
        ));
        assert!(!resource_fits(
            "https://mcp.example.com/mc",
            "https://mcp.example.com/mcp"
        ));
        assert!(!resource_fits(
            "https://mcp.example.com/mcp/other",
            "https://mcp.example.com/mcp"
        ));
        assert!(!resource_fits("", "https://mcp.example.com/mcp"));
    }

    fn server(names_itself: bool) -> Server {
        Server {
            issuer: "https://auth.example.com".into(),
            authorization_endpoint: String::new(),
            token_endpoint: String::new(),
            registration_endpoint: String::new(),
            reads_client_documents: false,
            names_itself,
            offline_access: false,
        }
    }

    #[test]
    fn an_answer_is_used_only_from_the_server_it_was_asked_of() {
        assert!(issuer_checked(&server(true), Some("https://auth.example.com")).is_ok());
        assert!(issuer_checked(&server(true), None).is_err());
        assert!(issuer_checked(&server(true), Some("https://evil.example.com")).is_err());
        assert!(issuer_checked(&server(false), Some("https://auth.example.com")).is_ok());
        assert!(issuer_checked(&server(false), Some("https://auth.example.com/")).is_err());
        assert!(issuer_checked(&server(false), None).is_ok());
    }

    #[test]
    fn a_token_the_app_cannot_use_is_refused() {
        let good = serde_json::json!({"access_token": "at", "token_type": "Bearer", "expires_in": 60, "refresh_token": "rt"});
        let t = tokens_from(200, &good, "x").unwrap();
        assert_eq!((t.access.as_str(), t.refresh.as_str()), ("at", "rt"));
        assert!(t.expires_at >= now() + 59);
        assert!(tokens_from(
            200,
            &serde_json::json!({"access_token": "at", "token_type": "mac"}),
            "x"
        )
        .is_err());
        assert!(tokens_from(
            200,
            &serde_json::json!({"access_token": "a\nb", "token_type": "bearer"}),
            "x"
        )
        .is_err());
        let Err(err) = tokens_from(
            400,
            &serde_json::json!({"error": "invalid_grant", "error_description": "code used"}),
            "the sign-in",
        ) else {
            panic!("a refusal was taken")
        };
        assert_eq!(
            err,
            "the sign-in server refused the sign-in: invalid_grant (code used)."
        );
    }

    // ── A whole sign-in, against stand-ins on this computer ─────────────────

    type Handler = dyn Fn(&str, &str, &str, &str) -> String + Send + Sync;

    /// A server on this computer answering every request with `handler(method,
    /// target, headers, body)`, for as long as the test runs.
    fn serve(handler: Arc<Handler>) -> (u16, TcpListener) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let taken = listener.try_clone().unwrap();
        std::thread::spawn(move || {
            for stream in taken.incoming() {
                let Ok(stream) = stream else { continue };
                let handler = handler.clone();
                std::thread::spawn(move || {
                    let mut reader = BufReader::new(stream.try_clone().unwrap());
                    let mut first = String::new();
                    if reader.read_line(&mut first).is_err() {
                        return;
                    }
                    let mut headers = String::new();
                    let mut length = 0usize;
                    loop {
                        let mut line = String::new();
                        if reader.read_line(&mut line).is_err() || line == "\r\n" || line.is_empty()
                        {
                            break;
                        }
                        if let Some(v) = line.to_ascii_lowercase().strip_prefix("content-length:") {
                            length = v.trim().parse().unwrap_or(0);
                        }
                        headers.push_str(&line);
                    }
                    let mut body = vec![0u8; length];
                    let _ = reader.read_exact(&mut body);
                    let mut parts = first.split_whitespace();
                    let (method, target) = (parts.next().unwrap_or(""), parts.next().unwrap_or(""));
                    let reply = handler(method, target, &headers, &String::from_utf8_lossy(&body));
                    let mut out = stream;
                    let _ = out.write_all(reply.as_bytes());
                });
            }
        });
        (port, listener)
    }

    fn json(status: &str, body: &str, extra: &str) -> String {
        format!("HTTP/1.1 {status}\r\nContent-Type: application/json\r\n{extra}Content-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len())
    }

    fn temp_store(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("hc-oauth-test-{}-{name}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        dir.join(super::super::STORE_FILE)
    }

    /// What the stand-in sign-in server saw.
    #[derive(Default)]
    struct Seen {
        challenge: String,
        exchanged: Vec<String>,
        renewed: Vec<String>,
        registered: u32,
        bearer: Vec<String>,
    }

    /// A system and its sign-in server on one port. `wrong_iss` makes the
    /// answer carry another server's name; `no_pkce` leaves S256 unoffered;
    /// `reads_documents` has the server read client documents.
    fn stand_in(
        wrong_iss: bool,
        no_pkce: bool,
        reads_documents: bool,
    ) -> (u16, Arc<Mutex<Seen>>, TcpListener) {
        let seen = Arc::new(Mutex::new(Seen::default()));
        let port_cell = Arc::new(Mutex::new(0u16));
        let (s, p) = (seen.clone(), port_cell.clone());
        let handler: Arc<Handler> = Arc::new(move |method, target, headers, body| {
            let port = *p.lock().unwrap();
            let base = format!("http://127.0.0.1:{port}");
            let (path, query) = target.split_once('?').unwrap_or((target, ""));
            match (method, path) {
                ("POST", "/mcp") => {
                    let auth = headers.lines().find_map(|l| {
                        l.to_ascii_lowercase()
                            .strip_prefix("authorization: bearer ")
                            .map(|t| t.trim().to_string())
                    });
                    match auth {
                        Some(t) if t.starts_with("at-") => {
                            s.lock().unwrap().bearer.push(t);
                            json("200 OK", r#"{"jsonrpc":"2.0","id":1,"result":{}}"#, "")
                        }
                        _ => json("401 Unauthorized", "{}", &format!("WWW-Authenticate: Bearer resource_metadata=\"{base}/.well-known/oauth-protected-resource/mcp\", scope=\"records:read\"\r\n")),
                    }
                }
                ("GET", "/.well-known/oauth-protected-resource/mcp") => json(
                    "200 OK",
                    &format!(r#"{{"resource":"{base}/mcp","authorization_servers":["{base}"]}}"#),
                    "",
                ),
                ("GET", "/.well-known/oauth-authorization-server") => {
                    let pkce = if no_pkce {
                        ""
                    } else {
                        r#","code_challenge_methods_supported":["S256"]"#
                    };
                    let documents = if reads_documents {
                        r#","client_id_metadata_document_supported":true"#
                    } else {
                        ""
                    };
                    json(
                        "200 OK",
                        &format!(
                            r#"{{"issuer":"{base}","authorization_endpoint":"{base}/authorize","token_endpoint":"{base}/token","registration_endpoint":"{base}/register","authorization_response_iss_parameter_supported":true{pkce}{documents}}}"#
                        ),
                        "",
                    )
                }
                ("POST", "/register") => {
                    s.lock().unwrap().registered += 1;
                    assert!(
                        body.contains("\"token_endpoint_auth_method\":\"none\"")
                            && body.contains("\"application_type\":\"native\"")
                    );
                    json("201 Created", r#"{"client_id":"cid-1"}"#, "")
                }
                ("GET", "/authorize") => {
                    let q = query_pairs(query);
                    let get = |k: &str| {
                        q.iter()
                            .find(|(n, _)| n == k)
                            .map(|(_, v)| v.clone())
                            .unwrap_or_default()
                    };
                    assert_eq!(get("code_challenge_method"), "S256");
                    assert_eq!(get("resource"), format!("{base}/mcp"));
                    assert_eq!(get("scope"), "records:read");
                    let client = if reads_documents {
                        CLIENT_METADATA_URL.unwrap()
                    } else {
                        "cid-1"
                    };
                    assert_eq!(get("client_id"), client);
                    s.lock().unwrap().challenge = get("code_challenge");
                    let iss = if wrong_iss {
                        "https://evil.example.com".to_string()
                    } else {
                        base.clone()
                    };
                    let to = format!(
                        "{}?code=code-1&state={}&iss={}",
                        get("redirect_uri"),
                        encode(&get("state")),
                        encode(&iss)
                    );
                    format!("HTTP/1.1 302 Found\r\nLocation: {to}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
                }
                ("POST", "/token") => {
                    let q = query_pairs(body);
                    let get = |k: &str| {
                        q.iter()
                            .find(|(n, _)| n == k)
                            .map(|(_, v)| v.clone())
                            .unwrap_or_default()
                    };
                    assert_eq!(get("resource"), format!("{base}/mcp"));
                    if reads_documents {
                        assert_eq!(get("client_id"), CLIENT_METADATA_URL.unwrap());
                        assert!(get("client_secret").is_empty());
                    }
                    if get("grant_type") == "refresh_token" {
                        s.lock().unwrap().renewed.push(get("refresh_token"));
                        return json(
                            "200 OK",
                            r#"{"access_token":"at-2","token_type":"bearer","expires_in":3600,"refresh_token":"rt-2"}"#,
                            "",
                        );
                    }
                    let mut seen = s.lock().unwrap();
                    seen.exchanged.push(get("code"));
                    if challenge_of(&get("code_verifier")) != seen.challenge {
                        return json("400 Bad Request", r#"{"error":"invalid_grant"}"#, "");
                    }
                    json(
                        "200 OK",
                        r#"{"access_token":"at-1","token_type":"Bearer","expires_in":3600,"refresh_token":"rt-1"}"#,
                        "",
                    )
                }
                _ => "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
                    .to_string(),
            }
        });
        let (port, listener) = serve(handler);
        *port_cell.lock().unwrap() = port;
        (port, seen, listener)
    }

    /// A browser: opens the page, and follows its one redirect to this computer.
    fn browser(opened: Arc<Mutex<Vec<String>>>) -> impl Fn(&str) -> Result<(), String> {
        move |url: &str| {
            opened.lock().unwrap().push(url.to_string());
            let url = url.to_string();
            std::thread::spawn(move || {
                let response = agent().get(&url).call().unwrap();
                let to = response
                    .headers()
                    .get("location")
                    .unwrap()
                    .to_str()
                    .unwrap()
                    .to_string();
                // A stray visit first, which the one-time address turns away.
                let (origin, _) = split(&to).unwrap();
                let _ = agent()
                    .get(&format!("{origin}/callback?state=not-this-one&code=stolen"))
                    .call();
                let _ = agent().get(&to).call();
            });
            Ok(())
        }
    }

    #[test]
    fn a_server_that_reads_client_documents_is_introduced_by_the_published_one() {
        let document = CLIENT_METADATA_URL.expect("the client document is published");
        let (scheme, rest) = document.split_once("://").unwrap();
        assert!(scheme == "https" && rest.split_once('/').is_some_and(|(_, p)| !p.is_empty()));
        let (port, seen, _l) = stand_in(false, false, true);
        let free = TcpListener::bind(("127.0.0.1", DOCUMENT_PORT)).is_ok();
        let path = temp_store("document");
        let url = format!("http://127.0.0.1:{port}/mcp");
        super::super::save_connection(&path, "sys-4", &url, "oauth", "", None).unwrap();
        let opened = Arc::new(Mutex::new(Vec::new()));
        let conn = sign_in(&path, "sys-4", &browser(opened.clone())).unwrap();
        let o = conn.oauth.clone().unwrap();
        assert_eq!(
            (
                o.access_token.as_str(),
                o.client_id.as_str(),
                o.client_secret.as_str()
            ),
            ("at-1", document, "")
        );
        // Nothing is registered: the server reads who the app is from its page.
        assert_eq!(seen.lock().unwrap().registered, 0);
        assert!(opened.lock().unwrap()[0].contains(&format!("client_id={}&", encode(document))));
        // The answer comes back to the port the document names, when it is free.
        if free {
            let named = format!("http://127.0.0.1:{DOCUMENT_PORT}/callback");
            assert!(
                opened.lock().unwrap()[0].contains(&format!("redirect_uri={}&", encode(&named)))
            );
        }
        // With that port taken, the sign-in waits on another.
        let held = TcpListener::bind(("127.0.0.1", DOCUMENT_PORT)).ok();
        let again = sign_in(&path, "sys-4", &browser(opened.clone())).unwrap();
        assert_eq!(again.oauth.unwrap().client_id, document);
        if held.is_some() {
            let named = format!("http://127.0.0.1:{DOCUMENT_PORT}/callback");
            assert!(!opened.lock().unwrap()[1].contains(&encode(&named)));
        }
    }

    #[test]
    fn a_whole_sign_in_keeps_its_tokens_out_of_the_page_and_renews_them() {
        let (port, seen, _l) = stand_in(false, false, false);
        let path = temp_store("flow");
        let url = format!("http://127.0.0.1:{port}/mcp");
        super::super::save_connection(&path, "sys-1", &url, "oauth", "", None).unwrap();
        let opened = Arc::new(Mutex::new(Vec::new()));
        let conn = sign_in(&path, "sys-1", &browser(opened.clone())).unwrap();
        let o = conn.oauth.clone().unwrap();
        assert_eq!(
            (
                o.access_token.as_str(),
                o.refresh_token.as_str(),
                o.client_id.as_str()
            ),
            ("at-1", "rt-1", "cid-1")
        );
        assert_eq!(seen.lock().unwrap().exchanged, vec!["code-1"]);
        assert!(opened.lock().unwrap()[0].starts_with(&format!("http://127.0.0.1:{port}/authorize?response_type=code&client_id=cid-1&redirect_uri=http%3A%2F%2F127.0.0.1%3A")));
        // The page learns only that the connection is signed in.
        let info = super::super::ConnectionInfo::from(&conn);
        let shown = serde_json::to_string(&info).unwrap();
        assert!(
            shown.contains("\"signedIn\":true")
                && !shown.contains("at-1")
                && !shown.contains("rt-1")
                && !shown.contains("cid-1")
        );
        // Requests carry the token, to the connection's own address.
        let reply = super::super::send(
            "sys-1",
            &conn,
            r#"{"jsonrpc":"2.0","id":1,"method":"tools/list"}"#,
            "2026-07-28",
        )
        .unwrap();
        assert_eq!(reply.status, 200);
        assert_eq!(seen.lock().unwrap().bearer, vec!["at-1"]);
        // A token past its time is renewed before it is sent, and the new ones kept.
        let mut late = conn.clone();
        late.oauth.as_mut().unwrap().expires_at = now();
        let renewed = fresh(&path, "sys-1", late);
        assert_eq!(renewed.oauth.as_ref().unwrap().access_token, "at-2");
        assert_eq!(seen.lock().unwrap().renewed, vec!["rt-1"]);
        assert_eq!(
            super::super::connection(&path, "sys-1")
                .unwrap()
                .oauth
                .unwrap()
                .refresh_token,
            "rt-2"
        );
        // Signing in again reuses the registration when the same port can be had.
        sign_in(&path, "sys-1", &browser(opened.clone())).unwrap();
        assert!(seen.lock().unwrap().registered <= 2);
        // A new address drops the tokens with the old one.
        let moved = super::super::save_connection(
            &path,
            "sys-1",
            "https://elsewhere.example.com/mcp",
            "oauth",
            "",
            None,
        )
        .unwrap();
        assert!(!moved.signed_in);
        assert!(super::super::connection(&path, "sys-1")
            .unwrap()
            .oauth
            .is_none());
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn an_answer_naming_another_server_is_not_used() {
        let (port, seen, _l) = stand_in(true, false, false);
        let path = temp_store("iss");
        super::super::save_connection(
            &path,
            "sys-2",
            &format!("http://127.0.0.1:{port}/mcp"),
            "oauth",
            "",
            None,
        )
        .unwrap();
        let err = sign_in(&path, "sys-2", &browser(Arc::new(Mutex::new(Vec::new())))).unwrap_err();
        assert!(err.contains("another server"), "{err}");
        assert!(seen.lock().unwrap().exchanged.is_empty());
        assert!(super::super::connection(&path, "sys-2")
            .unwrap()
            .oauth
            .is_none());
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn a_server_without_pkce_is_refused_before_the_browser_opens() {
        let (port, _seen, _l) = stand_in(false, true, false);
        let path = temp_store("pkce");
        super::super::save_connection(
            &path,
            "sys-3",
            &format!("http://127.0.0.1:{port}/mcp"),
            "oauth",
            "",
            None,
        )
        .unwrap();
        let opened = Arc::new(Mutex::new(Vec::new()));
        let err = sign_in(&path, "sys-3", &browser(opened.clone())).unwrap_err();
        assert!(err.contains("PKCE"), "{err}");
        assert!(opened.lock().unwrap().is_empty());
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }
}
