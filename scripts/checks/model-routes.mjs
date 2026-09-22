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
const sandbox = { window: {}, AbortController };
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
// It was a limit, which shut the whole account and — before a limit that names
// no quota was retried — sent the same request again two seconds later.
ok('a request too large for a per-minute budget is a size, not a spent quota', R.failureKind(E('Request too large for model on tokens per minute (TPM)')) === 'size');
ok('the Groq 413 wording is a size', R.failureKind(E('Groq error 413: {"error":{"message":"Request too large for model `qwen/qwen3.8-27b` in organization')) === 'size');
ok('a context window overflow is a size', R.failureKind(E("This model's maximum context length is 8192 tokens")) === 'size');
ok('an answer with nothing in it is empty', R.failureKind(E('returned an empty answer', { empty: true })) === 'empty');
ok('every kind has words for the trace', ['retired', 'limit', 'key', 'busy', 'slow', 'size', 'empty'].every((k) => R.reasonText(k) !== 'it failed'));
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

console.log('\nA model that cannot hold the job is not asked while one that can is left:');
{
  const small = (v) => v !== 'cloud:groq:openai/gpt-oss-120b' && v !== 'cloud:groq:openai/gpt-oss-20b';
  const next = R.nextRoutes({ failed: 'cloud:gemini:gemini-2.5-pro', kind: 'retired', options: opts, fits: small, store: memory() });
  ok('the routes leave out models that cannot hold it', !next.some((v) => v.startsWith('cloud:groq:')) && next.length > 0);
  const notes = [];
  const run = R.createRun({ options: () => opts, fits: small, note: (m) => notes.push(m), store: memory() });
  ok('a run chosen on a model that cannot hold the job starts on one that can', !run.start('cloud:groq:openai/gpt-oss-120b').startsWith('cloud:groq:'));
  ok('... and says why', notes.some((n) => /cannot hold this job/.test(n)));
  const only = R.createRun({ options: () => opts.filter((o) => o.value.startsWith('cloud:groq:')), fits: small, store: memory() });
  ok('when nothing can hold it, the run still goes on with what answers', only.next('cloud:groq:openai/gpt-oss-120b', E('x', {})) === 'cloud:groq:openai/gpt-oss-20b');
}

console.log('\nA job given to a local model stays local:');
{
  const local = [
    { value: 'llama3.2:3b', label: 'llama3.2:3b' },
    { value: 'qwen2.5-coder:7b', label: 'qwen2.5-coder:7b' },
  ];
  const mixed = [...opts, ...local];
  const cloud = (v) => v.startsWith('cloud:');
  for (const kind of ['retired', 'limit', 'key', 'busy', 'slow', 'size', 'empty', 'other']) {
    const next = R.nextRoutes({ failed: 'llama3.2:3b', kind, options: mixed, store: memory() });
    ok(`after a local model fails (${kind}), no cloud model is offered`, !next.some(cloud));
  }
  ok('... another local model still is', R.nextRoutes({ failed: 'llama3.2:3b', kind: 'busy', options: mixed, store: memory() })[0] === 'qwen2.5-coder:7b');
  const alone = R.createRun({ options: () => [...opts, local[0]], store: memory() });
  ok('with no other local model, the run is told there is nothing left', alone.next('llama3.2:3b', E('Failed to fetch')) === null);
  const small = R.createRun({ options: () => mixed, fits: (v) => cloud(v), store: memory() });
  ok('a local model too small for the job is started as chosen, not swapped for a cloud one', small.start('llama3.2:3b') === 'llama3.2:3b');
  ok('... and when it fails, nothing in the cloud takes over', small.next('llama3.2:3b', E('x', {})) === 'qwen2.5-coder:7b' && !cloud(small.next('qwen2.5-coder:7b', E('x', {})) || ''));
  const up = R.nextRoutes({ failed: 'cloud:groq:openai/gpt-oss-120b', kind: 'limit', options: mixed, store: memory() });
  ok('a cloud job may still fall back to a local model', up.some((v) => !cloud(v)));
}

