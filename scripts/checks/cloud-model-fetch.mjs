// ==============================================================
// Asking each provider what models it has — checks
//
// Loads the REAL src/js/cloud-model-fetch.js and runs every fetcher against
// recorded answers shaped the way each provider answers, with no network and
// no app around them.
//
// Three things are held here:
//
//  - The whole list is read. Google pages its answer and Anthropic can too;
//    only the first page used to be read.
//  - Each model keeps the limits its list gave — how much it reads, the
//    longest answer it can write, whether it calls tools — because every
//    request to it is sized by them (js/model-limits.js).
//  - A list is cut down to what can hold a conversation through the interface
//    this app uses, and no further. A filter written as "the current
//    generation" empties itself the day the next one ships, silently, so every
//    fetcher is asked about a model from a generation that does not exist yet.
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

// Answers by address. Set per test; every request is recorded.
let routes = [];
const calls = [];
const respond = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
  text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
});
const sandbox = {
  window: {},
  fetch: async (url, init = {}) => {
    calls.push({ url: String(url), headers: init.headers || {} });
    for (const [re, answer] of routes) if (re.test(String(url))) return typeof answer === 'function' ? answer(String(url)) : answer;
    return respond(404, { error: { message: 'no such address in this test' } });
  },
};
vm.createContext(sandbox);
vm.runInContext(readFileSync(join(root, 'src', 'js', 'cloud-model-fetch.js'), 'utf8'), sandbox, { filename: 'cloud-model-fetch.js' });

const F = sandbox.window.HCCloudModelFetch.create({
  prettify: (id) => String(id),
  isExcluded: () => false,
  moonshotApi: async (path, key, init) => {
    const res = await sandbox.fetch(`https://api.moonshot.ai/v1${path}`, init());
    return { res };
  },
  sortMoonshotIds: (ids) => ids.slice().sort(),
  kimiCodeKey: (k) => /^sk-ki/.test(k),
});
const on = (...pairs) => { routes = pairs; calls.length = 0; };
const ids = (list) => list.map((m) => m.value);
const find = (list, id) => list.find((m) => m.value.endsWith(`:${id}`));

console.log('Every provider the app can reach has a fetcher:');
for (const p of ['groq', 'gemini', 'openrouter', 'cerebras', 'openai', 'anthropic', 'moonshot', 'deepseek', 'mistral']) ok(p, typeof F[p] === 'function');
ok('none for the two that refuse requests from inside the app', !('samba' in F) && !('nvidia' in F));

console.log('\nGroq — limits carried, only chat models kept:');
{
  on([/api\.groq\.com\/openai\/v1\/models$/, respond(200, { data: [
    { id: 'zeta-120b', active: true, context_window: 131072, max_completion_tokens: 65536 },
    { id: 'alpha-99-enormous', active: true, context_window: 262144, max_completion_tokens: 32768 },
    { id: 'retired-one', active: false, context_window: 8192 },
    { id: 'whisper-large-v3', active: true },
    { id: 'meta-llama/llama-prompt-guard-2', active: true },
    { id: 'playai-tts', active: true },
  ] })]);
  const got = await F.groq('k');
  ok('chat models come back, ordered', ids(got).join() === 'cloud:groq:alpha-99-enormous,cloud:groq:zeta-120b');
  ok('each keeps its context and longest answer', find(got, 'zeta-120b').ctx === 131072 && find(got, 'zeta-120b').out === 65536);
  ok('a model Groq marks inactive is left out', !find(got, 'retired-one'));
  ok('speech, guard and voice models are left out', got.length === 2);
  ok('the key goes in the Authorization header', calls[0].headers.Authorization === 'Bearer k');
}

