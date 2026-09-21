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
    // These two do not answer a request from a web page: their servers send no
    // permission for one, so the browser inside the app stops every request
    // before it is sent. The app sends theirs itself, to an address fixed in
    // src-tauri/src/commands/provider.rs — so there is no chat URL here for
    // the page to fetch, and neither host is in the page's connect-src.
    samba: {
      label: 'SambaNova',
      auth: 'bearer',
      bridge: 'samba',
    },
    nvidia: {
      label: 'NVIDIA',
      auth: 'bearer',
      bridge: 'nvidia',
    },
    // Cloudflare refuses a web page too, so its requests go through the app
    // like those two. It is the only provider whose address is not fixed
    // there: its account id is part of the path, checked to thirty-two hex
    // digits before it is used — src-tauri/src/commands/provider.rs.
    cloudflare: {
      label: 'Cloudflare',
      auth: 'bearer',
      bridge: 'cloudflare',
      needsAccount: true,
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
    // ── Added after measuring, not after guessing ──────────────────────
    //
    // Every one of these was tested for the only thing that decides whether
    // this app can use it: whether its servers permit a request made from
    // inside a web page. All nine answer one. Each speaks the OpenAI shape,
    // so nothing here needs a translator — a chat address and a bearer key is
    // the whole entry.
    xai: {
      label: 'xAI (Grok)',
      chatUrl: 'https://api.x.ai/v1/chat/completions',
      auth: 'bearer',
    },
    together: {
      label: 'Together AI',
      chatUrl: 'https://api.together.xyz/v1/chat/completions',
      auth: 'bearer',
    },
    fireworks: {
      label: 'Fireworks AI',
      chatUrl: 'https://api.fireworks.ai/inference/v1/chat/completions',
      auth: 'bearer',
    },
    zai: {
      label: 'Z.ai (GLM)',
      chatUrl: 'https://api.z.ai/api/paas/v4/chat/completions',
      auth: 'bearer',
    },
    qwen: {
      label: 'Alibaba Qwen',
      // The international address. The mainland one is a separate account
      // system, the way Moonshot's two are.
      chatUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions',
      auth: 'bearer',
    },
    huggingface: {
      label: 'Hugging Face',
      chatUrl: 'https://router.huggingface.co/v1/chat/completions',
      auth: 'bearer',
    },
    deepinfra: {
      label: 'DeepInfra',
      chatUrl: 'https://api.deepinfra.com/v1/openai/chat/completions',
      auth: 'bearer',
    },
    novita: {
      label: 'Novita',
      chatUrl: 'https://api.novita.ai/v3/openai/chat/completions',
      auth: 'bearer',
    },
    venice: {
      label: 'Venice',
      chatUrl: 'https://api.venice.ai/api/v1/chat/completions',
      auth: 'bearer',
    },
    moonshot: {
      label: 'Moonshot (Kimi)',
      // Two hosts for two separate account systems, tried in turn. A Kimi
      // Code key belongs to neither and goes through the app instead — see
      // bridgeFor below.
      hosts: [
        'https://api.moonshot.ai',
        'https://api.moonshot.cn',
      ],
      auth: 'bearer',
    },
  };

  // ── Moonshot / Kimi ─────────────────────────────────────────────────────
  //
  // Moonshot is the one provider that does not answer at a single address.
  // It runs two platforms — platform.kimi.ai, whose API is api.moonshot.ai,
  // and platform.kimi.com, whose API is api.moonshot.cn — and they are
  // SEPARATE account systems. A key minted on one returns 401 on the other,
  // which reads exactly like a wrong key. So a request tries the second
  // before trusting the first refusal.
  //
  // api.kimi.com/v1 and api.kimi.ai/v1 were tried first here for a long time.
  // Neither exists: both answer 404, and their servers refuse a web page, so
  // every request began with two failures before reaching a real host.

  /** OpenAI-compatible bases, in the order they are tried. */
  const MOONSHOT_API_BASES = [
    'https://api.moonshot.ai/v1',
    'https://api.moonshot.cn/v1',
  ];

  /**
   * A Kimi Code key — the kind a Kimi Code membership issues, starting sk-kimi.
   *
   * It works only at api.kimi.com/coding, which speaks the OpenAI shape and
   * refuses a web page, so these requests go through the app. The model it
   * serves is listed there too.
   */
  function isKimiCodeKey(key) {
    return typeof key === 'string' && key.trim().toLowerCase().startsWith('sk-ki');
  }

  /**
   * Which of the app's own routes a request to this provider takes, or null
   * when the page sends it itself.
   *
   * SambaNova and NVIDIA always go through the app. Moonshot does only for a
   * Kimi Code key; a platform key is called from the page like any other.
   */
  function bridgeFor(provider, key) {
    const p = PROVIDERS[provider];
    if (!p) return null;
    if (p.bridge) return p.bridge;
    if (provider === 'moonshot' && isKimiCodeKey(key)) return 'kimi-code';
    return null;
  }

  /** Which of the two hosts an address belongs to, for showing the user. */
  function moonshotEndpointLabel(baseUrl) {
    return String(baseUrl || '').includes('.cn') ? 'api.moonshot.cn' : 'api.moonshot.ai';
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
      // Anthropic refuses a request from a web page — which this app is, to
      // the server — unless it says it knows. Without this header the
      // browser's preflight is turned away, so every call and every model
      // list failed before it was sent. The key stays on this machine either way.
      headers['anthropic-dangerous-direct-browser-access'] = 'true';
    }
    // 'query' providers carry the key in the URL and need nothing here.
    return Object.assign(headers, p.extraHeaders || {});
  }

  /** The endpoint and headers for a chat request, ready to fetch. */
  function requestFor(provider, key) {
    const p = PROVIDERS[provider];
    if (!p) throw new Error(`Unknown cloud provider: ${provider}`);
    if (p.bridge) throw new Error(`${p.label} is reached through the app, not from the page — use bridgeFor`);
    if (!p.chatUrl) throw new Error(`${p.label} builds its own URL — use its own path`);
    return { url: p.chatUrl, headers: headersFor(provider, key) };
  }

  /** Every host the page itself reaches, for checking against the CSP. */
  function allHosts() {
    const out = new Set();
    for (const p of Object.values(PROVIDERS)) {
      if (p.chatUrl) out.add(new URL(p.chatUrl).origin);
      if (p.host) out.add(new URL(p.host).origin);
      for (const h of p.hosts || []) out.add(new URL(h).origin);
    }
    return [...out];
  }

  /** Where each provider's keys and usage live, for telling someone where to go. */
  const HINTS = {
    groq:        { key: "console.groq.com → API Keys",            quota: "console.groq.com → Usage" },
    gemini:      { key: "aistudio.google.com → Get API key",      quota: "ai.google.dev/gemini-api/docs/quota" },
    openrouter:  { key: "openrouter.ai → Keys",                   quota: "openrouter.ai/activity" },
    cerebras:    { key: "cloud.cerebras.ai → API Keys (free)",    quota: "cloud.cerebras.ai → Usage" },
    samba:       { key: "cloud.sambanova.ai → API Keys (free)",   quota: "cloud.sambanova.ai → Usage" },
    openai:      { key: "platform.openai.com → API Keys",         quota: "platform.openai.com/usage" },
    anthropic:   { key: "console.anthropic.com → API Keys",       quota: "console.anthropic.com/settings/plans" },
    moonshot:    { key: "platform.kimi.ai or platform.kimi.com → API Keys, or kimi.com/code for a Kimi Code key", quota: "platform.kimi.ai / platform.kimi.com" },
    nvidia:      { key: "build.nvidia.com → Get API Key",          quota: "build.nvidia.com" },
    deepseek:    { key: "platform.deepseek.com → API Keys",       quota: "platform.deepseek.com" },
    mistral:     { key: "console.mistral.ai → API Keys",          quota: "console.mistral.ai" },
    xai:         { key: "console.x.ai → API Keys",                quota: "console.x.ai → Usage" },
    together:    { key: "api.together.ai → Settings → API Keys",  quota: "api.together.ai → Usage" },
    fireworks:   { key: "fireworks.ai → Account → API Keys",      quota: "fireworks.ai → Usage" },
    zai:         { key: "z.ai → API Keys",                        quota: "z.ai → Usage" },
    qwen:        { key: "modelstudio.console.alibabacloud.com → API-KEY", quota: "modelstudio.console.alibabacloud.com" },
    huggingface: { key: "huggingface.co/settings/tokens (free)",  quota: "huggingface.co/settings/billing" },
    deepinfra:   { key: "deepinfra.com/dash/api_keys",            quota: "deepinfra.com/dash/usage" },
    novita:      { key: "novita.ai → Settings → Key Management",  quota: "novita.ai → Billing" },
    venice:      { key: "venice.ai → Settings → API",             quota: "venice.ai → Settings → API" },
    cloudflare:  { key: "dash.cloudflare.com → AI → Workers AI (free tier, no card)", quota: "dash.cloudflare.com → AI → Workers AI" },
  };

  /** What to say when a request is made with no key saved for its provider. */
  function keyMissing(provider) {
    const label = (PROVIDERS[provider] && PROVIDERS[provider].label) || provider;
    const where = HINTS[provider] ? ` — get one at ${HINTS[provider].key}` : '';
    return `${label} API key missing.\nAdd it in Settings → APIs${where}`;
  }

  /**
   * Whether a request to this model may carry pictures in the OpenAI shape.
   * Others are sent the words alone; Gemini and Anthropic have their own shapes.
   */
  function readsImages(provider, modelId) {
    if (provider === 'openai' || provider === 'openrouter' || provider === 'nvidia') return true;
    return provider === 'groq' && /vision/i.test(String(modelId || ''));
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
/**
 * The sentence a provider's refusal actually contains, or '' when it holds
 * none.
 *
 * A refusal arrives as JSON, and the fall-through below used to put the first
 * hundred and twenty characters of it on screen — so somebody out of credit
 * read `{"error": {"balance_units":0,"billing_portal_url":"https://...` and
 * had to work out what that meant. Providers put the sentence in one of a
 * handful of places; this reads those, and gives back nothing rather than a
 * fragment of JSON when it cannot find one.
 *
 * Addresses inside the answer are dropped. The body is written by the
 * provider's server, and a link from it rendered into the app is content from
 * elsewhere appearing as if the app said it. Where to go is named by HINTS
 * here, which this app writes.
 */
function messageFrom(body) {
  const raw = String(body || '').trim();
  if (!raw) return '';
  let found = '';
  if (raw.startsWith('{') || raw.startsWith('[')) {
    try {
      const parsed = JSON.parse(raw);
      const pick = (v) => {
        if (typeof v === 'string') return v;
        if (v && typeof v === 'object') return pick(v.message) || pick(v.detail) || pick(v.error) || pick(v.description);
        return '';
      };
      found = pick(parsed.error) || pick(parsed.message) || pick(parsed.detail) || pick(parsed);
    } catch { found = ''; }
  } else {
    found = raw;
  }
  return String(found || '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}

  /**
   * A failure a reply carried in its body (see js/stream/sse.js openAIError),
   * as the Error the same failure sent as an HTTP status would have been.
   */
  function bodyFailure(provider, failed) {
    const body = JSON.stringify({ error: { message: failed.message } });
    return Object.assign(new Error(cloudHttpError(provider, failed.status, body, null)), { status: failed.status, body, inBody: true });
  }

  function cloudHttpError(provider, status, body, retryAfter) {
    const PROVIDER_LABELS = {
      groq: "Groq", gemini: "Google Gemini", openrouter: "OpenRouter",
      cerebras: "Cerebras", samba: "SambaNova", nvidia: "NVIDIA",
      openai: "OpenAI", anthropic: "Anthropic", moonshot: "Moonshot (Kimi)",
      deepseek: "DeepSeek", mistral: "Mistral AI",
      xai: "xAI (Grok)", together: "Together AI", fireworks: "Fireworks AI",
      zai: "Z.ai (GLM)", qwen: "Alibaba Qwen", huggingface: "Hugging Face",
      deepinfra: "DeepInfra", novita: "Novita", venice: "Venice",
      cloudflare: "Cloudflare",
    };
    const providerLabel = PROVIDER_LABELS[provider] || provider;
    const hints = HINTS[provider] || { key: "provider dashboard", quota: "provider dashboard" };
    if (status === 429) {
      const wait = retryAfter ? ` Try again in ${retryAfter}s.` : " Wait ~60s and try again, or switch to a different model.";
      return `${providerLabel} rate limit — free-tier quota exceeded (failed requests count too).${wait}\nCheck usage: ${hints.quota}`;
    }
    // Out of credit. Every provider that charges answers this way when the
    // balance runs out, and it used to fall through to the bottom of this
    // function and put the raw JSON on screen. It is not a rate limit — waiting
    // does not fix it — and it is not a bad key either, so it says which it is
    // and where to put that right.
    if (status === 402) {
      const said = messageFrom(body);
      return `${providerLabel} has no credit left on this account, so it refused the request. `
        + `Waiting will not help — add credit, or pick a model from another provider.`
        + `\nYour account: ${hints.quota}`
        + (said ? `\n${providerLabel} said: ${said}` : "");
    }
    if (status === 401 || status === 403) {
      const serverDetail = messageFrom(body);
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
    // The sentence the provider wrote, never the JSON it arrived in.
    const detail = messageFrom(body);
    return `${providerLabel} error ${status}${detail ? ": " + detail : ""}`;
  }

  window.HCProviders = {
    PROVIDERS, get, headersFor, requestFor, allHosts, bridgeFor, keyMissing, readsImages,
    // Moonshot answers on two hosts across two account systems.
    MOONSHOT_API_BASES, MOONSHOT_MODEL_ORDER,
    isKimiCodeKey, moonshotEndpointLabel, orderedMoonshotBases,
    // What came back, rather than what was sent.
    usageFrom, cloudHttpError, bodyFailure,
    shouldTryNextMoonshotEndpoint, sortMoonshotModelIds,
  };
})();
