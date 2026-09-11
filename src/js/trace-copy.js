// ==============================================================
// A run's trace, as text a person can take away
//
// styles.css switches selection off for the whole application and grants it
// back to a named list — inputs, chat bubbles, pre and code. A trace is on
// neither side of that, so a run could be read and never taken: no selection,
// no copy, and a failover chain that could only be photographed. The Forge
// fixed this for itself; the Agent Swarm and the Systems run log never did.
//
// This is the part every trace shares: a row's cells read in order into one
// line, and a Copy button that puts the whole run on the clipboard — or, when
// the clipboard is refused, selects it so the keyboard still can.
//
// Loaded before the modes and published as window.HCTraceCopy.
// Checked by scripts/checks/trace-copy.mjs.
// ==============================================================

(function () {
  'use strict';

  /** One row as one line: its cells in order, each on one line, the empty ones left out. */
  function rowText(row) {
    return Array.from((row && row.children) || [])
      .map((cell) => String(cell.textContent || '').replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .join('  ');
  }

  /** Every row of a trace under a heading naming the run, or '' when there is none. */
  function asText(host, { rowSelector, title, now = new Date() } = {}) {
    if (!host || !rowSelector) return '';
    const lines = Array.from(host.querySelectorAll(rowSelector)).map(rowText).filter(Boolean);
    if (!lines.length) return '';
    const header = `${title || 'Trace'}  ·  ${now.toLocaleString()}`;
    return [header, '='.repeat(header.length), '', ...lines, ''].join('\n');
  }

  function flash(button, label) {
    if (!button) return;
    const was = button.dataset.label || button.textContent;
    button.dataset.label = was;
    button.textContent = label;
    setTimeout(() => { button.textContent = button.dataset.label; }, 1400);
  }

  /** Put the text on the clipboard; when that is refused, select the trace instead. */
  async function copy(button, text, host) {
    if (!text) { flash(button, 'Empty'); return 'empty'; }
    try {
      await navigator.clipboard.writeText(text);
      flash(button, 'Copied');
      return 'copied';
    } catch {
      if (host) {
        const range = document.createRange();
        range.selectNodeContents(host);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
      }
      flash(button, 'Selected');
      return 'selected';
    }
  }

  /**
   * Wire a Copy button to a trace. `host` is looked up on each press, because
   * some traces are drawn after the button exists.
   */
  function wire(button, { host, rowSelector, title }) {
    if (!button) return;
    button.addEventListener('click', (e) => {
      // The button sits in a header that opens and closes the trace on click.
      e.stopPropagation();
      const el = typeof host === 'function' ? host() : host;
      copy(button, asText(el, { rowSelector, title }), el);
    });
  }

  window.HCTraceCopy = { rowText, asText, copy, wire };
})();
