// ==============================================================
// Talking to the providers whose servers refuse a web page
//
// Every other provider is called straight from the web view. These cannot be:
// a browser asks a server's permission before sending a request from a page,
// and SambaNova, NVIDIA and Kimi Code answer that question without granting
// it. The request is never sent, and the page sees only "Failed to fetch".
// A request made here is not a page's request, so no permission is asked.
//
// WHAT THIS IS NOT
// ----------------
// It is not a way for the renderer to reach the network. The renderer names a
// provider and a route — "chat" or "models" — and the address comes from the
// table below, written here, with no part of it taken from the caller: no
// host, no path, no query, no header. So the Content Security Policy, which is
// what stops injected text in a reply from sending data somewhere, is not
// widened by this file. The most any caller can do is send a request to one of
// six fixed endpoints of three AI providers, which is what the page could
// already do for every other provider.
//
// The caller supplies the key and the body. The key is the user's own, read
// from the same store the web view already reads it from, and it goes in one
// header to one fixed host. It is never logged and never returned.
//
// ANOTHER LOCAL MODEL APP on this computer is reached the same way, as the
// provider "local": the caller names only a port, a number from 1024 up, and
// the address is http://127.0.0.1 at that port with one of the two paths
// written below. Such a server usually needs no key, so none is required.
//
// JS calls:
//   invoke("provider_request", { provider, route, key, body, requestId, port, onEvent })
//     onEvent receives, in order:
//       { kind: "head",  status, mime, retry }   once, when the reply starts
//       { kind: "chunk", text }                  as the reply arrives
//       { kind: "end" }                          when it is complete
//       { kind: "fail",  message }               instead, if it cannot be
//   invoke("provider_request_cancel", { requestId })
//
// Everything is reported through onEvent, including a refusal before anything
// is sent, so the renderer has one ordered source to read. Tauri delivers a
// command's result and its channel messages by different routes, and nothing
// promises which arrives first.
// ==============================================================

use serde::Serialize;
use std::collections::HashMap;
use std::io::Read;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;
use tauri::ipc::Channel;
use ureq::config::Config;
use ureq::tls::{TlsConfig, TlsProvider};
use ureq::Agent;

/// Every address this file can reach.
///
/// The whole security argument for the command rests on this being the only
/// place an address is written. Anything the renderer sends is used to pick a
/// row, never to build one.
fn endpoint(provider: &str, route: &str) -> Option<&'static str> {
    match (provider, route) {
        ("samba", "chat") => Some("https://api.sambanova.ai/v1/chat/completions"),
        ("samba", "models") => Some("https://api.sambanova.ai/v1/models"),
        ("nvidia", "chat") => Some("https://integrate.api.nvidia.com/v1/chat/completions"),
        ("nvidia", "models") => Some("https://integrate.api.nvidia.com/v1/models"),
        // A Kimi Code membership key works here and nowhere else. Its servers
        // speak the OpenAI shape at /coding/v1.
        ("kimi-code", "chat") => Some("https://api.kimi.com/coding/v1/chat/completions"),
        ("kimi-code", "models") => Some("https://api.kimi.com/coding/v1/models"),
        _ => None,
    }
}

/// Cloudflare's account identifier: exactly thirty-two lowercase hex digits.
///
/// THIS IS THE ONE PIECE OF AN ADDRESS THAT COMES FROM THE CALLER, and it is
/// why the check is this narrow rather than "not empty". Cloudflare puts the
/// account in the path, so there is no fixed string to write above — the
/// template is fixed here and this one segment is filled in.
///
/// Thirty-two characters from `0-9a-f` cannot contain a slash, a dot, a colon,
/// a percent, a question mark, an at sign or a backslash. So it cannot leave
/// the path segment it is written into, cannot climb out of it, cannot become
/// a host, a query or a second address, and cannot be an encoded anything.
/// The scheme, the host and every other part of the path stay written here.
fn check_account(account: &str) -> Result<(), String> {
    if account.len() == 32 && account.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    {
        Ok(())
    } else {
        Err("that is not a Cloudflare account id — it is thirty-two characters, 0-9 and a-f.".into())
    }
}

