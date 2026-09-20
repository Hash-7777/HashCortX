// ==============================================================
// Ask each provider whether the models this app offers still exist
//
//     npm run models
//
// NOT part of `npm run check`. It talks to the network, and a check that
// fails because someone's wifi dropped teaches people to ignore checks.
//
// WHY IT EXISTS. src/data/cloud-models.js is the list the model picker shows
// before any provider has been asked — on a first run, with no key, with the
// network down, or when a provider answers with something unusable. It is a
// table of other people's decisions, and it goes stale on their schedule, not
// ours. Measured twice now, three weeks apart: seven of the eight OpenRouter
// entries were dead both times. A person installing the app met eight free
// models, seven of which failed on use.
//
// The app survives that — a model the provider says is gone is marked retired
// and the run moves to another (js/model-routes.js) — but the first call still
// fails, and a first run is where trust is won or lost.
//
// WHAT IT CAN AND CANNOT CHECK. OpenRouter publishes its catalogue with no key
// at all, so that one is always checkable and is where the rot has been. The
// others need a key; this reads one from the environment when it is there and
// says plainly when it is not. It never reads the app's stored keys — those
// belong to whoever is using the app, not to a script.
// ==============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(readFileSync(join(root, 'src', 'data', 'cloud-models.js'), 'utf8'), sandbox, { filename: 'cloud-models.js' });
const FALLBACK = sandbox.window.HCCloudModels.CLOUD_FALLBACK;

/** The model id inside a "cloud:<provider>:<id>" value, which may hold colons. */
const idOf = (value) => String(value).split(':').slice(2).join(':');

// How to ask each provider for its catalogue, and how to read the answer.
// `key` names the environment variable, and a provider with none is skipped
// with a word about why rather than being reported as healthy.
const PROVIDERS = {
  openrouter: {
    url: 'https://openrouter.ai/api/v1/models',
    key: null,   // public
    ids: (json) => (json.data || []).map((m) => m.id),
  },
  // These two refuse a request from a web page, which is why the app asks for
  // them through Rust — but their catalogues are public, so this can read them
  // directly.
  samba: {
    url: 'https://api.sambanova.ai/v1/models',
    key: null,
    ids: (json) => (json.data || []).map((m) => m.id),
  },
  nvidia: {
    url: 'https://integrate.api.nvidia.com/v1/models',
    key: null,
    ids: (json) => (json.data || []).map((m) => m.id),
  },
  cerebras: {
    url: 'https://api.cerebras.ai/v1/models',
    key: 'CEREBRAS_API_KEY',
    headers: (k) => ({ authorization: `Bearer ${k}` }),
    ids: (json) => (json.data || []).map((m) => m.id),
  },
  gemini: {
    url: 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000',
    key: 'GEMINI_API_KEY',
    // Google names a model "models/gemini-2.5-flash"; the app stores the tail.
    headers: (k) => ({ 'x-goog-api-key': k }),
    ids: (json) => (json.models || []).map((m) => String(m.name || '').replace(/^models\//, '')),
  },
  anthropic: {
    url: 'https://api.anthropic.com/v1/models?limit=1000',
    key: 'ANTHROPIC_API_KEY',
    headers: (k) => ({ 'x-api-key': k, 'anthropic-version': '2023-06-01' }),
    ids: (json) => (json.data || []).map((m) => m.id),
  },
  openai: {
    url: 'https://api.openai.com/v1/models',
    key: 'OPENAI_API_KEY',
    headers: (k) => ({ authorization: `Bearer ${k}` }),
    ids: (json) => (json.data || []).map((m) => m.id),
  },
  groq: {
    url: 'https://api.groq.com/openai/v1/models',
    key: 'GROQ_API_KEY',
    headers: (k) => ({ authorization: `Bearer ${k}` }),
    ids: (json) => (json.data || []).map((m) => m.id),
  },
  mistral: {
    url: 'https://api.mistral.ai/v1/models',
    key: 'MISTRAL_API_KEY',
    headers: (k) => ({ authorization: `Bearer ${k}` }),
    ids: (json) => (json.data || []).map((m) => m.id),
  },
  deepseek: {
    url: 'https://api.deepseek.com/models',
    key: 'DEEPSEEK_API_KEY',
    headers: (k) => ({ authorization: `Bearer ${k}` }),
    ids: (json) => (json.data || []).map((m) => m.id),
  },
};

async function upstreamIds(name, how) {
  const key = how.key ? process.env[how.key] : null;
  if (how.key && !key) return { skipped: `no ${how.key} in the environment` };
  try {
    const res = await fetch(how.url, {
      headers: { accept: 'application/json', ...(how.headers && key ? how.headers(key) : {}) },
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) return { skipped: `${name} answered ${res.status}` };
    return { ids: new Set(how.ids(await res.json())) };
  } catch (err) {
    return { skipped: `could not reach ${name}: ${String(err.message || err).slice(0, 60)}` };
  }
}

let dead = 0;
let checked = 0;
const skipped = [];

console.log('Asking each provider whether the models this app offers still exist.\n');

for (const [name, models] of Object.entries(FALLBACK)) {
  const how = PROVIDERS[name];
  if (!how) { skipped.push(`${name} — no public catalogue endpoint is wired up here`); continue; }
  const answer = await upstreamIds(name, how);
  if (answer.skipped) { skipped.push(`${name} — ${answer.skipped}`); continue; }
  checked++;
  const gone = models.filter((m) => !answer.ids.has(idOf(m.value)));
  dead += gone.length;
  console.log(`  ${name} … ${models.length} offered, ${answer.ids.size} upstream` + (gone.length ? ` — ${gone.length} GONE` : ' — all live'));
  for (const m of gone) console.log(`      gone: ${idOf(m.value)}`);
}

if (skipped.length) {
  console.log('\nNot checked:');
  for (const s of skipped) console.log(`  ${s}`);
}

console.log(dead
  ? `\n${dead} model(s) this app offers no longer exist. Replace them in src/data/cloud-models.js.`
  : `\nEvery model checked across ${checked} provider(s) still exists.`);
process.exit(dead ? 1 : 0);
