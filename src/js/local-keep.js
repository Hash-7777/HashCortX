// ============================================================
// local-keep.js — how long a model on this computer stays loaded
//
// A model Ollama has loaded holds its weights and its window in memory until
// it has not been asked for something for a while. Ollama's own setting is
// five minutes unless it has been changed on the server, and that is what
// stands until the person chooses a time here.
//
// On a computer short of memory a model held for five minutes after the last
// answer is memory other programs are waiting for, so the time is the
// person's to change. A shorter one frees it sooner; a longer one answers the
// next message without loading the model again.
//
// What is offered, and what is not:
//
//   • Never for good. A model kept loaded for good is never given up, and one
//     marked to make room for another is kept by the next request to it
//     (js/local-client.js).
//   • Never at once. Ollama keeps what it has read of a conversation only
//     while the model is loaded, so unloading after every answer makes every
//     step of an agent read the whole conversation again.
//   • Not under two minutes. A step an agent waits on, such as a test run,
//     counts from the end of the last answer; a longer step loads the model
//     again, and the setting says so.
//
// The choice is read at each request, so a change applies to the next one.
// Published as window.HCLocalKeep. Checked by scripts/checks/local-keep.mjs.
// ============================================================
(function () {
  'use strict';

  const KEY = 'hc_local_keep_alive';

  /** The times offered, as Ollama writes a lifetime. The first leaves it to Ollama. */
  const OPTIONS = [
    { value: '', label: "Ollama's own setting (five minutes unless changed there)" },
    { value: '2m', label: '2 minutes' },
    { value: '5m', label: '5 minutes' },
    { value: '10m', label: '10 minutes' },
    { value: '30m', label: '30 minutes' },
    { value: '1h', label: '1 hour' },
  ];
  const OFFERED = new Set(OPTIONS.map((o) => o.value));

  const store = () => { try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; } };

  /** The time chosen, or '' to leave it to Ollama. Anything not offered counts as not chosen. */
  function value(s = store()) {
    try {
      const v = s ? String(s.getItem(KEY) || '') : '';
      return OFFERED.has(v) ? v : '';
    } catch { return ''; }
  }

  /** Keep a choice. False when it is not one of those offered or could not be kept. */
  function set(v, s = store()) {
    const next = String(v == null ? '' : v);
    if (!OFFERED.has(next)) return false;
    try {
      if (!s) return false;
      if (next) s.setItem(KEY, next); else s.removeItem(KEY);
      return true;
    } catch { return false; }
  }

  /** Fill the setting's menu and keep what is chosen in it, once it is on the page. */
  function wire(doc = typeof document !== 'undefined' ? document : null) {
    const menu = doc && doc.getElementById('localKeepAlive');
    if (!menu || menu.dataset.wired) return;
    menu.dataset.wired = '1';
    for (const o of OPTIONS) {
      const item = doc.createElement('option');
      item.value = o.value;
      item.textContent = o.label;
      menu.appendChild(item);
    }
    menu.value = value();
    menu.addEventListener('change', () => { if (!set(menu.value)) menu.value = value(); });
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => wire());
    else wire();
  }

  window.HCLocalKeep = { KEY, OPTIONS, value, set, wire };
})();