console.log('\nA streamed answer is waited on while it keeps arriving:');
{
  // A clock the check moves by hand.
  let now = 0;
  const due = new Map();
  let seq = 0;
  const timers = { set: (fn, ms) => { const id = ++seq; due.set(id, { at: now + ms, fn }); return id; }, clear: (id) => due.delete(id) };
  const pass = (ms) => { now += ms; for (const [id, t] of [...due]) if (t.at <= now) { due.delete(id); t.fn(); } };
  const q = R.quietSignal(null, { first: 90, between: 30 }, timers);
  pass(80);
  ok('nothing is cut off before the first piece is due', !q.signal.aborted);
  q.tick();
  for (let i = 0; i < 20; i++) { pass(25); q.tick(); }
  ok('an answer that keeps arriving is never cut off, however long it takes', !q.signal.aborted && now > 500 && q.heard());
  pass(31);
  ok('an answer that stops arriving is dropped', q.signal.aborted);
  const silent = R.quietSignal(null, { first: 90, between: 30 }, timers);
  pass(91);
  ok('a model that never starts is dropped, and it can be told apart', silent.signal.aborted && !silent.heard());
  const parent = new AbortController();
  const child = R.quietSignal(parent.signal, { first: 90, between: 30 }, timers);
  parent.abort();
  ok('a stop from the person stops it at once', child.signal.aborted);
  const done = R.quietSignal(null, { first: 90, between: 30 }, timers);
  done.cleanup();
  pass(1000);
  ok('a finished answer leaves no timer behind', !done.signal.aborted);
  // With no timers passed it uses the real ones, called the way a browser
  // demands — this sandbox's setTimeout refuses any other `this`, as a browser's does.
  const strict = { setTimeout(fn, ms) { if (this !== undefined && this !== sandbox && this !== globalThis) throw new TypeError('Illegal invocation'); return setTimeout(fn, ms); } };
  sandbox.setTimeout = strict.setTimeout;
  sandbox.clearTimeout = clearTimeout;
  let real = null;
  try { real = R.quietSignal(null, { first: 50, between: 50 }); real.cleanup(); } catch (e) { real = e; }
  ok('the real timers are called as themselves, not as another object\'s methods', real && !(real instanceof Error));
  // What this guards is that the plan call is given the ROUTED signal and the
  // tick that keeps it alive, not the run's own signal. It used to pin the
  // whole argument list, so adding an argument ahead of them read as the
  // waiting having been removed.
  ok('the Forge waits this way for its plan', /window\.HCModelRoutes\.quietSignal\(signal, quiet\)/.test(src('modes', 'forge', 'mode.js')) && /askModelForPlan\([^)]*routedSignal\.signal, routedSignal\.tick\)/.test(src('modes', 'forge', 'mode.js')));
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
// Virtual OS picks and replaces its models itself; the same rule is held there.
const vos = src('modes', 'virtual-os', 'mode.js');
{
  const vosModels = src('js', 'vos', 'models.js');
  ok('Virtual OS knows a local model by the shared rule', /R \? R\.providerOf\(value\) === "local"/.test(vosModels) && /const isLocalModel = \(value\) => MODELS\(\)\.isLocal\(value\);/.test(vos));
  ok('... its worker is chosen on the side the job started on (checked in vos-models.mjs)', /filter\(\(o\) => sameSide\(godValue, o\.value\) && isLarge\(o, "worker"\)\)/.test(vosModels));
  ok('... and a job fails over only on its own side', /opts\.filter\(\(o\) => sameSide\(preferredValue, o\.value\) && isLarge\(o, role\)\)/.test(vosModels) && /MODELS\(\)\.routes\(preferredValue, role, availableModelOptions\(\)\)/.test(vos));
}
ok('the module loads before the modes', src('boot.js').indexOf("'/js/model-routes.js'") > src('boot.js').indexOf("'/js/chat/failover.js'")
  && src('boot.js').indexOf("'/js/model-routes.js'") < src('boot.js').indexOf("'/modes/manifest.js'"));

