// ==============================================================
// Model limit checks
//
// Loads the REAL src/js/model-limits.js. Holds how a request is sized for
// its model, what each provider's refusal is read as, and when a refused
// request is worth sending again. The refusals below are written the way each
// provider words them, with the numbers changed.
//
// Run with: npm run check:model-limits
// ==============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const src = (...p) => readFileSync(join(here, '..', '..', 'src', ...p), 'utf8');
const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(src('js', 'model-limits.js'), sandbox, { filename: 'model-limits.js' });
const L = sandbox.window.HCModelLimits;

let pass = 0;
let fail = 0;
function ok(label, cond) {
  if (cond) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}`); }
}
const memory = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
};
const E = (message, body) => Object.assign(new Error(message), { body });
const T0 = 2_000_000_000_000;
const msgs = (chars) => [{ role: 'system', content: 's' }, { role: 'user', content: 'x'.repeat(chars) }];

console.log('A request is sized for its model:');
{
  const store = memory();
  L.forgetListed();
  L.remember('cloud:openrouter:big:free', { ctx: 262144, out: 65536 });
  const b = L.fitBody('openai', 'cloud:openrouter:big:free', { model: 'big', messages: msgs(3000), temperature: 0.3 }, T0, store);
  ok('the longest answer its list allows is asked for', b.max_tokens === 65536);
  ok('OpenRouter takes max_tokens', !('max_completion_tokens' in b));
  L.remember('cloud:groq:m', { ctx: 131072, out: 65536 });
  const g = L.fitBody('openai', 'cloud:groq:m', { messages: msgs(300) }, T0, store);
  ok('Groq takes max_completion_tokens', g.max_completion_tokens === 65536 && !('max_tokens' in g));
  L.remember('cloud:openai:small-ctx', { ctx: 8192 });
  const o = L.fitBody('openai', 'cloud:openai:small-ctx', { messages: msgs(9000) }, T0, store);
  ok('with only a context known, the answer is what the question leaves room for', o.max_completion_tokens === 8192 - L.estimateTokens([msgs(9000)]) - 256);
  const unknown = L.fitBody('openai', 'cloud:deepseek:new', { messages: msgs(10), max_tokens: 50 }, T0, store);
  ok('a model nothing is known about keeps its provider\'s default', !('max_tokens' in unknown) && !('max_completion_tokens' in unknown));
  const a = L.fitBody('anthropic', 'cloud:anthropic:x', { messages: msgs(10) }, T0, store);
  ok('Anthropic, which requires the field, gets a working default when nothing is listed', a.max_tokens === L.ANTHROPIC_DEFAULT);
  L.remember('cloud:anthropic:y', { ctx: 200000, out: 64000 });
  ok('... and its listed limit when there is one', L.fitBody('anthropic', 'cloud:anthropic:y', { messages: msgs(10) }, T0, store).max_tokens === 64000);
  L.remember('cloud:gemini:g', { ctx: 1048576, out: 65536 });
  const gm = L.fitBody('gemini', 'cloud:gemini:g', { contents: [{ parts: [{ text: 'hi' }] }], generationConfig: { temperature: 0.2 } }, T0, store);
  ok('Gemini gets maxOutputTokens beside the settings it had', gm.generationConfig.maxOutputTokens === 65536 && gm.generationConfig.temperature === 0.2);
  L.remember('cloud:openai:tiny', { ctx: 1000 });
  const full = L.fitBody('openai', 'cloud:openai:tiny', { messages: msgs(6000) }, T0, store);
  ok('a question with no room left is sent without a limit, for the provider to refuse in its own words', !('max_completion_tokens' in full));
  ok('an image counts as an image, not as the length of its encoding', L.estimateTokens([{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,' + 'A'.repeat(90000) } }] }]) < 2000);
}

console.log('\nWhat each provider\'s refusal is read as:');
{
  const r = L.readRefusal;
  ok('a per-minute budget (Groq wording)', r('Request too large for model `m` in organization `o` service tier `on_demand` on tokens per minute (TPM): Limit 6000, Requested 9100, please reduce your message size').tpm === 6000);
  ok('a per-minute budget (OpenAI wording)', r('Request too large for m in organization o on tokens per min (TPM): Limit 30000, Requested 41000.').tpm === 30000);
  ok('a context limit (OpenAI and OpenRouter wording)', r("This model's maximum context length is 131072 tokens. However, you requested 140000 tokens").ctx === 131072);
  ok('a context limit (Mistral wording)', r('Prompt contains 40000 tokens and 0 draft tokens, too large for model with 32768 maximum context length').ctx === 32768);
  ok('a context limit (Gemini wording)', r('The input token count (1200000) exceeds the maximum number of tokens allowed (1048576).').ctx === 1048576);
  ok('a context limit (Cerebras wording)', r('Please reduce the length of the messages or completion. Current length is 70000 while limit is 65536').ctx === 65536);
  ok('a context limit (Anthropic wording)', r('prompt is too long: 210000 tokens > 200000 maximum').ctx === 200000 && r('input length and `max_tokens` exceed context limit: 188000 + 21000 > 200000').ctx === 200000);
  ok('an answer limit (Anthropic wording)', r('max_tokens: 64000 > 32000, which is the maximum allowed number of output tokens for claude-x').out === 32000);
  ok('an answer limit (Groq wording)', r('`max_completion_tokens` must be less than or equal to `32768`, the maximum value').out === 32768);
  ok('an answer limit (DeepSeek wording)', r('Invalid max_tokens value, the valid range of max_tokens is [1, 8192]').out === 8192);
  ok('an answer limit (Gemini range wording)', r('it has a maxOutputTokens value of 100000 but the supported range is from 1 (inclusive) to 65537 (exclusive)').out === 65536);
  ok('an answer limit from what the credit covers (OpenRouter)', r('You requested up to 65536 tokens, but can only afford 4000.').out === 4000);
  ok('a temperature the model will not take', r("Unsupported value: 'temperature' does not support 0.2 with this model. Only the default (1) value is supported.").drop.join() === 'temperature');
  ok('a parameter named in the error body', r('{"error":{"message":"x","type":"invalid_request_error","param":"max_tokens","code":"unsupported_parameter"}}').drop.join() === 'max_tokens');
  ok('a field a strict API does not know', r('{"detail":[{"type":"extra_forbidden","loc":["body","stream_options"],"msg":"Extra inputs are not permitted"}]}').drop.join() === 'stream_options');
  ok('the model or the messages are never dropped', !r("'messages' is not supported").drop && !r("Unsupported parameter: 'model'").drop);
  ok('an ordinary rate limit says nothing to learn', Object.keys(r('Rate limit reached for requests per day')).length === 0);
}

console.log('\nLearning from a refusal:');
{
  const store = memory();
  L.forgetListed();
  L.remember('cloud:groq:m', { ctx: 131072, out: 65536 });
  const body = 'Request too large for model `m` on tokens per minute (TPM): Limit 8000, Requested 70000';
  const small = L.learn('cloud:groq:m', E('Groq: request too large', body), 2000, 0, T0, store);
  ok('a budget stated only in the full body is learnt', small.learnt && small.limits.tpm === 8000);
  ok('... and a short question is sent again, sized to fit', small.retry === true);
  const next = L.fitBody('openai', 'cloud:groq:m', { messages: msgs(6000) }, T0, store);
  ok('the next request is right the first time', next.max_completion_tokens === 8000 - L.estimateTokens([msgs(6000)]) - 128);
  ok('the same refusal again teaches nothing new, so it is not sent again', L.learn('cloud:groq:m', E('x', body), 2000, 0, T0, store).retry === false);
  ok('a model cannot hold a job its budget is too small for', !L.canHold('cloud:groq:m', 6000, 8000, T0, store));
  ok('... but can hold a short one', L.canHold('cloud:groq:m', 1000, 2000, T0, store));
  const store2 = memory();
  const big = L.learn('cloud:groq:m', E('x', body), 7500, 8000, T0, store2);
  ok('a budget smaller than question plus the answer needed means another model, not a retry', big.learnt && big.retry === false);
  const store3 = memory();
  L.learn('cloud:openai:o', E("Unsupported value: 'temperature' does not support 0.2 with this model."), 100, 0, T0, store3);
  const t = L.fitBody('openai', 'cloud:openai:o', { messages: msgs(10), temperature: 0.2 }, T0, store3);
  ok('a parameter a model refused is left out from then on', !('temperature' in t));
  L.learn('cloud:openai:o', E('x', '{"error":{"param":"max_completion_tokens","code":"unsupported_parameter"}}'), 100, 0, T0, store3);
  L.remember('cloud:openai:o', { out: 4096 });
  const swapped = L.fitBody('openai', 'cloud:openai:o', { messages: msgs(10) }, T0, store3);
  ok('a model that refuses one name for the answer limit is sent the other', swapped.max_tokens === 4096 && !('max_completion_tokens' in swapped));
  ok('what was learnt lasts two weeks', L.infoOf('cloud:openai:o', T0 + L.LEARNED_FOR_MS - 1, store3).drop.includes('temperature') && !L.infoOf('cloud:openai:o', T0 + L.LEARNED_FOR_MS + 1, store3).drop.length);
  L.forgetLearned(store3);
  ok('Update model lists forgets it', !L.infoOf('cloud:openai:o', T0, store3).drop.length);
  const broken = { getItem: () => '{nope', setItem: () => { throw new Error('full'); }, removeItem: () => {} };
  ok('unreadable storage reads as nothing learnt', L.infoOf('x', T0, broken).drop.length === 0);
  ok('full storage does not throw', L.learn('x', E("Unsupported value: 'temperature'"), 0, 0, T0, broken).learnt === true);
  ok('a listed limit tighter than a learnt one wins', (() => { const st = memory(); L.remember('cloud:x:y', { out: 1000 }); L.learn('cloud:x:y', E('max_tokens must be less than or equal to 9000'), 0, 0, T0, st); return L.infoOf('cloud:x:y', T0, st).out === 1000; })());
}

console.log(`\n${pass} passed, ${fail} failed  (model limits)`);
if (fail) process.exit(1);
