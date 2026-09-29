// ==============================================================
// Cloud models in the HashCoder benchmark
//
// A cloud model is run the way a local one is: the real app in a headless
// browser, every command the agent runs inside the macOS sandbox, in a
// throwaway folder. What a cloud model adds is a key, and a key is handled
// with care here:
//
//   · It is read from an environment variable the person sets in their own
//     terminal, HASHCORTX_BENCH_KEY_<PROVIDER> (ANTHROPIC, OPENAI, GEMINI,
//     GROQ, ...), and from nowhere else: never from the app's own store.
//   · It reaches only the headless browser, through the page this runner
//     serves on this computer, into a browser profile that is deleted when
//     each task ends.
//   · The browser reaches only this runner, the local model server, and the
//     addresses of the providers whose keys were given.
//   · Everything written or printed is first searched for each key, and for
//     anything shaped like one, which is replaced.
//
// Each task makes real requests to the provider, which the provider bills
// or counts against its quota.
// ==============================================================
import fs from 'node:fs';
import vm from 'node:vm';

/** The key's name in the app's own store, for each provider the page reaches itself. */
export const KEY_NAMES = {
  anthropic: 'anthropicKey', openai: 'openaiKey', gemini: 'geminiKey', groq: 'groqKey',
  deepseek: 'deepseekKey', openrouter: 'openRouterKey', mistral: 'mistralKey', moonshot: 'moonshotKey',
  cerebras: 'cerebrasKey', xai: 'xaiKey', together: 'togetherKey', fireworks: 'fireworksKey',
  zai: 'zaiKey', qwen: 'qwenKey', huggingface: 'huggingfaceKey', deepinfra: 'deepinfraKey',
  novita: 'novitaKey', venice: 'veniceKey',
};

/** The environment variable that holds a provider's key. */
export const envName = (provider) => `HASHCORTX_BENCH_KEY_${String(provider).toUpperCase()}`;

/** The app's provider table (src/js/providers.js), loaded as the app loads it. */
export function loadProviders(srcDir) {
  const box = { window: {} };
  vm.createContext(box);
  vm.runInContext(fs.readFileSync(`${srcDir}/js/providers.js`, 'utf8'), box, { filename: 'providers.js' });
  return box.window.HCProviders;
}

/** The provider named in a cloud model's value, `cloud:<provider>:<model>`, or null. */
export const providerOf = (model) => (/^cloud:([^:]+):./.exec(String(model || '')) || [])[1] || null;

/**
 * The keys given in `env` for providers the page can reach itself:
 * `{ bundle, providers, secrets }` — the app's store as the page should hold
 * it, the providers named, and the keys themselves, for scrubbing.
 */
export function keysFrom(env, P) {
  const bundle = {};
  const providers = [];
  const secrets = [];
  for (const [provider, name] of Object.entries(KEY_NAMES)) {
    const key = String(env[envName(provider)] || '').trim();
    if (!key) continue;
    const p = P && P.get ? P.get(provider) : null;
    if (!p || p.bridge) continue;
    bundle[name] = key;
    providers.push(provider);
    secrets.push(key);
  }
  return { bundle, providers, secrets };
}

/** The addresses the browser may reach for these providers, as a proxy bypass list. */
export function hostsFor(providers, P) {
  const out = new Set();
  for (const provider of providers) {
    const p = P.get(provider);
    if (!p) continue;
    for (const url of [p.chatUrl, p.host, ...(p.hosts || [])]) {
      if (!url) continue;
      try { out.add(new URL(url).hostname); } catch { /* not an address */ }
    }
  }
  return [...out];
}

/** Why a cloud model cannot be run here, or ''. */
export function refusal(model, P, given) {
  const provider = providerOf(model);
  if (!provider) return `${model} is not a cloud model value (cloud:<provider>:<model>)`;
  const p = P.get(provider);
  if (!p) return `no provider called ${provider}`;
  if (p.bridge) return `${p.label} is reached through the app's native side, which the benchmark stands in for; pick another provider`;
  if (!given.includes(provider)) return `no key for ${p.label}: set ${envName(provider)} in this terminal`;
  return '';
}

// Shapes a key takes, for anything that is not one of the keys given but
// looks like one (a provider quoting part of a key back in an error).
const KEY_SHAPES = [
  /\bsk-[A-Za-z0-9_-]{12,}/g, /\bgsk_[A-Za-z0-9]{12,}/g, /\bAIza[0-9A-Za-z_-]{20,}/g,
  /\bxai-[A-Za-z0-9]{12,}/g, /\bnvapi-[A-Za-z0-9_-]{12,}/g, /\bhf_[A-Za-z0-9]{12,}/g,
];

/** A function that replaces each key, and anything shaped like one, in any value. */
export function scrubber(secrets) {
  const keys = (secrets || []).filter((s) => s && s.length >= 8);
  const text = (s) => {
    let out = String(s);
    for (const k of keys) out = out.split(k).join('[key]');
    for (const rx of KEY_SHAPES) out = out.replace(rx, '[key]');
    return out;
  };
  const walk = (v) => {
    if (typeof v === 'string') return text(v);
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return walk;
}
