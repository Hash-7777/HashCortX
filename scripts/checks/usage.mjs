// ==============================================================
// Usage-log checks
//
// HashMeterAi reads ~/.hashcortx/usage.jsonl and reports it as MEASURED. That
// promise only holds if every path records, and records real counts.
//
// It did not: usage was logged in one place, so cloud chat was counted and
// local Ollama and every Coder-mode turn were not. The total was quietly short
// and nothing looked wrong.
//
// These load the real usageFrom() and feed it each provider's actual response
// shape. It lives in src/js/providers.js — beside the rest of what this app
// knows about providers — rather than being lifted out of app.js by matching
// its text, which broke the moment it moved.
//
// Run with: npm run check:usage
// ==============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const appjs = readFileSync(process.argv[2] || join(root, 'src', 'js', 'app.js'), 'utf8');

const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(readFileSync(join(root, 'src', 'js', 'providers.js'), 'utf8'), sandbox, { filename: 'providers.js' });
const usageFrom = sandbox.window.HCProviders?.usageFrom;
if (typeof usageFrom !== 'function') { console.error('providers.js does not publish usageFrom'); process.exit(1); }

let pass = 0, fail = 0;
function check(label, condition, detail = '') {
  if (condition) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}

const eq = (got, i, o) => got && got.input === i && got.output === o;

console.log('\nEach provider reports counts in its own shape:');
check('OpenAI-compatible (most providers)',
  eq(usageFrom({ usage: { prompt_tokens: 120, completion_tokens: 45 } }), 120, 45));
check('Anthropic', eq(usageFrom({ usage: { input_tokens: 300, output_tokens: 90 } }), 300, 90));
check('Gemini', eq(usageFrom({ usageMetadata: { promptTokenCount: 55, candidatesTokenCount: 12 } }), 55, 12));
check('Ollama', eq(usageFrom({ prompt_eval_count: 800, eval_count: 210 }), 800, 210));

console.log('\nTokens read from a provider\'s cache are counted apart:');
{
  const oa = usageFrom({ usage: { prompt_tokens: 1000, completion_tokens: 40, prompt_tokens_details: { cached_tokens: 800 } } });
  check('OpenAI-compatible: the cached part is taken out of the input', oa.input === 200 && oa.cacheRead === 800 && oa.output === 40 && !('cacheWrite' in oa));
  const ds = usageFrom({ usage: { prompt_tokens: 900, completion_tokens: 10, prompt_cache_hit_tokens: 600, prompt_cache_miss_tokens: 300 } });
  check('DeepSeek spells it its own way', ds.input === 300 && ds.cacheRead === 600);
  const an = usageFrom({ usage: { input_tokens: 50, output_tokens: 20, cache_read_input_tokens: 4000, cache_creation_input_tokens: 700 } });
  check('Anthropic: read and written counted apart, input as reported', an.input === 50 && an.cacheRead === 4000 && an.cacheWrite === 700);
  const ge = usageFrom({ usageMetadata: { promptTokenCount: 500, candidatesTokenCount: 9, cachedContentTokenCount: 450 } });
  check('Gemini: the cached part is taken out of the prompt', ge.input === 50 && ge.cacheRead === 450);
  check('no cache reported: the counts are exactly what they were',
    JSON.stringify(usageFrom({ usage: { prompt_tokens: 120, completion_tokens: 45, prompt_tokens_details: { cached_tokens: 0 } } })) === '{"input":120,"output":45}');
  check('a cached count larger than the prompt never makes the input negative',
    usageFrom({ usage: { prompt_tokens: 10, completion_tokens: 1, prompt_tokens_details: { cached_tokens: 99 } } }).input === 0);
  const R = sandbox.window.HCProviders.usageRecord;
  const line = R('m', an, 't');
  check('the usage log is given them in the fields it has for them', line.input_tokens === 50 && line.cache_read === 4000 && line.cache_write === 700 && line.output_tokens === 20);
  check('a line with no cache has exactly the fields it always had', JSON.stringify(R('m', { input: 3, output: 4 }, 't')) === '{"ts":"t","model":"m","input_tokens":3,"output_tokens":4}');
  check('nothing reported, nothing written', R('m', { input: 0, output: 0 }, 't') === null && R('m', null, 't') === null);
  check('a turn served from the cache alone is still written', R('m', { input: 0, output: 0, cacheRead: 900 }, 't').cache_read === 900);
  const rec = appjs.slice(appjs.indexOf('function recordUsage('), appjs.indexOf('function recordUsage(') + 400);
  check('app.js records through it', /HCProviders\.usageRecord\(model, \{ input, output, cacheRead, cacheWrite \}/.test(rec));
  check('every agent turn hands them on', (appjs.match(/recordUsage\(model, u\.input, u\.output, u\.cacheRead, u\.cacheWrite\)/g) || []).length === 4);
}

console.log('\nNothing is invented when a provider stays silent:');
check('no usage field at all', usageFrom({ choices: [] }) === null);
check('empty object', usageFrom({}) === null);
check('null and undefined', usageFrom(null) === null && usageFrom(undefined) === null);
check('a non-object', usageFrom('nope') === null);

console.log('\nEvery path that finishes a model turn records:');
// streamCloudModel is a wrapper that sends a refused request once more; the
// turn itself, and its recording, is streamCloudModelOnce.
// Every send, the first and the resent one, goes through the one helper that
// calls it, and nothing in the wrapper sends a request around it.
{
  const wrapper = appjs.slice(appjs.indexOf('async function streamCloudModel('), appjs.indexOf('async function streamCloudModelOnce('));
  check('streamCloudModel sends every request through the turn that records',
    (wrapper.match(/streamCloudModelOnce\(/g) || []).length >= 1
    && !/\bfetch\(|providerPost\(|bridgedRequest\(/.test(wrapper));
}
const paths = ['streamCloudModelOnce', 'streamChat', 'agentTurnOllama', 'agentTurnOpenAI',
               'agentTurnAnthropic', 'agentTurnGemini'];
for (const name of paths) {
  const s = appjs.indexOf(`function ${name}(`);
  const nextFn = appjs.indexOf('\n  async function ', s + 10);
  const body = appjs.slice(s, nextFn > 0 ? nextFn : s + 20000);
  check(`${name} records usage`, /recordUsage\(/.test(body),
    'a path that does not record makes the reported total short');
}

console.log(`\n${pass} passed, ${fail} failed  (usage log)`);
process.exit(fail ? 1 : 0);
