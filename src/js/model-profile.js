// ==============================================================
// One profile per model family
//
// Model families differ in ways a harness has to know. Some think before
// they answer and refuse the next request unless that thinking comes back
// with the tool work; some throw it away; some refuse a sampling setting;
// some want every result of one turn in one message. What each family needs
// is written here once, as data, so the parts that build a request ask this
// file instead of each knowing a little.
//
// Matching is by provider first, then by the model's name, most specific
// first. Thinking is sent back only through the model's own maker: a service
// reselling another maker's model may name the fields its own way. An
// unknown model gets the app's behaviour as it stands exactly.
//
// Each row is confirmed against the maker's guide, named by its title.
//
// Pure. Published as window.HCModelProfile. Checked by scripts/checks/model-profile.mjs.
// ==============================================================
(function () {
  'use strict';

  /** Today's behaviour, for a model no row knows. */
  const UNKNOWN = Object.freeze({
    family: 'unknown', thinks: 'unknown', carry: 'never', carryField: null,
    sampling: { send: true, temperature: null, top_p: null, top_k: null, own: false },
    callsAtOnce: true, resultsTogether: false, markFailed: false, effort: null, strong: false,
  });

  /** A model on this computer keeps its own packaged settings (read only once own settings are switched on). */
  const LOCAL_OWN = { send: true, temperature: null, top_p: null, top_k: null, own: true };
  const NO_SAMPLING = { send: false, temperature: null, top_p: null, top_k: null, own: false };

  /**
   * The rows, most specific first. `where` is 'cloud', 'local' or 'any';
   * `makers` are the providers through which thinking is sent back; a row's
   * `thinks: 'info'` takes it from what the model on this computer says it
   * can do.
   */
  const ROWS = [
    // DeepSeek's guide, "Thinking Mode": with tools, reasoning_content goes back in every later request; sampling settings are not used.
    { family: 'deepseek', where: 'cloud', name: /deepseek[-/_.]?(?:reasoner|r1)|deepseek-v3\.[1-9].*think|deepseek-v4/i, makers: ['deepseek'], thinks: 'always', carry: 'required', carryField: 'reasoning_content', sampling: NO_SAMPLING },
    { family: 'deepseek', where: 'cloud', name: /deepseek/i, thinks: 'never' },
    // Kimi's guide, "Use the Kimi K2 Thinking Model": send the whole reply back as it came, reasoning_content included.
    { family: 'kimi', where: 'cloud', name: /kimi.*(?:thinking|k2\.[5-9])/i, makers: ['moonshot'], thinks: 'optional', carry: 'required', carryField: 'reasoning_content' },
    { family: 'kimi', where: 'cloud', name: /kimi|moonshot/i, thinks: 'never' },
    // Z.ai's guide, "Thinking Mode": kept thinking is a choice (clear_thinking), and goes back unchanged as reasoning_content.
    { family: 'glm', where: 'cloud', name: /glm-?(?:4\.[5-9]|[5-9])/i, makers: ['zai'], thinks: 'optional', carry: 'recommended', carryField: 'reasoning_content' },
    // MiniMax's guide, "Text: OpenAI-compatible": its thinking travels in the answer's text or its own field; neither is read here yet, so nothing changes.
    { family: 'minimax', where: 'cloud', name: /minimax/i, thinks: 'always' },
    // Anthropic's guide, "Extended thinking": thinking takes no sampling settings, and none is asked of it here, so its
    // temperature is sent as today; results of one turn go back together. Its thinking blocks are not sent back (carry stays never).
    { family: 'claude', where: 'cloud', name: /claude/i, thinks: 'optional', carryField: 'blocks', resultsTogether: true, markFailed: true },
    // OpenAI's guide, "Reasoning models": no temperature or top_p; reasoning_effort takes low, medium or high.
    { family: 'gpt', where: 'cloud', name: /^(?:openai\/)?(?:o\d|gpt-5)/i, thinks: 'always', sampling: NO_SAMPLING, effort: { field: 'reasoning_effort', levels: ['low', 'medium', 'high'] } },
    { family: 'gpt', where: 'cloud', name: /gpt|^(?:openai\/)/i, thinks: 'never' },
    // Google's guide, "Gemini 3 Developer Guide": keep temperature at 1.0; thought signatures are already returned (js/agent-shape.js).
    { family: 'gemini', where: 'cloud', name: /gemini-?3/i, thinks: 'optional', sampling: { send: true, temperature: 1.0, top_p: null, top_k: null, own: false } },
    { family: 'gemini', where: 'cloud', name: /gemini/i, thinks: 'optional' },
    { family: 'grok', where: 'cloud', name: /grok/i, thinks: 'unknown' },
    // Qwen's model cards, "Best Practices": the coding models do not think.
    { family: 'qwen-coder', where: 'local', name: /qwen[\d.]*-coder/i, thinks: 'never', sampling: LOCAL_OWN },
    // Qwen3's model card, "Best Practices": thinking mode at 0.6, top_p 0.95, top_k 20; not greedy.
    { family: 'qwen3', where: 'local', name: /qwen3/i, thinks: 'info', carryWhenThinks: 'recommended', carryField: 'thinking', sampling: { send: true, temperature: 0.6, top_p: 0.95, top_k: 20, own: true } },
    // The families below think only where the model on this computer says it can; their packaged settings are kept.
    { family: 'gemma', where: 'local', name: /gemma/i, thinks: 'info', carryWhenThinks: 'recommended', carryField: 'thinking', sampling: LOCAL_OWN },
    { family: 'llama', where: 'local', name: /llama/i, thinks: 'info', carryWhenThinks: 'recommended', carryField: 'thinking', sampling: LOCAL_OWN },
    { family: 'phi', where: 'local', name: /phi/i, thinks: 'info', carryWhenThinks: 'recommended', carryField: 'thinking', sampling: LOCAL_OWN },
    { family: 'mistral', where: 'local', name: /mistral|ministral|devstral/i, thinks: 'info', carryWhenThinks: 'recommended', carryField: 'thinking', sampling: LOCAL_OWN },
    { family: 'granite', where: 'local', name: /granite/i, thinks: 'info', carryWhenThinks: 'recommended', carryField: 'thinking', sampling: LOCAL_OWN },
    { family: 'nemotron', where: 'local', name: /nemotron/i, thinks: 'info', carryWhenThinks: 'recommended', carryField: 'thinking', sampling: LOCAL_OWN },
  ];

  // ── Strong enough to start sub-agents ────────────────────────────────
  //
  // A sub-agent (js/code/delegate.js) is offered only to a model rated
  // strong: these families on a cloud service, and any model of 120 billion
  // parameters or more, by the size its model app reports or, failing that,
  // its name. The list is a choice, not a measurement, which is why
  // sub-agents also stay switched off until a person turns them on.
  const STRONG_BILLIONS = 120;
  const STRONG = [
    /claude.*(?:opus|sonnet)/i,                                     // Claude Opus and Sonnet, not Haiku
    /^(?:openai\/)?(?:gpt-5|o[1-9])(?![\w.-]*(?:mini|nano))/i,      // GPT-5 and the o models, not mini or nano
    /gemini[\w.-]*-pro\b/i,                                         // Gemini Pro, not Flash
    /deepseek[-_.]?(?:v(?:[3-9]|\d{2})|r1|reasoner|chat)(?![\w.-]*distill)/i,   // DeepSeek from V3, not a model distilled from it
    /kimi/i,                                                        // Kimi
  ];

  /** `{ provider, id }` of a model value: `cloud:<provider>:<id>`, or a model on this computer. */
  function parse(value) {
    const v = String(value || '');
    const N = typeof window !== 'undefined' && window.HCModelNames;
    if (v.startsWith('cloud:')) {
      const p = N && N.parseCloudModel ? N.parseCloudModel(v) : { provider: v.split(':')[1] || '', modelId: v.split(':').slice(2).join(':') };
      return { cloud: true, provider: p.provider, id: p.modelId };
    }
    return { cloud: false, provider: '', id: v };
  }

  const copy = (p) => JSON.parse(JSON.stringify(p));

  /**
   * The profile of a model: its family, whether it thinks, whether its
   * thinking goes back with tool work and in which field, the sampling it
   * takes, and how its results are sent. `info` is what a model on this
   * computer says of itself (js/local-context.js infoOf: `caps`).
   */
  function of(value, info = null) {
    const { cloud, provider, id } = parse(value);
    if (!id) return copy(UNKNOWN);
    const rated = (p) => Object.assign(p, { strong: strongOf(cloud, id, info) });
    const row = ROWS.find((r) => (r.where === 'any' || (r.where === 'cloud') === cloud) && r.name.test(id));
    if (!row) return rated(copy(UNKNOWN));
    const caps = info && Array.isArray(info.caps) ? info.caps : [];
    const thinks = row.thinks === 'info' ? (caps.includes('thinking') ? 'optional' : 'never') : row.thinks;
    const byMaker = !row.makers || row.makers.includes(provider);
    const carry = row.thinks === 'info' ? (thinks === 'never' ? 'never' : row.carryWhenThinks) : byMaker ? (row.carry || 'never') : 'never';
    return rated(copy({
      family: row.family,
      thinks,
      carry,
      carryField: carry === 'never' && row.carryField !== 'blocks' ? null : row.carryField || null,
      sampling: row.sampling || UNKNOWN.sampling,
      callsAtOnce: true,
      resultsTogether: !!row.resultsTogether,
      markFailed: !!row.markFailed,
      effort: row.effort || null,
      strong: false,
    }));
  }

  /** Whether a model is rated strong: its size, as its model app reports it or its name says, or its family on a cloud service. */
  function strongOf(cloud, id, info) {
    const L = typeof window !== 'undefined' && window.HCCodeLight;
    const billions = info && Number.isFinite(info.billions) ? info.billions : L && L.billionsInName ? L.billionsInName(id) : null;
    if (billions >= STRONG_BILLIONS) return true;
    return cloud && STRONG.some((rx) => rx.test(id));
  }

  // ── Each model's recommended temperature, by the person's choice ───────
  //
  // HashCoder's temperature slider always holds a value, so a family's own
  // value would never be used. Switched on in Settings → HashCoder, a model
  // whose maker recommends one is sent it in place of the slider's; off to
  // begin with, so nothing changes until the person chooses.

  const FAMILY_TEMP_KEY = 'hc_family_temperature';
  const storeOf = (s) => { if (s) return s; try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; } };

  /** Whether each model's recommended temperature is used in place of the slider's. */
  function familyTemperature(s) {
    try { const st = storeOf(s); return !!st && st.getItem(FAMILY_TEMP_KEY) === 'on'; } catch { return false; }
  }
  /** Switch it on or off. */
  function setFamilyTemperature(on, s) {
    try { const st = storeOf(s); if (!st) return; if (on) st.setItem(FAMILY_TEMP_KEY, 'on'); else st.removeItem(FAMILY_TEMP_KEY); } catch { /* left as it was */ }
  }

  // ── Thinking on or off, step by step, for a model on this computer ─────
  //
  // A thinking model spends most of a short step thinking. For an answer
  // held to a shape, a step held short, or a step offered no tools (small
  // talk, light mode), it is told not to; otherwise it decides. Off until a
  // measured run on a thinking model shows no loss: until then nothing is said.

  /** `false` to tell a model on this computer not to think on this step, or undefined to leave it to decide. */
  function thinkFor(profile, { json = false, most = 0, tools = 0 } = {}) {
    if (!published.THINK_PER_STEP || !profile || (profile.thinks !== 'optional' && profile.thinks !== 'always')) return undefined;
    return json || most > 0 || !tools ? false : undefined;
  }

  // ── Effort, by the task ───────────────────────────────────────────────

  /**
   * The effort a model that takes the setting is asked for: low for small
   * talk and a helper that only explores, high for a request of five asks or
   * more or a plan of five steps or more, and null (the provider's own)
   * otherwise. Null for a model that takes no effort setting.
   */
  function effortFor(profile, { smallTalk = false, explore = false, asks = 0, steps = 0 } = {}) {
    const e = profile && profile.effort;
    if (!e || !Array.isArray(e.levels)) return null;
    if ((smallTalk || explore) && e.levels.includes('low')) return 'low';
    if ((asks >= 5 || steps >= 5) && e.levels.includes('high')) return 'high';
    return null;
  }

  const published = { UNKNOWN, ROWS, STRONG, STRONG_BILLIONS, of, FAMILY_TEMP_KEY, familyTemperature, setFamilyTemperature, THINK_PER_STEP: false, thinkFor, effortFor };
  window.HCModelProfile = published;
})();
