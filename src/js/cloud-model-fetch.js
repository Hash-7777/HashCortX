// ==============================================================
// Asking each provider what models it has
//
// Every provider answers the same question differently. Most speak the
// OpenAI shape, `{ data: [{ id }] }`; Google returns `{ models: [...] }` a page
// at a time and names each model "models/…"; Anthropic pages too, and needs
// a header before a web page may ask it anything; OpenRouter lists hundreds
// of models, of which a key without credit can use only the free ones.
//
// What the lists say beyond a name is the point of reading them. Most say
// how much each model can read and how long an answer it can write, and some
// say whether it can call tools. Those limits were thrown away here, so
// every request went out without knowing them and answers were cut off at
// whatever a provider defaulted to. They are kept now, on each model:
//
//   ctx    how many tokens it reads — the question and the answer together
//   out    the longest answer it can write
//   tools  whether it can call tools, when the list says
//   free   whether it costs nothing, when the list says
//
// A list is also cut down to what can hold a conversation — no speech,
// embedding, image-only or safety-classifier models — and to what answers the
// chat interface this app uses, rather than to a hand-picked few.
//
// A fetcher that cannot get a list throws, with the provider's own reason;
// js/cloud-catalogue.js decides what the menu shows instead and records why.
//
// Two providers have no fetcher: SambaNova and NVIDIA refuse every request
// made from inside the app (js/providers.js), so there is no list to read.
//
// What the fetchers need from the app is passed in, so
// scripts/checks/cloud-model-fetch.mjs runs every one of them against a
// recorded answer. Published as window.HCCloudModelFetch.
// ==============================================================

