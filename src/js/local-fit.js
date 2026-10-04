// ============================================================
// local-fit.js — whether a model on this computer fits where it runs
//
// A model is fastest when all of it sits in the graphics chip's memory.
// When it does not fit, Ollama keeps some of it in main memory and runs that
// part on the processor: every answer is slower, the processor works harder,
// and the computer has less memory left for everything else. Ollama says how
// much of a loaded model is where, in the list of loaded models (/api/ps):
// the model's size and how much of it is in graphics memory.
//
//   • All of it in graphics memory: fits. Nothing to say.
//   • None of it there: this computer has no graphics chip Ollama can use
//     (or none is in use), so there is nothing to spill from. Nothing to say;
//     the speed figure in js/local-speed.js already shows what it costs.
//   • Some of it there: it spills, and that is said, with how much runs on
//     the processor, how fast the model has been writing here when that is
//     known, and what would fit.
//
// Only a model that is loaded can be judged, so this is read after a model
// has answered. A model on another local app, or in the cloud, is not one
// this describes.
//
// Pure apart from the request it is given. Published as window.HCLocalFit.
// Checked by scripts/checks/local-fit.mjs.
// ============================================================
(function () {
  "use strict";

  /** Within this share of its size in graphics memory counts as all of it. */
  const FITS = 0.98;

  const measured = (model) => !!model && !/^(?:cloud|local):/.test(String(model));

  /** The loaded model called `model` in Ollama's answer, `{ size, vram }`, or null. */
  function find(answer, model) {
    const list = answer && (Array.isArray(answer.models) ? answer.models : Array.isArray(answer.processes) ? answer.processes : []);
    const hit = (list || []).find((m) => m && (m.model === model || m.name === model));
    if (!hit) return null;
    const size = Number(hit.size);
    const vram = Number(hit.size_vram);
    return Number.isFinite(size) && size > 0 && Number.isFinite(vram) && vram >= 0 ? { size, vram } : null;
  }

  /** `{ state: 'fits' | 'spills' | 'cpu', onGraphics, onProcessor, gb, spillGb }` for a loaded model, or null when it cannot be told. */
  function judge(entry) {
    if (!entry || !(entry.size > 0)) return null;
    const share = Math.min(1, entry.vram / entry.size);
    const base = { onGraphics: share, onProcessor: 1 - share, gb: entry.size / 1e9, spillGb: Math.max(0, entry.size - entry.vram) / 1e9 };
    if (entry.vram <= 0) return { state: "cpu", ...base };
    if (share >= FITS) return { state: "fits", ...base };
    return { state: "spills", ...base };
  }

  const oneDecimal = (n) => (Math.round(n * 10) / 10).toFixed(1);

  /**
   * What to tell the person about a model that spills, or '' for one that does
   * not. `tokensPerSecond` is how fast it has been writing here, if known.
   */
  function warning(model, verdict, tokensPerSecond) {
    if (!verdict || verdict.state !== "spills") return "";
    const percent = Math.round(verdict.onProcessor * 100);
    const speed = Number(tokensPerSecond) > 0 ? ` It has been writing about ${Math.round(tokensPerSecond)} tokens a second here.` : "";
    return `${model} does not fit in the graphics memory: about ${percent}% of it (${oneDecimal(verdict.spillGb)} GB) runs on the processor and in main memory, so answers are slower and the computer is under more load.${speed} A smaller model, or a shorter conversation, would fit.`;
  }

  /** Ask which part of `model` is in graphics memory. Resolves to a verdict, or null when it is not loaded or cannot be told. */
  async function read(host, model, { fetchFn = (...a) => fetch(...a), ms = 3000 } = {}) {
    if (!host || !measured(model)) return null;
    const stop = typeof AbortController === "function" ? new AbortController() : null;
    const timer = stop ? setTimeout(() => stop.abort(), ms) : null;
    try {
      const r = await fetchFn(`${host}/api/ps`, { cache: "no-store", ...(stop ? { signal: stop.signal } : {}) });
      if (!r || !r.ok) return null;
      return judge(find(await r.json(), model));
    } catch { return null; } finally { if (timer) clearTimeout(timer); }
  }

  /** The sentence for a loaded model, or '' when it fits, runs on the processor alone, is not loaded, or cannot be told. */
  async function describe(host, model, opts = {}) {
    const verdict = await read(host, model, opts);
    const speed = typeof window !== "undefined" && window.HCLocalSpeed && window.HCLocalSpeed.tokensPerSecond ? window.HCLocalSpeed.tokensPerSecond(host, model) : null;
    return warning(model, verdict, opts.tokensPerSecond != null ? opts.tokensPerSecond : speed);
  }

  window.HCLocalFit = { FITS, find, judge, warning, read, describe };
})();
