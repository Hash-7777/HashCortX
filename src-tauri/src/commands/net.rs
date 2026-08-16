// ==============================================================
// Reading a web page, and where a hostname actually leads
//
// The agent's `fetch_url` tool takes a URL a language model chose. The
// renderer checks the address as written — see src/js/url-safety.js — but it
// cannot resolve a name, so a public hostname pointing at 192.168.1.1 or at a
// cloud metadata service passed that check untouched. The comment in the
// renderer used to say a server proxy did the real address check; no server
// ships with this app, so nothing did.
//
// This resolves the name and refuses if ANY address it answers with is
// private. Any, not the first: a name that returns one public address and one
// private one is the interesting case, and taking the first would miss it.
//
// JS call:
//   invoke("net_fetch_text", { url })
//     → { ok, reason, status, finalUrl, contentType, text, truncated }
//
// WHY THE FETCH HAPPENS HERE AND NOT IN THE WEB VIEW
// --------------------------------------------------
// Two reasons, and the second is the one that matters.
//
// 1. Under the Content Security Policy the renderer may only reach the hosts
//    named in connect-src, so the agent could not read an ordinary web page at
//    all — the tool existed and worked for about twenty addresses.
//
// 2. A renderer fetch resolves the hostname a SECOND time, after this file has
//    already checked where that name leads. A name that answers with a public
//    address when it is checked and a private one a moment later defeated the
//    check completely, and nothing about checking harder in the renderer could
//    have closed it. `net_fetch_text` resolves once, judges every address it
//    got, and then pins the connection to those addresses, so the socket goes
//    where the check was made. The certificate is still validated against the
//    hostname, so pinning the address does not weaken TLS.
//
// Every redirect is a new URL and is put through the whole check again — the
// address a redirect leads to is exactly as model-chosen as the first one.
// ==============================================================

use serde::Serialize;
use std::io::Read;
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr, ToSocketAddrs};
use std::time::Duration;
use ureq::config::Config;
use ureq::tls::{TlsConfig, TlsProvider};
use ureq::http::Uri;
use ureq::unversioned::resolver::{ResolvedSocketAddrs, Resolver};
use ureq::unversioned::transport::{DefaultConnector, NextTimeout};
use ureq::Agent;

/// Addresses that are not somewhere on the public internet.
///
/// Deliberately broader than "private": loopback, link-local (where cloud
/// metadata lives), unique-local, carrier-grade NAT and the unspecified
/// address are all places an agent has no business being sent.
fn is_private_v4(ip: &Ipv4Addr) -> bool {
    let o = ip.octets();
    ip.is_loopback()
        || ip.is_private()
        || ip.is_link_local()
        || ip.is_broadcast()
        || ip.is_documentation()
        || ip.is_unspecified()
        // Carrier-grade NAT, 100.64.0.0/10 — not covered by is_private().
        || (o[0] == 100 && (64..=127).contains(&o[1]))
        // 0.0.0.0/8: "this network", routed to the local host in practice.
        || o[0] == 0
        // Reserved 240.0.0.0/4.
        || o[0] >= 240
}

fn is_private_v6(ip: &Ipv6Addr) -> bool {
    if ip.is_loopback() || ip.is_unspecified() {
        return true;
    }
    let seg = ip.segments();
    // Link-local fe80::/10.
    if seg[0] & 0xffc0 == 0xfe80 {
        return true;
    }
    // Unique-local fc00::/7.
    if seg[0] & 0xfe00 == 0xfc00 {
        return true;
    }
    // An IPv4 address wearing an IPv6 costume still has to be judged as IPv4.
    if let Some(v4) = ip.to_ipv4_mapped() {
        return is_private_v4(&v4);
    }
    if let Some(v4) = ip.to_ipv4() {
        return is_private_v4(&v4);
    }
    false
}

pub fn is_private_ip(ip: &IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => is_private_v4(v4),
        IpAddr::V6(v6) => is_private_v6(v6),
    }
}

/// What a name resolved to, and why it was refused if it was.
///
/// The addresses come back with the verdict because the fetch needs to connect
/// to the very ones that were just judged. Resolving again to make the
/// connection is the hole this whole file exists to close.
struct Resolution {
    addresses: Vec<IpAddr>,
    refusal: Option<String>,
}

