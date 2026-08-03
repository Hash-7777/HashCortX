// ==============================================================
// Where the agent's fetch tool is allowed to go
//
// `fetch_url` takes a URL a language model chose. A prompt-injected model that
// can reach a private address can read whatever is behind it — a router admin
// page, a cloud instance's metadata service, something on the user's own
// network — and put the contents in its next request to a provider. This is
// the gate that stops the obvious version of that.
//
// WHAT THIS IS, HONESTLY
// ----------------------
// It reads the address as WRITTEN. `isSafeExternalUrl` blocks a literal
// private address; it cannot know where a hostname leads, because resolving a
// name is not something the renderer can do. A public name pointing at
// 192.168.x.x passes this check.
//
// That is why it is only half the check. The other half is
// `net_resolve_is_public` in src-tauri/src/commands/net.rs, which resolves the
// name and refuses if any address it answers with is private. Both run before
// a fetch. docs/SECURITY.md states what is still open after both.
//
// Pure: no DOM, no storage, no network.
// Loaded before app.js and published as window.HCUrlSafety.
// Checked by scripts/checks/url-safety.mjs.
// ==============================================================

(function () {
  'use strict';

  /** Hostnames that name a metadata service rather than a place on the internet. */
  const BLOCKED_HOSTS = new Set([
    'localhost',
    '0.0.0.0',
    'metadata.google.internal',
    'metadata.goog',
    '::1',
    '[::1]',
  ]);

  /**
   * Is this literal hostname a private, loopback or link-local address?
   *
   * Exposed separately from the URL check because the Rust side resolves a
   * name to addresses and the same judgement has to be applied to each of
   * them; keeping one copy of the rules means they cannot drift apart.
   */
  function isPrivateHostname(hostname) {
    const h = String(hostname || '').toLowerCase();
    if (!h) return true;
    if (BLOCKED_HOSTS.has(h)) return true;
    // IPv4: loopback, the three private ranges, link-local (which is where
    // cloud metadata lives), and carrier-grade NAT.
    if (/^127\./.test(h)) return true;
    if (/^10\./.test(h)) return true;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
    if (/^192\.168\./.test(h)) return true;
    if (/^169\.254\./.test(h)) return true;
    if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(h)) return true;
    if (/^0\./.test(h)) return true;
    // IPv6, with or without the brackets a URL puts around it.
    if (h.startsWith('[::1') || h === '::1') return true;
    if (h.startsWith('[fe80:') || /^fe80:/i.test(h)) return true;
    if (/^\[f[cd][0-9a-f:]/i.test(h) || /^f[cd][0-9a-f]{2}:/i.test(h)) return true;
    // IPv4 wearing an IPv6 costume.
    if (/^\[?::ffff:(127|10|0)\./i.test(h)) return true;
    if (/^\[?::ffff:192\.168\./i.test(h)) return true;
    if (/^\[?::ffff:169\.254\./i.test(h)) return true;
    if (/^\[?::ffff:172\.(1[6-9]|2\d|3[01])\./i.test(h)) return true;
    return false;
  }

  /**
   * Whether the agent may fetch this URL at all, judging the address as
   * written. A `true` here is not permission to connect — see the file header.
   */
  function isSafeExternalUrl(raw) {
    let parsed;
    try { parsed = new URL(raw); } catch { return false; }
    // Only the two schemes that fetch a remote document. This is what keeps
    // file://, data: and javascript: out.
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
    // Credentials in a URL are a way to make one host look like another.
    if (parsed.username !== '' || parsed.password !== '') return false;
    return !isPrivateHostname(parsed.hostname);
  }

  /** The hostname a caller needs to resolve before fetching, or null. */
  function hostnameOf(raw) {
    try { return new URL(raw).hostname.toLowerCase(); } catch { return null; }
  }

  window.HCUrlSafety = { isSafeExternalUrl, isPrivateHostname, hostnameOf };
})();
