// ==============================================================
// Where a HashCoder run goes when its model will not answer — checks
//
// Loads the REAL src/js/code/router.js with the real rules beside it
// (js/model-routes.js, js/chat/failover.js) and runs it against scripted
// models. Holds that the model the person chose is asked first and its own
// failure is what they are told, whoever else failed after it; that a model
// found gone is moved off at once and not asked again; that a model that cannot
// read pictures is not tried while one is sent; that every move is said; that a
// job on a model on this computer stays on it; and that the Coder is wired to
// all of this and to nothing of its own.
//
// Run with: npm run check:code-router
// ==============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const src = (...p) => readFileSync(join(here, '..', '..', 'src', ...p), 'utf8');

let pass = 0;
let fail = 0;
function ok(label, cond, detail = '') {
  if (cond) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}

function world() {
  const data = new Map();
  const box = { window: {}, JSON, Math, Number, String, Array, Object, Map, Set, Promise, Error, Date, RegExp };
  box.localStorage = { getItem: (k) => (data.has(k) ? data.get(k) : null), setItem: (k, v) => data.set(k, String(v)), removeItem: (k) => data.delete(k) };
  vm.createContext(box);
  for (const f of [['js', 'chat', 'failover.js'], ['js', 'model-routes.js'], ['js', 'code', 'router.js']]) vm.runInContext(src(...f), box, { filename: f.join('/') });
  box.window.HCModelRoutes.forgetCooling();
  return box.window;
}

const MODELS = [
  { value: 'cloud:gemini:gemini-3.8-flash', label: 'Gemini 3.8 Flash' },
  { value: 'cloud:gemini:gemini-3.7-flash', label: 'Gemini 3.7 Flash' },
  { value: 'cloud:groq:llama-3.3-70b-versatile', label: 'Groq Llama 3.3 70B' },
  { value: 'cloud:cerebras:gpt-oss-120b', label: 'Cerebras GPT OSS 120B' },
  { value: 'cloud:openrouter:meta-llama/llama-4-maverick:free', label: 'OpenRouter Llama 4 Maverick' },
  { value: 'cloud:nvidia:nemotron-3-super', label: 'NVIDIA Nemotron 3 Super' },
  { value: 'cloud:openai:gpt-4o', label: 'GPT-4o' },
];
const SEES_PICTURES = (value) => !/cloud:(groq|cerebras)/.test(value);

/**
 * A run against scripted models: `says[value]` is what that model does, an
 * Error to fail with or anything else to answer with. Records every call.
 */
function run(W, selected, says, { messages = [{ role: 'user', content: 'hi' }], models = MODELS } = {}) {
  const calls = [];
  const told = [];
  const waits = [];
  const router = W.HCCodeRouter.create({
    selected,
    send: async (request) => {
      calls.push(request.modelValue);
      const doing = says[request.modelValue];
      if (typeof doing === 'function') return doing(calls.filter((c) => c === request.modelValue).length);
      if (doing instanceof Error) throw doing;
      return doing === undefined ? { content: `answered by ${request.modelValue}` } : doing;
    },
    adapterOf: (v) => ({ kind: 'openai', model: v }),
    available: () => models, readsImages: SEES_PICTURES,
    failover: W.HCChatFailover, routes: W.HCModelRoutes,
    say: (text) => told.push(text), wait: async (ms) => { waits.push(ms); },
  });
  return { router, calls, told, waits, messages, turn: (extra = {}) => router.turn({ messages, tools: [], temperature: 0.2, ...extra }) };
}
const fails = (message, extra = {}) => Object.assign(new Error(message), extra);
const error = async (promise) => { try { await promise; return null; } catch (e) { return e; } };

