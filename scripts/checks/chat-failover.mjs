// ==============================================================
// Failover — checks
//
// Loads the REAL src/js/chat/failover.js. When a request fails the app moves
// on to another model, and two judgements decide what happens: whether the
// failure is worth moving on from, and which model to reach for.
//
// What is pinned here is the RULE, not the list of names. Model names change
// every few months and any list of them goes out of date; the rule that a
// variant is read before the family does not, and it is the rule that was
// broken — "gpt-4o-mini" matched "gpt-4o" and was ranked among the frontier
// models it is the cheap version of.
//
// Run with: npm run check:chat-failover
// ==============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const sandbox = { window: {}, Map, Array, String, Number };
vm.createContext(sandbox);
vm.runInContext(readFileSync(join(root, 'src', 'js', 'chat', 'failover.js'), 'utf8'), sandbox, { filename: 'failover.js' });
const F = sandbox.window.HCChatFailover;

let pass = 0;
let fail = 0;
function ok(label, cond, detail = '') {
  if (cond) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}
const model = (label, name) => ({ label, model: name });

// ── The rule ─────────────────────────────────────────────────────────────
console.log('\nThe cheap version of a model is not the model:');
{
  // The defect. A family name matched before the variant, so every small
  // variant was ranked alongside the frontier model it is named after — and a
  // failover reached for it ahead of a genuinely large model.
  const pairs = [
    ['gpt-4o', 'gpt-4o-mini'],
    ['gemini-2.5-flash', 'gemini-2.5-flash-lite'],
    ['claude-opus-4', 'claude-opus-4-mini'],
    ['some-model-70b', 'some-model-70b-lite'],
  ];
  for (const [full, small] of pairs) {
    ok(`${small} ranks below ${full}`, F.rankOf(small) < F.rankOf(full),
      `${F.tierOf(small)} against ${F.tierOf(full)}`);
  }
  ok('and none of them is called frontier',
    pairs.every(([, small]) => F.tierOf(small) !== 'frontier'));
  // Stated as the rule rather than as a list, because the list goes stale.
  ok('any name carrying a small-variant word ranks below the same name without it',
    ['mini', 'lite', 'nano', 'tiny'].every((word) =>
      F.rankOf(`madeup-frontier-model-${word}`) < F.rankOf('gpt-4o')));
}

console.log('\nAnd a bigger model outranks a smaller one:');
{
  ok('frontier beats large', F.rankOf('gpt-4o') > F.rankOf('llama-3.3-70b'));
  ok('large beats medium', F.rankOf('llama-3.3-70b') > F.rankOf('claude-3-5-haiku'));
  ok('medium beats small', F.rankOf('claude-3-5-haiku') > F.rankOf('some-unknown-model'));
  // A name nobody has taught it about is ranked last rather than guessed high:
  // reaching for an unknown model ahead of a known good one is the worse
  // mistake of the two.
  ok('a name it knows nothing about ranks last', F.tierOf('totally-unheard-of') === 'small');
  ok('and nothing at all is survivable', F.tierOf('') === 'small' && F.tierOf(null) === 'small');
}

console.log('\nA failure is sorted into what to do about it:');
{
  ok('a cancelled request is the end of it',
    F.classifyError({ name: 'AbortError', message: 'aborted' }) === 'fatal');
  ok('and so is nothing at all', F.classifyError(null) === 'fatal');
  // The same model again might work.
  ok('a timeout is worth waiting out',
    F.classifyError(new Error('request timed out')) === 'transient');
  ok('so is a network drop', F.classifyError(new Error('fetch failed')) === 'transient');
  ok('and a server fault', F.classifyError(new Error('503 server error')) === 'transient');
  // This model will not do it; another might.
  ok('a rate limit means try somewhere else',
    F.classifyError(new Error('rate limit exceeded')) === 'routable');
  ok('so does a rejected key', F.classifyError(new Error('HTTP 401 invalid key')) === 'routable');
  ok('and a model that is not there', F.classifyError(new Error('model not found')) === 'routable');
  // Trying another model wastes a request; calling a recoverable failure fatal
  // ends somebody's work for no reason. The first is the cheaper mistake.
  ok('something it does not recognise is treated as worth trying elsewhere',
    F.classifyError(new Error('something nobody has seen before')) === 'routable');
  ok('and isRoutable agrees with the sorting',
    F.isRoutable(new Error('429')) && !F.isRoutable(new Error('timed out'))
    && !F.isRoutable({ name: 'AbortError' }));
}