console.log('\nGoogle — every page read, limits carried:');
{
  const model = (id, extra = {}) => ({ name: `models/${id}`, displayName: id.toUpperCase(), supportedGenerationMethods: ['generateContent'], inputTokenLimit: 1048576, outputTokenLimit: 65536, ...extra });
  on([/models\?pageSize=1000&key=k$/, respond(200, { models: [model('gemini-2.5-pro'), model('gemini-1.5-pro'), model('text-embedding-004', { supportedGenerationMethods: ['embedContent'] })], nextPageToken: 'P2' })],
    [/pageToken=P2/, respond(200, { models: [model('gemini-99-ultra'), model('gemma-4-31b-it', { inputTokenLimit: 131072, outputTokenLimit: 8192 }), model('gemini-3.1-flash-image-preview'), model('gemini-2.5-flash-preview-tts'), model('gemini-2.5-flash-native-audio')] })]);
  const got = await F.gemini('k');
  ok('it asks for a thousand to a page', /pageSize=1000/.test(calls[0].url));
  ok('it reads the second page', calls.length === 2 && /pageToken=P2/.test(calls[1].url));
  ok('a model on the second page is offered', !!find(got, 'gemini-99-ultra'));
  ok('the models/ prefix is stripped and Google\'s own name used', !!find(got, 'gemini-2.5-pro') && find(got, 'gemini-2.5-pro').shortLabel === 'GEMINI-2.5-PRO');
  ok('each keeps its limits', find(got, 'gemini-2.5-pro').ctx === 1048576 && find(got, 'gemini-2.5-pro').out === 65536 && find(got, 'gemma-4-31b-it').out === 8192);
  ok('the retired 1.x generation is left out', !find(got, 'gemini-1.5-pro'));
  ok('a model that cannot hold a conversation is left out', !find(got, 'text-embedding-004'));
  ok('speech and live-audio models are left out', !find(got, 'gemini-2.5-flash-preview-tts') && !find(got, 'gemini-2.5-flash-native-audio'));
  ok('Gemma is marked as taking no tools', find(got, 'gemma-4-31b-it').tools === false && find(got, 'gemini-2.5-pro').tools === true);
  ok('an image model is marked and listed last', got[got.length - 1].value.endsWith('image-preview') && got[got.length - 1].imageGen === true);
}

console.log('\nOpenRouter — paid models only when the key can pay:');
{
  const list = { data: [
    { id: 'vendor/free-one:free', name: 'Free One (free)', context_length: 131072, top_provider: { context_length: 131072, max_completion_tokens: 32768 }, supported_parameters: ['tools', 'max_tokens'], architecture: { output_modalities: ['text'] }, pricing: { prompt: '0', completion: '0' } },
    { id: 'vendor/paid-one', name: 'Paid One', context_length: 400000, top_provider: { context_length: 400000, max_completion_tokens: 128000 }, supported_parameters: ['max_tokens'], architecture: { output_modalities: ['text'] }, pricing: { prompt: '0.000001', completion: '0.000004' } },
    { id: '~vendor/latest', name: 'Alias', pricing: { prompt: '0', completion: '0' } },
    { id: 'vendor/expired:free', name: 'Old', expiration_date: '2000-01-01', pricing: { prompt: '0', completion: '0' } },
    { id: 'vendor/pictures:free', name: 'Pictures', architecture: { output_modalities: ['image'] }, pricing: { prompt: '0', completion: '0' } },
    { id: 'vendor/content-safety:free', name: 'Classifier', pricing: { prompt: '0', completion: '0' } },
    { id: 'no-slash', name: 'Malformed', pricing: { prompt: '0', completion: '0' } },
  ] };
  on([/openrouter\.ai\/api\/v1\/models$/, respond(200, list)], [/openrouter\.ai\/api\/v1\/key$/, respond(200, { data: { is_free_tier: true, limit_remaining: null } })]);
  const free = await F.openrouter('k');
  ok('a key without credit gets the free models only', ids(free).join() === 'cloud:openrouter:vendor/free-one:free');
  ok('... and says why', /free models only — this key has no credit/.test(free.note));
  ok('a free model keeps its limits and whether it calls tools', free[0].ctx === 131072 && free[0].out === 32768 && free[0].tools === true && free[0].free === true);
  ok('the key is used to ask what it can pay for', calls.some((c) => /\/key$/.test(c.url) && c.headers.Authorization === 'Bearer k'));
  on([/openrouter\.ai\/api\/v1\/models$/, respond(200, list)], [/openrouter\.ai\/api\/v1\/key$/, respond(200, { data: { is_free_tier: false, limit_remaining: 12.5 } })]);
  const paid = await F.openrouter('k');
  ok('a key with credit gets the paid models too', ids(paid).join() === 'cloud:openrouter:vendor/free-one:free,cloud:openrouter:vendor/paid-one');
  ok('... free first, with the paid one\'s limits', paid[1].out === 128000 && paid[1].tools === false && /paid models included/.test(paid.note));
  on([/openrouter\.ai\/api\/v1\/models$/, respond(200, list)], [/openrouter\.ai\/api\/v1\/key$/, respond(200, { data: { is_free_tier: false, limit_remaining: 0 } })]);
  ok('a key whose spending limit is used up gets the free ones', (await F.openrouter('k')).length === 1);
  on([/openrouter\.ai\/api\/v1\/models$/, respond(200, list)]);
  const keyless = await F.openrouter('');
  ok('with no key the free list is still read', keyless.length === 1 && /add a key/.test(keyless.note) && !calls.some((c) => /\/key$/.test(c.url)));
  on([/openrouter\.ai\/api\/v1\/models$/, respond(200, list)], [/openrouter\.ai\/api\/v1\/key$/, respond(500, 'down')]);
  ok('a key check that fails leaves the free list', (await F.openrouter('k')).length === 1);
}