console.log('The model the person chose is the one they are told about:');
{
  // Chose Gemini; its quota was spent, and so was every other account's.
  const W = world();
  const r = run(W, 'cloud:gemini:gemini-3.8-flash', {
    'cloud:gemini:gemini-3.8-flash': fails('Gemini rate limit reached: quota exceeded for gemini-3.8-flash'),
    'cloud:gemini:gemini-3.7-flash': fails('Gemini rate limit reached: quota exceeded for gemini-3.7-flash'),
    'cloud:groq:llama-3.3-70b-versatile': fails('429 rate limit exceeded: tokens per minute'),
    'cloud:cerebras:gpt-oss-120b': fails('Cerebras has no credit left on this account, so it refused the request.', { status: 402 }),
    'cloud:openrouter:meta-llama/llama-4-maverick:free': fails('OpenRouter quota limit: free-models-per-day'),
    'cloud:nvidia:nemotron-3-super': fails('429 too many requests'),
    'cloud:openai:gpt-4o': fails('429 You exceeded your current quota'),
  });
  const e = await error(r.turn());
  ok('with nothing left to take over, the message begins with the model that was chosen', !!e && /^Gemini 3\.8 Flash did not answer\./.test(e.message), e && e.message);
  ok('in its own words', /It said: Gemini rate limit reached: quota exceeded for gemini-3\.8-flash\./.test(e.message), e.message);
  ok('and does not begin with whichever was tried last', !/^(Cerebras|OpenRouter|GPT)/.test(e.message));
  ok('what was tried after it is named, with the reason in a few words', /Then .*Cerebras GPT OSS 120B/.test(e.message) && /could not either/.test(e.message), e.message);
  ok('and the person is told what to do', /pick another model, or put right the account named first/.test(e.message));
  ok('the original failure is kept for anyone who needs it', e.cause instanceof Error);
}
{
  // Chose Nemotron; Cerebras, with no credit, must not be the answer.
  const W = world();
  const r = run(W, 'cloud:nvidia:nemotron-3-super', {
    'cloud:nvidia:nemotron-3-super': fails('NVIDIA 429: rate limit reached for this model'),
    'cloud:cerebras:gpt-oss-120b': fails('Cerebras has no credit left on this account, so it refused the request.', { status: 402 }),
    'cloud:groq:llama-3.3-70b-versatile': fails('429 rate limit'),
    'cloud:gemini:gemini-3.8-flash': fails('429 quota'),
    'cloud:gemini:gemini-3.7-flash': fails('429 quota'),
    'cloud:openrouter:meta-llama/llama-4-maverick:free': fails('429 quota'),
    'cloud:openai:gpt-4o': fails('429 quota'),
  });
  const e = await error(r.turn());
  ok('a failure of the chosen Nemotron is reported as Nemotron\'s', /^NVIDIA Nemotron 3 Super did not answer\. It said: NVIDIA 429/.test(e.message) && !/^Cerebras/.test(e.message), e.message);
}

console.log('\nWhen another model can take over, it does, and it is said:');
{
  const W = world();
  const r = run(W, 'cloud:gemini:gemini-3.8-flash', { 'cloud:gemini:gemini-3.8-flash': fails('429 rate limit exceeded') });
  const got = await r.turn();
  ok('the run is answered by another model', got.content !== undefined && /^answered by /.test(got.content) && !/gemini-3\.8-flash/.test(got.content), got.content);
  ok('the chosen model was asked first', r.calls[0] === 'cloud:gemini:gemini-3.8-flash' && r.calls.length === 2);
  ok('the move is said: who failed, why, and who took over', r.told.length === 1 && /^Gemini 3\.8 Flash: this account is out of quota\. Carrying on with /.test(r.told[0]), r.told.join(' | '));
  ok('the run knows which model it is on', r.router.model === r.calls[1]);
  await r.turn();
  ok('and stays on it: the next step does not ask the failed model again', r.calls.length === 3 && r.calls[2] === r.calls[1]);
}
{
  // A model that is only busy: asked once more, and nothing else is troubled.
  const W = world();
  const r = run(W, 'cloud:gemini:gemini-3.8-flash', { 'cloud:gemini:gemini-3.8-flash': (n) => { if (n === 1) throw fails('fetch failed'); return { content: 'fine' }; } });
  const got = await r.turn();
  ok('a dropped connection is asked again on the same model, after a short wait', got.content === 'fine' && r.calls.length === 2 && r.calls[0] === r.calls[1] && r.waits.length === 1);
  ok('and is not said to be a move, or counted as a failure', r.told.length === 0 && r.router.model === 'cloud:gemini:gemini-3.8-flash');
}

console.log('\nA model that is gone is moved off, and not asked again:');
{
  const W = world();
  const gone = 'cloud:gemini:gemini-3.7-flash';
  const r = run(W, gone, { [gone]: fails('This model has been discontinued. Please migrate to gemini-3.8-flash.') });
  const got = await r.turn().catch((e) => ({ content: `it ended: ${e.message}` }));
  ok('"discontinued" is the provider saying it is gone', W.HCModelRoutes.failureKind(fails('models/gemini-3.7-flash is discontinued')) === 'retired');
  ok('the same provider\'s other model is tried first: the account works', r.calls[1] === 'cloud:gemini:gemini-3.8-flash' && /gemini-3\.8-flash/.test(got.content), r.calls.join());
  ok('it is said to be gone', r.told.some((t) => /Gemini 3\.7 Flash is gone/.test(t)), r.told.join(' | '));
  ok('and remembered, so no later run asks it', W.HCModelRoutes.isRetired(gone));
  const again = run(W, gone, {});
  await again.turn();
  ok('a run that chose it begins on another model, and never asks it', again.calls.length === 1 && again.calls[0] !== gone, again.calls.join());
  ok('and says why', again.told.some((t) => /Gemini 3\.7 Flash was reported gone — using /.test(t)), again.told.join(' | '));
}