fn resolve_and_judge(host: &str) -> Resolution {
    let name = host.trim().trim_start_matches('[').trim_end_matches(']').to_string();
    if name.is_empty() {
        return Resolution {
            addresses: vec![],
            refusal: Some("no hostname to resolve".into()),
        };
    }

    // The port is irrelevant to the address, but ToSocketAddrs wants one.
    let resolved: Vec<IpAddr> = match (name.as_str(), 80u16).to_socket_addrs() {
        Ok(iter) => iter.map(|s| s.ip()).collect(),
        Err(e) => {
            // A name that does not resolve is refused rather than allowed. The
            // fetch would fail anyway, and defaulting to "allow" on an error is
            // how a check becomes decorative.
            return Resolution {
                addresses: vec![],
                refusal: Some(format!("the address could not be resolved: {e}")),
            };
        }
    };

    if resolved.is_empty() {
        return Resolution {
            addresses: vec![],
            refusal: Some("the address resolved to nothing".into()),
        };
    }

    // ANY private address is a refusal. A name that answers with one public
    // address and one private one is exactly the case worth catching.
    let refusal = resolved.iter().find(|ip| is_private_ip(ip)).map(|bad| {
        format!("that address leads to {bad}, which is on this machine or its private network")
    });

    Resolution { addresses: resolved, refusal }
}

// ══════════════════════════════════════════════════════════════
// Reading a page
// ══════════════════════════════════════════════════════════════

/// A redirect chain has to end somewhere, and a long one is a sign of a loop.
const MAX_REDIRECTS: usize = 5;
/// What is read from one page. The model is shown a few thousand characters of
/// it, so this is a ceiling on memory rather than a useful amount of text.
const MAX_BYTES: u64 = 1_000_000;
const TIMEOUT_TOTAL: Duration = Duration::from_secs(20);
const TIMEOUT_CONNECT: Duration = Duration::from_secs(10);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FetchOutcome {
    pub ok: bool,
    /// Why it was refused or failed, in words the model can repeat to the user.
    pub reason: Option<String>,
    pub status: u16,
    /// Where the text actually came from, after any redirects.
    pub final_url: String,
    pub content_type: String,
    pub text: String,
    /// True when the page was longer than the cap and was cut.
    pub truncated: bool,
}

impl FetchOutcome {
    fn refused(reason: impl Into<String>) -> Self {
        FetchOutcome {
            ok: false,
            reason: Some(reason.into()),
            status: 0,
            final_url: String::new(),
            content_type: String::new(),
            text: String::new(),
            truncated: false,
        }
    }
}

/// A URL this crate has agreed to look at, broken into the parts it needs.
#[derive(Debug)]
struct Target {
    scheme: String,
    host: String,
    authority: String,
    path_and_query: String,
}

fn parse_target(raw: &str) -> Result<Target, String> {
    let uri: Uri = raw
        .parse()
        .map_err(|_| format!("\"{raw}\" is not an address that can be read."))?;

    let scheme = uri.scheme_str().unwrap_or("").to_ascii_lowercase();
    if scheme != "http" && scheme != "https" {
        return Err("only http and https addresses can be read.".into());
    }

    let authority = uri.authority().ok_or("that address names no host.")?;
    // A username or password in a URL is a way to make one host look like
    // another to someone reading it, and this address was chosen by a model.
    if authority.as_str().contains('@') {
        return Err("an address carrying a username or password is refused.".into());
    }

    let host = authority.host().to_ascii_lowercase();
    if host.is_empty() {
        return Err("that address names no host.".into());
    }

    let path_and_query = uri
        .path_and_query()
        .map(|p| p.as_str().to_string())
        .unwrap_or_else(|| "/".into());

    Ok(Target {
        scheme,
        host,
        authority: authority.as_str().to_string(),
        path_and_query,
    })
}

/// Remove `.` and `..` segments, without ever climbing above the root.
fn normalise_path(path: &str) -> String {
    let mut out: Vec<&str> = Vec::new();
    for seg in path.split('/') {
        match seg {
            "." => {}
            ".." => {
                // Keep the leading empty segment: it is the root slash, and
                // popping it would turn an absolute path into a relative one.
                if out.len() > 1 {
                    out.pop();
                }
            }
            s => out.push(s),
        }
    }
    let joined = out.join("/");
    // Everything cancelled out. An absolute path that reduces to nothing is
    // the root, not the empty string — otherwise the address loses its path.
    if joined.is_empty() && path.starts_with('/') {
        return "/".into();
    }
    joined
}

