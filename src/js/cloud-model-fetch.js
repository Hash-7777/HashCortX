// ==============================================================
// Asking each provider what models it has
//
// Ten providers, ten different answers to the same question. Most speak the
// OpenAI shape and return `{ data: [{ id }] }`; Google returns `{ models:
// [{ name: "models/gemini-…" }] }` and needs the prefix stripped; OpenRouter
// returns every model on the internet and has to be cut down to the free ones;
// Anthropic returns a display name worth using instead of a prettified id.
//
// This is the part of the app that goes out of date without anyone touching
// it. Providers add and retire models continuously, so these functions are
// what keeps the menu honest — and they sat inside a seven-thousand-line file
// where no check could reach them, which is precisely backwards for the code
// most likely to need changing.
//
// The four things they need from the app are passed in, not reached for:
//
//   prettify      a raw model id turned into something readable
//   isExcluded    the app's own list of models not worth offering
//   seed          what to answer with when a provider gives nothing usable
//   moonshotApi   Moonshot's request helper, which handles its several hosts
//   sortMoonshotIds  Moonshot's own ordering, which lives with the providers
//
// That is what lets scripts/checks/cloud-model-fetch.mjs run every one of them
// against a recorded answer, with no app and no network in the way.
//
// Loaded before app.js and published as window.HCCloudModelFetch.
// ==============================================================