console.log('\nA call that runs out of time is cancelled, not abandoned:');
{
  // A pretend request that only ends when it is aborted, as a real fetch does.
  const hanging = (seen) => (signal) => new Promise((_, reject) => {
    signal.addEventListener('abort', () => { seen.aborted = true; reject(Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' })); });
  });
  const manual = () => { const t = { fns: [], set: (fn) => { t.fns.push(fn); return t.fns.length; }, clear: () => { t.cleared = true; } }; return t; };

  const seen = {};
  const timers = manual();
  const pending = R.callWithin(1000, null, 'Agent timeout after 1s', hanging(seen), timers);
  timers.fns[0]();
  const err = await pending.catch((e) => e);
  ok('the request itself is aborted when time is up', seen.aborted === true);
  ok('and the failure is a timeout, so the run moves on', err.message === 'Agent timeout after 1s' && err.timedOut === true && R.failureKind(err) === 'slow');

  const stopper = new AbortController();
  const seen2 = {};
  const t2 = manual();
  const stopped = R.callWithin(1000, stopper.signal, 'x', hanging(seen2), t2);
  stopper.abort();
  const err2 = await stopped.catch((e) => e);
  ok('a stop the person makes reaches the request', seen2.aborted === true);
  ok('and stays a stop, not a timeout', err2.name === 'AbortError' && !err2.timedOut);

  const t3 = manual();
  const value = await R.callWithin(1000, null, 'x', async () => 'answer', t3);
  ok('an answer in time comes back as it is, and its timer is cleared', value === 'answer' && t3.cleared === true);

  // Control: racing a timer, which is what the Swarm did, leaves the request running.
  const seen4 = {};
  let fire;
  const raced = Promise.race([hanging(seen4)(new AbortController().signal), new Promise((_, rej) => { fire = () => rej(new Error('timeout')); })]);
  fire();
  await raced.catch(() => {});
  ok('control: a race against a timer never aborts the request', seen4.aborted !== true);
}

console.log('\nOne model out of quota is not the whole account:');
{
  R.forgetCooling();
  const options = [
    { value: 'cloud:gemini:gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro' },
    { value: 'cloud:gemini:gemini-3.6-flash', label: 'Gemini 3.6 Flash' },
    { value: 'cloud:groq:openai/gpt-oss-120b', label: 'GPT OSS 120B' },
    { value: 'cloud:groq:openai/gpt-oss-20b', label: 'GPT OSS 20B' },
    { value: 'cloud:cerebras:gpt-oss-120b', label: 'Cerebras GPT OSS 120B' },
  ];
  const http = (provider, status, body) => E(P.cloudHttpError(provider, status, JSON.stringify(body)), { status, body: JSON.stringify(body) });
  const geminiQuota = http('gemini', 429, { error: { code: 429, message: 'You exceeded your current quota, please check your plan and billing details.', status: 'RESOURCE_EXHAUSTED' } });
  const groqQuota = http('groq', 429, { error: { message: 'Rate limit reached for model `openai/gpt-oss-120b` on tokens per day (TPD)', code: 'rate_limit_exceeded' } });
  const noCredit = http('cerebras', 402, { message: 'Payment required to access this resource. Visit your billing tab.' });
  const orDaily = http('openrouter', 429, { error: { message: 'Rate limit exceeded: free-models-per-day. Add 10 credits to unlock 1000 free model requests per day', code: 429 } });

  ok('a Gemini quota refusal is one model\'s', R.coversAccount(geminiQuota) === false);
  ok('... and so is Groq\'s daily budget for one model', R.coversAccount(groqQuota) === false);
  ok('no credit covers the account', R.coversAccount(noCredit) === true);
  ok('OpenRouter\'s free daily allowance covers the account', R.coversAccount(orDaily) === true);

  const onlyGemini = options.filter((o) => o.value.includes(':gemini:'));
  const r1 = R.createRun({ options: () => onlyGemini, store: memory() });
  ok('the same provider\'s other model is still asked after one model\'s quota', r1.next('cloud:gemini:gemini-3.1-pro-preview', geminiQuota) === 'cloud:gemini:gemini-3.6-flash');
  R.forgetCooling();
  const order = R.nextRoutes({ failed: 'cloud:groq:openai/gpt-oss-120b', kind: 'limit', wide: false, options, store: memory() });
  ok('... after the other providers', order.indexOf('cloud:groq:openai/gpt-oss-20b') > order.indexOf('cloud:gemini:gemini-3.6-flash'));
  const shutOrder = R.nextRoutes({ failed: 'cloud:cerebras:gpt-oss-120b', kind: 'limit', wide: true, options, store: memory() });
  ok('an account with no credit is never asked again in the run', !shutOrder.some((v) => v.includes(':cerebras:')));
  const sizeOrder = R.nextRoutes({ failed: 'cloud:groq:openai/gpt-oss-120b', kind: 'size', options, store: memory() });
  ok('a request too large goes to another provider first', !sizeOrder[0].includes(':groq:') && sizeOrder.includes('cloud:groq:openai/gpt-oss-20b'));

  // What one run learns, the next starts from.
  R.forgetCooling();
  R.createRun({ options: () => options, store: memory() }).next('cloud:cerebras:gpt-oss-120b', noCredit);
  const second = R.createRun({ options: () => options, store: memory(), note: () => {} });
  ok('a second agent does not start on the account the first found empty', !second.start('cloud:cerebras:gpt-oss-120b').includes(':cerebras:'));
  R.createRun({ options: () => options, store: memory() }).next('cloud:groq:openai/gpt-oss-120b', groqQuota);
  const third = R.createRun({ options: () => options, store: memory(), note: () => {} });
  ok('... nor on the model the first found out of quota', third.start('cloud:groq:openai/gpt-oss-120b') !== 'cloud:groq:openai/gpt-oss-120b');
  ok('... while that provider\'s other model is still offered', R.createRun({ options: () => options, store: memory() }).next('cloud:gemini:gemini-3.6-flash', E('Google Gemini is overloaded right now. Try again in a few seconds.')) !== null);
  const onlyCold = R.createRun({ options: () => [options[4]], store: memory(), note: () => {} });
  ok('when only a cooling account is left it is still tried rather than nothing', onlyCold.start('cloud:cerebras:gpt-oss-120b') === 'cloud:cerebras:gpt-oss-120b');
  R.forgetCooling();
  const withPictures = [...options, { value: 'cloud:gemini:gemini-3-pro-image', label: 'Gemini 3 Pro Image' }, { value: 'cloud:gemini:gemini-3.1-flash-image-preview', label: 'Nano Banana 2' }];
  const pictureFree = R.nextRoutes({ failed: 'cloud:gemini:gemini-3.1-pro-preview', kind: 'busy', options: withPictures, store: memory() });
  ok('a model that makes pictures is never the fallback for one that writes', !pictureFree.some((v) => /image/.test(v)));
  ok('... though one picture model may stand in for another', R.nextRoutes({ failed: 'cloud:gemini:gemini-3.1-flash-image-preview', kind: 'busy', options: withPictures, store: memory() }).includes('cloud:gemini:gemini-3-pro-image'));
  ok('forgetting clears it', R.createRun({ options: () => options, store: memory(), note: () => {} }).start('cloud:cerebras:gpt-oss-120b') === 'cloud:cerebras:gpt-oss-120b');
}

console.log('\nOne question, answered by whichever model can:');
{
  const options = () => [
    { value: 'cloud:samba:big', label: 'Samba Big' },
    { value: 'cloud:samba:other', label: 'Samba Other' },
    { value: 'cloud:groq:llama-3.3-70b', label: 'Groq 70B' },
    { value: 'cloud:gemini:gemini-2.5-flash', label: 'Gemini Flash' },
  ];
  const noCredit = E(P.cloudHttpError('samba', 402, JSON.stringify({ error: { message: 'A payment method is required.' } })));
  const asked = [];
  const switches = [];
  const r = await R.askWithFailover({
    start: 'cloud:samba:big', options, store: memory(),
    call: async (m) => { asked.push(m); if (m.startsWith('cloud:samba')) throw noCredit; return 'Here is the change.'; },
    onSwitch: (from, to, why) => switches.push({ from, to, why }),
  });
  ok('an account with no credit is left for another provider', r.text === 'Here is the change.' && !r.model.startsWith('cloud:samba'));
  ok('... without asking its other models first', asked.filter((m) => m.startsWith('cloud:samba')).length === 1);
  ok('it says who answered, and why it moved on', r.switched.length === 1 && switches[0].from === 'cloud:samba:big' && /quota/.test(switches[0].why));

  const empties = [];
  const r2 = await R.askWithFailover({ start: 'cloud:groq:llama-3.3-70b', options, store: memory(), call: async (m) => { empties.push(m); return empties.length === 1 ? '   ' : 'ok'; } });
  ok('an empty answer counts as no answer', r2.text === 'ok' && empties.length === 2);

  let thrown = null;
  const bad = E('invalid_request_error: messages must alternate');
  try { await R.askWithFailover({ start: 'cloud:groq:llama-3.3-70b', options, store: memory(), call: async () => { throw bad; } }); } catch (e) { thrown = e; }
  ok('a question that is itself at fault is not passed round every model', thrown === bad);

  let calls = 0;
  thrown = null;
  const busy = E(P.cloudHttpError('groq', 503, ''));
  try { await R.askWithFailover({ start: 'cloud:groq:llama-3.3-70b', options, store: memory(), maxAttempts: 3, call: async () => { calls++; throw busy; } }); } catch (e) { thrown = e; }
  ok('it gives up after its attempts, with the last failure', thrown === busy && calls === 3);

  const stop = new AbortController();
  calls = 0;
  thrown = null;
  const p = R.askWithFailover({ start: 'cloud:groq:llama-3.3-70b', options, store: memory(), signal: stop.signal, call: (m, s) => new Promise((_, rej) => { calls++; s.addEventListener('abort', () => rej(Object.assign(new Error('Aborted'), { name: 'AbortError' }))); }) });
  stop.abort();
  try { await p; } catch (e) { thrown = e; }
  ok('a stop is a stop — no other model is asked', thrown && thrown.name === 'AbortError' && calls === 1);

  const timers = { set: (fn) => { setTimeout(fn, 0); return 1; }, clear: () => {} };
  const slowAsked = [];
  const r3 = await R.askWithFailover({ start: 'cloud:groq:llama-3.3-70b', options, store: memory(), timers, timeoutMs: 5,
    call: (m, s) => { slowAsked.push(m); return slowAsked.length === 1 ? new Promise((_, rej) => s.addEventListener('abort', () => rej(Object.assign(new Error('Aborted'), { name: 'AbortError' })))) : Promise.resolve('late but answered'); } });
  const tooBig = [];
  const r4 = await R.askWithFailover({ start: 'cloud:groq:llama-3.3-70b', options, store: memory(),
    call: async (m) => { tooBig.push(m); if (m.startsWith('cloud:groq')) throw E(P.cloudHttpError('groq', 413, JSON.stringify({ error: { message: 'Request too large for model on tokens per minute (TPM)' } }))); return 'fits here'; } });
  ok('a request too large for one model is taken to one that can hold it', r4.text === 'fits here' && !r4.model.startsWith('cloud:groq'));
  ok('a model that runs out of time is left for another', r3.text === 'late but answered' && r3.model !== 'cloud:groq:llama-3.3-70b');
}

console.log(`\n${pass} passed, ${fail} failed  (model routes)`);
if (fail) process.exit(1);
