// ============================================================
// local-place.js — where a model on this computer runs
//
// Ollama runs a model on the graphics chip when it can and keeps what does
// not fit there in main memory, on the processor. That is right for most
// people and stays the default. Two other choices are the person's to make:
//
//   • Graphics chip only. Every layer of the model goes to the graphics
//     chip. Fastest when the model fits; one that does not fit may fail to
//     load, and the error then says how to go back to Automatic.
//   • Main memory. No layer goes to the graphics chip, so it runs on the
//     processor: slower, and the graphics chip is left free for other work.
//
// Ollama counts this in layers (`num_gpu`). Zero is none; a number above any
// model's layer count is all of them, since Ollama sends no more layers than
// the model has.
//
// Only Ollama is told. Another local model app chooses this in its own
// settings when it loads a model, and the setting says so.
//
// Changing it loads the model again on its next answer, because Ollama keeps
// a model loaded the way its first request asked for. The choice is read at
// each request, so a change applies to the next one.
// Published as window.HCLocalPlace. Checked by scripts/checks/local-place.mjs.
// ============================================================
(function () {
  'use strict';

  const KEY = 'hc_local_place';

  /** The choices offered. The first leaves it to Ollama. */
  const OPTIONS = [
    { value: '', label: 'Automatic: the graphics chip first, the rest in main memory' },
    { value: 'gpu', label: 'Graphics chip only (fastest when the model fits)' },
    { value: 'cpu', label: 'Main memory and processor (slower, leaves the graphics chip free)' },
  ];
  const OFFERED = new Set(OPTIONS.map((o) => o.value));

  /** How many of a model's layers go to the graphics chip, per choice. */
  const LAYERS = { gpu: 999, cpu: 0 };

  const store = () => { try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; } };

  /** The choice made, or '' to leave it to Ollama. Anything not offered counts as not chosen. */
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

  /** The Ollama options for the choice made: `{ num_gpu }`, or nothing for Automatic. */
  function options(s = store()) {
    const v = value(s);
    return v ? { num_gpu: LAYERS[v] } : {};
  }

  /**
   * What to add to a failure from Ollama when the model was asked to sit on
   * the graphics chip alone and the failure reads like it did not fit there.
   * '' otherwise.
   */
  function tooBigHint(message, s = store()) {
    if (value(s) !== 'gpu') return '';
    if (!/out of memory|not enough memory|insufficient memory|requires more|unable to allocate|failed to allocate|runner process has terminated/i.test(String(message || ''))) return '';
    return 'The model may be too big for the graphics chip alone. In Settings, set where local models run to Automatic.';
  }

  /** Fill the setting's menu and keep what is chosen in it, once it is on the page. */
  function wire(doc = typeof document !== 'undefined' ? document : null) {
    const menu = doc && doc.getElementById('localPlace');
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

  window.HCLocalPlace = { KEY, OPTIONS, LAYERS, value, set, options, tooBigHint, wire };
})();