(function () {
  'use strict';

  /**
   * The ten fetchers, bound to the app's own helpers.
   *
   * Returns the map `loadCloudModelsFor` indexes by provider id.
   */
  function create(deps) {
    const prettifyModelId    = deps.prettify;
    const isExcludedCloudModel = deps.isExcluded;
    const seedModelsFor      = deps.seed;
    const fetchMoonshotApi   = deps.moonshotApi;
    const sortMoonshotModelIds = deps.sortMoonshotIds;

  // Pretty-print a raw model id into a label.
  // "llama-3.3-70b-versatile"  → "Llama 3.3 70B Versatile"
  // "openai/gpt-oss-120b:free" → "GPT OSS 120B (free)" with provider suffix added later
  async function fetchGroqModels(apiKey) {
    const r = await fetch("https://api.groq.com/openai/v1/models", {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!r.ok) throw new Error(`Groq /models ${r.status}`);
    const j = await r.json();
    const list = (j.data || [])
      .filter(m => m.active !== false && (m.object === "model" || !m.object))
      .map(m => m.id)
      .filter(id => !/whisper|tts|guard|embed|orpheus|allam|speech|safeguard|prompt-guard|compound/i.test(id))
      .sort();
    return list.map(id => ({
      value: `cloud:groq:${id}`,
      label: `${prettifyModelId(id)} · Groq`,
      shortLabel: prettifyModelId(id),
    }));
  }

  async function fetchGeminiModels(apiKey) {
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`
    );
    if (!r.ok) throw new Error(`Gemini /models ${r.status}`);
    const j = await r.json();
    // Keep the models that can hold a conversation, and drop the generation
    // that is deprecated.
    //
    // This used to admit `gemini-2.` and nothing else. That reads as "the
    // current generation" and behaves as "this one generation forever": the
    // day Google ships the next number, every model in it is filtered out
    // here and the menu quietly stops offering anything new, while the fetch
    // still reports success. Naming what is gone rather than what is current
    // is the version of this rule that does not need editing on a schedule.
    const ids = (j.models || [])
      .filter(m => Array.isArray(m.supportedGenerationMethods) &&
                   m.supportedGenerationMethods.includes("generateContent"))
      .map(m => String(m.name || "").replace(/^models\//, ""))
      .filter(id => id &&
        /^gemini-/i.test(id) &&
        !/^gemini-1\./i.test(id) &&
        !/embedding|aqa|tts|deep-research|veo|learnlm|exp-/i.test(id))
      .sort();
    // Text models first, image-gen models last
    const textIds  = ids.filter(id => !/image-generation/i.test(id));
    const imageIds = ids.filter(id => /image-generation/i.test(id));
    return [
      ...textIds.map(id => ({
        value: `cloud:gemini:${id}`,
        label: `${prettifyModelId(id)} · Google`,
        shortLabel: prettifyModelId(id),
      })),
      ...imageIds.map(id => ({
        value: `cloud:gemini:${id}`,
        label: `${prettifyModelId(id)} · Google`,
        shortLabel: `${prettifyModelId(id)} ✦`,
        imageGen: true,
      })),
    ];
  }

  async function fetchOpenRouterModels(apiKey) {
    const headers = {};
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    const r = await fetch("https://openrouter.ai/api/v1/models", { headers });
    if (!r.ok) throw new Error(`OpenRouter /models ${r.status}`);
    const j = await r.json();
    const isFree = (m) => /:free$/i.test(String(m.id || ""));
    const list = (j.data || [])
      .filter(isFree)
      .map(m => ({ id: m.id, name: m.name || m.id }))
      .filter(m => m.id.includes("/") && !/embedding|moderation|rerank|ocr|tts|whisper|venice|thudm\/glm|glm-z/i.test(m.id))
      .filter(m => !isExcludedCloudModel(m))
      .sort((a, b) => a.id.localeCompare(b.id));
    return list.map(m => ({
      value: `cloud:openrouter:${m.id}`,
      label: `${m.name.replace(/\s*\(free\)\s*$/i, "")} (free) · OpenRouter`,
      shortLabel: `${m.name.replace(/\s*\(free\)\s*$/i, "")} (free)`,
    }));
  }

  async function fetchCerebrasModels(apiKey) {
    if (!apiKey) return seedModelsFor("cerebras");
    const r = await fetch("https://api.cerebras.ai/v1/models", {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!r.ok) throw new Error(`Cerebras /models ${r.status}`);
    const j = await r.json();
    const list = (j.data || [])
      .map(m => m.id)
      .filter(id => id && !/embedding|guard|tts|whisper|vision|glm|zai/i.test(id))
      .sort();
    if (!list.length) return seedModelsFor("cerebras");
    return list.map(id => ({
      value: `cloud:cerebras:${id}`,
      label: `${prettifyModelId(id)} · Cerebras`,
      shortLabel: prettifyModelId(id),
    }));
  }

  async function fetchSambaModels(apiKey) {
    if (!apiKey) return seedModelsFor("samba");
    const r = await fetch("https://api.sambanova.ai/v1/models", {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!r.ok) throw new Error(`SambaNova /models ${r.status}`);
    const j = await r.json();
    const list = (j.data || [])
      .map(m => m.id)
      .filter(id => id && !/embedding|guard|tts|audio/i.test(id))
      .sort();
    if (!list.length) return seedModelsFor("samba");
    return list.map(id => ({
      value: `cloud:samba:${id}`,
      label: `${prettifyModelId(id)} · SambaNova`,
      shortLabel: prettifyModelId(id),
    }));
  }

  async function fetchOpenAIModels(apiKey) {
    if (!apiKey) return seedModelsFor("openai");
    const r = await fetch("https://api.openai.com/v1/models", {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!r.ok) throw new Error(`OpenAI /models ${r.status}`);
    const j = await r.json();
    const list = (j.data || [])
      .map(m => m.id)
      .filter(id => id && /^gpt-|^[oO][0-9]/.test(id) && !/embedding|tts|whisper|dall|moderation|instruct/i.test(id))
      .sort();
    if (!list.length) return seedModelsFor("openai");
    return list.map(id => ({
      value: `cloud:openai:${id}`,
      label: `${prettifyModelId(id)} · OpenAI`,
      shortLabel: prettifyModelId(id),
    }));
  }

  // Anthropic was the one provider still answering from the hand-written
  // catalogue: this used to return it unconditionally, with a comment saying
  // no public /models endpoint existed. One does, and has for a while, so
  // Claude was the only list in the app that could never learn a new model —
  // which is the worst place for that to be true, because the names carry
  // dates and go stale on a schedule.
  //
  // The list is ordered newest first. Anthropic returns it oldest first, and
  // a person opening this menu is far more often after the model that just
  // came out than the one from two years ago.
  async function fetchAnthropicModels(apiKey) {
    if (!apiKey) return seedModelsFor("anthropic");
    const r = await fetch("https://api.anthropic.com/v1/models?limit=1000", {
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    });
    if (!r.ok) throw new Error(`Anthropic /models ${r.status}`);
    const j = await r.json();
    const list = (j.data || [])
      .filter(m => m && typeof m.id === "string")
      .sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
    return list.map(m => {
      // display_name is what Anthropic calls the model in its own console.
      // Falling back to the prettified id keeps a brand-new model readable on
      // the day it ships, before the field is populated.
      const name = m.display_name || prettifyModelId(m.id);
      return {
        value: `cloud:anthropic:${m.id}`,
        label: `${name} · Anthropic`,
        shortLabel: name,
      };
    });
  }

  async function fetchMoonshotModels(apiKey) {
    if (!apiKey) return seedModelsFor("moonshot");
    const { res } = await fetchMoonshotApi("/models", apiKey, () => ({
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}` },
    }));
    const j = await res.json();
    const list = sortMoonshotModelIds((j.data || [])
      .map(m => m.id)
      .filter(id => id && !/embedding|tts|image/i.test(id))
    );
    if (!list.length) return seedModelsFor("moonshot");
    return list.map(id => ({
      value: `cloud:moonshot:${id}`,
      label: `${prettifyModelId(id)} · Kimi`,
      shortLabel: prettifyModelId(id),
    }));
  }

  async function fetchDeepSeekModels(apiKey) {
    if (!apiKey) return seedModelsFor("deepseek");
    const r = await fetch("https://api.deepseek.com/v1/models", {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!r.ok) throw new Error(`DeepSeek /models ${r.status}`);
    const j = await r.json();
    const list = (j.data || [])
      .map(m => m.id)
      .filter(id => id && !/embedding|image/i.test(id))
      .sort();
    if (!list.length) return seedModelsFor("deepseek");
    return list.map(id => ({
      value: `cloud:deepseek:${id}`,
      label: `${prettifyModelId(id)} · DeepSeek`,
      shortLabel: prettifyModelId(id),
    }));
  }

  async function fetchMistralModels(apiKey) {
    if (!apiKey) return seedModelsFor("mistral");
    const r = await fetch("https://api.mistral.ai/v1/models", {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!r.ok) throw new Error(`Mistral /models ${r.status}`);
    const j = await r.json();
    const list = (j.data || [])
      .map(m => m.id)
      .filter(id => id && !/embed/i.test(id))
      .sort();
    if (!list.length) return seedModelsFor("mistral");
    return list.map(id => ({
      value: `cloud:mistral:${id}`,
      label: `${prettifyModelId(id)} · Mistral`,
      shortLabel: prettifyModelId(id),
    }));
  }

  const CLOUD_FETCHERS = {
    groq: fetchGroqModels,
    gemini: fetchGeminiModels,
    openrouter: fetchOpenRouterModels,
    cerebras: fetchCerebrasModels,
    samba: fetchSambaModels,
    openai: fetchOpenAIModels,
    anthropic: fetchAnthropicModels,
    moonshot: fetchMoonshotModels,
    deepseek: fetchDeepSeekModels,
    mistral: fetchMistralModels,
  };

    return CLOUD_FETCHERS;
  }

  window.HCCloudModelFetch = { create };
})();
