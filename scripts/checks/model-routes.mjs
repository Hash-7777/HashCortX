// ==============================================================
// Model route checks
//
// Loads the REAL src/js/model-routes.js beside the real name ranking in
// src/js/chat/failover.js. Holds what kind of failure each provider's error
// is read as, what is tried next for each kind, and that a model a provider
// says is gone is remembered and not asked again.
//
// Run with: npm run check:model-routes
// ==============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const src = (...p) => readFileSync(join(here, '..', '..', 'src', ...p), 'utf8');
const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(src('js', 'chat', 'failover.js'), sandbox, { filename: 'failover.js' });
vm.runInContext(src('js', 'providers.js'), sandbox, { filename: 'providers.js' });
vm.runInContext(src('js', 'model-routes.js'), sandbox, { filename: 'model-routes.js' });
const R = sandbox.window.HCModelRoutes;
const P = sandbox.window.HCProviders;

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
const E = (message, extra = {}) => Object.assign(new Error(message), extra);

console.log('What kind of failure it is:');
ok('the app\'s own 404 wording is a retired model', R.failureKind(E(P.cloudHttpError('gemini', 404, ''))) === 'retired');
ok('a model the provider decommissioned is retired', R.failureKind(E('Groq error 400: {"error":{"message":"The model `x-70b` has been decommissioned and is no longer supported.')) === 'retired');
ok('a decommission notice cut off mid-sentence is still retired', R.failureKind(E('Groq error 400: {"error":{"message":"The model `x` has been decommissioned and is no longer supported. Pleas')) === 'retired');
ok('model_not_found is retired', R.failureKind(E('{"error":{"code":"model_not_found"}}')) === 'retired');
ok('the app\'s own 429 wording is a limit', R.failureKind(E(P.cloudHttpError('groq', 429, ''))) === 'limit');
ok('a request too large for a per-minute budget is a limit', R.failureKind(E('Request too large for model on tokens per minute (TPM)')) === 'limit');
ok('a quota message naming the key is still a limit', R.failureKind(E('Rate limit reached for this API key')) === 'limit');
ok('the app\'s own 401 wording is a refused key', R.failureKind(E(P.cloudHttpError('openai', 401, ''))) === 'key');
ok('the app\'s own 503 wording is busy', R.failureKind(E(P.cloudHttpError('gemini', 503, ''))) === 'busy');
ok('a provider that cannot be reached is busy, so the run moves on', R.failureKind(E('Failed to fetch')) === 'busy' && R.failureKind(E('Load failed')) === 'busy');
ok('a timeout is slow', R.failureKind(E('Agent timeout after 150s')) === 'slow');
ok('an abort the run made itself is slow', R.failureKind(E('Fetch is aborted', { name: 'AbortError', timedOut: true })) === 'slow');
ok('an abort the person made is a stop', R.failureKind(E('The user aborted a request.', { name: 'AbortError' })) === 'stopped');
ok('anything else is other', R.failureKind(E('Model returned invalid SystemSpec JSON')) === 'other');
ok('an overloaded model is busy, not retired', R.failureKind(E('The model is currently overloaded')) === 'busy');

