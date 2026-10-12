// ==============================================================
// Where a model on this computer runs — checks
//
// Loads the REAL src/js/local-place.js and src/js/local-client.js and holds
// that the choice made in Settings reaches every request and warm-up to
// Ollama, that nothing is sent until a choice is made, that only the choices
// offered can be kept, that a model too big for the graphics chip alone says
// how to go back to Automatic, and that the setting's menu is on the page and
// wired.
//
// Run with: npm run check:local-place
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

// A page with just enough in it for the setting's menu.
function page() {
  const events = {};
  const menu = {
    dataset: {}, children: [], value: '',
    appendChild(o) { this.children.push(o); },
    addEventListener(ev, fn) { events[ev] = fn; },
  };
  const doc = {
    readyState: 'complete',
    getElementById: (id) => (id === 'localPlace' ? menu : null),
    createElement: () => ({ value: '', textContent: '' }),
    addEventListener() {},
  };
  return { doc, menu, change: () => events.change && events.change() };
}

const box = { window: {}, JSON, Math, Number, String, Array, Object, Map, Set, Promise, Error, Date, AbortController, setTimeout, clearTimeout };
box.localStorage = memory();
vm.createContext(box);
vm.runInContext(src('js', 'local-place.js'), box, { filename: 'local-place.js' });
vm.runInContext(src('js', 'local-client.js'), box, { filename: 'local-client.js' });
const P = box.window.HCLocalPlace;
const L = box.window.HCLocal;
const ask = (extra = {}) => L.body({ model: 'm', messages: [{ role: 'user', content: 'hi' }], ...extra });

console.log('Until a choice is made, Ollama decides:');
{
  ok('nothing chosen reads as Automatic', P.value(memory()) === '');
  box.localStorage = memory();
  ok('and nothing about where it runs is sent', !('num_gpu' in ask().options));
  ok('Automatic is the first choice offered', P.OPTIONS[0].value === '' && /^Automatic/.test(P.OPTIONS[0].label));
}

console.log('\nA choice made reaches the next request:');
{
  box.localStorage = memory();
  ok('Graphics chip only is kept', P.set('gpu', box.localStorage) === true && P.value(box.localStorage) === 'gpu');
  ok('and sends every layer to the graphics chip', ask().options.num_gpu === P.LAYERS.gpu && P.LAYERS.gpu >= 999);
  ok('a warm-up carries it too', L.body({ model: 'm', messages: [], stream: false, numCtx: 8192 }).options.num_gpu === P.LAYERS.gpu);
  ok('Main memory is kept', P.set('cpu', box.localStorage) === true && P.value(box.localStorage) === 'cpu');
  ok('and sends no layer to the graphics chip', ask().options.num_gpu === 0);
  ok('the window and temperature still go with it', ask({ numCtx: 4096, temperature: 0.3 }).options.num_ctx === 4096 && ask({ temperature: 0.3 }).options.temperature === 0.3);
  P.set('', box.localStorage);
  ok('choosing Automatic again stops it being sent', !('num_gpu' in ask().options) && P.value(box.localStorage) === '');
}

console.log('\nOnly the choices offered can be kept:');
{
  const s = memory();
  for (const bad of ['GPU', 'cuda', '0', '999', '-1', ' gpu', 'null', 'both']) {
    s.setItem(P.KEY, bad);
    ok(`a stored "${bad}" reads as Automatic`, P.value(s) === '');
    ok(`and "${bad}" cannot be chosen`, P.set(bad, memory()) === false);
  }
  box.localStorage = s;
  s.setItem(P.KEY, 'cuda');
  ok('a damaged choice sends nothing', !('num_gpu' in ask().options));
}

console.log('\nWhere storage is not there, nothing breaks:');
{
  const broken = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); } };
  ok('a blocked store reads as Automatic', P.value(broken) === '' && Object.keys(P.options(broken)).length === 0);
  ok('and a choice says it was not kept', P.set('gpu', broken) === false);
  ok('no store at all is the same', P.value(null) === '' && P.set('gpu', null) === false);
}

