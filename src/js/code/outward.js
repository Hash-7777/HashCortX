// ==============================================================
// Sending something out, after reading from outside and holding what is private
//
// One action alone is seldom the danger. A run that has read material from
// outside (a web page, a search, a connected system, a file outside the
// project) can have been told what to do by it; a run that holds private
// material (a file outside the project, a file of keys, a connected system's
// records, the knowledge base, remembered facts, a project marked private)
// has something worth taking. When a run has both, an action that sends
// something out (a web address, a change to a connected system's records, a
// command that reaches the network) is asked about every time, and no yes
// given earlier in the session covers it.
//
// The facts are worked out from the conversation alone, so the same run
// always reads the same. Some addresses are refused whatever the run holds:
// one too long to read, and one whose query carries something shaped like a
// key.
//
// Pure: what it needs is handed in. Published as window.HCCodeOutward.
// Checked by scripts/checks/code-outward.mjs.
// ==============================================================
(function () {
  'use strict';

  /** Tools whose results come from outside the computer. */
  const FROM_OUTSIDE = new Set(['fetch_url', 'web_search', 'find_photos']);
  /** Tools whose results are the person's own, kept by the app. */
  const PRIVATE_TOOLS = new Set(['search_knowledge', 'recall_facts']);
  /** A connected system's tool, as a model calls it (js/mcp/policy.js exposedName). */
  const SYSTEM_TOOL = /^sys_/;
  /** Longest web address that is sent at all. */
  const MOST_ADDRESS = 2000;

  const slash = (p) => String(p || '').replace(/\\/g, '/').replace(/\/+$/, '');
  const failed = (content) => /^\s*\{\s*"error"/.test(String(content || ''));
  const argsOf = (raw) => { if (raw && typeof raw === 'object') return raw; try { return JSON.parse(raw || '{}') || {}; } catch { return {}; } };

  /** Whether `path` is inside `root`: a path written from the project folder is. */
  function inside(path, root) {
    const p = slash(path), r = slash(root);
    if (!p) return true;
    if (!/^([A-Za-z]:)?\//.test(p) && !p.startsWith('~')) return true;
    if (!r) return false;
    const same = /^[A-Za-z]:/.test(r) ? (a, b) => a.toLowerCase() === b.toLowerCase() : (a, b) => a === b;
    return same(p, r) || same(p.slice(0, r.length + 1), `${r}/`);
  }

  /**
   * `{ untrusted, private }` for a conversation: whether it holds a result
   * from outside, and whether it holds private material. `root` is the open
   * project, `isSecret(path)` tells a file of keys, `privateProject` is the
   * person's mark on the project. A result that failed brought nothing in.
   */
  function facts(messages, { root = '', isSecret = () => false, privateProject = false } = {}) {
    const calls = new Map();
    let untrusted = false;
    let held = !!privateProject;
    for (const m of Array.isArray(messages) ? messages : []) {
      if (m && m.role === 'assistant' && Array.isArray(m.tool_calls)) {
        for (const c of m.tool_calls) if (c && c.id) calls.set(c.id, { name: (c.function && c.function.name) || c.name, args: argsOf(c.function ? c.function.arguments : c.arguments) });
        continue;
      }
      if (!m || m.role !== 'tool' || failed(m.content)) continue;
      const call = calls.get(m.tool_call_id) || { name: m.name, args: {} };
      const name = String(call.name || m.name || '');
      if (FROM_OUTSIDE.has(name)) untrusted = true;
      if (SYSTEM_TOOL.test(name)) { untrusted = true; held = true; }
      if (PRIVATE_TOOLS.has(name)) held = true;
      if (name === 'read_file') {
        const path = call.args.path;
        if (!inside(path, root)) { untrusted = true; held = true; }
        if (path && isSecret(path)) held = true;
      }
    }
    return { untrusted, private: held };
  }

  /** A command that reaches the network: a fetch, a remote shell or copy, a push, a package install. */
  const NETWORKED = /^(?:\S*\/)?(?:curl|wget|nc|ncat|netcat|ssh|scp|sftp|rsync|ftp|telnet)(?:\s|$)|^(?:\S*\/)?git\s+(?:push|send-email)\b|^(?:\S*\/)?(?:npm|pnpm|yarn|bun)\s+(?:install|add|i)\b|^(?:\S*\/)?(?:pip3?|uv\s+pip)\s+install\b|^(?:\S*\/)?(?:uv|poetry)\s+add\b|^(?:\S*\/)?cargo\s+(?:add|install)\b|^(?:\S*\/)?(?:gem|brew|winget|choco|scoop)\s+install\b|^(?:\S*\/)?go\s+(?:get|install)\b/i;

  /** Whether an action sends something out of the computer. */
  const sendsOut = (action, target) => action === 'fetch' || action === 'erp-change' || (action === 'shell' && NETWORKED.test(String(target || '').trim()));

  const WHY = 'This run has read material from outside and holds private material. Check that nothing private is in what is sent.';

  /** `{ ask: 'always', why }` when the run holds both and the action sends something out; otherwise null, and the rules as they were apply. */
  function judge(action, target, f) {
    if (!f || !f.untrusted || !f.private || !sendsOut(action, target)) return null;
    return { ask: 'always', why: WHY };
  }

  const decoded = (text) => { try { return decodeURIComponent(String(text).replace(/\+/g, ' ')); } catch { return String(text); } };

  /** Why a web address is refused whatever the run holds, or ''. `looksLikeKey(text)` tells text shaped like a key. */
  function refuseAddress(url, looksLikeKey = () => false) {
    const u = String(url || '');
    if (u.length > MOST_ADDRESS) return 'The address is longer than 2,000 characters, so it was refused: a page is reached with a short address, and a long one can carry what is in the conversation.';
    const q = u.indexOf('?');
    if (q >= 0 && looksLikeKey(decoded(u.slice(q + 1)))) return 'The address carries something shaped like a key in its query, so it was refused: a key is never sent in an address.';
    return '';
  }

  /** The address as the person is shown it, its query decoded, on a line of its own. */
  function shownAddress(url) {
    const u = String(url || '');
    const q = u.indexOf('?');
    return `Address: ${q < 0 ? u : u.slice(0, q + 1) + decoded(u.slice(q + 1))}`;
  }

  window.HCCodeOutward = { FROM_OUTSIDE, PRIVATE_TOOLS, MOST_ADDRESS, facts, judge, sendsOut, refuseAddress, shownAddress };
})();