/// Cloudflare's two addresses, built from a template written here.
///
/// Its own list is not the OpenAI one: `ai/v1/models` answers nothing to a
/// GET, and the list lives at `ai/models/search` in Cloudflare's own shape.
fn cloudflare_endpoint(route: &str, account: &str) -> Option<String> {
    let tail = match route {
        "chat" => "ai/v1/chat/completions",
        "models" => "ai/models/search?task=Text%20Generation&per_page=100",
        _ => return None,
    };
    Some(format!(
        "https://api.cloudflare.com/client/v4/accounts/{account}/{tail}"
    ))
}

/// A model server on this computer, at a port the person's app runs it on.
///
/// THE PORT IS THE ONE PART OF THIS ADDRESS THAT COMES FROM THE CALLER, and it
/// arrives as a number, so it cannot carry a host, a path or anything else.
/// The host is always this computer and the path is one of the two below.
/// Ports under 1024 are the system's own and no model app listens there.
fn local_endpoint(route: &str, port: u16) -> Option<String> {
    if port < 1024 {
        return None;
    }
    let path = match route {
        "chat" => "v1/chat/completions",
        "models" => "v1/models",
        _ => return None,
    };
    Some(format!("http://127.0.0.1:{port}/{path}"))
}

/// A request body. Pictures travel inside it as base64, so it has to hold a
/// few screenshots; it does not have to hold a video.
const MAX_BODY_BYTES: usize = 24 * 1024 * 1024;
/// A reply. The longest answer any of these models writes is a small fraction
/// of this; the cap is there so a reply with no end cannot fill memory.
const MAX_REPLY_BYTES: u64 = 16 * 1024 * 1024;
/// Longer than any provider's key, and short enough that a key field holding
/// something else entirely is refused rather than sent.
const MAX_KEY_CHARS: usize = 512;
/// Each open request holds a thread. A loop in the renderer that kept opening
/// them must run out of room rather than out of threads.
const MAX_OPEN: usize = 16;
const TIMEOUT_CONNECT: Duration = Duration::from_secs(15);
/// A whole answer. A reasoning model writing a large file can take minutes;
/// the renderer stops a request long before this when a mode decides it has
/// gone quiet, and this is the ceiling when nothing does.
const TIMEOUT_TOTAL: Duration = Duration::from_secs(15 * 60);

#[derive(Clone, Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum ProviderEvent {
    Head {
        status: u16,
        mime: String,
        retry: Option<String>,
    },
    Chunk {
        text: String,
    },
    End,
    Fail {
        message: String,
    },
}

// ── What a caller may send ────────────────────────────────────────────────

/// A key goes into a header. Anything but visible ASCII there is either not a
/// key or an attempt to write a second header, and neither is sent.
fn check_key(key: &str) -> Result<(), String> {
    if key.is_empty() {
        return Err("no API key was given.".into());
    }
    if key.len() > MAX_KEY_CHARS {
        return Err("that API key is far longer than any provider's.".into());
    }
    if !key.bytes().all(|b| (0x21..=0x7e).contains(&b)) {
        return Err("that API key holds characters no key contains.".into());
    }
    Ok(())
}

/// A chat request carries one JSON object; a model list carries nothing.
fn check_body(route: &str, body: Option<&str>) -> Result<(), String> {
    match (route, body) {
        ("models", None) => Ok(()),
        ("models", Some(_)) => Err("asking for a model list sends no body.".into()),
        (_, None) => Err("a chat request needs a body.".into()),
        (_, Some(text)) => {
            if text.len() > MAX_BODY_BYTES {
                return Err("that request is larger than any chat request should be.".into());
            }
            match serde_json::from_str::<serde_json::Value>(text) {
                Ok(serde_json::Value::Object(_)) => Ok(()),
                _ => Err("a chat request must be one JSON object.".into()),
            }
        }
    }
}

/// The id a caller uses to stop its own request later.
fn check_id(id: &str) -> Result<(), String> {
    if id.is_empty() || id.len() > 64 || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
    {
        return Err("that request id is not one this app makes.".into());
    }
    Ok(())
}

// ── Requests in flight ────────────────────────────────────────────────────

fn open_requests() -> &'static Mutex<HashMap<String, Arc<AtomicBool>>> {
    static OPEN: OnceLock<Mutex<HashMap<String, Arc<AtomicBool>>>> = OnceLock::new();
    OPEN.get_or_init(|| Mutex::new(HashMap::new()))
}