console.log('\nA model too big for the graphics chip alone says how to go back:');
{
  box.localStorage = memory();
  P.set('gpu', box.localStorage);
  const reply = (status, text) => async () => ({ ok: false, status, text: async () => text });
  let err = null;
  try { await L.chat('http://host', { model: 'm', messages: [] }, { fetchFn: reply(500, '{"error":"model requires more system memory than is available"}') }); } catch (e) { err = e; }
  ok('a failed load names Automatic', !!err && /Ollama HTTP 500/.test(err.message) && /set where local models run to Automatic/.test(err.message), err && err.message);
  err = null;
  try {
    await L.chat('http://host', { model: 'm', messages: [] }, {
      fetchFn: async () => ({ ok: true, body: null }),
      lineReader: async function* () { yield { error: 'llama runner process has terminated: out of memory' }; },
    });
  } catch (e) { err = e; }
  ok('so does one that fails part-way', !!err && /Automatic/.test(err.message), err && err.message);
  err = null;
  try { await L.chat('http://host', { model: 'm', messages: [] }, { fetchFn: reply(404, 'model "m" not found') }); } catch (e) { err = e; }
  ok('any other failure is left as it was', !!err && !/Automatic/.test(err.message));
  P.set('', box.localStorage);
  err = null;
  try { await L.chat('http://host', { model: 'm', messages: [] }, { fetchFn: reply(500, 'out of memory') }); } catch (e) { err = e; }
  ok('and nothing is added when the graphics chip alone was not asked for', !!err && !/Automatic/.test(err.message));
  P.set('cpu', box.localStorage);
  ok('Main memory is never told it was too big for the graphics chip', P.tooBigHint('out of memory', box.localStorage) === '');
}

console.log('\nA change of place is warmed again:');
{
  box.localStorage = memory();
  const sent = [];
  const fetchFn = async (url, init) => { sent.push(JSON.parse(init.body)); return { ok: true }; };
  await L.warm('http://host', 'm', 8192, { fetchFn, now: 1000 });
  await L.warm('http://host', 'm', 8192, { fetchFn, now: 2000 });
  ok('the same place inside a minute is not warmed twice', sent.length === 1);
  P.set('cpu', box.localStorage);
  await L.warm('http://host', 'm', 8192, { fetchFn, now: 3000 });
  ok('a new place is warmed at once, where it will run', sent.length === 2 && sent[1].options.num_gpu === 0);
}

console.log('\nThe setting\'s menu:');
{
  box.localStorage = memory();
  P.set('cpu', box.localStorage);
  const p = page();
  P.wire(p.doc);
  ok('every choice is in it, Automatic first', p.menu.children.length === P.OPTIONS.length && p.menu.children[0].value === '');
  ok('it shows the one chosen', p.menu.value === 'cpu');
  p.menu.value = 'gpu';
  p.change();
  ok('choosing one keeps it', box.localStorage.getItem(P.KEY) === 'gpu' && ask().options.num_gpu === P.LAYERS.gpu);
  p.menu.value = '';
  p.change();
  ok('choosing Automatic clears it', box.localStorage.getItem(P.KEY) === null && !('num_gpu' in ask().options));
  p.menu.value = 'cuda';
  p.change();
  ok('a value that is not offered puts the menu back', p.menu.value === '');
  P.wire(p.doc);
  ok('it is wired once', p.menu.children.length === P.OPTIONS.length);
}

console.log('\nIt is in the app:');
{
  const html = src('core', 'settings', 'panel.html');
  ok('the setting is in General, as a menu', /<select class="control" id="localPlace"><\/select>/.test(html));
  ok('and says what each choice costs, and that it applies to Ollama', /a model too big for it may not load/.test(html) && /loads the model again on its next answer/.test(html) && /Applies to Ollama/.test(html));
  const boot = src('boot.js');
  const at = boot.indexOf("'/js/local-place.js'");
  ok('the module loads before the client is used and before the chat', at > -1 && at < boot.indexOf("'/js/app.js'"));
  ok('the client reads it for every request', /window\.HCLocalPlace/.test(src('js', 'local-client.js')) && /Object\.assign\(options, P\.options\(\)\)/.test(src('js', 'local-client.js')));
  ok('no other request to Ollama\'s chat is written outside the client', !/\/api\/chat/.test(src('js', 'app.js') + src('platform', 'tauri', 'hashcoder.js')));
  const pkg = readFileSync(join(here, '..', '..', 'package.json'), 'utf8');
  ok('and this check is part of npm run check', /npm run check:local-place/.test(pkg) && /"check:local-place": "node scripts\/checks\/local-place\.mjs"/.test(pkg));
}

console.log(`\n${pass} passed, ${fail} failed  (src/js/local-place.js)`);
process.exit(fail ? 1 : 0);
