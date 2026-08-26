// ==============================================================
// Where each cloud provider lives, what it needs, and what comes back
//
// These facts were written out twice, in two twelve-branch if/else chains —
// one for streaming chat, one for the agent loop — with the endpoint and the
// auth header repeated in each. Two copies of the same fact drift, and the way
// this one drifts is invisible: a wrong endpoint is not a crash but a request
// the Content Security Policy blocks, and the app reports it as the provider
// being unreachable.
//
// So the endpoints live here, once, and both callers read them. The check in
// scripts/checks/providers.mjs holds the part no reviewer reliably catches:
// every endpoint below must be inside the connect-src list in
// tauri.conf.json, or it cannot work in the shipped app at all.
//
// The two functions at the end are the other direction: what a provider sent
// BACK. How many tokens it says it used — four different spellings across the
// providers, and the numbers that end up in the usage log another application
// reads — and what to tell a person when a request failed. That second one is
// almost all of what somebody sees on a bad day, and none of it could be read
// by a check while it sat inside an seven-thousand-line file.
//
// Pure: no DOM, no storage, no network. Bodies stay with their callers — the
// providers genuinely disagree about those, and pretending otherwise would
// trade a real duplication for a fake abstraction.
//
// Loaded before app.js and published as window.HCProviders.
// ==============================================================

