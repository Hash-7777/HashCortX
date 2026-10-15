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
// THE WINDOW A MODEL IS ALREADY LOADED WITH IS KEPT. Ollama loads a model
// again whenever a request names a different window, and reads the whole
// request again, which costs seconds before the first word. So a request that
// fits the window last sent for that model reuses it.
//
// UNLESS THAT WINDOW PUSHED THE MODEL OFF THE GRAPHICS CHIP. A window's memory
// comes out of what the model's own layers could use, and on a computer with
// little memory a large one leaves some layers in main memory, where every
// word is several times slower. After each answer the app asks Ollama how
// much of the model it holds on the graphics chip at that window (measure).
// A window known to hold it all is kept whatever the request needs; one known
// to spill is given up for the smaller one the request needs; one not yet
// measured is kept while it is no more than twice what is needed. The
// smallest step is 4,096, the window Ollama gives a model by itself on such a
// computer.
//
// WHAT A MODEL CAN DO is read from the same answer as its window: whether it
// takes tools, reads pictures, or only turns text into vectors for search.
//
// Published as window.HCLocalContext. Checked by scripts/checks/local-context.mjs.
// ============================================================
(function () {
  "use strict";

  const STEPS = [4096, 8192, 16384, 32768];
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

  const known = new Map();   // host|model -> what the model is

  /** A parameter count as Ollama writes it ("3.1B", "770M"), in billions, or null. */
  function billionsOf(text) {
    const m = /^\s*([\d.]+)\s*([BMK])\b/i.exec(String(text || ""));
    if (!m) return null;
    const n = parseFloat(m[1]);
    return Number.isFinite(n) ? n * ({ b: 1, m: 1e-3, k: 1e-6 }[m[2].toLowerCase()]) : null;
  }

  /**
   * What a local model is, from Ollama, asked once and remembered: its own
   * window (`max`), what it can do (`caps`: "tools", "thinking", "vision",
   * "embedding", "completion") and its size in billions of parameters. When
   * Ollama cannot say, the ceiling stands and nothing is assumed about the rest.
   */
  async function infoOf(host, model, fetchFn = (...a) => fetch(...a)) {
    const key = `${host}|${model}`;
    if (known.has(key)) return known.get(key);
    const info = { max: CEILING, caps: null, billions: null };
    // A model on another local app is not Ollama's to describe.
    if (/^local:/.test(String(model))) return info;
    try {
      const r = await fetchFn(`${host}/api/show`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model }) });
      if (r.ok) {
        const data = await r.json();
        const len = Object.entries(data.model_info || {}).find(([k]) => /\.context_length$/.test(k));
        if (len && Number(len[1]) > 0) info.max = Number(len[1]);
        if (Array.isArray(data.capabilities)) info.caps = data.capabilities.map(String);
        info.billions = billionsOf(data.details && data.details.parameter_size);
      }
    } catch { /* unknown: the ceiling stands */ }
    known.set(key, info);
    return info;
  }

  /** Whether a model can do something. Unknown counts as yes, so an older Ollama loses nothing. */
  const can = (info, cap) => !info || !Array.isArray(info.caps) || info.caps.includes(cap);

  /** A model only for turning text into vectors, which cannot hold a conversation. */
  const embedsOnly = (info) => !!info && Array.isArray(info.caps) && info.caps.includes("embedding") && !info.caps.includes("completion");

  /**
   * Why a request cannot go to a model as it stands, in words a person can act
   * on, or null. Ollama's own refusal names no model and arrives as nested JSON.
   */
  function refusalFor(info, model, messages) {
    if (embedsOnly(info)) return `${model} is a model for search, not conversation. Pick another model to chat with.`;
    const pictures = (Array.isArray(messages) ? messages : []).some((m) => m && Array.isArray(m.images) && m.images.length);
    if (pictures && !can(info, "vision")) return `${model} cannot see pictures. Pick a model that can, or send the message without the picture.`;
    return null;
  }

  /** The model's own context length, from Ollama, remembered; the ceiling when it does not say. */
  async function limitOf(host, model, fetchFn) {
    return (await infoOf(host, model, fetchFn)).max;
  }

  const sent = new Map();   // host|model -> the window last sent for it
  const onChip = new Map();   // host|model|window -> share of the model on the graphics chip, 0 to 1

  /** Record how much of a model sat on the graphics chip at a window. */
  function placed(host, model, numCtx, share) {
    if (Number.isFinite(numCtx) && Number.isFinite(share)) onChip.set(`${host}|${model}|${numCtx}`, Math.max(0, Math.min(1, share)));
  }
  /** The share recorded for a window, or undefined when it has not been measured. */
  const shareAt = (key, w) => onChip.get(`${key}|${w}`);

  /**
   * Ask Ollama how much of a loaded model is on the graphics chip, and keep
   * it for the window it was loaded at. Resolves to the share, or null when
   * Ollama does not say (another local app, an older Ollama, no answer).
   */
  async function measure(host, model, numCtx, fetchFn = (...a) => fetch(...a)) {
    if (!host || !model || /^(?:cloud|local):/.test(String(model)) || !Number.isFinite(numCtx)) return null;
    try {
      const r = await fetchFn(`${host}/api/ps`);
      if (!r || !r.ok) return null;
      const m = ((await r.json()).models || []).find((x) => x && (x.name === model || x.model === model));
      if (!m || !(m.size > 0) || !Number.isFinite(m.size_vram)) return null;
      const share = m.size_vram / m.size;
      placed(host, model, Number(m.context_length) || numCtx, share);
      return share;
    } catch { return null; }
  }

  /**
   * The window to send. The one the model is loaded with, when it holds the
   * request and is known to keep the model on the graphics chip, or is not
   * yet measured and no more than twice what is needed; otherwise the
   * smallest step that holds the request. `floor` is a window the caller
   * wants at least.
   */
  function pick(key, size, floor, max) {
    const needed = Math.max(size, Math.min(Number(floor) || 0, max));
    const last = sent.get(key);
    const share = last ? shareAt(key, last) : undefined;
    const keep = !!last && last >= needed && last <= max && (share === undefined ? last <= needed * 2 : share >= 0.999 || needed >= last);
    const chosen = keep ? last : needed;
    sent.set(key, chosen);
    return chosen;
  }

  /**
   * `num_ctx` for a request to a local model, or an error that says why it
   * cannot be sent whole. The error reads as a request too large, so the
   * routing treats it as one.
   */
  async function numCtx(host, model, messages, { need, floor, fetchFn } = {}) {
    const max = await limitOf(host, model, fetchFn);
    const size = sizeFor(messages, { need, max });
    if (size.ok) return pick(`${host}|${model}`, size.numCtx, floor, max);
    throw new Error(`request too large for ${model}: about ${size.wanted.toLocaleString("en-US")} tokens against the ${size.numCtx.toLocaleString("en-US")} it can be given. Shorten it, or pick a model with more room.`);
  }

  /** Forget what was sent, so a model loaded again elsewhere is sized afresh. */
  const forget = (host, model) => sent.delete(`${host}|${model}`);

  window.HCLocalContext = { tokensOf, sizeFor, infoOf, limitOf, billionsOf, can, embedsOnly, refusalFor, numCtx, forget, placed, measure, STEPS, CEILING };
})();
