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
  const fakeFetch = async () => { asked++; return { ok: true, json: async () => ({ model_info: { 'qwen2.context_length': 32768 } }) }; };
  const first = await L.limitOf('http://h', 'qwen2.5-coder:3b', fakeFetch);
  await L.limitOf('http://h', 'qwen2.5-coder:3b', fakeFetch);
  ok('read from the model\'s own information, and remembered', first === 32768 && asked === 1);
  const down = await L.limitOf('http://h', 'other', async () => { throw new Error('offline'); });
  ok('unknown when Ollama cannot say: the ceiling stands', down === L.CEILING);
  let err = null;
  try { await L.numCtx('http://h', 'qwen2.5-coder:3b', text(200000), 2000, fakeFetch); } catch (e) { err = e; }
  ok('a request that cannot fit is refused as one too large, so the routing knows it', err && /request too large/.test(err.message));
}

console.log('\nEvery local call is sized:');
{
  const app = src('js', 'app.js');
  const calls = app.match(/HCLocalContext\.numCtx\(/g) || [];
  ok('the agent turn, plain chat, the side-by-side view and the modes\' own calls', calls.length === 4 && !/num_ctx: 8192/.test(app));
  ok('the agent turn leaves room for the answer the caller needs', /agentTurnOllama\(\{ model, messages, tools, temperature, signal, json, need \}\)/.test(app));
  ok('it loads before the chat', src('boot.js').indexOf("'/js/local-context.js'") < src('boot.js').indexOf("'/js/app.js'"));
}

console.log(`\n${pass} passed, ${fail} failed  (src/js/local-context.js)`);
process.exit(fail ? 1 : 0);