/// Where a `Location` header actually points, given the page that sent it.
///
/// A redirect may be written as a whole address, as `//host/path`, as an
/// absolute path, or relative to the page it came from. Whatever the form, the
/// result goes back through the same checks as the first address — the host it
/// names is no more trustworthy for having been reached by a redirect.
fn join_redirect(base: &Target, location: &str) -> Result<String, String> {
    let loc = location.trim();
    if loc.is_empty() {
        return Err("that address redirected to nowhere.".into());
    }

    let lower = loc.to_ascii_lowercase();
    if lower.starts_with("http://") || lower.starts_with("https://") {
        return Ok(loc.to_string());
    }
    // Scheme-relative: `//host/path` keeps the scheme it arrived on.
    if let Some(rest) = loc.strip_prefix("//") {
        return Ok(format!("{}://{}", base.scheme, rest));
    }
    // Anything else naming a scheme is not a page — `mailto:`, `data:`,
    // `javascript:`. Refused rather than guessed at.
    if let Some(colon) = loc.find(':') {
        let looks_like_scheme = loc[..colon]
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '+' || c == '-' || c == '.');
        if looks_like_scheme && !loc[..colon].is_empty() && !loc.starts_with('/') {
            let before_slash = loc.find('/').map(|s| colon < s).unwrap_or(true);
            if before_slash {
                return Err(format!(
                    "that address redirected to \"{loc}\", which is not a web page."
                ));
            }
        }
    }

    if loc.starts_with('/') {
        return Ok(format!(
            "{}://{}{}",
            base.scheme,
            base.authority,
            normalise_path(loc)
        ));
    }

    // Relative to the directory the current page sits in.
    let path = base.path_and_query.split(['?', '#']).next().unwrap_or("/");
    let dir = match path.rfind('/') {
        Some(cut) => &path[..=cut],
        None => "/",
    };
    Ok(format!(
        "{}://{}{}",
        base.scheme,
        base.authority,
        normalise_path(&format!("{dir}{loc}"))
    ))
}

/// Is this something that can be read as text at all?
///
/// An absent type is allowed: plenty of plain servers send none, and the byte
/// cap and lossy decode below make a wrong guess harmless. A type that is
/// positively binary is refused, because handing a model a megabyte of decoded
/// JPEG helps nobody.
fn is_text_content_type(content_type: &str) -> bool {
    let base = content_type
        .split(';')
        .next()
        .unwrap_or("")
        .trim()
        .to_ascii_lowercase();
    if base.is_empty() {
        return true;
    }
    base.starts_with("text/")
        || base.ends_with("+json")
        || base.ends_with("+xml")
        || matches!(
            base.as_str(),
            "application/json"
                | "application/xml"
                | "application/javascript"
                | "application/ecmascript"
                | "application/x-ndjson"
                | "application/yaml"
                | "application/x-yaml"
        )
}

/// A resolver that answers with the addresses already judged, and only for the
/// host they were judged for.
///
/// This is the whole reason the fetch lives here. The ordinary path is: check
/// where a name leads, then hand the name to something that looks it up again
/// and connects to whatever it gets the second time. Those can differ. Here the
/// lookup happens once and the socket goes to that answer.
#[derive(Debug)]
struct PinnedResolver {
    host: String,
    addresses: Vec<IpAddr>,
    port: u16,
}

impl Resolver for PinnedResolver {
    fn resolve(
        &self,
        uri: &Uri,
        _config: &Config,
        _timeout: NextTimeout,
    ) -> Result<ResolvedSocketAddrs, ureq::Error> {
        // Redirects are followed by hand, so this is only ever asked about the
        // host that was checked. If it is ever asked about another one, that is
        // a bug and the connection must not be made.
        let asked = uri.authority().map(|a| a.host().to_ascii_lowercase());
        if asked.as_deref() != Some(self.host.as_str()) {
            return Err(ureq::Error::HostNotFound);
        }

        let mut out = self.empty();
        for ip in &self.addresses {
            out.push(SocketAddr::new(*ip, self.port));
        }
        if out.is_empty() {
            return Err(ureq::Error::HostNotFound);
        }
        Ok(out)
    }
}