(function () {
  'use strict';

  /**
   * How a provider's key becomes request headers.
   *
   *   bearer     Authorization: Bearer <key>          — the OpenAI convention
   *   anthropic  x-api-key plus a required version header
   *   query      the key goes in the URL, not a header (Gemini)
   */
  const PROVIDERS = {
    groq: {
      label: 'Groq',
      chatUrl: 'https://api.groq.com/openai/v1/chat/completions',
      auth: 'bearer',
    },
    openai: {
      label: 'OpenAI',
      chatUrl: 'https://api.openai.com/v1/chat/completions',
      auth: 'bearer',
    },
    openrouter: {
      label: 'OpenRouter',
      chatUrl: 'https://openrouter.ai/api/v1/chat/completions',
      auth: 'bearer',
      // OpenRouter attributes requests to an app; these are not credentials.
      extraHeaders: { 'HTTP-Referer': 'hash-gpt://local', 'X-Title': 'HashCortx' },
    },
    cerebras: {
      label: 'Cerebras',
      chatUrl: 'https://api.cerebras.ai/v1/chat/completions',
      auth: 'bearer',
    },
    samba: {
      label: 'SambaNova',
      chatUrl: 'https://api.sambanova.ai/v1/chat/completions',
      auth: 'bearer',
    },
    nvidia: {
      label: 'NVIDIA',
      chatUrl: 'https://integrate.api.nvidia.com/v1/chat/completions',
      auth: 'bearer',
    },
    deepseek: {
      label: 'DeepSeek',
      chatUrl: 'https://api.deepseek.com/v1/chat/completions',
      auth: 'bearer',
    },
    mistral: {
      label: 'Mistral',
      chatUrl: 'https://api.mistral.ai/v1/chat/completions',
      auth: 'bearer',
    },
    anthropic: {
      label: 'Anthropic',
      chatUrl: 'https://api.anthropic.com/v1/messages',
      auth: 'anthropic',
    },
    gemini: {
      label: 'Google AI Studio',
      // Gemini puts the model and the action in the path and the key in the
      // query, so there is no single URL to name — only the host it lives on,
      // which is what the CSP check needs.
      host: 'https://generativelanguage.googleapis.com',
      auth: 'query',
    },
    moonshot: {
      label: 'Moonshot (Kimi)',
      // Moonshot answers on several hosts and the app fails over between them,
      // so its base list stays with the failover logic that uses it. Recorded
      // here so the provider is not silently missing from this table.
      hosts: [
        'https://api.kimi.com',
        'https://api.kimi.ai',
        'https://api.moonshot.ai',
        'https://api.moonshot.cn',
      ],
      auth: 'bearer',
    },
  };

  // ── Moonshot / Kimi ─────────────────────────────────────────────────────
  //
  // Moonshot is the one provider that does not answer at a single address.
  // The same company runs four hosts, and — this is the part that costs
  // people an afternoon — kimi.com and the older Moonshot platforms are
  // SEPARATE account systems. A key minted on one returns 401 on the other,
  // which reads exactly like a wrong key. So a request sweeps the candidates
  // rather than trusting the first refusal.

  /** OpenAI-compatible bases, in the order they are tried. */
  const MOONSHOT_API_BASES = [
    'https://api.kimi.com/v1',
    'https://api.kimi.ai/v1',
    'https://api.moonshot.ai/v1',
    'https://api.moonshot.cn/v1',
  ];

  /**
   * Anthropic-protocol bases used by the Kimi for Code platform.
   * Keys minted at kimi.com/code/console start with `sk-ki` and work only here.
   */
  const KIMI_ANTHROPIC_BASES = [
    'https://api.moonshot.ai/anthropic',
    'https://api.moonshot.cn/anthropic',
    'https://api.kimi.com/anthropic',
    'https://api.kimi.ai/anthropic',
  ];

  /** A Kimi for Code key, which speaks the Anthropic protocol, not OpenAI's. */
  function isKimiCodeKey(key) {
    return typeof key === 'string' && key.trim().toLowerCase().startsWith('sk-ki');
  }

  /** Which of the four hosts an address belongs to, for showing the user. */
  function moonshotEndpointLabel(baseUrl) {
    const s = String(baseUrl || '');
    if (s.includes('kimi.com')) return 'api.kimi.com';
    if (s.includes('kimi.ai')) return 'api.kimi.ai';
    if (s.includes('.cn')) return 'api.moonshot.cn';
    return 'api.moonshot.ai';
  }

  /**
   * The bases to try, with one that has worked before moved to the front.
   *
   * The remembered base is passed in rather than looked up, so this stays a
   * function of its arguments; app.js keeps the memory of what worked.
   */
  function orderedMoonshotBases(preferredBase, bases) {
    const list = (bases || MOONSHOT_API_BASES).slice();
    if (!preferredBase || !list.includes(preferredBase)) return list;
    return [preferredBase, ...list.filter((b) => b !== preferredBase)];
  }

  /**
   * Whether a failure means "try the next host" rather than "give up".
   *
   * 401 and 403 are included precisely because the accounts are separate: a
   * valid key refused by the wrong platform looks identical to a bad key, and
   * treating it as final is what would make a working key appear broken.
   */
  function shouldTryNextMoonshotEndpoint(status) {
    return status === 401 || status === 403 || status === 404;
  }

  /** Moonshot's own model ids, newest and most capable first. */
  const MOONSHOT_MODEL_ORDER = [
    'kimi-k2.6',
    'kimi-k2.5',
    'kimi-k2-thinking-turbo',
    'kimi-k2-thinking',
    'kimi-k2-turbo-preview',
    'kimi-k2-0905-preview',
    'kimi-k2-0711-preview',
    'moonshot-v1-128k',
    'moonshot-v1-32k',
    'moonshot-v1-8k',
  ];

  function sortMoonshotModelIds(ids) {
    return (ids || []).slice().sort((a, b) => {
      const ai = MOONSHOT_MODEL_ORDER.indexOf(a);
      const bi = MOONSHOT_MODEL_ORDER.indexOf(b);
      // Anything unlisted sorts after everything listed, then alphabetically,
      // so a model released after this list was written still appears.
      const ar = ai === -1 ? 999 : ai;
      const br = bi === -1 ? 999 : bi;
      return ar - br || String(a).localeCompare(String(b));
    });
  }

  /**
   * Convert an OpenAI-style conversation into the Anthropic body Kimi for Code
   * expects: the system prompt lifted out to its own field, and every message
   * carrying a content array rather than a string.
   */
  function buildKimiAnthropicBody(model, messages, opts) {
    const list = messages || [];
    const systemMsg = list.find((m) => m.role === 'system');
    const anthropicMessages = list
      .filter((m) => m.role !== 'system')
      .map((m) => {
        const content = [];
        if (m.content) content.push({ type: 'text', text: m.content });
        if (m.images?.length) {
          m.images.forEach((b64) => content.push({
            type: 'image',
            source: { type: 'base64', media_type: 'image/jpeg', data: b64 },
          }));
        }
        // Anthropic rejects an empty content array, and only knows two roles.
        return {
          role: m.role === 'assistant' ? 'assistant' : 'user',
          content: content.length ? content : [{ type: 'text', text: '' }],
        };
      });
    const body = { model, messages: anthropicMessages, max_tokens: (opts && opts.maxTokens) || 4096 };
    if (systemMsg) body.system = systemMsg.content;
    if (opts && typeof opts.temperature === 'number') body.temperature = opts.temperature;
    if (opts && opts.stream) body.stream = true;
    return body;
  }

  /** Everything known about one provider, or null. */
  function get(provider) {
    return PROVIDERS[provider] || null;
  }

  /**
   * The headers a request to this provider needs, given its key.
   *
   * Throws when the provider is unknown rather than returning something
   * plausible — a request built from a guess fails later and further away.
   */
  function headersFor(provider, key) {
    const p = PROVIDERS[provider];
    if (!p) throw new Error(`Unknown cloud provider: ${provider}`);
    const headers = { 'Content-Type': 'application/json' };
    if (p.auth === 'bearer') headers.Authorization = `Bearer ${key}`;
    else if (p.auth === 'anthropic') {
      headers['x-api-key'] = key;
      headers['anthropic-version'] = '2023-06-01';
    }
    // 'query' providers carry the key in the URL and need nothing here.
    return Object.assign(headers, p.extraHeaders || {});
  }

  /** The endpoint and headers for a chat request, ready to fetch. */
  function requestFor(provider, key) {
    const p = PROVIDERS[provider];
    if (!p) throw new Error(`Unknown cloud provider: ${provider}`);
    if (!p.chatUrl) throw new Error(`${p.label} builds its own URL — use its own path`);
    return { url: p.chatUrl, headers: headersFor(provider, key) };
  }

  /** Every host this table can reach, for checking against the CSP. */
  function allHosts() {
    const out = new Set();
    for (const p of Object.values(PROVIDERS)) {
      if (p.chatUrl) out.add(new URL(p.chatUrl).origin);
      if (p.host) out.add(new URL(p.host).origin);
      for (const h of p.hosts || []) out.add(new URL(h).origin);
    }
    return [...out];
  }

  // ── What came back ──────────────────────────────────────────────────────

  /**
   * How many tokens a provider says it used, whichever way it says it.
   *
   * Four spellings: the OpenAI one that most follow, Anthropic's, Gemini's,
   * and the pair Ollama puts on its final object. Read in that order because
   * that is the order they are common in, and a response only ever uses one.
   *
   * These numbers are written into the usage log that a separate application
   * reads, so a shape read wrongly here is a wrong figure in something else
   * entirely — and nothing in either app would say so.
   *
   * Null when a response does not report usage at all, which is a different
   * thing from reporting zero and has to stay different: a provider that says
   * nothing must not be recorded as having cost nothing.
   */
  function usageFrom(data) {
    if (!data || typeof data !== "object") return null;
    // OpenAI-compatible, which most providers follow.
    if (data.usage) {
      const u = data.usage;
      if (u.prompt_tokens != null || u.completion_tokens != null) {
        return { input: u.prompt_tokens, output: u.completion_tokens };
      }
      // Anthropic.
      if (u.input_tokens != null || u.output_tokens != null) {
        return { input: u.input_tokens, output: u.output_tokens };
      }
    }
    // Gemini.
    if (data.usageMetadata) {
      return {
        input: data.usageMetadata.promptTokenCount,
        output: data.usageMetadata.candidatesTokenCount,
      };
    }
    // Ollama reports these on the final object.
    if (data.prompt_eval_count != null || data.eval_count != null) {
      return { input: data.prompt_eval_count, output: data.eval_count };
    }
    return null;
  }

  /**
   * What to tell somebody when a request failed.
   *
   * Almost all of what a person sees on a bad day. Each case says what
   * happened, and where to go about it — a rate limit is not a broken key, and
   * being told the wrong one sends somebody to regenerate a key that was
   * working.
   *
   * The free-tier note on a rate limit is there because it is the single most
   * confusing thing about these providers: a request that FAILED still counts
   * against the quota, so somebody retrying a failure is spending the budget
   * they are trying to get back.
   */
  function cloudHttpError(provider, status, body, retryAfter) {
    const PROVIDER_LABELS = {
      groq: "Groq", gemini: "Google Gemini", openrouter: "OpenRouter",
      cerebras: "Cerebras", samba: "SambaNova",
      openai: "OpenAI", anthropic: "Anthropic", moonshot: "Moonshot (Kimi)",
      deepseek: "DeepSeek", mistral: "Mistral AI",
    };
    const providerLabel = PROVIDER_LABELS[provider] || provider;
    const hints = {
      groq:        { key: "console.groq.com → API Keys",            quota: "console.groq.com → Usage" },
      gemini:      { key: "aistudio.google.com → Get API key",      quota: "ai.google.dev/gemini-api/docs/quota" },
      openrouter:  { key: "openrouter.ai → Keys",                   quota: "openrouter.ai/activity" },
      cerebras:    { key: "cloud.cerebras.ai → API Keys (free)",    quota: "cloud.cerebras.ai → Usage" },
      samba:       { key: "cloud.sambanova.ai → API Keys (free)",   quota: "cloud.sambanova.ai → Usage" },
      openai:      { key: "platform.openai.com → API Keys",         quota: "platform.openai.com/usage" },
      anthropic:   { key: "console.anthropic.com → API Keys",       quota: "console.anthropic.com/settings/plans" },
      moonshot:    { key: "platform.kimi.ai or platform.kimi.com → API Keys", quota: "platform.kimi.ai / platform.kimi.com" },
      deepseek:    { key: "platform.deepseek.com → API Keys",       quota: "platform.deepseek.com" },
      mistral:     { key: "console.mistral.ai → API Keys",          quota: "console.mistral.ai" },
    }[provider] || { key: "provider dashboard", quota: "provider dashboard" };
    if (status === 429) {
      const wait = retryAfter ? ` Try again in ${retryAfter}s.` : " Wait ~60s and try again, or switch to a different model.";
      return `${providerLabel} rate limit — free-tier quota exceeded (failed requests count too).${wait}\nCheck usage: ${hints.quota}`;
    }
    if (status === 401 || status === 403) {
      const serverDetail = (body || "").replace(/\s+/g, " ").trim().slice(0, 200);
      const detailLine = serverDetail ? `\nServer said: ${serverDetail}` : "";
      return `${providerLabel} rejected the API key (HTTP ${status}). Check it was generated on the matching platform — ${hints.key} — and that API access is enabled on your project.${detailLine}`;
    }
    if (status === 404) {
      return `${providerLabel} model not found.\nThe model may have been renamed or retired.`;
    }
    if (status === 503 || status === 529) {
      return `${providerLabel} is overloaded right now. Try again in a few seconds.`;
    }
    if (status >= 500) {
      return `${providerLabel} server error (${status}). Try again shortly.`;
    }
    const detail = (body || "").slice(0, 120);
    return `${providerLabel} error ${status}${detail ? ": " + detail : ""}`;
  }

  window.HCProviders = {
    PROVIDERS, get, headersFor, requestFor, allHosts,
    // Moonshot answers on four hosts across two account systems.
    MOONSHOT_API_BASES, KIMI_ANTHROPIC_BASES, MOONSHOT_MODEL_ORDER,
    isKimiCodeKey, moonshotEndpointLabel, orderedMoonshotBases,
    // What came back, rather than what was sent.
    usageFrom, cloudHttpError,
    shouldTryNextMoonshotEndpoint, sortMoonshotModelIds, buildKimiAnthropicBody,
  };
})();
