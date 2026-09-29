// ==============================================================
// What HashCoder tells a model beside the person's words
//
// The instructions stay the same for every request of a conversation. A
// provider, or a model on this computer, can reuse the work of reading the
// start of a request only while that start does not change, and in a
// coding run the same start is read again at every step. So what belongs to
// one request goes with that request, read after the person's own words
// (js/agent-context.js withContext): the bar a site is held to, the file
// open, and remembered facts that bear on the request.
//
// Pure: takes strings and lists, returns strings. No DOM, no storage.
//
// Loaded before the Coder mode and published as window.HCCodeContext.
// Checked by scripts/checks/code-context.mjs.
// ==============================================================

(function () {
  'use strict';

  /** How the app's addition to a request begins, so it is never read as the person's. */
  const FROM_APP = 'For this request, from HashCortX (not from the person):';

  /**
   * The app's addition to one request, or '' when there is none. `site` is
   * the bar a site is held to when the request builds one; `activeFile` the
   * file open in the project, if any; `facts` remembered facts that bear on
   * the request, as `{ key, value }`.
   */
  function forRequest({ site = '', activeFile = '', facts = [] } = {}) {
    const lines = [];
    if (site) lines.push(String(site));
    if (activeFile) lines.push(`Active file: ${activeFile}`);
    const known = (Array.isArray(facts) ? facts : []).filter((f) => f && f.key);
    if (known.length) {
      lines.push('Memory (silent context, do not recite):');
      known.forEach((f) => lines.push(`  - ${f.key}: ${String(f.value).slice(0, 120)}`));
    }
    return lines.length ? [FROM_APP, ...lines].join('\n') : '';
  }

  window.HCCodeContext = { FROM_APP, forRequest };
})();