console.log('\nOpenAI — everything that answers the chat interface:');
{
  on([/api\.openai\.com\/v1\/models$/, respond(200, { data: [
    { id: 'gpt-4o', created: 100 }, { id: 'gpt-9-turbo', created: 900 }, { id: 'o9-mini', created: 800 }, { id: 'chatgpt-4o-latest', created: 50 },
    { id: 'gpt-5-codex', created: 700 }, { id: 'o3-pro', created: 600 }, { id: 'gpt-4o-realtime-preview', created: 1 }, { id: 'gpt-4o-audio-preview', created: 1 },
    { id: 'gpt-4o-mini-transcribe', created: 1 }, { id: 'gpt-image-1', created: 1 }, { id: 'gpt-4o-search-preview', created: 1 }, { id: 'text-embedding-3-large', created: 1 },
    { id: 'gpt-3.5-turbo-instruct', created: 1 }, { id: 'dall-e-3', created: 1 }, { id: 'omni-moderation-latest', created: 1 }, { id: 'computer-use-preview', created: 1 },
  ] })]);
  const got = await F.openai('k');
  ok('chat models come back, newest first', ids(got).join() === 'cloud:openai:gpt-9-turbo,cloud:openai:o9-mini,cloud:openai:gpt-4o,cloud:openai:chatgpt-4o-latest');
  ok('models that only answer the Responses interface are left out', !find(got, 'gpt-5-codex') && !find(got, 'o3-pro'));
}