(function () {
  'use strict';

  const NAMES = {
    groq: 'Groq', gemini: 'Google', openrouter: 'OpenRouter', cerebras: 'Cerebras', openai: 'OpenAI',
    anthropic: 'Anthropic', moonshot: 'Kimi', deepseek: 'DeepSeek', mistral: 'Mistral',
  };

  /** Models that do not hold a conversation, by the words their names use. */
  const NOT_CHAT = /embed|whisper|\btts\b|-tts|transcri|speech|orpheus|playai|guard|safety|moderation|rerank|\bclip\b|dall-e|imagen|\bveo\b|native-audio|realtime/i;

  const count = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : undefined);

  /** A menu entry for a model, with whatever limits its list gave. */
  function entry(provider, id, name, extra = {}) {
    const m = { value: `cloud:${provider}:${id}`, label: `${name} · ${NAMES[provider]}`, shortLabel: name };
    const ctx = count(extra.ctx);
    const out = count(extra.out);
    if (ctx) m.ctx = ctx;
    if (out) m.out = out;
    if (typeof extra.tools === 'boolean') m.tools = extra.tools;
    if (extra.free) m.free = true;
    if (extra.imageGen) m.imageGen = true;
    return m;
  }

  /** The reason a provider gave for refusing, in a few words. */
  async function refusal(label, res) {
    let reason = '';
    try {
      const text = await res.text();
      try {
        const j = JSON.parse(text);
        reason = (j.error && (j.error.message || j.error)) || j.message || j.detail || '';
      } catch { reason = text; }
    } catch { /* no body */ }
    reason = String(typeof reason === 'string' ? reason : JSON.stringify(reason)).replace(/\s+/g, ' ').trim().slice(0, 160);
    return new Error(`${label} would not list its models (HTTP ${res.status})${reason ? `: ${reason}` : ''}`);
  }

  function create(deps) {
    const prettify = deps.prettify;
    const isExcluded = deps.isExcluded;
    const moonshotApi = deps.moonshotApi;
    const sortMoonshotIds = deps.sortMoonshotIds;

    async function getJson(label, url, headers = {}) {
      const res = await fetch(url, { headers, referrerPolicy: 'no-referrer' });
      if (!res.ok) throw await refusal(label, res);
      return res.json();
    }

    const byName = (a, b) => a.value.localeCompare(b.value);

    async function fetchGroqModels(apiKey) {
      const j = await getJson('Groq', 'https://api.groq.com/openai/v1/models', { Authorization: `Bearer ${apiKey}` });
      return (j.data || [])
        .filter((m) => m && typeof m.id === 'string' && m.active !== false && !NOT_CHAT.test(m.id))
        .map((m) => entry('groq', m.id, prettify(m.id), { ctx: m.context_window, out: m.max_completion_tokens }))
        .sort(byName);
    }

    // Google returns fifty models to a page unless asked for more, and every
    // page after the first used to be ignored.
    async function fetchGeminiModels(apiKey) {
      const models = [];
      let token = '';
      for (let page = 0; page < 20; page++) {
        const url = `https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000&key=${encodeURIComponent(apiKey)}${token ? `&pageToken=${encodeURIComponent(token)}` : ''}`;
        const j = await getJson('Google', url);
        models.push(...(j.models || []));
        token = j.nextPageToken || '';
        if (!token) break;
      }
      const list = models
        .filter((m) => m && Array.isArray(m.supportedGenerationMethods) && m.supportedGenerationMethods.includes('generateContent'))
        .map((m) => ({ m, id: String(m.name || '').replace(/^models\//, '') }))
        // The 1.x generation is retired; naming what is gone rather than what
        // is current means a new generation is never filtered out.
        .filter(({ id }) => /^(gemini|gemma)-/i.test(id) && !/^gemini-1\./i.test(id) && !NOT_CHAT.test(id) && !/aqa|live|computer-use|robotics|learnlm|deep-research/i.test(id))
        .map(({ m, id }) => entry('gemini', id, m.displayName || prettify(id), {
          ctx: m.inputTokenLimit,
          out: m.outputTokenLimit,
          // Gemma on this API takes no tools and no system instruction.
          tools: !/^gemma-/i.test(id),
          imageGen: /image/i.test(id),
        }))
        .sort(byName);
      // Text models first, image models last.
      return [...list.filter((m) => !m.imageGen), ...list.filter((m) => m.imageGen)];
    }

    // Every model OpenRouter lists, not only the free ones — when this key has
    // credit to pay for them. A key without credit gets the free models only,
    // since every paid one would be refused.
    async function fetchOpenRouterModels(apiKey) {
      const headers = apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
      const [j, key] = await Promise.all([
        getJson('OpenRouter', 'https://openrouter.ai/api/v1/models', headers),
        apiKey ? getJson('OpenRouter', 'https://openrouter.ai/api/v1/key', headers).catch(() => null) : null,
      ]);
      const account = key && key.data;
      const canPay = !!account && account.is_free_tier === false && (account.limit_remaining == null || account.limit_remaining > 0);
      const now = Date.now();
      const list = (j.data || [])
        .filter((m) => m && typeof m.id === 'string' && m.id.includes('/') && !m.id.startsWith('~'))
        .filter((m) => ((m.architecture && m.architecture.output_modalities) || ['text']).includes('text'))
        .filter((m) => !m.expiration_date || !(Date.parse(m.expiration_date) <= now))
        .filter((m) => !NOT_CHAT.test(m.id) && !/venice|thudm\/glm|glm-z/i.test(m.id) && !isExcluded(m))
        .map((m) => {
          const p = m.pricing || {};
          const free = /:free$/i.test(m.id) || (String(p.prompt) === '0' && String(p.completion) === '0');
          const name = String(m.name || m.id).replace(/\s*\(free\)\s*$/i, '');
          const top = m.top_provider || {};
          return entry('openrouter', m.id, free ? `${name} (free)` : name, {
            ctx: top.context_length || m.context_length,
            out: top.max_completion_tokens,
            tools: Array.isArray(m.supported_parameters) ? m.supported_parameters.includes('tools') : undefined,
            free,
          });
        })
        .filter((m) => m.free || canPay)
        .sort((a, b) => (b.free ? 1 : 0) - (a.free ? 1 : 0) || byName(a, b));
      list.note = canPay ? 'paid models included — this key has credit'
        : apiKey ? 'free models only — this key has no credit for paid ones'
          : 'free models only — add a key to see paid ones';
      return list;
    }

    async function fetchCerebrasModels(apiKey) {
      const j = await getJson('Cerebras', 'https://api.cerebras.ai/v1/models', { Authorization: `Bearer ${apiKey}` });
      return (j.data || [])
        .filter((m) => m && typeof m.id === 'string' && !NOT_CHAT.test(m.id))
        .map((m) => entry('cerebras', m.id, prettify(m.id), { ctx: m.context_length || m.context_window, out: m.max_completion_tokens }))
        .sort(byName);
    }

    // Everything that answers the Chat Completions interface. The models that
    // only answer OpenAI's Responses interface — the "pro", codex, deep-research
    // and computer-use models — and the audio, image, search and embedding
    // models are left out, since this app could not use them.
    async function fetchOpenAIModels(apiKey) {
      const j = await getJson('OpenAI', 'https://api.openai.com/v1/models', { Authorization: `Bearer ${apiKey}` });
      return (j.data || [])
        .filter((m) => m && typeof m.id === 'string' && /^(gpt-|o\d|chatgpt-)/i.test(m.id))
        .filter((m) => !NOT_CHAT.test(m.id) && !/instruct|audio|transcribe|search|image|codex|computer-use|deep-research|(^|-)pro(-|$)/i.test(m.id))
        .sort((a, b) => (b.created || 0) - (a.created || 0) || String(a.id).localeCompare(String(b.id)))
        .map((m) => entry('openai', m.id, prettify(m.id), { tools: true }));
    }

    // Newest first, as Anthropic lists them. Each model says how much it reads
    // and the longest answer it can write.
    async function fetchAnthropicModels(apiKey) {
      const headers = { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' };
      const models = [];
      let after = '';
      for (let page = 0; page < 20; page++) {
        const j = await getJson('Anthropic', `https://api.anthropic.com/v1/models?limit=1000${after ? `&after_id=${encodeURIComponent(after)}` : ''}`, headers);
        models.push(...(j.data || []));
        if (!j.has_more || !j.last_id) break;
        after = j.last_id;
      }
      return models
        .filter((m) => m && typeof m.id === 'string')
        .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
        .map((m) => entry('anthropic', m.id, m.display_name || prettify(m.id), { ctx: m.max_input_tokens, out: m.max_tokens, tools: true }));
    }

    async function fetchMoonshotModels(apiKey) {
      // A Kimi for Code key only works on Kimi's Claude-style servers, and
      // those refuse every request made from inside an app like this one.
      if (deps.kimiCodeKey && deps.kimiCodeKey(apiKey)) throw new Error('Kimi for Code keys (sk-ki…) are refused from inside apps like this one — a platform key from platform.kimi.ai works');
      const { res } = await moonshotApi('/models', apiKey, () => ({
        method: 'GET',
        headers: { Authorization: `Bearer ${apiKey}` },
      }));
      if (!res.ok) throw await refusal('Kimi', res);
      const j = await res.json();
      const byId = new Map((j.data || []).filter((m) => m && typeof m.id === 'string').map((m) => [m.id, m]));
      return sortMoonshotIds([...byId.keys()].filter((id) => !NOT_CHAT.test(id) && !/image/i.test(id)))
        .map((id) => entry('moonshot', id, prettify(id), { ctx: byId.get(id).context_length }));
    }

    async function fetchDeepSeekModels(apiKey) {
      const j = await getJson('DeepSeek', 'https://api.deepseek.com/v1/models', { Authorization: `Bearer ${apiKey}` });
      return (j.data || [])
        .filter((m) => m && typeof m.id === 'string' && !NOT_CHAT.test(m.id) && !/image/i.test(m.id))
        .map((m) => entry('deepseek', m.id, prettify(m.id)))
        .sort(byName);
    }

    // Mistral says of each model whether it chats, whether it calls tools,
    // how much it reads, and when it is being retired.
    async function fetchMistralModels(apiKey) {
      const j = await getJson('Mistral', 'https://api.mistral.ai/v1/models', { Authorization: `Bearer ${apiKey}` });
      const now = Date.now();
      const seen = new Set();
      return (j.data || [])
        .filter((m) => m && typeof m.id === 'string' && !NOT_CHAT.test(m.id) && !/ocr/i.test(m.id))
        .filter((m) => !m.archived && !(m.capabilities && m.capabilities.completion_chat === false))
        .filter((m) => !m.deprecation || !(Date.parse(m.deprecation) <= now))
        .filter((m) => (seen.has(m.id) ? false : seen.add(m.id)))
        .map((m) => entry('mistral', m.id, prettify(m.id), {
          ctx: m.max_context_length,
          tools: m.capabilities ? m.capabilities.function_calling === true : undefined,
        }))
        .sort(byName);
    }

    return {
      groq: fetchGroqModels,
      gemini: fetchGeminiModels,
      openrouter: fetchOpenRouterModels,
      cerebras: fetchCerebrasModels,
      openai: fetchOpenAIModels,
      anthropic: fetchAnthropicModels,
      moonshot: fetchMoonshotModels,
      deepseek: fetchDeepSeekModels,
      mistral: fetchMistralModels,
    };
  }

  window.HCCloudModelFetch = { create, NOT_CHAT };
})();
