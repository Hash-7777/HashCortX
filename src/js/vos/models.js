// ============================================================
// vos/models.js — which model the Virtual OS asks
//
// The Virtual OS has a God Agent that plans and a Worker Agent that writes the
// files, and when a model cannot answer it tries others. Which ones, in what
// order, is decided here, from the models the app offers.
//
// A MODEL'S SIZE IS READ FROM ITS NAME. The list of sizes that stood here had
// no 7b, 4b or 14b, so a local 7B coder counted as large and — named "coder" —
// scored as the strongest worker there was, above every cloud model. A job
// given to a fast cloud model was handed to it and took minutes. And "mini"
// was found inside "gemini", so every Gemini model, Pro included, was small
// and never asked.
//
// THE JOB STAYS ON THE SIDE IT WAS STARTED ON. A local model's job goes only to
// local models, which keeps a task and its files off the cloud, the rule
// js/model-routes.js holds for every mode. A cloud model's job goes only to
// cloud models.
//
// THE CHOSEN MODEL IS ALWAYS ASKED. Only the fallbacks must be large; a small
// model someone picked does the work, where it used to be refused and leave a
// person with only a local model with no agent at all.
//
// Pure: model options in, choices out. Published as window.HCVosModels.
// Run the checks with: npm run check:vos-models
// ============================================================
(function () {
  "use strict";

  const MAX_ROUTES = 6;

  const isLocal = (value) => {
    const R = typeof window !== "undefined" && window.HCModelRoutes;
    return !!value && (R ? R.providerOf(value) === "local" : !String(value).startsWith("cloud:"));
  };

  /** A model's size in billions of parameters when its name says (7b, 1.5b, 3.8-27b), or null. */
  function sizeOf(text) {
    const all = [...String(text).matchAll(/(?:^|[^0-9.])(\d+(?:\.\d+)?)b(?![a-z0-9])/gi)].map((m) => parseFloat(m[1]));
    return all.length ? Math.max(...all) : null;
  }

  const textOf = (opt) => `${(opt && opt.value) || ""} ${(opt && opt.label) || ""}`.toLowerCase();

  function strength(opt, role = "worker") {
    const text = textOf(opt);
    let score = 0;
    const add = (rx, n) => { if (rx.test(text)) score += n; };
    const size = sizeOf(text);
    if (size === null || size >= 70) add(/qwen.*(480b|235b|230b|coder|max|plus)|qwen3.*(235b|230b|30b|coder)|qwq/i, 170);
    add(/480b|235b|230b|405b/i, 120);
    add(/405b|480b|235b|230b|120b|70b|large|pro|r1|deepseek|qwen3 coder|gpt oss 120|nemotron 3 super|maverick|hermes/i, 80);
    add(/llama.*70b|deepseek.*llama.*70b/i, -35);
    add(/32b|30b|26b|17b|scout|versatile/i, 38);
    add(/8b|9b|12b|20b|flash|instant|lite|nano|small/i, -12);
    add(/embedding|rerank|moderation|vision|image|tts|whisper/i, -1000);
    if (String(opt && opt.value).startsWith("cloud:")) score += role === "god" ? 18 : 10;
    if (/gemini.*pro|openrouter|samba|cerebras|groq|nvidia/i.test(text)) score += 12;
    return score;
  }

  function isSmall(opt) {
    const text = textOf(opt);
    if (/embedding|rerank|moderation|vision|image|tts|whisper/i.test(text)) return true;
    if (/llama.*70b|deepseek.*llama.*70b/i.test(text)) return true;
    const size = sizeOf(text);
    if (size !== null && size < 70) return true;
    // Whole words: "mini" inside "gemini" made every Gemini model small, Pro
    // included, so none was ever a worker or a fallback here.
    return /\b(?:flash|instant|lite|nano|small|mini|scout|versatile)\b/i.test(text);
  }

  function isLarge(opt, role = "worker") {
    if (!opt || !opt.value || isSmall(opt)) return false;
    return strength(opt, role) >= 90
      || /qwen.*(480b|235b|230b|coder|max|plus)|480b|235b|230b|405b|120b|gpt[-_\s]*oss[-_\s]*120|deepseek.*r1|gemini.*pro/i.test(textOf(opt));
  }

  const sameSide = (a, b) => isLocal(a) === isLocal(b);

  /** The worker for a job the God Agent's model started: the strongest large model on its side, or that model itself. */
  function workerFor(godValue, options) {
    const large = (options || []).filter((o) => sameSide(godValue, o.value) && isLarge(o, "worker"));
    if (!large.length) return godValue;
    const score = (o) => strength(o, "worker") + (o.value === godValue ? -6 : 0);
    return large.slice().sort((a, b) => score(b) - score(a))[0].value;
  }

  /** The models to ask in turn: the chosen one first, then the strongest large ones on its side. */
  function routes(preferredValue, role, options) {
    const opts = options || [];
    const out = [];
    const seen = new Set();
    const push = (opt) => { if (opt && opt.value && !seen.has(opt.value)) { seen.add(opt.value); out.push(opt); } };
    if (preferredValue) push(opts.find((o) => o.value === preferredValue) || { value: preferredValue, label: preferredValue });
    opts.filter((o) => sameSide(preferredValue, o.value) && isLarge(o, role))
      .sort((a, b) => strength(b, role) - strength(a, role))
      .forEach(push);
    return out.slice(0, MAX_ROUTES);
  }

  window.HCVosModels = { sizeOf, strength, isSmall, isLarge, workerFor, routes, isLocal };
})();