console.log('\nA model that cannot read pictures is not tried while one is sent:');
{
  const W = world();
  const pictures = [{ role: 'user', content: 'see this', images: ['abc'] }];
  // The only model besides the chosen one that can see is a small one, and the
  // two that cannot rank above it. A model that cannot see answers with an
  // error no other model can mend, which ends a run that reaches it.
  const shortList = [
    { value: 'cloud:gemini:gemini-3.8-flash', label: 'Gemini 3.8 Flash' },
    { value: 'cloud:groq:llama-3.3-70b-versatile', label: 'Groq Llama 3.3 70B' },
    { value: 'cloud:cerebras:gpt-oss-120b', label: 'Cerebras GPT OSS 120B' },
    { value: 'cloud:gemini:gemini-2.0-flash-lite', label: 'Gemini 2.0 Flash Lite' },
  ];
  const says = {
    'cloud:gemini:gemini-3.8-flash': fails('429 rate limit exceeded'),
    'cloud:groq:llama-3.3-70b-versatile': fails('cloud:groq cannot read pictures. Pick a model that can.'),
    'cloud:cerebras:gpt-oss-120b': fails('cloud:cerebras cannot read pictures. Pick a model that can.'),
  };
  const r = run(W, 'cloud:gemini:gemini-3.8-flash', says, { messages: pictures, models: shortList });
  const got = await r.turn().catch((e) => ({ content: `it ended: ${e.message}` }));
  ok('the models that cannot see are never asked', !r.calls.some((c) => /groq|cerebras/.test(c)), r.calls.join());
  ok('and the one that can takes over', got.content === 'answered by cloud:gemini:gemini-2.0-flash-lite', got.content);
  W.HCModelRoutes.forgetCooling();
  const plain = run(W, 'cloud:gemini:gemini-3.8-flash', says, { models: shortList });
  const e = await error(plain.turn());
  ok('with no picture they are offered, as before', plain.calls.some((c) => /groq|cerebras/.test(c)), plain.calls.join());
  ok('which messages hold a picture is read from the conversation', W.HCCodeRouter.hasPictures(pictures) && !W.HCCodeRouter.hasPictures([{ role: 'user', content: 'x' }]) && !W.HCCodeRouter.hasPictures(null));
  ok('and which models are offered while one is sent', W.HCCodeRouter.optionsFor(MODELS, { pictures: true, readsImages: SEES_PICTURES }).every((m) => SEES_PICTURES(m.value)) && W.HCCodeRouter.optionsFor(MODELS, {}).length === MODELS.length);
}

console.log('\nA picture sent to a chosen model that cannot read it:');
{
  const W = world();
  const pictures = [{ role: 'user', content: 'see this', images: ['abc'] }];
  const list = [
    { value: 'cloud:cerebras:gpt-oss-120b', label: 'Cerebras GPT OSS 120B' },
    { value: 'cloud:gemini:gemini-3.8-flash', label: 'Gemini 3.8 Flash' },
    { value: 'cloud:groq:llama-3.3-70b-versatile', label: 'Groq Llama 3.3 70B' },
  ];
  const says = { 'cloud:cerebras:gpt-oss-120b': fails('cloud:cerebras cannot read pictures. Pick a model that can.') };
  const r = run(W, 'cloud:cerebras:gpt-oss-120b', says, { messages: pictures, models: list });
  const got = await r.turn().catch((e) => ({ content: `it ended: ${e.message}` }));
  // A picture is the person's to place: when the model they chose cannot read
  // it, the run says so in plain words and sends nothing to another company.
  ok('a chosen model that cannot read pictures is asked once and says so', r.calls.join() === 'cloud:cerebras:gpt-oss-120b', r.calls.join());
  ok('the person is told, in its own plain words, to pick one that can', /cannot read pictures\. Pick a model that can/.test(got.content), got.content);
  ok('and the picture is not handed to another provider behind their back', !r.calls.some((c) => /gemini|groq/.test(c)) && r.told.length === 0, r.told.join());
}

