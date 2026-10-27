// ==============================================================
// A file is read before it is changed, and so is what uses it
//
// A model could change a file it had not read in the conversation: replace
// it whole from what it guessed was there, or patch a passage it had seen
// only in a search result. It could change what a function takes, or rename
// it, without having looked at the files that call it, and leave them
// broken. On a large project that is most of what goes wrong.
//
// So before an existing file is changed (patch_file, write_file over a file
// that is there, delete_file):
//
//   · it must have been read in this conversation, with read_file, or shown
//     whole as the conversation began, or written by the run itself;
//   · and not changed since by anything else, a command or the person,
//     which is told by what the file holds now against what it held when
//     it was last read or written here;
//   · and when the change alters a name the project's other files use, a
//     function's parameters or a name removed or renamed, those files must
//     have been read too. They are found by searching the project for the
//     name, and named with their lines. A model that changes the same name
//     again without reading them is told twice, then let through, so a run
//     is never held for good.
//
// What was read is worked out from the conversation itself, so it holds for
// a conversation opened again, and a new conversation starts with nothing
// read. What a file held is kept here by a short fingerprint only.
//
// Pure but for the fingerprints it keeps, and before(), which is handed the
// functions that read.
//
// Loaded before the Coder mode and published as window.HCCodeSeen.
// Checked by scripts/checks/code-seen.mjs.
// ==============================================================