/// A request's place in the table, given back however the request ends.
struct Registration {
    id: String,
}

impl Drop for Registration {
    fn drop(&mut self) {
        if let Ok(mut open) = open_requests().lock() {
            open.remove(&self.id);
        }
    }
}

fn register(id: &str) -> Result<(Registration, Arc<AtomicBool>), String> {
    let mut open = open_requests()
        .lock()
        .map_err(|_| "the request table is unavailable.".to_string())?;
    if open.contains_key(id) {
        return Err("a request with that id is already open.".into());
    }
    if open.len() >= MAX_OPEN {
        return Err("too many requests are already open; wait for one to finish.".into());
    }
    let flag = Arc::new(AtomicBool::new(false));
    open.insert(id.to_string(), Arc::clone(&flag));
    Ok((Registration { id: id.to_string() }, flag))
}

// ── Reading the reply ─────────────────────────────────────────────────────

/// The whole characters at the front of `pending`, leaving any character the
/// network split in two for the next read to complete.
///
/// A read ends wherever the network happened to cut, which can be inside a
/// character. Decoding each read on its own turns every such cut into a
/// replacement character in the middle of a word.
fn take_text(pending: &mut Vec<u8>) -> String {
    let mut out = String::new();
    loop {
        match std::str::from_utf8(pending) {
            Ok(text) => {
                out.push_str(text);
                pending.clear();
                return out;
            }
            Err(e) => {
                let good = e.valid_up_to();
                // Safe: from_utf8 has just said these bytes are valid.
                out.push_str(std::str::from_utf8(&pending[..good]).unwrap_or(""));
                match e.error_len() {
                    // Cut short at the end: keep it for the next read.
                    None => {
                        pending.drain(..good);
                        return out;
                    }
                    // Genuinely invalid bytes: mark them and carry on.
                    Some(bad) => {
                        out.push('\u{FFFD}');
                        pending.drain(..good + bad);
                    }
                }
            }
        }
    }
}

fn agent() -> Agent {
    let config = Config::builder()
        // Named because ureq's default is rustls, which this build does not
        // compile in; the mismatch is a panic on the first request, not an
        // error. See the same line in net.rs.
        .tls_config(
            TlsConfig::builder()
                .provider(TlsProvider::NativeTls)
                .build(),
        )
        // None of these redirect, and a redirect would lead somewhere the table
        // above does not name. It is reported as the answer instead.
        .max_redirects(0)
        .http_status_as_error(false)
        .timeout_connect(Some(TIMEOUT_CONNECT))
        .timeout_global(Some(TIMEOUT_TOTAL))
        .user_agent("HashCortx")
        .build();
    Agent::new_with_config(config)
}

/// Send the request and pass the reply on as it arrives.
fn run(
    url: &str,
    key: &str,
    body: Option<String>,
    stop: &AtomicBool,
    events: &Channel<ProviderEvent>,
) -> Result<(), String> {
    let agent = agent();
    // A model server on this computer may take no key; nothing is sent then.
    let auth = if key.is_empty() { None } else { Some(format!("Bearer {key}")) };
    let sent = match body {
        Some(json) => {
            let mut req = agent
                .post(url)
                .header("Content-Type", "application/json")
                .header("Accept", "text/event-stream, application/json");
            if let Some(a) = &auth {
                req = req.header("Authorization", a);
            }
            req.send(json)
        }
        None => {
            let mut req = agent.get(url).header("Accept", "application/json");
            if let Some(a) = &auth {
                req = req.header("Authorization", a);
            }
            req.call()
        }
    };
    let mut response = sent.map_err(|e| format!("the provider was unreachable: {e}"))?;

    let header = |name: &str| {
        response
            .headers()
            .get(name)
            .and_then(|v| v.to_str().ok())
            .map(|s| s.to_string())
    };
    let head = ProviderEvent::Head {
        status: response.status().as_u16(),
        mime: header("content-type").unwrap_or_default(),
        retry: header("retry-after"),
    };
    if events.send(head).is_err() {
        return Ok(()); // nobody is listening any more
    }

    let mut reader = response
        .body_mut()
        .with_config()
        .limit(MAX_REPLY_BYTES)
        .reader();
    let mut buf = vec![0u8; 16 * 1024];
    let mut pending: Vec<u8> = Vec::new();
    loop {
        if stop.load(Ordering::Relaxed) {
            return Ok(());
        }
        let n = match reader.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => n,
            Err(e) => {
                let _ = events.send(ProviderEvent::Fail {
                    message: format!(
                        "the network connection broke part-way through the reply: {e}"
                    ),
                });
                return Ok(());
            }
        };
        if stop.load(Ordering::Relaxed) {
            return Ok(());
        }
        pending.extend_from_slice(&buf[..n]);
        let text = take_text(&mut pending);
        if !text.is_empty() && events.send(ProviderEvent::Chunk { text }).is_err() {
            return Ok(());
        }
    }
    if !pending.is_empty() {
        let text = String::from_utf8_lossy(&pending).into_owned();
        let _ = events.send(ProviderEvent::Chunk { text });
    }
    let _ = events.send(ProviderEvent::End);
    Ok(())
}

