// ==============================================================
// Model speed checks
//
// Loads the REAL src/js/model-speed.js, with the failover ranking and routing
// in src/js/model-routes.js that read it, into a Node VM.
//
// The rule: a model is chosen by how it answers as well as by its name. One
// that ran out of time, or a free giant never yet heard from, is not asked
// before one that answers — however large it is.
//
// Run with: npm run check:model-speed
// ==============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const src = (...p) => readFileSync(join(here, '..', '..', 'src', ...p), 'utf8');
const sandbox = { window: {} };
vm.createContext(sandbox);
for (const f of [['js', 'chat', 'failover.js'], ['js', 'model-speed.js'], ['js', 'model-routes.js']]) vm.runInContext(src(...f), sandbox, { filename: f[f.length - 1] });
const S = sandbox.window.HCModelSpeed;
const R = sandbox.window.HCModelRoutes;

let pass = 0;
let fail = 0;
function ok(label, cond, detail = '') {
  if (cond) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}
const memory = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
const T0 = 1_800_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

const ULTRA = 'cloud:openrouter:nvidia/nemotron-3-ultra-550b-a55b:free';
const SUPER = 'cloud:openrouter:nvidia/nemotron-3-super-120b-a12b:free';
const OSS = 'cloud:groq:openai/gpt-oss-120b';
const PRO = 'cloud:gemini:gemini-3.1-pro-preview';

console.log('What a model has done decides its group:');
{
  const store = memory();
  ok('a model never tried is ready', S.stateOf(OSS, T0, store) === 'ready');
  ok('a free model of 200B or more, never heard from, is likely slow', S.stateOf(ULTRA, T0, store) === 'likely-slow');
  ok('a free model under 200B is not judged by its size', S.stateOf(SUPER, T0, store) === 'ready');
  ok('a paid giant is not judged by its size', S.stateOf('cloud:samba:llama-405b', T0, store) === 'ready');
  S.record(ULTRA, { ms: 20_000, chars: 12_000 }, T0, store);
  ok('a free giant that answered in good time is ready', S.stateOf(ULTRA, T0, store) === 'ready');
  S.recordTimeout(OSS, T0 + 1000, store);
  ok('a model that ran out of time is timed out', S.stateOf(OSS, T0 + 2000, store) === 'timed-out');
  S.record(OSS, { ms: 8000, chars: 9000 }, T0 + 3000, store);
  ok('an answer after the timeout puts it back at once', S.stateOf(OSS, T0 + 4000, store) === 'ready');
  S.recordTimeout(PRO, T0, store);
  ok('a timeout is forgotten after a week', S.stateOf(PRO, T0 + 8 * DAY, store) !== 'timed-out');
  S.record(SUPER, { ms: 186_000, chars: 24_000 }, T0, store);
  ok('an answer that took a long time for its length is not slow', S.stateOf(SUPER, T0, store) === 'ready');
  S.record('cloud:x:crawl', { ms: 150_000, chars: 4_000 }, T0, store);
  ok('a model that takes minutes for a short answer is slow', S.stateOf('cloud:x:crawl', T0, store) === 'slow');
  ok('nothing is recorded without a model or a time', S.record('', { ms: 5 }, T0, store) === false && S.record(OSS, {}, T0, store) === false);
  ok('each passed-over group has words for the trace', ['timed-out', 'slow', 'likely-slow'].every((g) => S.reasonOf(g)));
}

console.log('\nChoosing goes by group, then strength:');
{
  const store = memory();
  const opts = [ULTRA, SUPER, OSS].map((v) => ({ value: v }));
  const strength = { [ULTRA]: 800, [SUPER]: 400, [OSS]: 300 };
  const ordered = S.order(opts, (o) => o.value, (o) => strength[o.value], T0, store).map((o) => o.value);
  ok('a free giant never heard from goes after models that answer, however strong its name', ordered[ordered.length - 1] === ULTRA && ordered[0] === SUPER);
  S.recordTimeout(SUPER, T0, store);
  const after = S.order(opts, (o) => o.value, (o) => strength[o.value], T0 + 1, store).map((o) => o.value);
  ok('one that timed out goes last of all', after.join() === [OSS, ULTRA, SUPER].join());
  ok('with nothing known, strength decides as it always did', S.order([{ value: 'a', s: 1 }, { value: 'b', s: 2 }], (o) => o.value, (o) => o.s, T0, memory())[0].value === 'b');

  // Control: by strength alone, the choice that stalled a real run.
  const byName = [...opts].sort((a, b) => strength[b.value] - strength[a.value])[0].value;
  ok('control: by name alone the free giant is chosen first', byName === ULTRA);
}

