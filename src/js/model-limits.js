// ==============================================================
// How much a model can be asked to write, and what it will accept
//
// Answers were cut off and requests were refused for reasons the app could
// have known in advance, and did not:
//
//  - No request said how long its answer could be. Two paths capped it at a
//    number written into the code, far below what the models can write, and
//    the rest took whatever each provider defaults to — sometimes a few
//    thousand tokens. A web page stopped mid-tag and was taken as finished.
//  - Every provider's model list says how much each model can read and
//    write, and the app threw that away when it built the menu.
//  - A free account has a budget per minute that counts the question and the
//    longest answer together. A model with one of those cannot be handed a
//    long job at all, and the app kept handing it one.
//  - When a provider refuses a request it says exactly why — the limit, what
//    was asked for, the parameter it does not take — and the app kept only
//    the first two hundred characters of that, to show a person.
//
// So this holds, for each model: what its provider's list says (context and
// longest answer), and what its provider has said when it refused a request
// (a per-minute budget, a smaller limit, a parameter it will not take). From
// those it sizes every request — the longest answer that fits — and it can
// say before a run whether a model can hold a job at all.
//
// A limit a provider states is remembered for two weeks, so the next request
// is right the first time. A per-minute budget belongs to the account, not
// the model, and changes when the account does; Update model lists in
// Settings forgets what was learnt.
//
// Pure apart from the storage it is handed. Published as window.HCModelLimits.
// Checked by scripts/checks/model-limits.mjs.
// ==============================================================