#[tauri::command]
pub async fn provider_request(
    provider: String,
    route: String,
    key: String,
    body: Option<String>,
    request_id: String,
    account: Option<String>,
    port: Option<u16>,
    on_event: Channel<ProviderEvent>,
) -> Result<(), String> {
    let fail = |message: String| {
        let _ = on_event.send(ProviderEvent::Fail { message });
        Ok(())
    };
    // Cloudflare is the only provider whose address is not written whole
    // above: its account id is part of the path. The id is checked to be
    // thirty-two hex digits before it is put anywhere near a URL, and every
    // other part of that address is still fixed here. `account` is ignored
    // for every other provider, so it cannot alter one of their addresses.
    let url: String = if provider == "local" {
        match local_endpoint(&route, port.unwrap_or(0)) {
            Some(u) => u,
            None => return fail(format!("the app does not reach a local \"{route}\" on that port.")),
        }
    } else if provider == "cloudflare" {
        let account = account.unwrap_or_default();
        if let Err(e) = check_account(&account) {
            return fail(e);
        }
        match cloudflare_endpoint(&route, &account) {
            Some(u) => u,
            None => return fail(format!("the app does not reach \"{provider}\" \"{route}\".")),
        }
    } else {
        match endpoint(&provider, &route) {
            Some(u) => u.to_string(),
            None => {
                return fail(format!(
                    "the app does not reach \"{provider}\" \"{route}\"."
                ))
            }
        }
    };
    // A local server may need no key; one that is given is still checked.
    let key_ok = if provider == "local" && key.is_empty() { Ok(()) } else { check_key(&key) };
    if let Err(e) = key_ok
        .and_then(|_| check_body(&route, body.as_deref()))
        .and_then(|_| check_id(&request_id))
    {
        return fail(e);
    }
    let (registration, stop) = match register(&request_id) {
        Ok(r) => r,
        Err(e) => return fail(e),
    };

    // Off the main thread: a command without `async` runs ON it, and a reply
    // that takes a minute would hold the whole window still for that minute.
    let events = on_event.clone();
    let outcome = tauri::async_runtime::spawn_blocking(move || {
        let _registration = registration;
        run(&url, &key, body, &stop, &events)
    })
    .await;
    match outcome {
        Ok(Ok(())) => Ok(()),
        Ok(Err(message)) => fail(message),
        Err(_) => fail("the request ended unexpectedly.".into()),
    }
}

