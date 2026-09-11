// ==============================================================
// A generated system as one file that runs in any browser
//
// A system made in the app lived only in the app. This writes it out as a
// single HTML file — its screens, its records and the code that runs them —
// that opens in any browser and works there: modules, boards, links, forms,
// search, the books, and CSV export, with edits kept in that browser.
//
// The file runs the Systems mode's own code, not a copy of it, so it cannot
// fall behind the app: it carries the same scripts, the mode's panel with the
// app's chrome hidden, and the system itself. The mode opens straight on that
// one system and keeps it under a key of its own — every local file shares
// one browser storage, so two exported systems must not overwrite each other.
//
// Pure: texts in, one text out. Fetching the files is the mode's job.
//
// Loaded before the Systems mode and published as window.HCSystemsExportApp.
// Checked by scripts/checks/systems-export-app.mjs.
// ==============================================================

(function () {
  'use strict';

  /** What the file carries, in the order it must load. */
  const SCRIPTS = [
    '/js/fences.js', '/js/export-format.js', '/js/forge/expr.js',
    '/js/systems/spec.js', '/js/systems/view.js', '/js/systems/icons.js', '/js/systems/shells.js',
    '/js/systems/stages.js', '/js/systems/relations.js', '/js/systems/forms.js', '/js/systems/revise.js',
    '/js/systems/figures.js', '/js/systems/money.js', '/js/systems/samples.js', '/js/systems/domain.js',
    '/js/systems/theme.js', '/js/systems/books.js', '/js/systems/ledger.js', '/js/systems/export-app.js',
    '/modes/systems/mode.js',
  ];
  const STYLES = ['/css/vars.css', '/modes/systems/mode.css'];
  /** The dialogs the panel borrows from the Agent Swarm's sheet. */
  const BORROWED = { file: '/modes/agent-maker/mode.css', selector: /amk-dialog|amk-btn/ };

  const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /** The top-level rules of a sheet whose selector matches, each whole. */
  function rulesMatching(css, selector) {
    const out = [];
    let depth = 0;
    let start = 0;
    const text = String(css || '').replace(/\/\*[\s\S]*?\*\//g, '');
    for (let i = 0; i < text.length; i++) {
      if (text[i] === '{') depth++;
      else if (text[i] === '}') {
        depth--;
        if (depth === 0) {
          const rule = text.slice(start, i + 1).trim();
          const head = rule.slice(0, rule.indexOf('{'));
          if (!head.trim().startsWith('@') && selector.test(head)) out.push(rule);
          start = i + 1;
        }
      }
    }
    return out.join('\n');
  }

  /**
   * The panel's markup without the tab button the app lifts out of it, and
   * without images of the app's own, which a file on its own cannot reach.
   */
  const panelBody = (html) => String(html || '')
    .replace(/<template data-mode-tab>[\s\S]*?<\/template>/, '')
    .replace(/<img\b[^>]*\ssrc="\/[^"]*"[^>]*>/g, '')
    .trim();

  /**
   * JSON that can sit inside a script element: every "<" in a value is written
   * as its escape, so no record can close the element or open a comment, and
   * so are the two characters JSON allows that JavaScript takes as line breaks.
   */
  const scriptJson = (value) => JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

  /** Code that can sit inside a script element, however it was written. */
  const scriptCode = (code) => String(code || '').replace(/<\/(script)/gi, '<\\/$1').replace(/<!--/g, '<\\!--');

  /**
   * In a browser there is no save dialog of the app's, so a file is saved by
   * download; the app's own check for being the desktop app reads false.
   */
  const BROWSER_SHIM = `window.HC = window.HC || { isTauri: false, save: {
    file: async (name, content, opts) => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([content], { type: (opts && opts.mime) || 'text/plain' })); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); return { saved: true }; },
    folder: async () => null } };`;

  /** The whole file. */
  function appHtml({ spec, data, exportedAt, css, scripts, panel }) {
    const title = escapeHtml(spec && spec.name ? spec.name : 'Business system');
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="HashCortX">
<title>${title}</title>
<style>
${String(css || '').replace(/<\/(style)/gi, '<\\/$1')}
html, body { margin: 0; height: 100%; background: var(--bg-0); color: var(--text); font-family: var(--sans); }
</style>
</head>
<body class="system-maker-mode sys-standalone">
${panelBody(panel)}
<script type="application/json" id="hc-system">${scriptJson({ spec, data, exportedAt })}</script>
<script>
${BROWSER_SHIM}
window.HCSystemStandalone = JSON.parse(document.getElementById('hc-system').textContent);
</script>
<script>
${(scripts || []).map(scriptCode).join('\n;\n')}
</script>
<script>window.SystemMaker.mount();</script>
</body>
</html>
`;
  }

  /**
   * The file for a system, its scripts and styles read by `read(path)` — the
   * app passes one that fetches its own files.
   */
  async function build(read, { spec, data, exportedAt }) {
    const [scripts, styles, borrowed, panel] = await Promise.all([
      Promise.all(SCRIPTS.map(read)), Promise.all(STYLES.map(read)), read(BORROWED.file), read('/modes/systems/panel.html'),
    ]);
    return appHtml({
      spec: { ...spec, revisionHistory: [] }, data, exportedAt,
      css: [...styles, rulesMatching(borrowed, BORROWED.selector)].join('\n'), scripts, panel,
    });
  }

  window.HCSystemsExportApp = { SCRIPTS, STYLES, BORROWED, rulesMatching, panelBody, scriptJson, scriptCode, appHtml, build };
})();
