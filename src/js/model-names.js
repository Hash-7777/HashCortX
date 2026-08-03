// ==============================================================
// Reading a model's identifier: its name, its size, its class
//
// A model arrives as a string like `cloud:openrouter:meta-llama/llama-3.3-70b-instruct:free`
// and the app has to get several things out of it — which provider, which
// model, what to call it on screen, and roughly how capable it is so failover
// can pick something comparable rather than something worse.
//
// All of it is string handling, and all of it fails quietly. A tier read too
// low sends a hard question to a small model; a label parsed wrong shows the
// user a name they do not recognise; a provider split at the wrong colon sends
// the request nowhere. Nothing throws.
//
// Tables that live in app.js — the catalogue of cloud models, the list of what
// is currently usable — are passed in rather than reached for, so this file
// stays pure and checkable.
//
// Loaded before app.js and published as window.HCModelNames.
// Checked by scripts/checks/model-names.mjs.
// ==============================================================

(function () {
  'use strict';

  /**
   * Roughly how capable a model is, for choosing a replacement when one fails.
   *
   * The numbers are spaced so "one tier down" is a comparison rather than a
   * table lookup — see the failover rule below, which accepts anything within
   * 50 of the current tier.
   */
  const MODEL_TIER = {
    frontier: 300, // GPT-4o, Claude 4, Gemini 2.5 Pro, Kimi K1.5, DeepSeek-V3, Llama-4-Maverick, 405B+
    strong:   200, // GPT-4, Claude 3.5, Gemini Pro, 120B–235B, Qwen3-235B
    capable:  100, // 70B class: Llama-3.3, Qwen3-72B, Nemotron-70B
    moderate:  50, // 32B–40B: DeepSeek-R1-Distill, Qwen2.5-32B
    small:      0, // < 32B: flash, lite, mini, 8B, 3B
  };

  /** Split `cloud:provider:model-id` — the model id may contain colons. */
  function parseCloudModel(val) {
    if (!val || !val.startsWith('cloud:')) return { provider: '', modelId: '' };
    const parts = val.split(':');
    return { provider: parts[1] || '', modelId: parts.slice(2).join(':') };
  }

  /**
   * Turn a model id into something readable.
   *
   * Version numbers are the trap: separators become spaces, but `3.1` and
   * `2.5` must survive, so the dot between two digits is shielded before the
   * rest are replaced and restored afterwards. Without that, "llama-3.1-8b"
   * reads as "Llama 3 1 8B".
   */
  function prettifyModelId(id) {
    if (!id) return '';
    let core = id.split('/').pop().replace(/:free$/i, '');

    core = core
      .replace(/[-_]/g, ' ')
      .replace(/(\d)\.(\d)/g, '$1\x00$2')   // shield "3.1", "2.5" etc.
      .replace(/\./g, ' ')
      .replace(/\x00/g, '.')                 // restore shielded dots
      .replace(/\s+/g, ' ').trim();

    const ALWAYS_UPPER = new Set(['gpt', 'oss', 'llm', 'api', 'rag', 'sql']);
    const CUSTOM_CASE = { deepseek: 'DeepSeek', qwq: 'QwQ', llava: 'LLaVA', nvidia: 'NVIDIA' };

    core = core.split(' ').filter(Boolean).map((tok) => {
      const lo = tok.toLowerCase();
      if (CUSTOM_CASE[lo]) return CUSTOM_CASE[lo];
      if (ALWAYS_UPPER.has(lo)) return tok.toUpperCase();
      // Parameter count: "8b" → "8B", "405b" → "405B"
      if (/^\d+(\.\d+)?[bkmtBKMT]$/i.test(tok)) return tok.slice(0, -1) + tok.slice(-1).toUpperCase();
      // Mixture-of-experts spec: "a22b" → "A22B"
      if (/^[a-zA-Z]\d+[bkmtBKMT]$/i.test(tok)) {
        return tok.charAt(0).toUpperCase() + tok.slice(1, -1) + tok.slice(-1).toUpperCase();
      }
      if (/^[\d.]+$/.test(tok)) return tok;
      return tok.charAt(0).toUpperCase() + tok.slice(1).toLowerCase();
    }).join(' ');

    return /:free$/i.test(id.split('/').pop()) ? `${core} (free)` : core;
  }

  /** Models the app does not offer, whatever a provider lists. */
  function isExcludedCloudModel(model) {
    const haystack = [model?.value, model?.id, model?.name, model?.label, model?.shortLabel]
      .filter(Boolean).join(' ').toLowerCase();
    return /baidu|qianfan|cobuddy/.test(haystack);
  }

  function visibleCloudModels(models) {
    return (models || []).filter((m) => !isExcludedCloudModel(m));
  }

  /** An Ollama listing entry names its model in one of several fields. */
  function ollamaModelName(entry) {
    if (typeof entry === 'string') return entry;
    if (!entry || typeof entry !== 'object') return '';
    return entry.name || entry.model || entry.id || '';
  }

  /**
   * Roughly how capable a model is, read from its name.
   *
   * Family patterns are tried before the parameter count, because a name is
   * more reliable than a number in it: "gpt-4o-mini" contains no size at all,
   * and a size found in an unrelated part of the string would be read as one.
   * The count is the fallback for models nobody has listed.
   */
  function getModelTier(value, label) {
    const s = `${value || ''} ${label || ''}`.toLowerCase();
    const sizeMatch = s.match(/(\d+)(?:\.\d+)?\s*([bkmt])/i);
    const sizeUnit = sizeMatch?.[2]?.toLowerCase();
    const sizeNum = sizeMatch ? (sizeUnit === 't' ? parseFloat(sizeMatch[1]) * 1000 : parseFloat(sizeMatch[1])) : 0;
    if (/gpt-4o|claude-4|gemini-2\.5-pro|kimi-k(?:1\.5|2(?:\.|-))|deepseek-v3|llama-4-maverick|405b|253b|235b|120b/i.test(s)) return MODEL_TIER.frontier;
    if (/gpt-4|claude-3\.5|gemini-pro|qwen3-235|120b|70b|maverick|nemotron-ultra/i.test(s)) return MODEL_TIER.strong;
    if (/70b|llama-3\.3|qwen3-72|nemotron-70/i.test(s)) return MODEL_TIER.capable;
    if (/32b|40b|deepseek-r1-distill|qwen2\.5-32/i.test(s)) return MODEL_TIER.moderate;
    if (/8b|7b|3b|mini|flash|lite|instant|small|tiny/i.test(s)) return MODEL_TIER.small;
    return sizeNum >= 120 ? MODEL_TIER.frontier
      : sizeNum >= 70 ? MODEL_TIER.capable
      : sizeNum >= 32 ? MODEL_TIER.moderate
      : MODEL_TIER.small;
  }

  /** The display name for a selected model, from the catalogue if it is there. */
  function cloudModelLabel(val, catalogue) {
    if (!val) return '';
    if (isExcludedCloudModel({ value: val, label: val, shortLabel: val })) return '';
    if (!val.startsWith('cloud:')) return val;
    for (const grp of catalogue || []) {
      const m = (grp.models || []).find((x) => x.value === val);
      if (m) return m.label;
    }
    // Not in the catalogue — a model discovered from a provider's own list.
    const { provider, modelId } = parseCloudModel(val);
    return `${modelId} · ${provider}`;
  }

  /** Whether a catalogued model draws pictures rather than writing text. */
  function isImageGenModel(val, catalogue) {
    if (!val) return false;
    for (const grp of catalogue || []) {
      const m = (grp.models || []).find((x) => x.value === val);
      if (m) return !!m.imageGen;
    }
    return false;
  }

  /**
   * Pick a replacement when a model fails.
   *
   * Prefers the same class or better; then within one tier below; then
   * anything left, because an answer from a smaller model beats no answer.
   * Between equals, providers with a free tier come first — failover should
   * not quietly move a user onto something that bills them.
   */
  const FREE_PREFERRED = { groq: 1, gemini: 1, cerebras: 1, samba: 1, openrouter: 1 };

  function getBestFailoverModel(currentModel, availableModels, excludeSet = new Set()) {
    const currentTier = getModelTier(currentModel, '');
    const available = (availableModels || [])
      .filter((m) => !excludeSet.has(m.value) && m.value !== currentModel);
    if (!available.length) return null;

    available.sort((a, b) => {
      if (b.tier !== a.tier) return b.tier - a.tier;
      return (FREE_PREFERRED[b.provider] || 0) - (FREE_PREFERRED[a.provider] || 0);
    });

    return available.find((m) => m.tier >= currentTier)
      || available.find((m) => m.tier >= currentTier - 50)
      || available[0];
  }

  window.HCModelNames = {
    MODEL_TIER,
    parseCloudModel,
    prettifyModelId,
    isExcludedCloudModel,
    visibleCloudModels,
    ollamaModelName,
    getModelTier,
    cloudModelLabel,
    isImageGenModel,
    getBestFailoverModel,
  };
})();