/// Stop a request this app opened. The reply is dropped at the next read.
#[tauri::command]
pub fn provider_request_cancel(request_id: String) {
    if let Ok(open) = open_requests().lock() {
        if let Some(stop) = open.get(&request_id) {
            stop.store(true, Ordering::Relaxed);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // The table of open requests is shared by the whole process, and tests run
    // side by side. The two that fill or read it take turns.
    static TABLE: Mutex<()> = Mutex::new(());

    #[test]
    fn only_the_listed_endpoints_exist() {
        for provider in ["samba", "nvidia", "kimi-code"] {
            for route in ["chat", "models"] {
                let url = endpoint(provider, route).expect("listed");
                assert!(url.starts_with("https://"), "{url} must be https");
            }
        }
        // Everything else is refused — including other providers, which are
        // called from the web view under its own policy, and anything shaped
        // like an address.
        for (provider, route) in [
            ("groq", "chat"),
            ("openai", "chat"),
            ("samba", "completions"),
            ("samba", "https://attacker.test/"),
            ("https://attacker.test", "chat"),
            ("samba", ""),
            ("", "chat"),
            ("SAMBA", "chat"),
            ("samba", "../chat"),
        ] {
            assert!(
                endpoint(provider, route).is_none(),
                "{provider} {route} must not exist"
            );
        }
    }

    #[test]
    fn a_local_model_app_is_reached_only_on_this_computer_and_two_paths() {
        assert_eq!(local_endpoint("chat", 1234).as_deref(), Some("http://127.0.0.1:1234/v1/chat/completions"));
        assert_eq!(local_endpoint("models", 8080).as_deref(), Some("http://127.0.0.1:8080/v1/models"));
        assert_eq!(local_endpoint("models", 65535).as_deref(), Some("http://127.0.0.1:65535/v1/models"));
        // No other route, and no system port.
        for (route, port) in [("completions", 1234), ("", 1234), ("../chat", 1234), ("chat", 80), ("models", 0), ("chat", 1023)] {
            assert!(local_endpoint(route, port).is_none(), "{route} {port} must not exist");
        }
        // Whatever the port, the host is this computer.
        for port in [1024u16, 11434, 40000, 65535] {
            let url = local_endpoint("chat", port).unwrap();
            assert_eq!(url.trim_start_matches("http://").split('/').next().unwrap(), format!("127.0.0.1:{port}"));
        }
    }

    /// The one segment of an address that comes from the caller, held to
    /// thirty-two hex digits — because everything below is what a looser check
    /// would let through.
    #[test]
    fn only_a_real_account_id_reaches_an_address() {
        assert!(check_account("0123456789abcdef0123456789abcdef").is_ok());
        for bad in [
            "",
            "0123456789abcdef0123456789abcde",   // one short
            "0123456789abcdef0123456789abcdef0", // one long
            "0123456789ABCDEF0123456789ABCDEF",  // upper case
            "0123456789abcdef0123456789abcdeg",  // not hex
            "../../../../etc/passwd0123456789",
            "0123456789abcdef/../../../v4/user",
            "0123456789abcdef0123456789abcde/",
            "..%2f..%2f..%2fuser0123456789abc",
            "0123456789abcdef0123456789abcd@x",
            "attacker.test/0123456789abcdef01",
            "0123456789abcdef0123456789abcd?x",
            "0123456789abcdef0123456789abc#ab",
            "0123456789abcdef0123456789ab cde",
            "0123456789abcdef0123456789abcd\n0",
        ] {
            assert!(
                check_account(bad).is_err(),
                "{bad:?} must not reach an address"
            );
        }
    }

    #[test]
    fn a_checked_account_stays_inside_its_own_path_segment() {
        let account = "0123456789abcdef0123456789abcdef";
        for route in ["chat", "models"] {
            let url = cloudflare_endpoint(route, account).expect("listed");
            assert!(
                url.starts_with("https://api.cloudflare.com/client/v4/accounts/"),
                "{url} must stay on Cloudflare"
            );
            // The account appears once, as its own segment, and the host is
            // still Cloudflare's however it is read.
            assert_eq!(url.matches(account).count(), 1, "{url}");
            assert!(url.contains(&format!("/accounts/{account}/")), "{url}");
            assert_eq!(
                url.trim_start_matches("https://")
                    .split('/')
                    .next()
                    .unwrap(),
                "api.cloudflare.com",
                "{url}"
            );
        }
        assert!(cloudflare_endpoint("completions", account).is_none());
        assert!(cloudflare_endpoint("", account).is_none());
        // Cloudflare is not in the fixed table, and no other provider gains a
        // Cloudflare address.
        assert!(endpoint("cloudflare", "chat").is_none());
        assert!(endpoint("cloudflare", "models").is_none());
    }

    #[test]
    fn every_endpoint_is_on_a_host_that_needs_this_path() {
        // If one of these hosts ever lets a web page call it, it belongs in the
        // web view with the others, not here. The list is what the renderer
        // cannot reach; keep it that short.
        let hosts: std::collections::BTreeSet<&str> = ["samba", "nvidia", "kimi-code"]
            .iter()
            .flat_map(|p| ["chat", "models"].map(|r| endpoint(p, r).unwrap()))
            .map(|u| u.trim_start_matches("https://").split('/').next().unwrap())
            .collect();
        assert_eq!(
            hosts.into_iter().collect::<Vec<_>>(),
            vec![
                "api.kimi.com",
                "api.sambanova.ai",
                "integrate.api.nvidia.com"
            ]
        );
    }

    #[test]
    fn a_key_cannot_carry_a_second_header() {
        assert!(check_key("gsk_abcDEF123").is_ok());
        assert!(check_key("nvapi-abc_DEF.123").is_ok());
        for bad in [
            "",
            "key\r\nX-Other: 1",
            "key\nX-Other: 1",
            "key with space",
            "key\u{0}",
            "kéy",
        ] {
            assert!(check_key(bad).is_err(), "{bad:?} must be refused");
        }
        assert!(check_key(&"k".repeat(MAX_KEY_CHARS)).is_ok());
        assert!(check_key(&"k".repeat(MAX_KEY_CHARS + 1)).is_err());
    }

    #[test]
    fn a_chat_request_is_one_json_object_and_a_list_is_nothing() {
        assert!(check_body("chat", Some(r#"{"model":"m","messages":[]}"#)).is_ok());
        assert!(check_body("models", None).is_ok());
        assert!(check_body("chat", None).is_err());
        assert!(check_body("models", Some("{}")).is_err());
        for bad in ["[]", "\"text\"", "12", "not json", "{\"a\":1} trailing"] {
            assert!(
                check_body("chat", Some(bad)).is_err(),
                "{bad} must be refused"
            );
        }
        let huge = format!("{{\"x\":\"{}\"}}", "a".repeat(MAX_BODY_BYTES));
        assert!(check_body("chat", Some(&huge)).is_err());
    }

    #[test]
    fn a_request_id_is_the_kind_this_app_makes() {
        assert!(check_id("0b6e4f3a-1c2d-4e5f-8a9b-0c1d2e3f4a5b").is_ok());
        for bad in ["", "a b", "../x", "x\n", &"a".repeat(65)] {
            assert!(check_id(bad).is_err(), "{bad:?} must be refused");
        }
    }

    #[test]
    fn open_requests_are_bounded_and_given_back() {
        let _turn = TABLE.lock().unwrap_or_else(|e| e.into_inner());
        let ids: Vec<String> = (0..MAX_OPEN).map(|i| format!("bound-test-{i}")).collect();
        let held: Vec<_> = ids.iter().map(|id| register(id).expect("room")).collect();
        assert!(
            register("bound-test-extra").is_err(),
            "one past the limit is refused"
        );
        assert!(register(&ids[0]).is_err(), "an id already open is refused");
        drop(held);
        assert!(
            register("bound-test-extra").is_ok(),
            "finished requests give their place back"
        );
    }

    #[test]
    fn cancelling_reaches_the_request_it_names() {
        let _turn = TABLE.lock().unwrap_or_else(|e| e.into_inner());
        let (_reg, stop) = register("cancel-test-a").unwrap();
        let (_other, untouched) = register("cancel-test-b").unwrap();
        provider_request_cancel("cancel-test-a".into());
        assert!(stop.load(Ordering::Relaxed));
        assert!(!untouched.load(Ordering::Relaxed));
        provider_request_cancel("no-such-request".into()); // harmless
    }

    #[test]
    fn a_character_split_between_reads_arrives_whole() {
        let word = "café — 日本".as_bytes();
        for cut in 0..=word.len() {
            let mut pending = word[..cut].to_vec();
            let mut text = take_text(&mut pending);
            pending.extend_from_slice(&word[cut..]);
            text.push_str(&take_text(&mut pending));
            assert_eq!(text, "café — 日本", "cut at byte {cut}");
            assert!(pending.is_empty());
        }
    }

    #[test]
    fn bytes_that_are_not_text_are_marked_not_dropped_or_stuck() {
        let mut pending = vec![b'a', 0xff, b'b'];
        assert_eq!(take_text(&mut pending), "a\u{FFFD}b");
        assert!(pending.is_empty());
    }
}
