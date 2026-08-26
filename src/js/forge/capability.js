// ============================================================
// capability.js — which of a person's models can actually do geometry
//
// Designing a part is not chatting. The model has to hold a shape in mind,
// place a dozen things in three dimensions, keep them touching, and answer in
// strict JSON. Plenty of models that write perfectly good prose produce a pile
// of disconnected boxes here, and the person watching has no way to know that
// the problem was the model rather than the app.
//
// So the app says so, before the run rather than after it.
//
// WHAT THIS IS HONEST ABOUT. Every judgement here is made from the model's NAME
// and nothing else. There is no capability list to query and no benchmark being
// run: a name mentioning seventy billion parameters is taken at its word, and a
// model whose name says nothing is judged unknown rather than judged badly.
// That is a guess, it is described as one wherever it is shown, and it is the
// same guess the router was already making silently to choose a model — the
// difference is that it is now written down and can be checked.
//
// Pure: strings in, a verdict out. No THREE, no DOM, no network, no clock.
//
// Run the checks with: npm run check:forge-capability
// ============================================================
(function () {
  "use strict";

  const text = (value, label) => `${value || ""} ${label || ""}`.toLowerCase();

  /** A free tier, by the way providers spell one. */
  function isFree(value, label) {
    return /:free|\bfree\b/.test(text(value, label));
  }

  /**
   * How many billions of parameters a name claims, or zero when it says
   * nothing. Zero means UNKNOWN, never small.
   */
  function sizeOf(value, label) {
    const s = text(value, label);
    let best = 0;
    for (const match of s.matchAll(/(\d+(?:\.\d+)?)\s*b\b/g)) best = Math.max(best, Number(match[1]) || 0);
    // Named rather than numbered in most of its spellings.
    if (/gpt[-_\s]?oss.*120|120.*gpt[-_\s]?oss/.test(s)) best = Math.max(best, 120);
    if (/405b|480b|671b/.test(s)) best = Math.max(best, Number((s.match(/(405|480|671)b/) || [0, 0])[1]) || 0);
    return best;
  }

  /**
   * A rough ordering, used to pick between models rather than to judge one.
   *
   * `bigTask` is the geometry case: it weighs size harder and penalises the
   * small and the rate-limited, because a design call is one long answer that
   * has to be right all the way through rather than a paragraph that can be
   * carried by a good first sentence.
   */
  function strengthOf(value, label, bigTask) {
    const s = text(value, label);
    let score = 0;
    const size = sizeOf(value, label);
    if (/gpt[-_\s]?oss/.test(s)) score += 95;
    if (/pro|opus|sonnet|gpt-4|gpt-5|o3|o4|r1|v3|405b|235b|120b|70b|large|max|maverick|nemotron|hermes|qwen3|deepseek/.test(s)) score += 70;
    if (size >= 120) score += 52;
    else if (size >= 100) score += 38;
    else if (size >= 70) score += bigTask ? 12 : 18;
    if (size > 0 && size < 70) score -= bigTask ? 18 : 8;
    if (/coder|code|dev|reason|thinking|instruct|chat/.test(s)) score += 18;
    if (/vision|vl|multi/.test(s)) score += 10;
    if (/flash|lite|mini|small|tiny|1b|1\.5b|3b|7b|8b|instant/.test(s)) score -= bigTask ? 35 : 12;
    if (isFree(value, label)) score -= bigTask ? 28 : 10;
    if (/local/.test(s)) score -= bigTask ? 12 : 0;
    if (/nvidia|samba|openrouter|gemini|groq|cerebras/.test(s)) score += 8;
    return score;
  }

  // What a name has to claim before geometry is worth expecting from it.
  // Seventy billion is where models start reliably holding a dozen parts in
  // three dimensions at once and answering in strict JSON at the same time.
  const GEOMETRY_SIZE = 70;

  /**
   * Whether to expect geometry from this model, and why in one phrase.
   *
   * Three answers, not two. A model whose name says nothing about its size is
   * UNKNOWN — most local models and plenty of hosted ones — and calling that a
   * no would be judging a model on its name being uninformative.
   */
  function geometryVerdict(value, label) {
    const s = text(value, label);
    const size = sizeOf(value, label);
    if (/flash|lite|mini|small|tiny|instant/.test(s) || (size > 0 && size < 8)) {
      return { verdict: "no", why: "small models describe a shape well and rarely place one" };
    }
    if (size >= GEOMETRY_SIZE) {
      return isFree(value, label)
        ? { verdict: "maybe", why: "big enough, but a free tier runs out part way through a design" }
        : { verdict: "yes", why: "big enough to hold a model in mind while writing it out" };
    }
    if (size > 0) {
      return { verdict: "maybe", why: `${size}B is under the ${GEOMETRY_SIZE}B where parts start landing where they should` };
    }
    if (isFree(value, label)) {
      return { verdict: "maybe", why: "a free tier runs out part way through a design" };
    }
    return { verdict: "unknown", why: "its name says nothing about its size" };
  }

  /**
   * The same judgement over everything a person has set up.
   *
   * `models` is `[{ value, label }]`. The best is chosen by the same ordering
   * the router uses, so what the panel names and what a run reaches for cannot
   * disagree.
   */
  function surveyOf(models) {
    const list = (Array.isArray(models) ? models : []).filter((m) => m && m.value);
    const judged = list.map((m) => ({ ...m, ...geometryVerdict(m.value, m.label) }));
    const able = judged.filter((m) => m.verdict === "yes");
    const ranked = [...judged].sort((a, b) =>
      strengthOf(b.value, b.label, true) - strengthOf(a.value, a.label, true));
    return {
      models: judged,
      total: judged.length,
      able: able.length,
      maybe: judged.filter((m) => m.verdict === "maybe").length,
      best: ranked[0] || null,
      // Said as a sentence here rather than assembled in the panel, so the
      // wording is checked in one place.
      note: !judged.length
        ? "No models are set up yet, so there is nothing to design with."
        : able.length
          ? `${able.length} of your ${judged.length} model${judged.length === 1 ? "" : "s"} should manage geometry.`
          : "None of your models look big enough for geometry — expect plain boxes.",
    };
  }

  window.HCForgeCapability = { isFree, sizeOf, strengthOf, geometryVerdict, surveyOf, GEOMETRY_SIZE };
})();
