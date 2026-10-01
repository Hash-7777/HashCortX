// ==============================================================
// How long a model on this computer stays loaded — checks
//
// Loads the REAL src/js/local-keep.js and src/js/local-client.js and holds
// that the time the person chooses in Settings reaches the request, that
// nothing is sent until they choose one, that no time can be chosen that
// would hold a model for good or unload it after every answer, and that the
// setting's menu is on the page and wired.
//
// Run with: npm run check:local-keep
// ==============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const src = (...p) => readFileSync(join(here, '..', '..', 'src', ...p), 'utf8');

let pass = 0;
let fail = 0;
function ok(label, cond) {
  if (cond) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}`); }
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
    getElementById: (id) => (id === 'localKeepAlive' ? menu : null),
    createElement: () => ({ value: '', textContent: '' }),
    addEventListener() {},
  };
  return { doc, menu, change: () => events.change && events.change() };
}

const box = { window: {}, JSON, Math, Number, String, Array, Object, Map, Set, Promise, Error, Date };
box.localStorage = memory();
vm.createContext(box);
vm.runInContext(src('js', 'local-keep.js'), box, { filename: 'local-keep.js' });
vm.runInContext(src('js', 'local-client.js'), box, { filename: 'local-client.js' });
const K = box.window.HCLocalKeep;
const L = box.window.HCLocal;
const ask = (extra = {}) => L.body({ model: 'm', messages: [{ role: 'user', content: 'hi' }], ...extra });

console.log('Until a time is chosen, Ollama decides:');
{
  const s = memory();
  ok('nothing chosen reads as not chosen', K.value(s) === '');
  box.localStorage = memory();
  ok('and no lifetime is sent', !('keep_alive' in ask()));
}

console.log('\nA time chosen reaches the next request:');
{
  box.localStorage = memory();
  ok('a time offered is kept', K.set('10m', box.localStorage) === true && K.value(box.localStorage) === '10m');
  ok('the request carries it', ask().keep_alive === '10m');
  ok('a warm-up carries it too', L.body({ model: 'm', messages: [], stream: false, numCtx: 8192 }).keep_alive === '10m');
  ok('a time a caller asks for wins', ask({ keepAlive: '1m' }).keep_alive === '1m' && ask({ keepAlive: 0 }).keep_alive === 0);
  K.set('', box.localStorage);
  ok('choosing Ollama\'s own again stops it being sent', !('keep_alive' in ask()) && K.value(box.localStorage) === '');
  for (const v of ['2m', '5m', '10m', '30m', '1h']) { K.set(v, box.localStorage); ok(`${v} is sent as written`, ask().keep_alive === v); }
}

console.log('\nNo time can be chosen that does harm:');
{
  const offered = K.OPTIONS.map((o) => o.value);
  ok('every time offered is a plain length or Ollama\'s own', offered.every((v) => v === '' || /^[1-9]\d*[mh]$/.test(v)));
  ok('none holds a model for good', !offered.some((v) => /^-|forever|never|infinity/i.test(v)));
  ok('none unloads it after each answer', !offered.some((v) => v === '0' || /^0/.test(v)));
  const minutes = offered.filter(Boolean).map((v) => (v.endsWith('h') ? 60 : 1) * parseInt(v, 10));
  ok('none is under two minutes', Math.min(...minutes) >= 2, String(Math.min(...minutes)));
  const s = memory();
  for (const bad of ['-1', '0', '0s', 'forever', '5', '1m ', '  ', 'null', '9999h']) {
    s.setItem(K.KEY, bad);
    ok(`a stored "${bad}" is ignored`, K.value(s) === '');
    ok(`and "${bad}" cannot be chosen`, K.set(bad, memory()) === false);
  }
  box.localStorage = s;
  s.setItem(K.KEY, '-1');
  ok('a damaged choice sends nothing', !('keep_alive' in ask()));
  ok('nothing in the app asks for a model to be kept for good', !/keepAlive: -1|keep_alive: -1/.test(src('js', 'app.js') + src('js', 'local-client.js') + src('js', 'local-keep.js')));
}

console.log('\nWhere storage is not there, nothing breaks:');
{
  const broken = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); } };
  ok('a blocked store reads as not chosen', K.value(broken) === '');
  ok('and a choice says it was not kept', K.set('10m', broken) === false);
  ok('no store at all is the same', K.value(null) === '' && K.set('10m', null) === false);
}

console.log('\nThe setting\'s menu:');
{
  box.localStorage = memory();
  K.set('30m', box.localStorage);
  const p = page();
  K.wire(p.doc);
  ok('every time offered is in it, Ollama\'s own first', p.menu.children.length === K.OPTIONS.length && p.menu.children[0].value === '');
  ok('it shows the one chosen', p.menu.value === '30m');
  p.menu.value = '5m';
  p.change();
  ok('choosing one keeps it', box.localStorage.getItem(K.KEY) === '5m' && ask().keep_alive === '5m');
  p.menu.value = '';
  p.change();
  ok('choosing Ollama\'s own clears it', box.localStorage.getItem(K.KEY) === null && !('keep_alive' in ask()));
  p.menu.value = '-1';
  p.change();
  ok('a value that is not offered puts the menu back', p.menu.value === '');
  K.wire(p.doc);
  ok('it is wired once', p.menu.children.length === K.OPTIONS.length);
}

console.log('\nIt is in the app:');
{
  const html = src('core', 'settings', 'panel.html');
  ok('the setting is in General, as a menu', /<select class="control" id="localKeepAlive"><\/select>/.test(html));
  ok('and says what it costs: a long step loads the model again', /A step that takes longer than this[^<]*loads the model again/.test(html));
  const boot = src('boot.js');
  ok('the module loads before the chat', boot.indexOf("'/js/local-keep.js'") > -1 && boot.indexOf("'/js/local-keep.js'") < boot.indexOf("'/js/app.js'"));
  ok('the client reads it for every request', /window\.HCLocalKeep/.test(src('js', 'local-client.js')));
  const pkg = readFileSync(join(here, '..', '..', 'package.json'), 'utf8');
  ok('and this check is part of npm run check', /npm run check:local-keep/.test(pkg));
}

console.log(`\n${pass} passed, ${fail} failed  (src/js/local-keep.js)`);
process.exit(fail ? 1 : 0);
