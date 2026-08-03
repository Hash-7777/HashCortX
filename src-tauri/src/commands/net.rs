// ==============================================================
// Where a hostname actually leads
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
//   invoke("net_resolve_is_public", { host })
//     → { ok: bool, reason: string|null, addresses: [..] }
//
// HONEST LIMIT
// ------------
// This app resolves the name, and then the webview resolves it AGAIN when it
// fetches. A name that answers differently between those two moments is not
// caught. Closing that needs the fetch itself to happen here, over a
// connection pinned to the address that was checked, which means an HTTP stack
// this crate does not have. docs/SECURITY.md says exactly this and no more.
//
// No new dependency: name resolution is in the standard library.
// ==============================================================

use serde::Serialize;
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, ToSocketAddrs};

#[derive(Serialize)]
pub struct ResolveVerdict {
    /// Every resolved address is a public one.
    pub ok: bool,
    /// Why it was refused, in words a user can read. `None` when ok.
    pub reason: Option<String>,
    /// What the name resolved to, for the audit trail.
    pub addresses: Vec<String>,
}

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

#[tauri::command]
pub fn net_resolve_is_public(host: String) -> ResolveVerdict {
    let name = host.trim().trim_start_matches('[').trim_end_matches(']').to_string();
    if name.is_empty() {
        return ResolveVerdict {
            ok: false,
            reason: Some("no hostname to resolve".into()),
            addresses: vec![],
        };
    }

    // The port is irrelevant to the address, but ToSocketAddrs wants one.
    let resolved: Vec<IpAddr> = match (name.as_str(), 80u16).to_socket_addrs() {
        Ok(iter) => iter.map(|s| s.ip()).collect(),
        Err(e) => {
            // A name that does not resolve is refused rather than allowed. The
            // fetch would fail anyway, and defaulting to "allow" on an error is
            // how a check becomes decorative.
            return ResolveVerdict {
                ok: false,
                reason: Some(format!("the address could not be resolved: {e}")),
                addresses: vec![],
            };
        }
    };

    if resolved.is_empty() {
        return ResolveVerdict {
            ok: false,
            reason: Some("the address resolved to nothing".into()),
            addresses: vec![],
        };
    }

    let addresses: Vec<String> = resolved.iter().map(|ip| ip.to_string()).collect();
    // ANY private address is a refusal. A name that answers with one public
    // address and one private one is exactly the case worth catching.
    if let Some(bad) = resolved.iter().find(|ip| is_private_ip(ip)) {
        return ResolveVerdict {
            ok: false,
            reason: Some(format!(
                "that address leads to {bad}, which is on this machine or its private network"
            )),
            addresses,
        };
    }

    ResolveVerdict { ok: true, reason: None, addresses }
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
        let v = net_resolve_is_public("127.0.0.1".into());
        assert!(!v.ok);
        assert!(v.reason.unwrap().contains("127.0.0.1"));

        let v = net_resolve_is_public("192.168.1.1".into());
        assert!(!v.ok);

        // Brackets are how a URL writes an IPv6 host; they must not confuse it.
        let v = net_resolve_is_public("[::1]".into());
        assert!(!v.ok, "bracketed loopback must still be refused");
    }

    #[test]
    fn a_literal_public_address_is_allowed() {
        let v = net_resolve_is_public("8.8.8.8".into());
        assert!(v.ok, "reason: {:?}", v.reason);
        assert_eq!(v.addresses, vec!["8.8.8.8".to_string()]);
    }

    #[test]
    fn nothing_to_resolve_is_refused_rather_than_allowed() {
        assert!(!net_resolve_is_public("".into()).ok);
        assert!(!net_resolve_is_public("   ".into()).ok);
        // A name that cannot resolve is refused too: defaulting to allow on an
        // error is how a check stops being one.
        assert!(!net_resolve_is_public("this-name-does-not-exist.invalid".into()).ok);
    }
}