console.log('\nAnthropic — asked with the header a web page needs, every page read:');
{
  on([/v1\/models\?limit=1000$/, respond(200, { data: [{ id: 'claude-fictional-9', display_name: 'Claude Fictional 9', created_at: '2099-01-01T00:00:00Z', max_input_tokens: 1000000, max_tokens: 128000 }], has_more: true, last_id: 'claude-fictional-9' })],
    [/after_id=claude-fictional-9/, respond(200, { data: [{ id: 'claude-old-1', created_at: '2024-01-01T00:00:00Z', max_input_tokens: 0, max_tokens: null }], has_more: false, last_id: 'claude-old-1' })]);
  const got = await F.anthropic('k');
  ok('the browser-access header is sent, or the request never leaves', calls[0].headers['anthropic-dangerous-direct-browser-access'] === 'true' && calls[0].headers['x-api-key'] === 'k');
  ok('the second page is read', ids(got).includes('cloud:anthropic:claude-old-1'));
  ok('newest first, by Anthropic\'s own name', got[0].value === 'cloud:anthropic:claude-fictional-9' && got[0].shortLabel === 'Claude Fictional 9');
  ok('each keeps its limits', got[0].ctx === 1000000 && got[0].out === 128000);
  ok('a limit given as zero or nothing is not a limit', got[1].ctx === undefined && got[1].out === undefined && got[1].shortLabel === 'claude-old-1');
}

console.log('\nMistral — what it says of each model is used:');
{
  on([/api\.mistral\.ai\/v1\/models$/, respond(200, { data: [
    { id: 'mistral-enormous-2099', max_context_length: 256000, capabilities: { completion_chat: true, function_calling: true } },
    { id: 'mistral-enormous-2099', max_context_length: 256000, capabilities: { completion_chat: true, function_calling: true } },
    { id: 'codestral-fim', capabilities: { completion_chat: false } },
    { id: 'mistral-archived', archived: true, capabilities: { completion_chat: true } },
    { id: 'mistral-leaving', deprecation: '2000-01-01', capabilities: { completion_chat: true } },
    { id: 'mistral-leaving-later', deprecation: '2999-01-01', capabilities: { completion_chat: true, function_calling: false } },
    { id: 'mistral-embed', capabilities: { completion_chat: false } },
    { id: 'mistral-ocr-latest', capabilities: { completion_chat: true } },
  ] })]);
  const got = await F.mistral('k');
  ok('chat models come back once each', ids(got).join() === 'cloud:mistral:mistral-enormous-2099,cloud:mistral:mistral-leaving-later');
  ok('context and tools are carried', got[0].ctx === 256000 && got[0].tools === true && got[1].tools === false);
}

console.log('\nThe OpenAI-shaped rest:');
{
  on([/api\.cerebras\.ai/, respond(200, { data: [{ id: 'llama-99-enormous' }, { id: 'some-embed-model' }] })]);
  ok('Cerebras', ids(await F.cerebras('k')).join() === 'cloud:cerebras:llama-99-enormous');
  on([/api\.deepseek\.com/, respond(200, { data: [{ id: 'deepseek-v9' }] })]);
  ok('DeepSeek', ids(await F.deepseek('k')).join() === 'cloud:deepseek:deepseek-v9');
  on([/api\.moonshot\.ai/, respond(200, { data: [{ id: 'kimi-k9', context_length: 262144 }, { id: 'moonshot-v1-embedding' }] })]);
  const kimi = await F.moonshot('k');
  ok('Kimi, with a context length when it gives one', ids(kimi).join() === 'cloud:moonshot:kimi-k9' && kimi[0].ctx === 262144);
  let refused = null;
  try { await F.moonshot('sk-ki-x'); } catch (e) { refused = e; }
  ok('a Kimi for Code key is refused with the reason, before a request is made', !!refused && /Kimi for Code keys/.test(refused.message));
}

console.log('\nA provider that refuses says why, rather than answering with nothing:');
for (const p of ['groq', 'gemini', 'openrouter', 'cerebras', 'openai', 'anthropic', 'moonshot', 'deepseek', 'mistral']) {
  on([/./, respond(401, { error: { message: 'Invalid API Key' } })]);
  let err = null;
  try { await F[p]('k'); } catch (e) { err = e; }
  ok(`${p}`, !!err && /HTTP 401/.test(err.message) && /Invalid API Key/.test(err.message), err ? err.message : 'no error');
}

console.log(`\n${pass} passed, ${fail} failed  (asking each provider)`);
process.exit(fail ? 1 : 0);