console.log('\nWhat does not move:');
{
  const W = world();
  const local = run(W, 'qwen2.5-coder:3b', { 'qwen2.5-coder:3b': fails('429 rate limit exceeded') });
  const e = await error(local.turn());
  ok('a job on a model on this computer stays there, and ends with its own error', !!e && e.message === '429 rate limit exceeded' && local.calls.length === 1 && local.told.length === 0);
  const bad = run(W, 'cloud:gemini:gemini-3.8-flash', { 'cloud:gemini:gemini-3.8-flash': fails('400 invalid argument: the request body is wrong') });
  const f = await error(bad.turn());
  ok('a failure no other model could fix is the model\'s own, as it said it', !!f && f.message === '400 invalid argument: the request body is wrong' && bad.calls.length === 1);
  const stop = new AbortController();
  stop.abort();
  const stopped = run(W, 'cloud:gemini:gemini-3.8-flash', { 'cloud:gemini:gemini-3.8-flash': Object.assign(new Error('aborted'), { name: 'AbortError' }) });
  const g = await error(stopped.turn({ signal: stop.signal }));
  ok('pressing Stop ends the run at once, with nothing said and nothing else asked', !!g && g.name === 'AbortError' && stopped.calls.length === 1 && stopped.told.length === 0);
}

console.log('\nThe message when no model could answer:');
{
  const W = world();
  const R = W.HCCodeRouter;
  const label = (v) => ({ a: 'Alpha', b: 'Beta', c: 'Gamma' }[v] || v);
  const kindOf = W.HCModelRoutes.failureKind, reasonOf = W.HCModelRoutes.reasonText;
  ok('one failure is nobody\'s to explain: it is thrown as it was', R.explain({ hops: [{ model: 'a', error: new Error('x') }], label, kindOf, reasonOf }) === null && R.explain({ hops: [], label, kindOf, reasonOf }) === null);
  const text = R.explain({ hops: [{ model: 'a', error: new Error('Error: 429 slow down') }, { model: 'b', error: new Error('503 overloaded') }, { model: 'c', error: new Error('model not found') }], label, kindOf, reasonOf });
  ok('the first is quoted, the rest named with a reason', /^Alpha did not answer\. It said: 429 slow down\. Then Beta \(the provider is overloaded\); Gamma \(the provider says this model is gone\) could not either\./.test(text), text);
  const many = R.explain({ hops: Array.from({ length: 9 }, (_, i) => ({ model: `m${i}`, error: new Error('429') })), label, kindOf, reasonOf });
  ok('a long list is cut: five named, then how many more', /and 3 more/.test(many) && !/m6/.test(many), many);
  const long = R.explain({ hops: [{ model: 'a', error: new Error('word '.repeat(200)) }, { model: 'b', error: new Error('x') }], label, kindOf, reasonOf });
  ok('what the first said is cut to a sentence or two, not a page', long.length < 600, String(long.length));
}

console.log('\nThe Coder is wired to it:');
{
  const mode = src('modes', 'code', 'mode.js');
  ok('the run is routed by the shared routing, with the model chosen first', /window\.HCCodeRouter\.create\(\{/.test(mode) && /failover: window\.HCChatFailover, routes: window\.HCModelRoutes/.test(mode));
  ok('the panel keeps no list of providers or chain of its own', !/ROUTER_FALLBACKS|buildRouterChain|sortChainByQuality|_routerStreaks|withFallbacks/.test(mode));
  ok('each run starts again from the model chosen', /routing = null;\s*\/\/ each run starts again from the model chosen/.test(mode));
  ok('a move and a model found gone are said in the conversation and the trace', /routeNotice = \(text\) => \{[\s\S]{0,260}cdrTraceAdd\('Model', text, 'warn'\)[\s\S]{0,200}HCCodeSteps\.add\(activeContentEl/.test(mode));
  ok('the picker stops offering a model that is gone', /isRetired\(opt\.value\)/.test(mode) && /populateModelPicker\(\)/.test(mode));
  const boot = src('boot.js');
  const routerSrc = src('js', 'code', 'router.js');
  ok('the router loads before the panel, and uses the shared rules only as they are handed to it', boot.indexOf("'/js/code/router.js'") > -1 && boot.indexOf("'/js/code/router.js'") < boot.indexOf("'/js/app.js'") && !/window\.(HCChatFailover|HCModelRoutes)/.test(routerSrc));
  ok('a model that cannot read pictures says so in plain words', !/PDF page images/.test(src('js', 'app.js')) && /cannot read pictures\. Pick a model that can/.test(src('js', 'app.js')));
  ok('this check is part of npm run check', /npm run check:code-router/.test(readFileSync(join(here, '..', '..', 'package.json'), 'utf8')));
}

console.log(`\n${pass} passed, ${fail} failed  (src/js/code/router.js)`);
process.exit(fail ? 1 : 0);
