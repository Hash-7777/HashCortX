// ==============================================================
// The person's own folders are not looked through unasked
//
// A model asked to make a file on the Desktop would often list the whole
// Desktop first, "to see what is there", or the home folder to find its way:
// the names of everything the person keeps there, sent to a model provider,
// for a task that needed none of it. A home folder, the folders a system
// keeps a person's files in (Desktop, Documents, Downloads and the like) and
// the folder of every account are looked through only when the request asks
// for it in words, such as "list what is on my Desktop", or when the person
// opened that very folder as the project. A place inside one of them, such as
// a project on the Desktop, is not one of them.
//
// Listing, finding, searching and listing commands are answered in words
// without running; the answer says how to do the task without looking.
//
// Pure. Published as window.HCCodePrivate. Checked by scripts/checks/code-private.mjs.
// ==============================================================
(function () {
  'use strict';

  /** The folders a system keeps a person's own files in, directly under their home folder. */
  const OWN = ['desktop', 'documents', 'downloads', 'pictures', 'movies', 'music', 'videos', 'library', 'public', 'onedrive', 'icloud drive'];
  /** The tools that look through a folder, and where each names it. */
  const LOOKING = { list_dir: ['dir', 'path'], fuzzy_find: ['dir', 'path'], grep_code: ['dir', 'path'], search_files: ['dir', 'path'] };
  /** The commands that list or search a folder. */
  const LISTING = ['ls', 'find', 'tree', 'du', 'dir', 'fd', 'mdfind', 'locate', 'grep', 'rg'];

  const slashed = (p) => String(p || '').replace(/\\/g, '/').replace(/\/+$/, '');

  /** The home folder a place sits in, from the one given or the shape of the place, or ''. */
  function homeOf(place, home) {
    const h = slashed(home);
    if (h && (place === h || place.startsWith(`${h}/`))) return h;
    const m = /^(\/Users\/[^/]+|\/home\/[^/]+|[A-Za-z]:\/Users\/[^/]+)/i.exec(place);
    return m ? m[1] : '';
  }

  /** A place as written, its home folder spelled out: `~`, `$HOME` and `%USERPROFILE%`. */
  function spelled(p, home) {
    const h = slashed(home);
    let t = slashed(String(p || '').trim().replace(/^["']|["']$/g, ''));
    if (h) t = t.replace(/^(~|\$HOME|\$\{HOME\}|%USERPROFILE%)(?=\/|$)/i, h);
    return t;
  }

  /** What a place is when it is one of the person's own folders: 'home', 'accounts' or the folder's name; else ''. */
  function kindOf(place, home) {
    const p = slashed(place);
    if (!p || p.startsWith('~')) return '';
    if (/^(\/Users|\/home|[A-Za-z]:\/Users)$/i.test(p)) return 'accounts';
    const h = homeOf(p, home);
    if (!h) return '';
    if (p.toLowerCase() === h.toLowerCase()) return 'home';
    const rest = p.slice(h.length + 1);
    return !rest.includes('/') && OWN.includes(rest.toLowerCase()) ? rest : '';
  }

  /** Whether the request asks in words to look through that kind of folder. */
  function asked(request, kind) {
    const t = String(request || '').toLowerCase();
    const seeing = /\b(list|show|see|look(?:ing)? (?:at|in|through)|what(?:'s| is| are)? (?:on|in)|which files|find|search|organi[sz]e|clean(?: up)?|tidy|sort|go through|scan)\b/.test(t);
    if (!seeing) return false;
    if (kind === 'home') return /\b(home folder|home directory|my files|user folder)\b/.test(t);
    if (kind === 'accounts') return /\b(users|accounts)\b/.test(t);
    return new RegExp(`\\b${kind.toLowerCase()}\\b`).test(t);
  }

  /** The places a call looks through. */
  function placesOf(call, cwd) {
    const c = call && typeof call === 'object' ? call : {};
    const a = c.arguments && typeof c.arguments === 'object' ? c.arguments : {};
    if (LOOKING[c.name]) { const p = LOOKING[c.name].map((k) => a[k]).find((x) => typeof x === 'string' && x.trim()); return [p || cwd || '']; }
    if (c.name !== 'shell_run') return [];
    const cmd = String(a.command || '').trim().split(/\s+/)[0].split('/').pop().toLowerCase();
    if (!LISTING.includes(cmd)) return [];
    const given = (Array.isArray(a.args) ? a.args : []).map(String).filter((x) => x && !x.startsWith('-'));
    return given.length ? given : [a.cwd || cwd || ''];
  }

  /**
   * A call that would look through the person's own folders unasked, answered
   * without running ({ ok: false, result }), or null to let it run.
   */
  function refuse(call, { request = '', home = '', root = '' } = {}) {
    const r = slashed(root);
    for (const raw of placesOf(call, root)) {
      const place = spelled(raw, home);
      const kind = kindOf(place, home);
      if (!kind || (r && place.toLowerCase() === r.toLowerCase())) continue;   // a folder the person opened as the project is theirs to have looked through
      if (asked(request, kind)) continue;
      const what = kind === 'home' ? 'home folder' : kind === 'accounts' ? 'folder of every account on this computer' : `${kind} folder`;
      return { ok: false, result: JSON.stringify({ error: `Not run: ${place} is the person's own ${what}, and looking through it would send the names of their private files to the model. This request does not ask to look there. Work only with the paths the request names: to make a folder there, run mkdir with its whole path (mkdir -p makes it whether or not it is there already); to check one place, read or list that place itself. If the task cannot be done without looking there, ask the person first.` }) };
    }
    return null;
  }

  window.HCCodePrivate = { OWN, LISTING, kindOf, asked, placesOf, refuse };
})();