(function () {
  'use strict';

  const LEARNED_KEY = 'hc_model_limits_v1';
  const LEARNED_FOR_MS = 14 * 24 * 60 * 60 * 1000;

  /** The parameter each provider takes for the longest answer, in the OpenAI shape. */
  const MAX_FIELD = {
    openai: 'max_completion_tokens', groq: 'max_completion_tokens', cerebras: 'max_completion_tokens',
    openrouter: 'max_tokens', mistral: 'max_tokens', deepseek: 'max_tokens', moonshot: 'max_tokens',
    samba: 'max_tokens', nvidia: 'max_tokens',
  };
  const OTHER_FIELD = { max_tokens: 'max_completion_tokens', max_completion_tokens: 'max_tokens' };
  /** Parameters a request can do without. Never the model, the messages or the stream itself. */
  const DROPPABLE = new Set(['temperature', 'top_p', 'stream_options', 'max_tokens', 'max_completion_tokens', 'parallel_tool_calls', 'tool_choice', 'reasoning_effort', 'frequency_penalty', 'presence_penalty']);
  /** What Anthropic is asked for when neither its list nor a refusal has said. Every current model takes it. */
  const ANTHROPIC_DEFAULT = 8192;
  /** Tokens counted for each image, rather than the length of its encoding. */
  const IMAGE_TOKENS = 1600;

  const num = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : undefined);
  const providerOf = (value) => {
    const v = String(value || '');
    return v.startsWith('cloud:') ? v.split(':')[1] : 'local';
  };
  const defaultStore = () => {
    try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; }
  };

  // ── what the lists say ────────────────────────────────────────────

  const listed = new Map();

  /** What a provider's list says about a model: context, longest answer, tools. */
  function remember(value, info) {
    if (!value || !info) return;
    const ctx = num(info.ctx);
    const out = num(info.out);
    if (ctx || out || info.tools != null) listed.set(value, { ctx, out, tools: info.tools });
  }

  /** Forget what the lists said — before a fresh set of lists is read. */
  const forgetListed = () => listed.clear();

  // ── what the providers have said when they refused ────────────────

  function readLearned(store) {
    try {
      const parsed = JSON.parse((store && store.getItem(LEARNED_KEY)) || '{}');
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch { return {}; }
  }

  function learnedOf(value, now = Date.now(), store = defaultStore()) {
    const entry = readLearned(store)[value];
    return entry && entry.until > now ? entry : {};
  }

  function writeLearned(value, patch, now, store) {
    if (!store || !value) return false;
    const all = readLearned(store);
    for (const [k, e] of Object.entries(all)) if (!(e && e.until > now)) delete all[k];
    const was = all[value] && all[value].until > now ? all[value] : {};
    const next = { ...was, ...patch, until: now + LEARNED_FOR_MS };
    if (patch.drop) next.drop = [...new Set([...(was.drop || []), ...patch.drop])];
    all[value] = next;
    try { store.setItem(LEARNED_KEY, JSON.stringify(all)); return true; } catch { return false; }
  }

  /** Forget every limit learnt from a refusal — Update model lists does this. */
  function forgetLearned(store = defaultStore()) {
    try { store && store.removeItem(LEARNED_KEY); } catch { /* nothing to undo */ }
  }

  /** Everything known about a model, the tighter of what was listed and what was learnt. */
  function infoOf(value, now = Date.now(), store = defaultStore()) {
    const l = listed.get(value) || {};
    const t = learnedOf(value, now, store);
    const tighter = (a, b) => (a && b ? Math.min(a, b) : a || b);
    return { ctx: tighter(l.ctx, num(t.ctx)), out: tighter(l.out, num(t.out)), tpm: num(t.tpm), tools: l.tools, drop: t.drop || [] };
  }

  // ── sizing a request ──────────────────────────────────────────────

  /**
   * Roughly how many tokens a request's words take. Three characters to a
   * token, which overcounts ordinary prose and is about right for code and
   * JSON — a request sized on too high a guess loses a little room, one sized
   * on too low a guess is refused.
   */
  function estimateTokens(parts) {
    let chars = 0;
    let images = 0;
    const walk = (v, key) => {
      if (v == null) return;
      if (typeof v === 'string') {
        if ((key === 'data' || key === 'url' || key === 'images') && v.length > 2000 && /^(data:|[A-Za-z0-9+/=]{2000})/.test(v)) images++;
        else chars += v.length;
        return;
      }
      if (Array.isArray(v)) { v.forEach((x) => walk(x, key)); return; }
      if (typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, k);
    };
    walk(parts, '');
    return Math.ceil(chars / 3) + images * IMAGE_TOKENS + 16;
  }

  /**
   * The longest answer a request can ask for. Undefined when nothing is
   * known, so the provider's own default stands.
   */
  function room(value, inputTokens, now = Date.now(), store = defaultStore()) {
    const info = infoOf(value, now, store);
    const limits = [];
    if (info.out) limits.push(info.out);
    if (info.ctx) limits.push(info.ctx - inputTokens - Math.max(256, Math.ceil(info.ctx * 0.03)));
    if (info.tpm) limits.push(info.tpm - inputTokens - 128);
    return limits.length ? Math.floor(Math.min(...limits)) : undefined;
  }

  /**
   * Whether a model can hold a job: take `inputTokens` and write at least
   * `need`. A model nothing is known about is given the benefit of the doubt.
   */
  function canHold(value, inputTokens, need, now = Date.now(), store = defaultStore()) {
    const r = room(value, inputTokens, now, store);
    return r === undefined || r >= Math.max(1, need || 1);
  }

  /**
   * A request body, sized for its model. `shape` is how the body is laid out:
   * 'openai' (every provider speaking the OpenAI API), 'anthropic' or
   * 'gemini'. Sets the longest answer that fits, takes out parameters the
   * model has refused, and returns the body.
   */
  function fitBody(shape, value, body, now = Date.now(), store = defaultStore()) {
    if (!body || typeof body !== 'object') return body;
    const info = infoOf(value, now, store);
    const input = estimateTokens([body.messages, body.contents, body.system, body.systemInstruction, body.tools]);
    const max = room(value, input, now, store);
    // A question that leaves no room for an answer is sent without a limit,
    // so the provider refuses it in its own words instead of answering in one token.
    const fits = max !== undefined && max >= 1;
    if (shape === 'gemini') {
      // Gemma on Google's API refuses a system instruction ("developer
      // instruction is not enabled"), so it goes at the head of the first turn.
      if (/^cloud:gemini:gemma-/i.test(value) && body.systemInstruction) {
        const text = ((body.systemInstruction.parts || []).map((p) => p.text || '').join('\n')).trim();
        delete body.systemInstruction;
        if (text) {
          const first = Array.isArray(body.contents) && body.contents[0];
          if (first && first.role !== 'model') first.parts = [{ text }, ...(first.parts || [])];
          else body.contents = [{ role: 'user', parts: [{ text }] }, ...(body.contents || [])];
        }
      }
      if (fits) body.generationConfig = { ...(body.generationConfig || {}), maxOutputTokens: max };
      if (info.drop.includes('temperature') && body.generationConfig) delete body.generationConfig.temperature;
      return body;
    }
    if (shape === 'anthropic') {
      // Anthropic requires the field, so it always gets one.
      body.max_tokens = fits ? max : ANTHROPIC_DEFAULT;
      if (info.drop.includes('temperature')) delete body.temperature;
      return body;
    }
    // The OpenAI shape.
    let field = MAX_FIELD[providerOf(value)] || 'max_tokens';
    if (info.drop.includes(field)) field = OTHER_FIELD[field];
    delete body.max_tokens;
    delete body.max_completion_tokens;
    if (fits && !info.drop.includes(field)) body[field] = max;
    for (const p of info.drop) if (DROPPABLE.has(p) && p !== 'max_tokens' && p !== 'max_completion_tokens') delete body[p];
    return body;
  }

  // ── reading a refusal ─────────────────────────────────────────────

  /** What a refusal says, as limits and parameters — or {} when it says neither. */
  function readRefusal(text) {
    const s = String(text || '');
    const got = {};
    let m;
    if ((m = s.match(/tokens per min(?:ute)?\s*\(TPM\)\s*:\s*Limit\s*(\d+)/i))) got.tpm = +m[1];
    if ((m = s.match(/maximum context length is\s*(\d+)/i)) || (m = s.match(/(\d+) maximum context length/i))
      || (m = s.match(/exceeds? the maximum number of tokens allowed\s*\((\d+)\)/i))
      || (m = s.match(/while limit is\s*(\d+)/i)) || (m = s.match(/prompt is too long: \d+ tokens > (\d+) maximum/i))
      || (m = s.match(/exceed context limit: \d+ \+ \d+ > (\d+)/i))) got.ctx = +m[1];
    if ((m = s.match(/max_tokens: \d+ > (\d+), which is the maximum allowed number of output tokens/i))
      || (m = s.match(/(?:max_completion_tokens|max_tokens|maxOutputTokens)`?\s*(?:must be less than or equal to|must be at most|should be at most|<=)\s*`?(\d+)/i))
      || (m = s.match(/valid range of max_(?:completion_)?tokens is \[\s*1\s*,\s*(\d+)\s*\]/i))
      || (m = s.match(/can only afford\s*(\d+)/i))) got.out = +m[1];
    if ((m = s.match(/supported range is from \d+ \(inclusive\) to (\d+) \(exclusive\)/i))) got.out = +m[1] - 1;
    const drop = new Set();
    const param = (p) => { if (p && DROPPABLE.has(p)) drop.add(p); };
    for (const r of [
      /Unsupported (?:parameter|value):\s*'(\w+)'/gi,
      /"param"\s*:\s*"(\w+)"[^{}]*"code"\s*:\s*"unsupported_(?:parameter|value)"/gi,
      /"code"\s*:\s*"unsupported_(?:parameter|value)"[^{}]*"param"\s*:\s*"(\w+)"/gi,
      /['"`](\w+)['"`] (?:is not supported|is unsupported|are not supported)/gi,
      /property '(\w+)' is unsupported/gi,
      /"loc"\s*:\s*\[\s*"body"\s*,\s*"(\w+)"\s*\][^{}]*Extra inputs are not permitted/gi,
    ]) for (const x of s.matchAll(r)) param(x[1]);
    if (drop.size) got.drop = [...drop];
    return got;
  }

  /**
   * Learn from a refused request, and say whether sending it again — sized by
   * what was learnt — can work. Sending it again is right only when something
   * new was learnt that changes the request, and what is left still holds the
   * question and an answer of at least `need` tokens. Otherwise the job belongs
   * on another model.
   */
  function learn(value, err, inputTokens = 0, need = 0, now = Date.now(), store = defaultStore()) {
    const got = readRefusal(`${(err && err.body) || ''}\n${(err && err.message) || err || ''}`);
    if (!Object.keys(got).length) return { learnt: false, retry: false };
    const before = infoOf(value, now, store);
    const patch = {};
    if (got.tpm && got.tpm !== before.tpm) patch.tpm = got.tpm;
    if (got.ctx && (!before.ctx || got.ctx < before.ctx)) patch.ctx = got.ctx;
    if (got.out && (!before.out || got.out < before.out)) patch.out = got.out;
    const newDrops = (got.drop || []).filter((p) => !before.drop.includes(p));
    if (newDrops.length) patch.drop = newDrops;
    if (!Object.keys(patch).length) return { learnt: false, retry: false };
    writeLearned(value, patch, now, store);
    const r = room(value, inputTokens, now, store);
    return { learnt: true, retry: r === undefined || r >= Math.max(256, need || 0), limits: patch };
  }

  window.HCModelLimits = {
    remember, forgetListed, infoOf, estimateTokens, room, canHold, fitBody, readRefusal, learn, forgetLearned,
    MAX_FIELD, LEARNED_KEY, LEARNED_FOR_MS, ANTHROPIC_DEFAULT,
  };
})();
