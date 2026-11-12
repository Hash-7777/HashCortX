// ==============================================================
// A site HashCoder changed, read the way a browser would read it
//
// A model cannot see the page it builds. It can finish a site whose
// sections never appear, whose menu never opens, or whose page points at a
// stylesheet that is not there, and say it is done. So when a run changes a
// page, a stylesheet or a script, the site's files are gathered here and
// read by the check the Agent Swarm's work goes through
// (js/swarm/project-check.js), which needs no model. What will not work, and
// what falls short of the standard a site is held to, is handed back to the
// agent once, before it finishes (js/code/verify.js siteNote): only what the
// run brought in, never what the site already had.
//
// The files gathered: every page, stylesheet and script in each folder the
// run changed one in, and the stylesheets and scripts those pages load from
// other folders of the project. Read through the guard's check that never
// asks (HC.code.readQuietly), within limits on files and characters.
//
// Scripts from other sites are said, not refused: what the run's changed
// pages and scripts now load from another site that they did not before (a
// <script src> or an import of a full address) is listed under the answer,
// since each such script runs with full access to its page (outsideLine).
//
// Pure but for gather(), which is handed the functions that list and read.
//
// Loaded before the Coder mode and published as window.HCCodeSite.
// Checked by scripts/checks/code-site.mjs.
// ==============================================================

