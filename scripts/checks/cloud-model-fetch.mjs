// ==============================================================
// Asking each provider what models it has — checks
//
// Loads the REAL src/js/cloud-model-fetch.js and runs every one of the ten
// fetchers against a recorded answer, with no network and no app around them.
//
// What is worth checking here is not that a request is made. It is that the
// answer is decoded correctly, and — the part that actually goes wrong — that
// a decoder does not quietly stop returning models when a provider moves on.
// A filter written as "the current generation" is a filter that empties itself
// the day the next one ships, and it fails silently: the fetch still succeeds,
// the list is just missing everything new. That is the defect this file exists
// to catch, so every fetcher is asked about a model from a generation that
// does not exist yet.
//
// Run with: npm run check:cloud-model-fetch
// ==============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');

let pass = 0;
let fail = 0;
function ok(label, cond, detail = '') {
  if (cond) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}

// The answer the next fetch will get. Set per test.
let reply = { ok: true, status: 200, body: {} };
const sandbox = {
  window: {},
  fetch: async () => ({
    ok: reply.ok,
    status: reply.status,
    json: async () => reply.body,
  }),
};
vm.createContext(sandbox);
vm.runInContext(
  readFileSync(join(root, 'src', 'js', 'cloud-model-fetch.js'), 'utf8'),
  sandbox,
  { filename: 'cloud-model-fetch.js' },
);

const SEED = [{ value: 'cloud:seed:from-the-catalogue', label: 'seed', shortLabel: 'seed' }];
const F = sandbox.window.HCCloudModelFetch.create({
  // The real one lives in app.js; the shape is all these decoders use.
  prettify: (id) => String(id),
  isExcluded: () => false,
  seed: () => SEED.slice(),
  moonshotApi: async () => ({ res: { ok: reply.ok, status: reply.status, json: async () => reply.body } }),
  sortMoonshotIds: (ids) => ids.slice().sort(),
});

const answer = (body, o = {}) => { reply = { ok: true, status: 200, body, ...o }; };
const ids = (list) => list.map((m) => m.value);

console.log('\nEvery provider has a fetcher:');
{
  for (const p of ['groq','gemini','openrouter','cerebras','samba','openai','anthropic','moonshot','deepseek','mistral']) {
    ok(p, typeof F[p] === 'function');
  }
}

console.log('\nAn OpenAI-shaped answer is read:');
{
  answer({ data: [{ id: 'zeta-model' }, { id: 'alpha-model' }] });
  const got = await F.groq('k');
  ok('every model comes back', got.length === 2);
  ok('the ids are namespaced to the provider', got.every((m) => m.value.startsWith('cloud:groq:')));
  ok('the list is ordered', ids(got)[0] === 'cloud:groq:alpha-model');
  ok('a label is built', typeof got[0].label === 'string' && got[0].label.includes('Groq'));
}

console.log('\nGoogle\'s shape is read, and the prefix stripped:');
{
  answer({ models: [
    { name: 'models/gemini-2.5-pro', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/gemini-1.5-pro', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/text-embedding-004', supportedGenerationMethods: ['embedContent'] },
  ]});
  const got = await F.gemini('k');
  ok('the models/ prefix is stripped', ids(got).includes('cloud:gemini:gemini-2.5-pro'));
  ok('the deprecated generation is dropped', !ids(got).includes('cloud:gemini:gemini-1.5-pro'));
  ok('a model that cannot hold a conversation is dropped',
    !ids(got).some((v) => v.includes('embedding')));
}

console.log('\nA generation that does not exist yet is still offered:');
{
  // The whole point. Each of these is a model from a future generation, and a
  // decoder that admits only what exists today would drop it silently.
  answer({ models: [
    { name: 'models/gemini-9.0-pro', supportedGenerationMethods: ['generateContent'] },
  ]});
  const gem = await F.gemini('k');
  ok('a future Gemini generation survives the filter',
    ids(gem).includes('cloud:gemini:gemini-9.0-pro'),
    'the filter names a current generation instead of the deprecated one');

  answer({ data: [{ id: 'gpt-9-turbo' }] });
  ok('a future GPT survives', ids(await F.openai('k')).includes('cloud:openai:gpt-9-turbo'));

  answer({ data: [{ id: 'claude-fictional-9-20990101', display_name: 'Claude Fictional 9' }] });
  ok('a future Claude survives', ids(await F.anthropic('k')).includes('cloud:anthropic:claude-fictional-9-20990101'));

  answer({ data: [{ id: 'llama-99-enormous' }] });
  ok('a future Llama survives on Cerebras', ids(await F.cerebras('k')).includes('cloud:cerebras:llama-99-enormous'));
  ok('and on SambaNova', ids(await F.samba('k')).includes('cloud:samba:llama-99-enormous'));

  answer({ data: [{ id: 'deepseek-v9' }] });
  ok('a future DeepSeek survives', ids(await F.deepseek('k')).includes('cloud:deepseek:deepseek-v9'));

  answer({ data: [{ id: 'mistral-enormous-2099' }] });
  ok('a future Mistral survives', ids(await F.mistral('k')).includes('cloud:mistral:mistral-enormous-2099'));
}

console.log('\nAnthropic is asked, not assumed:');
{
  answer({ data: [
    { id: 'claude-old-1', display_name: 'Claude Old', created_at: '2024-01-01T00:00:00Z' },
    { id: 'claude-new-1', display_name: 'Claude New', created_at: '2026-08-01T00:00:00Z' },
  ]});
  const got = await F.anthropic('k');
  ok('the answer is used rather than the catalogue',
    !ids(got).includes('cloud:seed:from-the-catalogue'),
    'this provider used to return the hand-written list unconditionally');
  ok('the newest model is first', ids(got)[0] === 'cloud:anthropic:claude-new-1');
  ok("the provider's own display name is used", got[0].shortLabel === 'Claude New');
  answer({ data: [{ id: 'claude-unnamed-1' }] });
  const unnamed = await F.anthropic('k');
  ok('a model with no display name falls back to its id', unnamed[0].shortLabel === 'claude-unnamed-1');
}

console.log('\nOpenRouter is cut down to the free models:');
{
  answer({ data: [
    { id: 'vendor/paid-model', name: 'Paid' },
    { id: 'vendor/free-model:free', name: 'Free' },
    { id: 'no-slash:free', name: 'Malformed' },
  ]});
  const got = await F.openrouter('');
  ok('only the free models come back', got.length === 1);
  ok('and only the well-formed ones', ids(got)[0] === 'cloud:openrouter:vendor/free-model:free');
}

console.log('\nA provider having a bad day does not empty the menu:');
{
  answer({}, { ok: false, status: 500 });
  for (const p of ['groq', 'gemini', 'openrouter', 'openai', 'anthropic']) {
    let threw = false;
    try { await F[p]('k'); } catch { threw = true; }
    // Throwing is correct: loadCloudModelsFor catches it and seeds the list.
    // Returning an empty array instead would look like a provider with no
    // models at all, which is the one answer that must never reach the menu.
    ok(`${p} reports the failure rather than answering with nothing`, threw);
  }

  answer({ data: [] });
  ok('an empty answer falls back to the catalogue',
    ids(await F.cerebras('k')).includes('cloud:seed:from-the-catalogue'));
  ok('so does a missing key', ids(await F.openai('')).includes('cloud:seed:from-the-catalogue'));
}

console.log(`\n${pass} passed, ${fail} failed  (asking each provider)`);
process.exit(fail ? 1 : 0);