(function () {
  'use strict';

  /** The tools that change a file that is there, and the argument naming it. */
  const CHANGES = { patch_file: 'path', write_file: 'path', delete_file: 'path' };
  /** A name shorter than this is too common to search the project for. */
  const SHORTEST_NAME = 4;
  /** At most this many files that use a name are named. */
  const MOST_USERS = 10;
  /** A model that changes a name again without reading what uses it is told this many times, then let through. */
  const TOLD_MOST = 2;

  const slash = (p) => String(p == null ? '' : p).replace(/\\/g, '/');
  const same = (a, b) => slash(a) === slash(b);

  /** A short fingerprint of a file's text, its line endings and trailing space left aside. */
  function print(text) {
    const s = String(text == null ? '' : text).replace(/\r\n/g, '\n').replace(/\s+$/, '');
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return `${s.length}:${h.toString(36)}`;
  }

  /** What each file held when it was last read or written here, by fingerprint. */
  const prints = new Map();
  /** A file's text as it was read or written here. */
  function stamp(path, text) { if (path && typeof text === 'string') prints.set(slash(path), print(text)); }

  const argsOf = (c) => {
    const fn = c && c.function;
    const raw = fn ? fn.arguments : c && c.arguments;
    if (raw && typeof raw === 'object') return raw;
    try { return JSON.parse(raw || '{}') || {}; } catch { return {}; }
  };
  const nameOf = (c) => (c && c.function ? c.function.name : c && c.name) || '';
  const failed = (text) => /^\s*\{\s*"error"/.test(String(text == null ? '' : text));

  /**
   * The files this conversation has read with read_file, or written, and a
   * read or write that worked: a Set of paths as the calls named them.
   * `messages` is the conversation, in the shape the run keeps it.
   */
  function readIn(messages) {
    const results = new Map();
    for (const m of messages || []) if (m && m.role === 'tool') results.set(m.tool_call_id, m.content);
    const seen = new Set();
    for (const m of messages || []) {
      if (!m || m.role !== 'assistant' || !Array.isArray(m.tool_calls)) continue;
      for (const c of m.tool_calls) {
        const name = nameOf(c);
        if (!['read_file', 'write_file', 'patch_file'].includes(name) || !results.has(c.id) || failed(results.get(c.id))) continue;
        const p = argsOf(c).path;
        if (p) seen.add(slash(p));
      }
    }
    return seen;
  }

  /** The files a project shown whole holds, from the text it was shown as (js/code/context.js wholeProject): place in the project to text. */
  function shownWhole(whole) {
    const out = new Map();
    const parts = String(whole == null ? '' : whole).split(/^=== (.+?) ===[ \t]*$\n?/m);
    for (let i = 1; i + 1 < parts.length; i += 2) if (!/^not text, not shown:/.test(parts[i])) out.set(parts[i], parts[i + 1].replace(/\s+$/, ''));
    return out;
  }

  /** The language codemap.js reads a path as, or ''. */
  const langOf = (path) => (window.HCCodeMap ? window.HCCodeMap.langOf(String(path).split('/').pop()) : '');

  /**
   * The names a change alters that other files may use: `{ name, was, now }`,
   * `now` '' when the name is no longer defined there. `before` and `after`
   * are the text a change replaces and what replaces it, `path` the file.
   */
  function altered(before, after, path) {
    const lang = langOf(path);
    if (!lang || !window.HCCodeMap) return [];
    const was = window.HCCodeMap.definitions(String(before || ''), lang);
    const now = window.HCCodeMap.definitions(String(after || ''), lang);
    const label = window.HCCodeMap.label;
    const out = [];
    for (const d of was) {
      if (d.name.length < SHORTEST_NAME || !['fn', 'class', 'type', 'interface', 'enum', 'const', 'struct', 'trait'].includes(d.kind)) continue;
      const twin = now.find((n) => n.name === d.name);
      if (!twin) out.push({ name: d.name, was: label(d), now: '' });
      else if (d.kind === 'fn' && d.params !== undefined && twin.params !== undefined && String(d.params) !== String(twin.params)) out.push({ name: d.name, was: label(d), now: label(twin) });
    }
    return out;
  }

  /**
   * The files other than `path` with lines that use `name` as a whole word,
   * from what the native search found (`found`, its records): `{ path,
   * lines }`, at most MOST_USERS, the lines that define it left out.
   */
  function usersOf(name, found, path, root) {
    const word = new RegExp(`(^|[^\\w$])${name.replace(/[$]/g, '\\$')}($|[^\\w$])`);
    const defines = new RegExp(`\\b(?:function|def|fn|func|class|struct|interface|type|enum|trait)\\s+${name.replace(/[$]/g, '\\$')}\\b`);
    const place = (p) => (window.HCCodeSearch ? window.HCCodeSearch.place(p, root) : slash(p));
    const files = new Map();
    for (const m of Array.isArray(found) ? found : []) {
      if (!m || m.path == null || same(m.path, path) || !word.test(String(m.line)) || defines.test(String(m.line))) continue;
      const at = place(m.path);
      if (!files.has(at)) files.set(at, { path: at, full: slash(m.path), lines: [] });
      const f = files.get(at);
      if (f.lines.length < 4) f.lines.push(m.line_no);
    }
    return [...files.values()].slice(0, MOST_USERS);
  }

  const NOT_READ = (rel) => `Not changed: ${rel} has not been read in this conversation, so this change would be made without seeing the file. ` +
    'Read it with read_file first, at least the part you change, then make the change.';
  const CHANGED_SINCE = (rel) => `Not changed: ${rel} has changed since you last read it, by a command or outside this run. Read it again with read_file, then make the change.`;

  /** What a change that alters names others use is told, with the files to read. */
  function usersNote(rel, names, unread) {
    const what = names.map((n) => (n.now ? `${n.was}, now ${n.now}` : `${n.was}, which it removes or renames`)).join('; ');
    const list = unread.map((f) => `${f.path} (line${f.lines.length === 1 ? '' : 's'} ${f.lines.join(', ')})`).join(', ');
    return `Not changed yet: this change to ${rel} alters ${what}, and other files use it: ${list}. ` +
      'Read the ones you have not, so the change fits every place it is used and those places are changed too where they need it; then make this change again.';
  }

  /** How many times each name was held back, for one request. */
  const told = new WeakMap();

  /**
   * The answer for a change made without seeing what it changes, in the
   * shape js/code/calls.js answers a call it does not make: `{ ok: false,
   * result }`, or null when the change may go ahead. `call` is `{ name,
   * arguments }`, its paths written out in full. `deps`:
   *   root — the project; whole — the project as it was shown whole, or '';
   *   current(path) — what the file holds now, or null when it is not there;
   *   uses(name) — the native search's lines holding the name, never asking.
   * How often a name was held back is kept on the newest request.
   */
  async function before(call, messages, deps = {}) {
    const key = call && CHANGES[call.name];
    if (!key || !deps.current) return null;
    const a = call.arguments || {};
    const path = a[key];
    if (!path || (call.name === 'write_file' && a.append === true)) return null;
    const now = await Promise.resolve(deps.current(path)).catch(() => null);
    if (typeof now !== 'string') return null;   // a new file: nothing to have read
    const rel = window.HCCodeSearch ? window.HCCodeSearch.place(path, deps.root) : slash(path);
    const read = readIn(messages);
    const whole = shownWhole(deps.whole);
    const seenHere = read.has(slash(path)) || read.has(rel);
    const shown = whole.has(rel);
    if (!seenHere && !shown) return { ok: false, result: JSON.stringify({ error: NOT_READ(rel) }) };
    const known = prints.get(slash(path));
    if (known ? known !== print(now) : (!seenHere && shown && print(whole.get(rel)) !== print(now))) return { ok: false, result: JSON.stringify({ error: CHANGED_SINCE(rel) }) };

    // What other files use, when this change alters it.
    if (call.name === 'delete_file' || typeof deps.uses !== 'function') return null;
    const changeBefore = call.name === 'patch_file' ? [a.search, ...(Array.isArray(a.edits) ? a.edits.map((e) => e && e.search) : [])].join('\n') : now;
    const changeAfter = call.name === 'patch_file' ? [a.replace, ...(Array.isArray(a.edits) ? a.edits.map((e) => e && e.replace) : [])].join('\n') : a.content;
    const names = altered(changeBefore, changeAfter, path);
    if (!names.length) return null;
    const request = [...(messages || [])].reverse().find((m) => m && m.role === 'user' && !m.note && !m.opened && !m.added) || null;
    const counts = request ? (told.get(request) || new Map()) : new Map();
    if (request) told.set(request, counts);
    const held = [], unread = [];
    for (const n of names) {
      if ((counts.get(n.name) || 0) >= TOLD_MOST) continue;
      const users = usersOf(n.name, await Promise.resolve(deps.uses(n.name)).catch(() => []), path, deps.root)
        .filter((f) => !read.has(f.full) && !read.has(f.path) && !whole.has(f.path));
      if (!users.length) continue;
      held.push(n);
      for (const f of users) if (!unread.some((u) => u.path === f.path)) unread.push(f);
    }
    if (!held.length) return null;
    held.forEach((n) => counts.set(n.name, (counts.get(n.name) || 0) + 1));
    return { ok: false, result: JSON.stringify({ error: usersNote(rel, held, unread.slice(0, MOST_USERS)) }) };
  }

  window.HCCodeSeen = { CHANGES, SHORTEST_NAME, MOST_USERS, TOLD_MOST, print, stamp, readIn, shownWhole, altered, usersOf, usersNote, before };
})();
