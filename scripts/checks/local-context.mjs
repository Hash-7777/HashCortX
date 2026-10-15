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
ok('a short request gets the smallest step, the window Ollama gives a model by itself', L.sizeFor(text(1000)).numCtx === 4096 && L.STEPS[0] === 4096);
ok('a request the old fixed 8,192 cut short gets a larger one', L.sizeFor(text(44000), { need: 6000 }).numCtx === 32768);
ok('the answer it must leave room for counts', L.sizeFor(text(20000), { need: 0 }).numCtx === 8192 && L.sizeFor(text(20000), { need: 6000 }).numCtx === 16384 && L.sizeFor(text(9000)).numCtx === 8192);
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
  ok('a request after a longer one keeps the larger window while it is not measured and at most twice what is needed: no reload', a === 4096 && b === 16384 && (await n(20000)) === 16384);
  const d = await n(80000, { need: 4000 });
  const e = await n(1000);
  ok('a window more than twice what is needed, not measured, is not kept', d === 32768 && e === 4096);
  ok('a caller\'s floor is honoured when it asks for more', (await n(1000, { floor: 16384 })) === 16384);
  L.forget('http://s', 'm');
  ok('forgotten, a model is sized afresh', (await n(1000)) === 4096);
}

console.log('\nA window is kept or given up by where it put the model:');
{
  const fetchFn = async () => ({ ok: true, json: async () => ({ model_info: { 'x.context_length': 131072 } }) });
  const n = (model, chars) => L.numCtx('http://g', model, text(chars), { fetchFn });
  await n('fits', 40000);   // 16,384
  L.placed('http://g', 'fits', 16384, 1);
  ok('a window known to hold the whole model on the graphics chip is kept for a short request: no reload', (await n('fits', 1000)) === 16384);
  await n('spills', 40000);
  L.placed('http://g', 'spills', 16384, 0.77);
  ok('a window known to push part of the model into main memory is given up for the smaller one the request needs', (await n('spills', 1000)) === 4096);
  await n('big', 40000);
  L.placed('http://g', 'big', 16384, 0.7);
  ok('...but kept while the request needs all of it', (await n('big', 40000)) === 16384);
  const ps = (models) => async (url) => ({ ok: /\/api\/ps$/.test(url), json: async () => ({ models }) });
  const share = await L.measure('http://g', 'qwen:7b', 8192, ps([{ name: 'other', size: 1, size_vram: 1 }, { name: 'qwen:7b', size: 100, size_vram: 85, context_length: 8192 }]));
  ok('Ollama is asked how much of the model it holds on the graphics chip, at the window it was loaded with', Math.abs(share - 0.85) < 1e-9);
  ok('a model it does not list, another local app, or a failed answer says nothing', (await L.measure('http://g', 'gone', 8192, ps([]))) === null
    && (await L.measure('http://g', 'local:1234/m', 8192, ps([]))) === null && (await L.measure('http://g', 'm', 8192, async () => { throw new Error('off'); })) === null);
  const client = src('js', 'local-client.js');
  ok('after every answer from Ollama the client measures it, without holding the answer up', /C\.measure\(host, request\.model, request\.numCtx, fetchFn\)\.catch\(\(\) => null\);/.test(client));
}

console.log('\nEvery local call is sized:');
{
  const app = src('js', 'app.js');
  const calls = app.match(/HCLocalContext\.numCtx\(/g) || [];
  ok('the agent turn, a local agent\'s steps, plain chat, the side-by-side view, the modes\' own calls and the warm-up', calls.length === 6 && !/num_ctx: 8192/.test(app));
  ok('no request to a local model is written out beside the one client', !/\/api\/chat/.test(app));
  ok('the agent turn leaves room for the answer the caller needs', /agentTurnOllama\(\{ model, messages, tools, temperature, signal, json, need(?:, [\w, ]+)? \}\)/.test(app) && /\{ need: need \|\| most \}\)/.test(app));
  ok('a model the app unloads is sized afresh when it is loaded again', /HCLocalContext\.forget\(host, modelName\)/.test(app));
  ok('the chat and the agents say what a model cannot do before asking it', (app.match(/HCLocalContext\.refusalFor\(/g) || []).length === 2);
  ok('a model only for search is listed but not offered', /HCLocalContext\.embedsOnly\(infos\[i\]\)/.test(app) && /opt\.disabled = true; opt\.textContent = `\$\{m\} \(for search only\)`/.test(app) && /markSearchOnly\(safeHost\(\), models\)/.test(app));
  ok('it loads before the chat', src('boot.js').indexOf("'/js/local-context.js'") < src('boot.js').indexOf("'/js/app.js'"));
  // A window is memory the model holds for as long as it is loaded: the
  // conversation is never given a larger one than it needs because of what it
  // contains or how much of it is remembered.
  ok('the chat asks for the room the request needs, never a larger window of its own',
    !/\bfloor:/.test(app) && !/const numCtx\s*=\s*hasAttachedFileContext/.test(app) && !/streamWithModelValue\(\{[^}]*numCtx/.test(app));
  ok('files attached to a short request leave it the smallest window', L.sizeFor([{ role: 'user', content: '[ATTACHED FILES - use this content when answering]\nsmall' }]).numCtx === 4096);
}

console.log(`\n${pass} passed, ${fail} failed  (src/js/local-context.js)`);
process.exit(fail ? 1 : 0);
