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
  const itpm = r('Request too large for model `qwen/qwen3.8-27b` service tier `on_demand` on input tokens per minute (ITPM): Limit 8000, Requested 12000, please reduce your message size and try again.');
  ok('a budget for the question alone (Groq\'s newer wording) is read as one, and not as a budget for both', itpm.itpm === 8000 && itpm.tpm === undefined);
  const otpm = r('on output tokens per minute (OTPM): Limit 4000, Requested 9000');
  ok('...and one for the answer alone', otpm.otpm === 4000 && otpm.tpm === undefined && otpm.itpm === undefined);
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
  const store4 = memory();
  const qBody = 'Request too large for model `q` service tier `on_demand` on input tokens per minute (ITPM): Limit 8000, Requested 12000';
  const qBig = L.learn('cloud:groq:q', E('Groq error 413', qBody), 12000, 1500, T0, store4);
  ok('a question larger than its budget means another model, not the same question again', qBig.learnt && qBig.limits.itpm === 8000 && qBig.retry === false);
  ok('... and the next agent is not given that model for a question that large', !L.canHold('cloud:groq:q', 12000, 1500, T0, store4) && !L.canHold('cloud:groq:q', 7990, 10, T0, store4));
  ok('... while a smaller question is, its answer left as long as anything else allows', L.canHold('cloud:groq:q', 3000, 20000, T0, store4) && L.room('cloud:groq:q', 3000, T0, store4) === undefined);
  L.learn('cloud:groq:q', E('x', 'on output tokens per minute (OTPM): Limit 4000, Requested 9000'), 3000, 0, T0, store4);
  ok('a budget for the answer caps the answer asked for', L.room('cloud:groq:q', 3000, T0, store4) === 4000 && L.fitBody('openai', 'cloud:groq:q', { messages: msgs(10) }, T0, store4).max_completion_tokens === 4000);
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

console.log('\nA refusal naming the thinking field, or a sampling setting:');
{
  const drops = (t) => (L.readRefusal(t).drop || []).join();
  ok('the thinking field refused in a message, as each shape of refusal says it', drops('{"error":{"message":"messages.2.reasoning_content: Extra inputs are not permitted"}}') === 'reasoning_content'
    && drops('Additional properties are not allowed (\'reasoning_content\' was unexpected)') === 'reasoning_content'
    && drops('Unrecognized request argument supplied: reasoning_content') === 'reasoning_content'
    && drops('unknown field `reasoning_content`') === 'reasoning_content', [drops('{"error":{"message":"messages.2.reasoning_content: Extra inputs are not permitted"}}'), drops("Additional properties are not allowed ('reasoning_content' was unexpected)"), drops('Unrecognized request argument supplied: reasoning_content'), drops('unknown field `reasoning_content`')].join(' | '));
  ok('a sampling setting it does not take', drops("Unsupported parameter: 'top_k' is not supported with this model.") === 'top_k' && drops("Unsupported parameter: 'min_p' is not supported with this model.") === 'min_p');
  ok('a field that is the request itself is never taken as one to leave out', drops('unknown field `messages`') === '' && drops('Unrecognized request argument supplied: model') === '');
  const store = (() => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; })();
  const value = 'cloud:groq:invented-thinker';
  const err = { message: 'groq error 400: messages.1.reasoning_content: Extra inputs are not permitted', body: '' };
  const first = L.learn(value, err, 100, 0, 1000, store);
  ok('learnt, the request is sent once more', first.learnt === true && first.retry === true && JSON.stringify(first.limits.drop) === '["reasoning_content"]', JSON.stringify(first));
  const again = L.learn(value, err, 100, 0, 2000, store);
  ok('...and never twice for the same reason', again.learnt === false && again.retry === false);
  const body = { model: 'm', messages: [{ role: 'user', content: 'x' }, { role: 'assistant', content: '', tool_calls: [], reasoning_content: 'thought' }], temperature: 0.2 };
  L.fitBody('openai', value, body, 3000, store);
  ok('the request is rebuilt without the field in any message, the rest kept', !('reasoning_content' in body.messages[1]) && body.messages[1].role === 'assistant' && body.temperature === 0.2, JSON.stringify(body));
  ok('...and what was learnt is kept two weeks', L.LEARNED_FOR_MS === 14 * 24 * 60 * 60 * 1000 && L.infoOf(value, 1000 + L.LEARNED_FOR_MS - 1, store).drop.includes('reasoning_content') && !L.infoOf(value, 1000 + L.LEARNED_FOR_MS + 1, store).drop.includes('reasoning_content'));
}

console.log('\nWhat the context rules size a conversation by:');
{
  const store = memory();
  L.forgetListed();
  ok('a model whose window is not known gives nothing to size by', L.forContext('cloud:groq:unknown-one', 0, T0, store) === null);
  L.remember('cloud:anthropic:wide', { ctx: 200000, out: 32000 });
  const wide = L.forContext('cloud:anthropic:wide', 18000, T0, store);
  ok('its window, the answer kept room for, the characters a token is counted as, and the instructions and tools', JSON.stringify(wide) === JSON.stringify({ window: 200000, answer: 32000, perMinuteIn: undefined, charsPerToken: 3, fixed: 18000 }));
  ok('...counted as requests are sized here', L.CHARS_PER_TOKEN === 3 && L.estimateTokens(['x'.repeat(300)]) === 100 + 16);
  L.remember('cloud:openrouter:all-out', { ctx: 128000, out: 128000 });
  ok('an answer listed as long as the window is kept room for as a quarter of it', L.forContext('cloud:openrouter:all-out', 0, T0, store).answer === 32000);
  L.remember('cloud:groq:no-out', { ctx: 131072 });
  ok('an answer the list does not give is kept room for as the usual longest answer', L.forContext('cloud:groq:no-out', 0, T0, store).answer === 8192);
  store.setItem(L.LEARNED_KEY, JSON.stringify({ 'cloud:groq:no-out': { tpm: 6000, until: T0 + 1e9 }, 'cloud:anthropic:wide': { tpm: 90000, itpm: 30000, until: T0 + 1e9 } }));
  ok('a per-minute allowance a provider gave is counted, the one for the question first', L.forContext('cloud:groq:no-out', 0, T0, store).perMinuteIn === 6000 && L.forContext('cloud:anthropic:wide', 0, T0, store).perMinuteIn === 30000);
  ok('...and a smaller window a provider gave beats the list', (store.setItem(L.LEARNED_KEY, JSON.stringify({ 'cloud:anthropic:wide': { ctx: 100000, until: T0 + 1e9 } })), L.forContext('cloud:anthropic:wide', 0, T0, store).window === 100000));
  L.forgetListed();
}

console.log(`\n${pass} passed, ${fail} failed  (model limits)`);
if (fail) process.exit(1);
