// ==============================================================
// What looks like a secret
//
// Files that usually hold keys and passwords, told apart by their names:
// environment files, private keys and certificates, key stores, the files
// command-line tools keep sign-ins in, and files named as secrets or
// credentials. An example of one (.env.example, .sample, .template, .dist)
// is not one. And text shaped like a key, by the shapes providers give their
// keys. Each rule has one home, here, and every part of the app that needs
// it asks this file.
//
// Pure. Published as window.HCSecretShapes. Checked by scripts/checks/secret-shapes.mjs.
// ==============================================================
(function () {
  "use strict";

  /** A file that holds secrets by what it is called. */
  const SECRET_FILE = /(?:^|\/)(?:\.env(?:\.(?!example$|sample$|template$|dist$)[^/]*)?|[^/]*\.(?:pem|key|p12|pfx|keystore|kdbx)|id_(?:rsa|dsa|ecdsa|ed25519)[^/]*|\.netrc|\.pgpass|\.git-credentials|credentials(?:\.json)?|secrets?\.(?:json|ya?ml|toml))$/i;

  /** Whether the file at `path` is one that usually holds keys, written with either kind of slash. */
  const isSecretFile = (path) => !!path && SECRET_FILE.test(String(path).replace(/\\/g, "/"));

  // What a key looks like, by the shapes each provider the app offers gives
  // them (the commit hook, .githooks/pre-commit, holds the same shapes; the
  // check says which are this file's own), and a value written after a name
  // that says it is secret.
  const SHAPES = [
    /\bsk-[A-Za-z0-9_-]{8,}/g,
    /\b[sr]k_(?:live|test)_[A-Za-z0-9]{8,}/g,
    /\bgsk_[A-Za-z0-9]{8,}/g,
    /\bAIza[0-9A-Za-z_-]{16,}/g,
    /\bxai-[A-Za-z0-9_-]{8,}/g,
    /\bhf_[A-Za-z0-9]{8,}/g,
    /\bcsk-[A-Za-z0-9_-]{8,}/g,
    /\bfw_[A-Za-z0-9]{8,}/g,
    /\bnvapi-[A-Za-z0-9_-]{8,}/g,
    /\btvly-[A-Za-z0-9_-]{8,}/g,
    /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{8,}/g,
    /\bgithub_pat_[A-Za-z0-9_]{12,}/g,
    /\bAKIA[0-9A-Z]{12,}/g,
    /\bxox[abprs]-[A-Za-z0-9-]{8,}/g,
    /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g,
    /\bBearer\s+[A-Za-z0-9._~+/=-]{20,}/g,
    /\bBEGIN [A-Z ]*PRIVATE KEY\b/g,   // the header alone, as the commit hook reads it
  ];
  const NAMED = /((?:api[_-]?key|secret|token|password|passwd|authorization)["']?\s*[:=]\s*["']?)([^\s"',;)}\]]{12,})/gi;
  const MARK = "[redacted: looked like a key]";

  /**
   * `text` with whatever is shaped like a key replaced by `mark` (a string,
   * or a function given the text it replaces), and how many were.
   */
  function redact(text, mark = MARK) {
    let count = 0;
    let out = String(text == null ? "" : text);
    const put = (found) => { count++; return typeof mark === "function" ? mark(found) : mark; };
    for (const shape of SHAPES) out = out.replace(shape, put);
    out = out.replace(NAMED, (all, name, value) => `${name}${put(value)}`);
    return { text: out, count };
  }

  /** Whether `text` holds anything shaped like a key. */
  const looksLikeKey = (text) => redact(text).count > 0;

  // ── Kept from a model off this computer ──────────────────────────────
  //
  // A tool result a cloud model is sent leaves this computer. What is shaped
  // like a key in it is replaced by how long it was, and the result says so
  // once, so the model leaves those lines alone. It goes by shape: a secret
  // with no known shape is not caught. On unless switched off in Settings.

  const KEEP_KEY = "hc_keep_keys_from_cloud";
  const keptMark = (found) => `[kept from the model: looked like a key, ${found.length} characters]`;
  const store = (s) => { if (s) return s; try { return typeof localStorage !== "undefined" ? localStorage : null; } catch { return null; } };

  /** Whether key-shaped text is kept from cloud models: on, unless switched off. */
  function keepFromCloud(s) {
    try { const st = store(s); return !st || st.getItem(KEEP_KEY) !== "off"; } catch { return true; }
  }
  /** Switch it on or off. */
  function setKeepFromCloud(on, s) {
    try { const st = store(s); if (!st) return; if (on) st.removeItem(KEEP_KEY); else st.setItem(KEEP_KEY, "off"); } catch { /* left on */ }
  }

  /**
   * The conversation with key-shaped text kept out of its tool results, and
   * how many values were. Every other message, and a result with none, is
   * the same object it was; the same result always comes out the same.
   */
  function forCloud(messages) {
    let count = 0;
    const out = (Array.isArray(messages) ? messages : []).map((m) => {
      if (!m || m.role !== "tool" || typeof m.content !== "string") return m;
      const r = redact(m.content, keptMark);
      if (!r.count) return m;
      count += r.count;
      return Object.assign({}, m, { content: `${r.text}\n[${r.count} value${r.count === 1 ? " that looked like a key was" : "s that looked like keys were"} kept from the model. Leave those lines as they are, or ask the person.]` });
    });
    return { messages: count ? out : messages, count };
  }

  window.HCSecretShapes = { SECRET_FILE, isSecretFile, SHAPES, NAMED, redact, looksLikeKey, KEEP_KEY, keepFromCloud, setKeepFromCloud, forCloud };
})();