console.log('\nFailover and the start of a job read it:');
{
  const store = memory();
  const options = () => [{ value: ULTRA, label: 'Nemotron Ultra 550B' }, { value: OSS, label: 'GPT OSS 120B' }, { value: PRO, label: 'Gemini 3.1 Pro' }];
  S.recordTimeout(PRO, T0, store);
  const next = R.nextRoutes({ failed: 'cloud:samba:some-model', kind: 'slow', options: options(), store, now: T0 + 1 });
  ok('after a failure, a model that timed out is tried last', next[next.length - 1] === PRO);
  const notes = [];
  const run = R.createRun({ options, store, note: (m) => notes.push(m), label: (v) => v });
  const began = run.start(PRO);
  ok('a job given to a model that timed out on its last job starts on another', began !== PRO && began === OSS, began);
  ok('and the trace says why', /ran out of time on its last job/.test(notes.join(' ')));
  ok('a model that answers is started as chosen', R.createRun({ options, store }).start(OSS) === OSS);
  const alone = R.createRun({ options: () => [{ value: PRO }], store });
  ok('with nothing else to ask, the chosen model is still asked', alone.start(PRO) === PRO);
  const timing = R.createRun({ options, store });
  timing.next(OSS, Object.assign(new Error('Agent timeout after 150s'), { timedOut: true }));
  ok('a timeout reported to failover is remembered', S.stateOf(OSS, Date.now(), store) === 'timed-out');
}

console.log('\nIt is kept small:');
{
  const store = memory();
  for (let i = 0; i < 320; i++) S.record(`cloud:p:m${i}`, { ms: 1000, chars: 1000 }, T0 + i, store);
  const kept = Object.keys(JSON.parse(store.getItem(S.KEY)));
  ok('no more than 300 models are kept, the oldest dropped first', kept.length === 300 && !kept.includes('cloud:p:m0') && kept.includes('cloud:p:m319'));
  S.forget(store);
  ok('forgetting clears it', store.getItem(S.KEY) === null);
}

console.log('\nEvery place a model is picked reads it:');
{
  const swarm = src('modes', 'agent-maker', 'mode.js');
  const forge = src('modes', 'forge', 'mode.js');
  const app = src('js', 'app.js');
  const shape = src('js', 'agent-shape.js');
  const strength = readFileSync(new URL('../../src/js/swarm/model-strength.js', import.meta.url), 'utf8');
  ok('the God Agent picks each provider\'s model by group, then strength', /function best\(options, bigTask\)[\s\S]{0,200}HCModelSpeed\.order\(options/.test(strength)
    && /window\.HCSwarmModelStrength\.best\(options, bigTask\)/.test(swarm) && /HCModelSpeed\.order\(unordered/.test(swarm));
  ok('the Forge does the same', /function bestModelForProvider[\s\S]{0,300}HCModelSpeed\.order\(options/.test(forge) && /HCModelSpeed\.order\(unordered/.test(forge));
  ok('every model turn records how long its answer took', /S\.record\(request\.modelValue, \{ ms: Date\.now\(\) - started, chars: text\.length \}\)/.test(shape) && /HCAgentShape\.routeModelTurn\(/.test(app));
  ok('the God Agent is no longer told to prefer the largest models', !/strongest\/frontier\/famous\/largest/.test(swarm));
  const boot = src('boot.js');
  ok('it loads before the failover that reads it', boot.indexOf("'/js/model-speed.js'") > 0 && boot.indexOf("'/js/model-speed.js'") < boot.indexOf("'/js/model-routes.js'"));
}

console.log(`\n${pass} passed, ${fail} failed  (src/js/model-speed.js)`);
process.exit(fail ? 1 : 0);
