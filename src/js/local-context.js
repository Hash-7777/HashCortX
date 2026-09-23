// ============================================================
// local-context.js — how much a local model is given room to read
//
// Ollama reads a request into a window of `num_ctx` tokens and, when the
// request is longer, drops the START of it without a word. The start is the
// system prompt: the instructions, the rules and the shape the answer must
// take. The app sent a fixed 8,192 from its agents and nothing at all from
// several modes (Ollama then used the model's default, 4,096 on this machine),
// while an ERP records request alone ran to 44,000 characters. The model
// answered without its instructions and the answer could not be read.
//
// The window is now sized to what is sent, in a few fixed steps so Ollama does
// not reload the model for every request, never past what the model itself
// supports (read once from Ollama and remembered), and never past a ceiling
// that keeps memory in check. A request that still does not fit is refused in
// words, not cut.
//
// Published as window.HCLocalContext. Checked by scripts/checks/local-context.mjs.
// ============================================================
(function () {
  "use strict";

  const STEPS = [8192, 16384, 32768];
  const CEILING = STEPS[STEPS.length - 1];
  const CHARS_PER_TOKEN = 3.2;   // on the safe side: code and JSON pack tighter than prose
  const REPLY_ROOM = 2048;

  /** A rough count of the tokens in messages, erring high. */
  function tokensOf(messages) {
    let chars = 0;
    for (const m of Array.isArray(messages) ? messages : []) {
      if (!m) continue;
      chars += String(m.content || "").length + 16;
      if (Array.isArray(m.tool_calls)) chars += JSON.stringify(m.tool_calls).length;
    }
    return Math.ceil(chars / CHARS_PER_TOKEN);
  }

  /**
   * The window for a request: the smallest step that holds it and its answer,
   * within what the model supports. `{ ok: false }` when it cannot be held.
   */
  function sizeFor(messages, { need = REPLY_ROOM, max = CEILING } = {}) {
    const limit = Math.max(2048, Math.min(Number(max) || CEILING, CEILING));
    const wanted = tokensOf(messages) + Math.max(0, Number(need) || 0);
    const step = STEPS.find((s) => s >= wanted && s <= limit) || (wanted <= limit ? limit : null);
    return step ? { ok: true, numCtx: step, wanted } : { ok: false, numCtx: limit, wanted };
  }

  const known = new Map();   // host|model -> the model's own context length

  /** The model's own context length, from Ollama, remembered; the ceiling when it does not say. */
  async function limitOf(host, model, fetchFn = (...a) => fetch(...a)) {
    const key = `${host}|${model}`;
    if (known.has(key)) return known.get(key);
    let max = CEILING;
    try {
      const r = await fetchFn(`${host}/api/show`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model }) });
      if (r.ok) {
        const info = (await r.json()).model_info || {};
        const len = Object.entries(info).find(([k]) => /\.context_length$/.test(k));
        if (len && Number(len[1]) > 0) max = Number(len[1]);
      }
    } catch { /* unknown: the ceiling stands */ }
    known.set(key, max);
    return max;
  }

  /**
   * `num_ctx` for a request to a local model, or an error that says why it
   * cannot be sent whole. The error reads as a request too large, so the
   * routing treats it as one.
   */
  async function numCtx(host, model, messages, need, fetchFn) {
    const max = await limitOf(host, model, fetchFn);
    const size = sizeFor(messages, { need, max });
    if (size.ok) return size.numCtx;
    throw new Error(`request too large for ${model}: about ${size.wanted.toLocaleString("en-US")} tokens against the ${size.numCtx.toLocaleString("en-US")} it can be given. Shorten it, or pick a model with more room.`);
  }

  window.HCLocalContext = { tokensOf, sizeFor, limitOf, numCtx, STEPS, CEILING };
})();