console.log('\nThe model somebody chose stays the one that is tried first:');
{
  // Being quietly moved off the model you picked, because the app thinks it
  // knows better, is not a failover.
  const chain = [model('local', 'tiny-1b'), model('groq', 'gpt-4o'), model('gemini', 'gemini-2.5-pro')];
  const order = F.orderChain(chain);
  ok('the choice is first even when it ranks last', order[0].model === 'tiny-1b');
  ok('and the rest follow by how capable they are',
    order.slice(1).every((m, i, a) => i === 0 || F.rankOf(a[i - 1].model) >= F.rankOf(m.model)));
}

console.log('\nA model that keeps failing goes to the back:');
{
  const chain = [
    model('primary', 'tiny-1b'),
    model('a', 'gpt-4o'),
    model('b', 'llama-3.3-70b'),
  ];
  const streaks = new Map([['a:gpt-4o', 5]]);
  const order = F.orderChain(chain, streaks);
  ok('the choice is still first', order[0].model === 'tiny-1b');
  // A frontier model refusing every request is worth less right now than a
  // smaller one that answers.
  ok('the one that keeps failing is tried after the one that works',
    order[1].model === 'llama-3.3-70b', order.map((m) => m.model).join(' → '));
  ok('but it is still tried rather than dropped',
    order.some((m) => m.model === 'gpt-4o'));
  ok('a couple of failures is not enough to demote it',
    F.orderChain(chain, new Map([['a:gpt-4o', 2]]))[1].model === 'gpt-4o');
}

console.log('\nThe same chain always comes back in the same order:');
{
  // Two models of equal rank must not swap places between runs, or a failover
  // becomes something nobody can reproduce.
  const chain = [model('p', 'x'), model('a', 'llama-3.3-70b'), model('b', 'qwen2.5-72b')];
  const once = F.orderChain(chain).map((m) => m.label).join();
  const twice = F.orderChain(chain).map((m) => m.label).join();
  ok('two runs give the same order', once === twice, `${once} then ${twice}`);
  ok('and equal ranks keep the order they were offered in', once === 'p,a,b', once);
  ok('an empty chain is an empty chain',
    F.orderChain([]).length === 0 && F.orderChain(null).length === 0);
  ok('nothing is lost from the chain', F.orderChain(chain).length === chain.length);
}

