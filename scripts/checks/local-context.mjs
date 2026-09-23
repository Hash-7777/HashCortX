// ==============================================================
// Local model room checks
//
// Loads the REAL src/js/local-context.js and holds that a request to a local
// model is given room for all of it and its answer — Ollama otherwise drops
// the start, which is the instructions — within what the model supports, in
// a few fixed steps, and refused in words when it cannot fit.
//
// Run with: npm run check:local-context
// ==============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const src = (...p) => readFileSync(join(here, '..', '..', 'src', ...p), 'utf8');
const sandbox = { window: {}, Map, JSON, Math, Number, String, Array, Object };
vm.createContext(sandbox);
vm.runInContext(src('js', 'local-context.js'), sandbox, { filename: 'local-context.js' });
const L = sandbox.window.HCLocalContext;

let pass = 0;
let fail = 0;
function ok(label, cond) {
  if (cond) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}`); }
}
const text = (chars) => [{ role: 'system', content: 'x'.repeat(chars) }];

console.log('Room for a request and its answer:');
ok('a short request gets the smallest step', L.sizeFor(text(1000)).numCtx === 8192);
ok('a request the old fixed 8,192 cut short gets a larger one', L.sizeFor(text(44000), { need: 6000 }).numCtx === 32768);
ok('the answer it must leave room for counts', L.sizeFor(text(20000), { need: 0 }).numCtx === 8192 && L.sizeFor(text(20000), { need: 6000 }).numCtx === 16384);
ok('never past what the model supports', L.sizeFor(text(20000), { need: 6000, max: 8192 }).ok === false && L.sizeFor(text(1000), { max: 4096 }).numCtx === 4096);
ok('never past the ceiling that keeps memory in check, whatever the model supports', L.sizeFor(text(50000), { max: 262144 }).numCtx === 32768);
ok('too much to hold is said, not cut', L.sizeFor(text(200000)).ok === false);
ok('tool calls in a conversation are counted', L.tokensOf([{ content: '', tool_calls: [{ function: { arguments: 'y'.repeat(3200) } }] }]) > 1000);

console.log('\nWhat the model supports, asked once:');
{
  let asked = 0;
  const fakeFetch = async () => { asked++; return { ok: true, json: async () => ({ model_info: { 'qwen2.context_length': 32768 }, capabilities: ['completion', 'tools'], details: { parameter_size: '3.1B' } }) }; };
  const first = await L.limitOf('http://h', 'qwen2.5-coder:3b', fakeFetch);
  await L.limitOf('http://h', 'qwen2.5-coder:3b', fakeFetch);
  ok('read from the model\'s own information, and remembered', first === 32768 && asked === 1);
  const info = await L.infoOf('http://h', 'qwen2.5-coder:3b', fakeFetch);
  ok('what it can do and its size come from the same answer', asked === 1 && L.can(info, 'tools') && !L.can(info, 'vision') && info.billions === 3.1);
  const down = await L.limitOf('http://h', 'other', async () => { throw new Error('offline'); });
  ok('unknown when Ollama cannot say: the ceiling stands', down === L.CEILING);
  const unknown = await L.infoOf('http://h', 'other');
  ok('and nothing is assumed about what it can do: an older Ollama loses nothing', L.can(unknown, 'tools') && L.can(unknown, 'vision') && !L.embedsOnly(unknown) && L.refusalFor(unknown, 'other', [{ images: ['x'] }]) === null);
  let err = null;
  try { await L.numCtx('http://h', 'qwen2.5-coder:3b', text(200000), { need: 2000, fetchFn: fakeFetch }); } catch (e) { err = e; }
  ok('a request that cannot fit is refused as one too large, so the routing knows it', err && /request too large/.test(err.message));
  ok('a caller\'s floor is honoured, within what the model supports', (await L.numCtx('http://h', 'qwen2.5-coder:3b', text(100), { floor: 16384, fetchFn: fakeFetch })) === 16384
    && (await L.numCtx('http://h', 'tiny', text(100), { floor: 16384, fetchFn: async () => ({ ok: true, json: async () => ({ model_info: { 'x.context_length': 4096 } }) }) })) === 4096);
}

console.log('\nWhat a model cannot do is said before it is asked:');
ok('a model only for search is told apart', L.embedsOnly({ caps: ['embedding'] }) && !L.embedsOnly({ caps: ['embedding', 'completion'] }) && !L.embedsOnly({ caps: ['completion'] }));
ok('... and asked to chat, the refusal says what to do', /for search, not conversation\. Pick another model/.test(L.refusalFor({ caps: ['embedding'] }, 'embed-m', [{ content: 'hi' }])));
ok('a picture for a model that cannot see: said plainly, naming the model', L.refusalFor({ caps: ['completion'] }, 'coder-3b', [{ content: 'what is this', images: ['b64'] }]) === 'coder-3b cannot see pictures. Pick a model that can, or send the message without the picture.');
ok('a picture for a model that can see, or no picture: nothing to refuse', L.refusalFor({ caps: ['completion', 'vision'] }, 'v', [{ images: ['b64'] }]) === null && L.refusalFor({ caps: ['completion'] }, 'c', [{ content: 'hi' }]) === null);
ok('sizes as Ollama writes them', L.billionsOf('7.6B') === 7.6 && Math.abs(L.billionsOf('770M') - 0.77) < 1e-9 && L.billionsOf('') === null && L.billionsOf('large') === null);

console.log('\nThe window a model is loaded with is kept while it fits:');
{
  const fetchFn = async () => ({ ok: true, json: async () => ({ model_info: { 'x.context_length': 131072 } }) });
  const n = (chars, opts = {}) => L.numCtx('http://s', 'm', text(chars), { fetchFn, ...opts });
  const a = await n(1000);
  const b = await n(40000);
  const c = await n(1000);
  ok('a short request after a longer one keeps the larger window: no reload', a === 8192 && b === 16384 && c === 16384);
  const d = await n(80000, { need: 4000 });
  const e = await n(1000);
  ok('a window more than twice what is needed is not kept: it holds memory the model could use', d === 32768 && e === 8192);
  ok('a caller\'s floor is honoured when it asks for more', (await n(1000, { floor: 16384 })) === 16384);
  L.forget('http://s', 'm');
  ok('forgotten, a model is sized afresh', (await n(1000)) === 8192);
}

console.log('\nEvery local call is sized:');
{
  const app = src('js', 'app.js');
  const calls = app.match(/HCLocalContext\.numCtx\(/g) || [];
  ok('the agent turn, plain chat, the side-by-side view, the modes\' own calls and the warm-up', calls.length === 5 && !/num_ctx: 8192/.test(app));
  ok('no request to a local model is written out beside the one client', !/\/api\/chat/.test(app));
  ok('the agent turn leaves room for the answer the caller needs', /agentTurnOllama\(\{ model, messages, tools, temperature, signal, json, need \}\)/.test(app) && /\{ need \}\)/.test(app));
  ok('a model the app unloads is sized afresh when it is loaded again', /HCLocalContext\.forget\(host, modelName\)/.test(app));
  ok('the chat and the agents say what a model cannot do before asking it', (app.match(/HCLocalContext\.refusalFor\(/g) || []).length === 2);
  ok('a model only for search is listed but not offered', /HCLocalContext\.embedsOnly\(infos\[i\]\)/.test(app) && /opt\.disabled = true; opt\.textContent = `\$\{m\} \(for search only\)`/.test(app) && /markSearchOnly\(safeHost\(\), models\)/.test(app));
  ok('it loads before the chat', src('boot.js').indexOf("'/js/local-context.js'") < src('boot.js').indexOf("'/js/app.js'"));
}

console.log(`\n${pass} passed, ${fail} failed  (src/js/local-context.js)`);
process.exit(fail ? 1 : 0);
