// ==============================================================
// How fast a model writes on this computer — checks
//
// Loads the REAL src/js/local-speed.js and src/js/local-client.js and holds
// that the speed of each reply is remembered per model and address, that a
// model never heard from is not slow, that short replies and models on other
// apps say nothing, that one busy answer does not make a model slow for good,
// and that storage that is missing or damaged changes nothing.
//
// Run with: npm run check:local-speed
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

const memory = () => {
  const data = new Map();
  return { getItem: (k) => (data.has(k) ? data.get(k) : null), setItem: (k, v) => data.set(k, String(v)), removeItem: (k) => data.delete(k), data };
};
const box = { window: {}, JSON, Math, Number, String, Array, Object, Map, Set, Promise, Error, Date };
vm.createContext(box);
vm.runInContext(src('js', 'local-speed.js'), box, { filename: 'local-speed.js' });
const S = box.window.HCLocalSpeed;

/** What Ollama sends at the end of a reply: this many tokens in this many seconds. */
const reply = (tokens, seconds) => ({ done: true, eval_count: tokens, eval_duration: seconds * 1e9 });
const H = 'http://127.0.0.1:11434';
const T0 = 1_000_000_000_000;

console.log('A reply is measured:');
{
  const store = memory();
  ok('tokens over seconds, kept', S.record(H, 'm', reply(100, 4), { store, now: T0 }) === 25 && S.tokensPerSecond(H, 'm', { store, now: T0 }) === 25);
  ok('a fast model is not slow', S.isSlow(H, 'm', { store, now: T0 }) === false);
  const slow = memory();
  S.record(H, 'm', reply(60, 20), { store: slow, now: T0 });
  ok('a model writing three words a second is slow', S.isSlow(H, 'm', { store: slow, now: T0 }) === true);
  const edge = memory();
  S.record(H, 'm', reply(100, 10), { store: edge, now: T0 });
  ok('ten a second is not slow: the line is below it', S.isSlow(H, 'm', { store: edge, now: T0 }) === false);
}

console.log('\nA model not measured is not slow:');
{
  const store = memory();
  ok('never heard from', S.tokensPerSecond(H, 'new', { store }) === null && S.isSlow(H, 'new', { store }) === false);
  ok('no storage at all', S.isSlow(H, 'm', { store: null }) === false && S.record(H, 'm', reply(100, 1), { store: null }) !== undefined);
}

console.log('\nWhat says too little is not taken in:');
{
  const store = memory();
  ok('a reply of under twenty tokens', S.record(H, 'm', reply(19, 5), { store }) === null && store.data.size === 0);
  ok('twenty is enough', S.record(H, 'm', reply(20, 5), { store }) === 4);
  const other = memory();
  for (const bad of [null, undefined, {}, { eval_count: 'x', eval_duration: 1e9 }, { eval_count: 50, eval_duration: 0 }, { eval_count: 50, eval_duration: -3 }, { eval_count: Infinity, eval_duration: 1e9 }, { eval_count: 50 }]) {
    ok(`nothing usable in ${JSON.stringify(bad)}`, S.record(H, 'm', bad, { store: other }) === null);
  }
  ok('and none of it was kept', other.data.size === 0);
  ok('a model on another local app is not measured here', S.record(H, 'local:1234/x', reply(100, 50), { store: other }) === null && S.isSlow(H, 'local:1234/x', { store: other }) === false);
  ok('nor a cloud model', S.record(H, 'cloud:openai/x', reply(100, 50), { store: other }) === null);
}

console.log('\nOne busy answer does not make a model slow for good:');
{
  const store = memory();
  S.record(H, 'm', reply(120, 4), { store, now: T0 });                  // 30 a second
  S.record(H, 'm', reply(40, 20), { store, now: T0 + 1000 });           // 2 a second
  const after = S.tokensPerSecond(H, 'm', { store, now: T0 + 1000 });
  ok('it moves half way, not all the way', after === 16, String(after));
  ok('and that is not yet slow', S.isSlow(H, 'm', { store, now: T0 + 1000 }) === false);
  S.record(H, 'm', reply(40, 20), { store, now: T0 + 2000 });
  S.record(H, 'm', reply(40, 20), { store, now: T0 + 3000 });
  ok('a model that stays slow is slow', S.isSlow(H, 'm', { store, now: T0 + 3000 }) === true);
  for (let i = 0; i < 4; i++) S.record(H, 'm', reply(300, 5), { store, now: T0 + 4000 + i });
  ok('and one that recovers is not', S.isSlow(H, 'm', { store, now: T0 + 9000 }) === false);
}