const opts = [
  { value: 'cloud:groq:openai/gpt-oss-120b', label: 'GPT OSS 120B' },
  { value: 'cloud:groq:openai/gpt-oss-20b', label: 'GPT OSS 20B' },
  { value: 'cloud:gemini:gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
  { value: 'cloud:gemini:gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
  { value: 'cloud:gemini:gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash Lite' },
  { value: 'cloud:openrouter:vendor/big-model-120b:free', label: 'Big 120B (free)' },
  { value: 'cloud:openrouter:vendor/small-model-8b:free', label: 'Small 8B (free)' },
];

console.log('\nWhat is tried next:');
{
  const store = memory();
  const next = R.nextRoutes({ failed: 'cloud:gemini:gemini-2.5-pro', kind: 'retired', options: opts, store });
  ok('after a retired model, the same provider\'s others come first', next[0] === 'cloud:gemini:gemini-2.5-flash');
  ok('... strongest first, the lite model after the full one', next.indexOf('cloud:gemini:gemini-2.5-flash') < next.indexOf('cloud:gemini:gemini-2.5-flash-lite'));
  ok('... then one model from each other provider', next.includes('cloud:groq:openai/gpt-oss-120b') && next.includes('cloud:openrouter:vendor/big-model-120b:free') && !next.includes('cloud:openrouter:vendor/small-model-8b:free'));
  ok('... and never the model that failed', !next.includes('cloud:gemini:gemini-2.5-pro'));
}
{
  const store = memory();
  const next = R.nextRoutes({ failed: 'cloud:groq:openai/gpt-oss-120b', kind: 'limit', options: opts, store });
  ok('after a limit, no model of that account is tried', !next.some((v) => v.startsWith('cloud:groq:')));
  ok('... each other provider\'s strongest is', next.includes('cloud:gemini:gemini-2.5-pro') && next.includes('cloud:openrouter:vendor/big-model-120b:free'));
}
{
  const store = memory();
  const next = R.nextRoutes({ failed: 'cloud:openrouter:vendor/big-model-120b:free', kind: 'slow', options: opts, tried: ['cloud:groq:openai/gpt-oss-120b'], avoid: ['groq'], store });
  ok('after a slow answer, other providers come before the same one', next[0].startsWith('cloud:gemini:') && next[next.length - 1].startsWith('cloud:openrouter:'));
  ok('an account out of quota earlier in the run stays out', !next.some((v) => v.startsWith('cloud:groq:')));
}
ok('a stop tries nothing', R.nextRoutes({ failed: 'cloud:groq:openai/gpt-oss-120b', kind: 'stopped', options: opts, store: memory() }).length === 0);

console.log('\nA model that is gone is remembered:');
{
  const store = memory();
  const t0 = 1_000_000_000_000;
  R.markRetired('cloud:gemini:gemini-2.5-pro', t0, store);
  ok('it is known to be gone', R.isRetired('cloud:gemini:gemini-2.5-pro', t0 + 1000, store));
  ok('another model is not', !R.isRetired('cloud:gemini:gemini-2.5-flash', t0 + 1000, store));
  ok('the next run never offers it', !R.nextRoutes({ failed: 'cloud:groq:openai/gpt-oss-120b', kind: 'limit', options: opts, now: t0 + 1000, store }).includes('cloud:gemini:gemini-2.5-pro'));
  ok('... it offers that provider\'s next model instead', R.nextRoutes({ failed: 'cloud:groq:openai/gpt-oss-120b', kind: 'limit', options: opts, now: t0 + 1000, store }).includes('cloud:gemini:gemini-2.5-flash'));
  ok('after two weeks it is asked again', !R.isRetired('cloud:gemini:gemini-2.5-pro', t0 + R.RETIRED_FOR_MS + 1, store));
  R.forgetRetired(store);
  ok('clearing settings forgets it', !R.isRetired('cloud:gemini:gemini-2.5-pro', t0 + 1000, store));
  const broken = { getItem: () => '{not json', setItem: () => { throw new Error('full'); }, removeItem: () => {} };
  ok('unreadable storage reads as nothing gone', !R.isRetired('x', t0, broken));
  ok('full storage does not throw', R.markRetired('x', t0, broken) === false);
}

console.log('\nThe three failover chains that end a run early:');
{
  // Groq out of quota, the OpenRouter model too slow, and Gemini's chosen
  // model gone. Each mode used to stop there with Gemini's other models unasked.
  const store = memory();
  const tried = [];
  const avoid = [];
  const failWith = (value, err) => {
    const kind = R.failureKind(err);
    tried.push(value);
    if (kind === 'retired') R.markRetired(value, Date.now(), store);
    if (kind === 'limit' || kind === 'key') avoid.push(R.providerOf(value));
    return R.nextRoutes({ failed: value, kind, options: opts, tried, avoid, store })[0];
  };
  let next = failWith('cloud:groq:openai/gpt-oss-120b', E(P.cloudHttpError('groq', 429, '')));
  ok('Groq out of quota → the strongest other provider', !!next && !next.startsWith('cloud:groq:'));
  next = failWith('cloud:openrouter:vendor/big-model-120b:free', E('Fetch is aborted', { name: 'AbortError', timedOut: true }));
  ok('OpenRouter too slow → Gemini', next === 'cloud:gemini:gemini-2.5-pro');
  next = failWith('cloud:gemini:gemini-2.5-pro', E(P.cloudHttpError('gemini', 404, '')));
  ok('Gemini 2.5 Pro gone → Gemini 2.5 Flash, not the end of the run', next === 'cloud:gemini:gemini-2.5-flash');
}

console.log('\nOne run keeps what it has learnt:');
{
  const store = memory();
  const notes = [];
  const run = R.createRun({ options: () => opts, note: (m) => notes.push(m), store });
  ok('a model nobody has reported is started as chosen', run.start('cloud:gemini:gemini-2.5-pro') === 'cloud:gemini:gemini-2.5-pro');
  const repairErr = E(P.cloudHttpError('gemini', 404, ''), { model: 'cloud:gemini:gemini-2.5-pro' });
  const next = run.next('cloud:groq:openai/gpt-oss-120b', repairErr);
  ok('an error is blamed on the model that gave it, not the one that started the attempt',
    R.isRetired('cloud:gemini:gemini-2.5-pro', Date.now(), store) && !R.isRetired('cloud:groq:openai/gpt-oss-120b', Date.now(), store));
  ok('... and the run says so', notes.some((n) => /gemini-2\.5-pro is gone/.test(n)));
  ok('... and moves to that provider\'s next model', next === 'cloud:gemini:gemini-2.5-flash');
  ok('both models count as asked', run.tried.includes('cloud:groq:openai/gpt-oss-120b') && run.tried.includes('cloud:gemini:gemini-2.5-pro'));
  const later = R.createRun({ options: () => opts, note: (m) => notes.push(m), store });
  ok('the next run starts on a working model instead', later.start('cloud:gemini:gemini-2.5-pro') !== 'cloud:gemini:gemini-2.5-pro');
  const cooling = R.createRun({ options: () => opts, shut: () => ['gemini', 'openrouter'], store: memory() });
  ok('a provider cooling down is left alone while another can answer', cooling.next('cloud:groq:openai/gpt-oss-120b', E('Agent timeout after 90s')) === 'cloud:groq:openai/gpt-oss-20b');
  const allCooling = R.createRun({ options: () => opts.filter((o) => !o.value.startsWith('cloud:groq:')), shut: () => ['gemini', 'openrouter'], store: memory() });
  ok('... but every provider cooling is no reason to stop', !!allCooling.next('cloud:gemini:gemini-2.5-pro', E('Agent timeout after 90s')));
}

console.log('\nThe hand-written catalogue drops what its providers shut down:');
{
  const cat = src('data', 'cloud-models.js');
  for (const gone of ['groq:deepseek-r1-distill-llama-70b', 'groq:qwen-qwq-32b', 'gemini:gemini-2.0-flash"', 'gemini:gemini-2.0-flash-lite"']) {
    ok(`no ${gone.replace('"', '')}`, !cat.includes(`cloud:${gone}`));
  }
}

console.log('\nEvery mode routes through it:');
const swarm = src('modes', 'agent-maker', 'mode.js');
const systems = src('modes', 'systems', 'mode.js');
const forge = src('modes', 'forge', 'mode.js');
// Each names the module once and may call it through a short local name.
const routes = (code) => /window\.HCModelRoutes\.createRun\(\{/.test(code) && /\.start\(/.test(code) && /\.next\(/.test(code);
ok('the Agent Swarm', routes(swarm));
ok('... which no longer takes the first model of each provider in menu order', !/function getFailoverModels/.test(swarm));
ok('the Systems builder', routes(systems));
ok('the Forge', routes(forge));
ok('the module loads before the modes', src('boot.js').indexOf("'/js/model-routes.js'") > src('boot.js').indexOf("'/js/chat/failover.js'")
  && src('boot.js').indexOf("'/js/model-routes.js'") < src('boot.js').indexOf("'/modes/manifest.js'"));

console.log(`\n${pass} passed, ${fail} failed  (model routes)`);
if (fail) process.exit(1);