(function () {
  'use strict';

  const WEB = /\.(?:html?|css|m?js)$/i;
  const MOST_FILES = 30;
  /** At most this many scripts from other sites are named under the answer. */
  const MOST_LISTED = 5;
  const MOST_CHARS = 1500000;

  const sepOf = (p) => (/\\/.test(p) && !/\//.test(p) ? '\\' : '/');
  const trimEnd = (p) => String(p || '').replace(/[\\/]+$/, '');
  const dirOf = (p) => String(p).replace(/[\\/][^\\/]*$/, '');
  const baseOf = (p) => String(p).split(/[\\/]/).pop();
  const absolute = (p) => /^(?:\/|[A-Za-z]:[\\/]|\\\\)/.test(String(p));

  /** Whether `path` is the folder `root` or inside it. */
  function inside(root, path) {
    const r = trimEnd(root);
    return !!r && (path === r || path.startsWith(`${r}/`) || path.startsWith(`${r}\\`));
  }

  /** Whether a run that changed these files changed a site: a page, a stylesheet or a script. */
  const worthChecking = (changed) => (Array.isArray(changed) ? changed : []).some((p) => WEB.test(String(p)));

  /** The stylesheets and scripts a page loads from the project, as it writes them. */
  function loads(html) {
    const out = [];
    for (const m of String(html || '').matchAll(/\b(?:src|href)\s*=\s*["']([^"'#?]+)/gi)) {
      const ref = m[1].trim();
      if (!/^(?:[a-z][\w+.-]*:|\/\/|\/)/i.test(ref) && /\.(?:css|m?js)$/i.test(ref)) out.push(ref);
    }
    return out;
  }

  /** `ref`, as a page in `dir` writes it, as a path: `./` and `../` followed. */
  function resolve(dir, ref) {
    const sep = sepOf(dir);
    const parts = trimEnd(dir).split(/[\\/]/);
    for (const seg of String(ref).split('/')) {
      if (!seg || seg === '.') continue;
      if (seg === '..') parts.pop();
      else parts.push(seg);
    }
    return parts.join(sep);
  }

  /**
   * The site's files, `Map(name -> { content, path })`, named as the check
   * reads them: by file name. `changed` is what the run changed, `root` the
   * open project; `list(dir)` answers with a folder's entries and
   * `read(path)` with a file's text. Anything outside the project, or that
   * cannot be read, is left out, and scripts with no page among them, such
   * as a server's, give nothing: they are not a site.
   */
  async function gather(changed, root, { list, read }) {
    const files = new Map();
    let chars = 0;
    const take = async (path) => {
      const name = baseOf(path).toLowerCase();
      if (files.has(name) || files.size >= MOST_FILES || chars >= MOST_CHARS || !inside(root, path)) return;
      let text;
      try { text = await read(path); } catch { return; }
      if (typeof text !== 'string') return;
      chars += text.length;
      files.set(name, { content: text, path });
    };
    const base = trimEnd(root);
    const paths = (Array.isArray(changed) ? changed : []).map(String).filter((p) => WEB.test(p))
      .map((p) => (absolute(p) ? p : `${base}${sepOf(base)}${p}`));
    for (const dir of [...new Set(paths.map(dirOf))].filter((d) => inside(root, d))) {
      let entries;
      try { entries = await list(dir); if (typeof entries === 'string') entries = JSON.parse(entries); } catch { continue; }
      const named = (Array.isArray(entries) ? entries : []).filter((e) => e && !e.is_dir && typeof e.name === 'string' && WEB.test(e.name))
        .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
      for (const e of named) await take(dir + sepOf(dir) + e.name);
    }
    const pages = [...files.values()].filter((f) => /\.html?$/i.test(f.path));
    if (!pages.length) return new Map();   // scripts with no page among them are not a site
    for (const f of pages) for (const ref of loads(f.content)) await take(resolve(dirOf(f.path), ref));
    return files;
  }

  /**
   * The same files as they stood before the run: a file the run changed holds
   * what it held, and one the run made is left out. `changes` is
   * js/code/review.js's `Map(path -> { before, after, unreadable })`; a file
   * whose earlier text was not kept stays as it is now.
   */
  function asBefore(files, changes) {
    const out = new Map(files);
    for (const [path, c] of changes || []) {
      const name = baseOf(String(path)).toLowerCase();
      if (!c || c.unreadable || !out.has(name)) continue;
      if (c.before == null) out.delete(name);
      else out.set(name, { ...out.get(name), content: c.before });
    }
    return out;
  }

  /**
   * What the run brought in: the findings in `now` that `before` did not
   * have, by their words. A problem the site already had is the person's to
   * ask about, not the run's to fix: sent back for it, a model rewrites parts
   * of a page the request never mentioned.
   */
  function newSince(now, before) {
    const had = new Set((before || []).map((f) => f && f.what));
    return (now || []).filter((f) => f && !had.has(f.what));
  }

  // ── Scripts from other sites ─────────────────────────────────────────

  /** A full address, or one with no scheme: a script from another site. */
  const ELSEWHERE = /^(?:https?:)?\/\//i;

  /** The scripts `text` loads from other sites, as it writes them: a page's <script src>, and any import of a full address. */
  function outsideScripts(text, isPage) {
    const t = String(text || '');
    const out = [];
    if (isPage) for (const m of t.matchAll(/<script\b[^>]*?\bsrc\s*=\s*["']([^"']+)["']/gi)) if (ELSEWHERE.test(m[1].trim())) out.push(m[1].trim());
    for (const m of t.matchAll(/\bimport\s*(?:[\w*{}\s,]+\s*from\s*|\(\s*)["']([^"']+)["']/g)) if (ELSEWHERE.test(m[1].trim())) out.push(m[1].trim());
    return [...new Set(out)];
  }

  /**
   * What the run brought in: `[{ url, file }]` for each script from another
   * site that a page or script it changed loads now and did not load in
   * `before` (asBefore). `files` is what gather() read; `changed` the paths
   * the run changed.
   */
  function brought(files, before, changed) {
    const names = new Set((Array.isArray(changed) ? changed : []).map((p) => baseOf(String(p)).toLowerCase()));
    const out = [];
    for (const [name, f] of files || []) {
      if (!names.has(name) || !/\.(?:html?|m?js)$/i.test(name)) continue;
      const page = /\.html?$/i.test(name);
      const was = before && before.get(name);
      const had = new Set(outsideScripts(was ? was.content : '', page));
      for (const url of outsideScripts(f.content, page)) if (!had.has(url)) out.push({ url, file: baseOf(f.path) });
    }
    return out;
  }

  /** The line under the answer naming them, or ''. Each address as code, so it is never a link, its hidden characters as codes. */
  function outsideLine(list) {
    if (!Array.isArray(list) || !list.length) return '';
    const shown = (u) => {
      const s = String(u).replace(/`/g, '%60');
      const coded = window.HCTextSafety ? window.HCTextSafety.reveal(s) : s;
      return `\`${coded.length > 120 ? `${coded.slice(0, 119)}…` : coded}\``;
    };
    const named = list.slice(0, MOST_LISTED).map((s) => `${shown(s.url)} in ${s.file}`).join('; ');
    const more = list.length > MOST_LISTED ? `, and ${list.length - MOST_LISTED} more` : '';
    return `Scripts from other sites this run added: ${named}${more}. Each one runs with full access to its page.`;
  }

  window.HCCodeSite = { MOST_FILES, MOST_CHARS, MOST_LISTED, worthChecking, loads, resolve, gather, asBefore, newSince, outsideScripts, brought, outsideLine };
})();