console.log('\nEach model at each address on its own:');
{
  const store = memory();
  S.record(H, 'big', reply(40, 20), { store, now: T0 });
  S.record(H, 'small', reply(300, 5), { store, now: T0 });
  S.record('http://other-machine.example:11434', 'big', reply(300, 5), { store, now: T0 });
  ok('a large model can be slow where a small one is not', S.isSlow(H, 'big', { store, now: T0 }) && !S.isSlow(H, 'small', { store, now: T0 }));
  ok('the same model on another machine is its own', !S.isSlow('http://other-machine.example:11434', 'big', { store, now: T0 }));
}

console.log('\nWhat is old is not trusted, and what is kept is small:');
{
  const store = memory();
  S.record(H, 'm', reply(40, 20), { store, now: T0 });
  const month = 30 * 24 * 60 * 60 * 1000;
  ok('after a month there is no figure, so the model is not slow', S.tokensPerSecond(H, 'm', { store, now: T0 + month + 1 }) === null && !S.isSlow(H, 'm', { store, now: T0 + month + 1 }));
  S.record(H, 'm', reply(300, 5), { store, now: T0 + month + 2 });
  ok('a new reply starts from itself, not from the old figure', S.tokensPerSecond(H, 'm', { store, now: T0 + month + 2 }) === 60);
  const many = memory();
  for (let i = 0; i < 130; i++) S.record(H, `model-${i}`, reply(100, 4), { store: many, now: T0 + i });
  const kept = JSON.parse(many.getItem(S.KEY));
  ok('only the most recent hundred models are kept', Object.keys(kept).length === 100 && !kept[`${H}|model-0`] && !!kept[`${H}|model-129`]);
}

console.log('\nStorage that is missing or damaged changes nothing:');
{
  const broken = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  ok('a blocked store reads as no figure', S.tokensPerSecond(H, 'm', { store: broken }) === null && S.isSlow(H, 'm', { store: broken }) === false);
  ok('and recording into it does not throw', S.record(H, 'm', reply(100, 4), { store: broken }) === 25);
  for (const junk of ['not json', '[]', '"x"', 'null', '{"http://127.0.0.1:11434|m":"slow"}', '{"http://127.0.0.1:11434|m":{"tps":"fast","at":1}}']) {
    const store = memory(); store.setItem(S.KEY, junk);
    ok(`damaged contents ${junk.slice(0, 24)} read as no figure`, S.isSlow(H, 'm', { store, now: 2 }) === false);
  }
}

console.log('\nThe client records every reply it reads:');
{
  const client = { window: {}, JSON, Math, Number, String, Array, Object, Map, Set, Promise, Error, Date };
  client.localStorage = memory();
  vm.createContext(client);
  vm.runInContext(src('js', 'local-speed.js'), client, { filename: 'local-speed.js' });
  vm.runInContext(src('js', 'local-client.js'), client, { filename: 'local-client.js' });
  const L = client.window.HCLocal;
  const fetchFn = async () => ({ ok: true, body: null });
  async function* lines() { yield { message: { content: 'hello there' } }; yield reply(80, 4); }
  const done = await L.chat(H, { model: 'm', messages: [{ role: 'user', content: 'hi' }] }, { fetchFn, lineReader: lines });
  ok('the words still arrive', done.content === 'hello there');
  ok('and the speed of the reply was kept', client.window.HCLocalSpeed.tokensPerSecond(H, 'm') === 20);
  async function* none() { yield { message: { content: 'x' } }; }
  await L.chat(H, { model: 'quiet', messages: [{ role: 'user', content: 'hi' }] }, { fetchFn, lineReader: none });
  ok('a reply that ends without counts keeps nothing and is not an error', client.window.HCLocalSpeed.tokensPerSecond(H, 'quiet') === null);
  const bare = { window: {}, JSON, Math, Number, String, Array, Object, Map, Set, Promise, Error, Date };
  vm.createContext(bare);
  vm.runInContext(src('js', 'local-client.js'), bare, { filename: 'local-client.js' });
  const fine = await bare.window.HCLocal.chat(H, { model: 'm', messages: [] }, { fetchFn, lineReader: lines });
  ok('where the module is not loaded, the client works as it did', fine.content === 'hello there');
}

console.log('\nIt is in the app:');
{
  const boot = src('boot.js');
  ok('the module loads before the chat', boot.indexOf("'/js/local-speed.js'") > -1 && boot.indexOf("'/js/local-speed.js'") < boot.indexOf("'/js/app.js'"));
  ok('and nothing is sent anywhere', !/fetch\(|sendBeacon|XMLHttpRequest/.test(src('js', 'local-speed.js')));
  const pkg = readFileSync(join(here, '..', '..', 'package.json'), 'utf8');
  ok('this check is part of npm run check', /npm run check:local-speed/.test(pkg));
}

console.log(`\n${pass} passed, ${fail} failed  (src/js/local-speed.js)`);
process.exit(fail ? 1 : 0);
