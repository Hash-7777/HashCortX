// ==============================================================
// Where each cloud provider lives, and how its key becomes a header
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

  window.HCProviders = { PROVIDERS, get, headersFor, requestFor, allHosts };
})();