console.log('\nThe chat moves on the way every agent mode does:');
{
  // The chat's failover is js/model-routes.js with the chat's own preference,
  // so both are loaded as the app loads them.
  const box = { window: { HCChatFailover: F }, Map, Set, Array, String, Number, Date, JSON, Math, Object };
  vm.createContext(box);
  vm.runInContext(readFileSync(join(root, 'src', 'js', 'model-routes.js'), 'utf8'), box, { filename: 'model-routes.js' });
  const R = box.window.HCModelRoutes;
  const store = { v: {}, getItem(k) { return this.v[k] ?? null; }, setItem(k, x) { this.v[k] = String(x); }, removeItem(k) { delete this.v[k]; } };
  const options = [
    { value: 'cloud:openrouter:nvidia/nemotron-3-super-120b-a12b:free', label: 'Nemotron 3 Super (free)' },
    { value: 'cloud:openrouter:nvidia/nemotron-3-ultra-550b-a55b:free', label: 'Nemotron 3 Ultra (free)' },
    { value: 'cloud:openrouter:google/gemma-4-31b-it:free', label: 'Gemma 4 31B (free)' },
    { value: 'cloud:openai:gpt-4o', label: 'GPT-4o' },
    { value: 'cloud:gemini:gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
    { value: 'cloud:groq:llama-3.3-70b-versatile', label: 'Llama 3.3 70B' },
  ];
  const run = () => R.createRun({ options: () => options, store, strength: (o) => F.strengthOf(o.value, o.label) });
  const first = options[0].value;
  const provider = (v) => v && v.split(':')[1];

  // The account's free allowance for the day is shared by every free model on
  // it, so trying the next free model on that account is a wasted request.
  const quota = Object.assign(new Error('OpenRouter rate limit: free-models-per-day'), { status: 429 });
  ok('an account out of quota is left whole', provider(run().next(first, quota)) !== 'openrouter');
  const credit = new Error('SambaNova has no credit left on this account');
  ok('... and so is one with no credit', R.failureKind(credit) === 'limit');
  const busy = Object.assign(new Error('OpenRouter is overloaded right now. Try again in a few seconds.'), { status: 503 });
  ok('a busy model is replaced from another provider first', provider(run().next(first, busy)) !== 'openrouter');
  ok('a model that never started is replaced from another provider first',
    provider(run().next(first, Object.assign(new Error('x did not start answering within 45 s'), { timedOut: true }))) !== 'openrouter');
  ok('an empty reply is replaced too', !!run().next(first, Object.assign(new Error('x answered with nothing'), { empty: true })));

  // Between two of the same class, the free tier comes first.
  ok('between equals, a free-tier provider is preferred', F.strengthOf('cloud:gemini:gemini-2.5-pro', 'Gemini 2.5 Pro') > F.strengthOf('cloud:openai:gpt-5', 'GPT-5'));
  ok('... but never over a stronger class', F.strengthOf('cloud:openai:gpt-4o', 'GPT-4o') > F.strengthOf('cloud:groq:llama-3.1-8b-instant', 'Llama 3.1 8B'));
  const r = run();
  const seen = [];
  let at = first;
  for (let i = 0; i < 8 && at; i++) { seen.push(at); at = r.next(at, busy); }
  ok('a run never asks the same model twice', new Set(seen).size === seen.length);
}

// ── An agent's turns ─────────────────────────────────────────────────────
console.log('\nAn agent moves to another model when the one in use cannot answer:');
{
  const rsb = { window: {}, Map, Array, String, Number, Date, JSON, Math, Set, Object, Error, setTimeout, clearTimeout, AbortController };
  vm.createContext(rsb);
  vm.runInContext(readFileSync(join(root, 'src', 'js', 'model-routes.js'), 'utf8'), rsb, { filename: 'model-routes.js' });
  const R = rsb.window.HCModelRoutes;
  const options = () => [
    { value: 'cloud:gemini:gemini-3.5-flash', label: 'Gemini 3.5 Flash' },
    { value: 'cloud:groq:openai/gpt-oss-120b', label: 'GPT OSS 120B' },
    { value: 'cloud:openrouter:nvidia/nemotron-3-super-120b-a12b:free', label: 'Nemotron 3 Super' },
  ];
  const adapterOf = (v) => ({ kind: v.split(':')[1] === 'gemini' ? 'gemini' : 'openai', provider: v.split(':')[1], model: v.split(':').slice(2).join(':') });
  const quota = (model) => Object.assign(new Error('rate limit — free-tier quota exceeded'), { status: 429, model });
  const make = (answers, extra = {}) => {
    const asked = [];
    const switched = [];
    const turns = F.agentTurns({
      start: 'cloud:gemini:gemini-3.5-flash',
      send: async (req) => { asked.push(req); const a = answers[asked.length - 1]; if (a instanceof Error) throw a; return a; },
      adapterOf, routes: R.createRun({ options, store: null }), failureKind: R.failureKind, reasonText: R.reasonText,
      onSwitch: (from, to, why) => switched.push({ from, to, why }), ...extra,
    });
    return { turns, asked, switched };
  };
  R.forgetCooling();
  {
    const { turns, asked, switched } = make([quota('cloud:gemini:gemini-3.5-flash'), { content: 'hello', tool_calls: null }]);
    const out = await turns.turn({ messages: [{ role: 'user', content: 'hi' }], tools: [] });
    ok('a rate limit on the first model is answered by another', out.content === 'hello' && asked.length === 2);
    ok('... from another provider', asked[1].modelValue.split(':')[1] !== 'gemini' && asked[1].adapter.provider === asked[1].modelValue.split(':')[1]);
    ok('... and the person is told which, and why', switched.length === 1 && /out of quota/.test(switched[0].why));
    ok('the rest of the run stays on the model that answered', turns.model === asked[1].modelValue);
    ok('every request names its model whole', asked.every((r) => /^cloud:[^:]+:/.test(r.modelValue)));
  }
  R.forgetCooling();
  {
    const { turns, asked } = make([Object.assign(new Error('Function call is missing a thought_signature'), { status: 400 })]);
    const err = await turns.turn({ messages: [], tools: [] }).catch((e) => e);
    ok('a mistake in the request itself is not passed round every model', /thought_signature/.test(err.message) && asked.length === 1);
  }
  R.forgetCooling();
  {
    const ctrl = new AbortController();
    ctrl.abort();
    const { turns, asked } = make([quota('cloud:gemini:gemini-3.5-flash'), { content: 'x' }]);
    const err = await turns.turn({ messages: [], tools: [], signal: ctrl.signal }).catch((e) => e);
    ok('a run the person stopped does not move on', err instanceof Error && asked.length === 1);
  }
  R.forgetCooling();
  {
    const { turns, asked } = make(Array.from({ length: 12 }, () => quota()), { maxSwitches: 1 });
    await turns.turn({ messages: [], tools: [] }).catch(() => {});
    ok('it moves on a bounded number of times', asked.length === 2);
  }
  {
    const asked = [];
    const turns = F.agentTurns({ start: 'llama3', send: async (r) => { asked.push(r); throw quota(); }, adapterOf: () => ({ kind: 'ollama', model: 'llama3' }),
      routes: null, failureKind: R.failureKind, reasonText: R.reasonText });
    await turns.turn({ messages: [] }).catch(() => {});
    ok('a local model\'s job is never handed to a cloud model', asked.length === 1);
  }
}

console.log('\nHow the chat uses it:');
{
  const app = readFileSync(join(root, 'src', 'js', 'app.js'), 'utf8');
  const loop = app.slice(app.indexOf('async function runAgentLoop'), app.indexOf('async function runAgentLiteFlow'));
  ok('the agent loop sends every turn through it', /HCChatFailover\.agentTurns\(\{/.test(loop) && /await turns\.turn\(\{ messages, tools, temperature, signal \}\)/.test(loop) && !/runModelTurn\(\{/.test(loop));
  ok('... a local model gets no routes', /routes: modelEl\.value\.startsWith\("cloud:"\)/.test(loop));
  ok('the last turn tells the model the tools are over, rather than only leaving them off', /content: AGENT_CLOSING_TURN/.test(loop) && /No more tools can be used now/.test(app));
  ok('a run that wrote no answer never says "Done."', !/: "Done\."/.test(loop) && /did not write an answer/.test(loop));
  ok('a tool that keeps its own time, or waits on the person, is not raced', /tool\.ownLimit \? await run/.test(app)
    && /statusLabel: a => `Reading page[^\n]*\n[^]*?ownLimit: true/.test(app) && /statusLabel: a => `Running Python[^\n]*\n[^]*?ownLimit: true/.test(app));
  const preset = app.slice(app.indexOf('async function applyPreset'), app.indexOf('// Wire the persistent composer-level chip row'));
  ok('"Look it up" turns on an agent that can search when the one in use cannot', /grounded: \["web_search", "builtin_researcher"/.test(preset) && /setActiveAgent\(needs\[1\]\)/.test(preset));
  ok('"Work it out" turns on one that can run Python', /compute: \["code_interpreter", "builtin_hash_ai"/.test(preset));
  ok('"Use my notes" says when a cloud model means the notes are not read', /preset === "knowledge"/.test(preset) && /never sent to a cloud model/.test(preset));
}

console.log(`\n${pass} passed, ${fail} failed  (src/js/chat/failover.js)\n`);
process.exit(fail === 0 ? 0 : 1);