fn pinned_agent(host: &str, addresses: Vec<IpAddr>, port: u16) -> Agent {
    let config = Config::builder()
        // Name the TLS provider. The default is rustls, which this build does
        // not compile in — and the mismatch is not a build error or a failed
        // request but a PANIC on the first https address, inside a command the
        // renderer called. The crate is built against the platform's own TLS.
        .tls_config(
            TlsConfig::builder()
                .provider(TlsProvider::NativeTls)
                .build(),
        )
        // Followed by hand instead, so every hop is checked like a first
        // address. Letting the client follow them would connect to hosts
        // nothing had judged.
        .max_redirects(0)
        .http_status_as_error(false)
        .timeout_global(Some(TIMEOUT_TOTAL))
        .timeout_connect(Some(TIMEOUT_CONNECT))
        .user_agent("HashCortx")
        .build();

    Agent::with_parts(
        config,
        DefaultConnector::new(),
        PinnedResolver {
            host: host.to_string(),
            addresses,
            port,
        },
    )
}

#[tauri::command]
pub fn net_fetch_text(url: String) -> FetchOutcome {
    let mut current = url.trim().to_string();

    for _ in 0..=MAX_REDIRECTS {
        let target = match parse_target(&current) {
            Ok(t) => t,
            Err(reason) => return FetchOutcome::refused(reason),
        };

        let resolution = resolve_and_judge(&target.host);
        if let Some(reason) = resolution.refusal {
            return FetchOutcome::refused(reason);
        }

        let port = match target.authority.rsplit_once(':') {
            // An IPv6 authority is `[::1]:443`; the colon inside the brackets
            // is not a port separator.
            Some((_, p)) if !p.is_empty() && p.chars().all(|c| c.is_ascii_digit()) => {
                p.parse().unwrap_or(if target.scheme == "https" { 443 } else { 80 })
            }
            _ => {
                if target.scheme == "https" {
                    443
                } else {
                    80
                }
            }
        };

        let agent = pinned_agent(&target.host, resolution.addresses, port);
        let mut response = match agent
            .get(&current)
            .header(
                "Accept",
                "text/html,application/xhtml+xml,text/plain,application/json;q=0.9,*/*;q=0.2",
            )
            .header("Accept-Language", "en")
            .call()
        {
            Ok(r) => r,
            Err(e) => {
                return FetchOutcome::refused(format!("that page could not be read: {e}"));
            }
        };

        let status = response.status().as_u16();

        // A redirect is a new address, and it gets the whole check again.
        if matches!(status, 301 | 302 | 303 | 307 | 308) {
            let location = response
                .headers()
                .get("location")
                .and_then(|v| v.to_str().ok())
                .unwrap_or("")
                .to_string();
            current = match join_redirect(&target, &location) {
                Ok(next) => next,
                Err(reason) => return FetchOutcome::refused(reason),
            };
            continue;
        }

        let content_type = response
            .headers()
            .get("content-type")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .to_string();

        if !is_text_content_type(&content_type) {
            return FetchOutcome {
                ok: false,
                reason: Some(format!(
                    "that address is {content_type}, which is not a page that can be read as text."
                )),
                status,
                final_url: current.clone(),
                content_type,
                text: String::new(),
                truncated: false,
            };
        }

        // Read through a cap rather than asking for the whole body: a page with
        // no end to it must not be able to fill memory.
        let mut buf: Vec<u8> = Vec::new();
        let mut reader = response
            .body_mut()
            .with_config()
            .limit(MAX_BYTES + 4096)
            .reader();
        if let Err(e) = (&mut reader).take(MAX_BYTES + 1).read_to_end(&mut buf) {
            return FetchOutcome::refused(format!("that page could not be read: {e}"));
        }

        let truncated = buf.len() as u64 > MAX_BYTES;
        if truncated {
            buf.truncate(MAX_BYTES as usize);
        }

        return FetchOutcome {
            ok: (200..300).contains(&status),
            reason: if (200..300).contains(&status) {
                None
            } else {
                Some(format!("that page answered {status}."))
            },
            status,
            final_url: current.clone(),
            content_type,
            text: String::from_utf8_lossy(&buf).into_owned(),
            truncated,
        };
    }

    FetchOutcome::refused("that address redirected too many times.")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::str::FromStr;

    fn ip(s: &str) -> IpAddr {
        IpAddr::from_str(s).unwrap()
    }

    #[test]
    fn the_machine_and_its_network_are_private() {
        for s in [
            "127.0.0.1", "127.1.2.3", "10.0.0.1", "10.255.255.255",
            "192.168.0.1", "172.16.0.1", "172.31.255.255",
            "169.254.169.254", // cloud metadata
            "100.64.0.1", "100.127.255.255", // carrier-grade NAT
            "0.0.0.0", "0.1.2.3",
            "255.255.255.255",
        ] {
            assert!(is_private_ip(&ip(s)), "{s} should be private");
        }
    }

    #[test]
    fn public_addresses_are_public() {
        for s in [
            "8.8.8.8", "1.1.1.1", "93.184.216.34",
            "172.15.0.1", "172.32.0.1", // just outside the private block
            "11.0.0.1", "9.255.255.255", // just outside 10/8
            "100.63.255.255", "100.128.0.1", // just outside CGNAT
            "191.168.0.1", "192.167.0.1", // near-misses for 192.168
        ] {
            assert!(!is_private_ip(&ip(s)), "{s} should be public");
        }
    }

    #[test]
    fn the_same_holds_for_ipv6() {
        for s in ["::1", "fe80::1", "fc00::1", "fd12:3456::1", "::"] {
            assert!(is_private_ip(&ip(s)), "{s} should be private");
        }
        for s in ["2606:4700:4700::1111", "2001:4860:4860::8888"] {
            assert!(!is_private_ip(&ip(s)), "{s} should be public");
        }
    }

    #[test]
    fn an_ipv4_address_written_as_ipv6_is_still_judged_as_ipv4() {
        // ::ffff:127.0.0.1 is the loopback with a different spelling, and a
        // check that only understood one notation would wave it through.
        assert!(is_private_ip(&ip("::ffff:127.0.0.1")));
        assert!(is_private_ip(&ip("::ffff:192.168.1.1")));
        assert!(is_private_ip(&ip("::ffff:169.254.169.254")));
        assert!(!is_private_ip(&ip("::ffff:8.8.8.8")));
    }

    #[test]
    fn a_literal_private_address_is_refused_without_needing_a_name_server() {
        let v = resolve_and_judge("127.0.0.1");
        assert!(v.refusal.is_some());
        assert!(v.refusal.unwrap().contains("127.0.0.1"));

        assert!(resolve_and_judge("192.168.1.1").refusal.is_some());

        // Brackets are how a URL writes an IPv6 host; they must not confuse it.
        assert!(
            resolve_and_judge("[::1]").refusal.is_some(),
            "bracketed loopback must still be refused"
        );
    }

    #[test]
    fn a_literal_public_address_is_allowed() {
        let v = resolve_and_judge("8.8.8.8");
        assert!(v.refusal.is_none(), "refusal: {:?}", v.refusal);
        assert_eq!(v.addresses, vec![ip("8.8.8.8")]);
    }

    // ── Reading a page ────────────────────────────────────────

    #[test]
    fn only_a_web_address_is_read_at_all() {
        for good in [
            "https://example.com",
            "http://example.com/a/b?c=d",
            "HTTPS://Example.COM/x",
        ] {
            assert!(parse_target(good).is_ok(), "{good} should parse");
        }

        // Anything that is not a page fetched over http(s). file: is how a
        // fetch tool becomes a way to read the disk.
        for bad in [
            "file:///etc/passwd",
            "data:text/html,<b>x</b>",
            "javascript:alert(1)",
            "ftp://example.com/x",
            "not a url",
            "",
        ] {
            assert!(parse_target(bad).is_err(), "{bad} should be refused");
        }
    }

    #[test]
    fn an_address_carrying_credentials_is_refused() {
        // `https://trusted.example@attacker.test/` reads as the first host and
        // connects to the second.
        for bad in [
            "https://user@attacker.test/",
            "https://user:pass@attacker.test/",
            "https://trusted.example@attacker.test/path",
        ] {
            let err = parse_target(bad).expect_err("{bad} should be refused");
            assert!(err.contains("username or password"), "unexpected: {err}");
        }
    }

    #[test]
    fn the_host_is_taken_from_the_authority_not_the_text() {
        let t = parse_target("https://Example.COM:8443/Path?q=1").unwrap();
        assert_eq!(t.host, "example.com");
        assert_eq!(t.scheme, "https");
        assert_eq!(t.path_and_query, "/Path?q=1");
    }

    #[test]
    fn dot_segments_cannot_climb_above_the_root() {
        assert_eq!(normalise_path("/a/b/../c"), "/a/c");
        assert_eq!(normalise_path("/a/./b"), "/a/b");
        // The interesting direction: no number of steps up escapes the root.
        assert_eq!(normalise_path("/../../../etc/passwd"), "/etc/passwd");
        assert_eq!(normalise_path("/a/../../.."), "/");
    }

    #[test]
    fn a_redirect_is_resolved_the_way_a_browser_would() {
        let base = parse_target("https://example.com/docs/guide/page.html").unwrap();

        // Whole address.
        assert_eq!(
            join_redirect(&base, "https://other.test/x").unwrap(),
            "https://other.test/x"
        );
        // Scheme-relative keeps the scheme it arrived on.
        assert_eq!(
            join_redirect(&base, "//other.test/x").unwrap(),
            "https://other.test/x"
        );
        // Absolute path, same host.
        assert_eq!(
            join_redirect(&base, "/top").unwrap(),
            "https://example.com/top"
        );
        // Relative to the directory the page is in.
        assert_eq!(
            join_redirect(&base, "next.html").unwrap(),
            "https://example.com/docs/guide/next.html"
        );
        assert_eq!(
            join_redirect(&base, "../other.html").unwrap(),
            "https://example.com/docs/other.html"
        );
    }

    #[test]
    fn a_redirect_to_something_that_is_not_a_page_is_refused() {
        let base = parse_target("https://example.com/a").unwrap();
        for bad in ["mailto:x@y.test", "data:text/html,x", "file:///etc/passwd", ""] {
            assert!(
                join_redirect(&base, bad).is_err(),
                "redirect to {bad} should be refused"
            );
        }
    }

    #[test]
    fn only_something_readable_as_text_comes_back() {
        for good in [
            "text/html; charset=utf-8",
            "text/plain",
            "application/json",
            "application/ld+json",
            "image/svg+xml",
            "", // absent header
        ] {
            assert!(is_text_content_type(good), "{good} should be readable");
        }
        for bad in [
            "image/png",
            "application/pdf",
            "application/zip",
            "application/octet-stream",
            "video/mp4",
        ] {
            assert!(!is_text_content_type(bad), "{bad} should be refused");
        }
    }

    #[test]
    fn a_page_on_this_machine_is_refused_without_touching_the_network() {
        for bad in [
            "http://127.0.0.1:8080/admin",
            "http://localhost/",
            "http://192.168.1.1/",
            "http://169.254.169.254/latest/meta-data/", // cloud metadata
            "http://[::1]/",
        ] {
            let out = net_fetch_text(bad.into());
            assert!(!out.ok, "{bad} should be refused");
            assert!(out.text.is_empty(), "{bad} must return no text");
            assert!(out.reason.is_some(), "{bad} should say why");
        }
    }

    #[test]
    fn the_connection_only_goes_to_the_host_that_was_checked() {
        // The resolver is what pins a connection to the addresses that were
        // judged. Asked about any other host it must refuse, so that a bug
        // elsewhere cannot turn into a connection nobody checked.
        let resolver = PinnedResolver {
            host: "example.com".into(),
            addresses: vec![ip("93.184.216.34")],
            port: 443,
        };
        let config = Config::builder().build();
        let timeout = NextTimeout {
            // ureq carries its own Duration here, which also spells "no timeout".
            after: ureq::unversioned::transport::time::Duration::Exact(Duration::from_secs(5)),
            reason: ureq::Timeout::Global,
        };

        let ok: Uri = "https://example.com/x".parse().unwrap();
        let resolved = resolver.resolve(&ok, &config, timeout).expect("the checked host");
        assert_eq!(resolved.len(), 1);
        assert_eq!(resolved[0], "93.184.216.34:443".parse().unwrap());

        let elsewhere: Uri = "https://attacker.test/x".parse().unwrap();
        assert!(
            resolver.resolve(&elsewhere, &config, timeout).is_err(),
            "a host that was never checked must not resolve"
        );
    }

    #[test]
    fn nothing_to_resolve_is_refused_rather_than_allowed() {
        assert!(resolve_and_judge("").refusal.is_some());
        assert!(resolve_and_judge("   ").refusal.is_some());
        // A name that cannot resolve is refused too: defaulting to allow on an
        // error is how a check stops being one.
        assert!(resolve_and_judge("this-name-does-not-exist.invalid").refusal.is_some());
    }
}

