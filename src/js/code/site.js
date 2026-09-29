// ==============================================================
// A site HashCoder changed, read the way a browser would read it
//
// A model cannot see the page it builds. It can finish a site whose
// sections never appear, whose menu never opens, or whose page points at a
// stylesheet that is not there, and say it is done. So when a run changes a
// page, a stylesheet or a script, the site's files are gathered here and
// read by the check the Agent Swarm's work goes through
// (js/swarm/project-check.js), which needs no model. What will not work is
// handed back to the agent once, before it finishes (js/code/verify.js
// siteNote).
//
// The files gathered: every page, stylesheet and script in each folder the
// run changed one in, and the stylesheets and scripts those pages load from
// other folders of the project. Read through the guard's check that never
// asks (HC.code.readQuietly), within limits on files and characters.
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

  window.HCCodeSite = { MOST_FILES, MOST_CHARS, worthChecking, loads, resolve, gather };
})();
