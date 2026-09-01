// ==============================================================
// What the providers said last time — checks
//
// Loads the REAL src/js/cloud-model-memory.js. This module decides which model
// list a person is shown before the network answers, so the thing worth
// checking is the ORDER of preference: what a provider last said beats what
// was typed into the catalogue by hand, and the catalogue is only reached for
// when there is nothing better.
//
// It is also the module most likely to be handed rubbish — a provider that
// answers with an error page, a storage that is full, a record from an older
// version of the app. None of that may throw, and none of it may quietly
// replace a good list with a bad one.
//
// Storage is injected rather than reached for. A check that ran against a
// missing `localStorage` would see every try/catch swallow the failure and
// report that everything works, which is a false pass that reads as strictness.
//
// Run with: npm run check:cloud-model-memory
// ==============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(
  readFileSync(join(root, 'src', 'js', 'cloud-model-memory.js'), 'utf8'),
  sandbox,
  { filename: 'cloud-model-memory.js' },
);
const M = sandbox.window.HCCloudModelMemory;

let pass = 0;
let fail = 0;
function ok(label, cond, detail = '') {
  if (cond) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}

/** A storage that behaves like localStorage and nothing more. */
const fakeStore = (seed = {}) => {
  const map = new Map(Object.entries(seed));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    _dump: () => Object.fromEntries(map),
  };
};

const model = (id, extra = {}) => ({
  value: `cloud:groq:${id}`, label: `${id} · Groq`, shortLabel: id, ...extra,
});

console.log('\nThe module is there and says what it stores under:');
{
  ok('published on window', !!M);
  ok('names its storage key', typeof M.KEY === 'string' && M.KEY.length > 0);
  // A version in the key is what lets the shape change later without an old
  // record being read as a new one.
  ok('the key is versioned', /_v\d+$/.test(M.KEY), M.KEY);
}

console.log('\nA provider is remembered and read back:');
{
  const store = fakeStore();
  ok('nothing is remembered to begin with', M.recall('groq', store) === null);
  ok('a real list is accepted', M.remember('groq', [model('a'), model('b')], store) === true);
  const back = M.recall('groq', store);
  ok('it reads back with both models', Array.isArray(back) && back.length === 2);
  ok('the value survives', back[0].value === 'cloud:groq:a');
  ok('the label survives', back[0].label === 'a · Groq');
  ok('the short label survives', back[0].shortLabel === 'a');
  ok('an image model keeps its flag', (() => {
    const s = fakeStore();
    M.remember('gemini', [model('img', { imageGen: true })], s);
    return M.recall('gemini', s)[0].imageGen === true;
  })());
  ok('one provider does not overwrite another', (() => {
    const s = fakeStore();
    M.remember('groq', [model('a')], s);
    M.remember('openai', [model('b')], s);
    return M.recall('groq', s)?.length === 1 && M.recall('openai', s)?.length === 1;
  })());
}

console.log('\nAn answer that is not an answer is refused:');
{
  const store = fakeStore();
  M.remember('groq', [model('good')], store);
  // The whole point of remembering is to beat a stale list. Letting an empty
  // or broken answer overwrite a good one would do the opposite.
  ok('an empty list is refused', M.remember('groq', [], store) === false);
  ok('a non-array is refused', M.remember('groq', null, store) === false);
  ok('a list of rubbish is refused', M.remember('groq', [null, {}, { label: 'x' }], store) === false);
  ok('the good list is still there afterwards', M.recall('groq', store)?.[0].value === 'cloud:groq:good');
}

console.log('\nA record that cannot become an option is dropped, not kept:');
{
  const store = fakeStore();
  M.remember('groq', [model('a'), { value: 'not-a-cloud-model' }, null, model('b')], store);
  const back = M.recall('groq', store);
  ok('only the usable records are stored', back.length === 2);
  ok('every stored value is a cloud model', back.every((m) => m.value.startsWith('cloud:')));
  ok('a record with no label still gets one', (() => {
    const s = fakeStore();
    M.remember('groq', [{ value: 'cloud:groq:x' }], s);
    return M.recall('groq', s)[0].label === 'cloud:groq:x';
  })());
}

console.log('\nThe catalogue is the last resort, never the first:');
{
  const fallback = [model('from-the-file')];
  const empty = fakeStore();
  ok('with nothing remembered, the catalogue is used',
    M.seed('groq', fallback, empty)[0].value === 'cloud:groq:from-the-file');

  const store = fakeStore();
  M.remember('groq', [model('from-the-provider')], store);
  ok('with something remembered, the provider wins',
    M.seed('groq', fallback, store)[0].value === 'cloud:groq:from-the-provider');

  // The seed is handed straight to a mutable per-provider list. Handing back
  // the caller's own array would let one provider's list edit the catalogue
  // for every launch afterwards.
  const seeded = M.seed('openai', fallback, empty);
  seeded.push(model('added-later'));
  ok('the catalogue is copied, not handed out', fallback.length === 1);

  ok('a provider with no catalogue and nothing remembered gets an empty list',
    Array.isArray(M.seed('nobody', undefined, empty)) && M.seed('nobody', undefined, empty).length === 0);
}

console.log('\nBroken storage never breaks the list:');
{
  ok('unreadable JSON reads as nothing remembered',
    M.recall('groq', fakeStore({ [M.KEY]: '{not json' })) === null);
  ok('an array where an object belongs reads as nothing',
    M.recall('groq', fakeStore({ [M.KEY]: '[]' })) === null);
  ok('a record with no models reads as nothing',
    M.recall('groq', fakeStore({ [M.KEY]: '{"groq":{"at":1}}' })) === null);

  const throwing = {
    getItem: () => { throw new Error('denied'); },
    setItem: () => { throw new Error('full'); },
    removeItem: () => { throw new Error('denied'); },
  };
  ok('a storage that refuses to read does not throw', M.recall('groq', throwing) === null);
  ok('a storage that refuses to write does not throw', M.remember('groq', [model('a')], throwing) === false);
  ok('the catalogue still comes through a refusing storage',
    M.seed('groq', [model('c')], throwing)[0].value === 'cloud:groq:c');
  ok('no storage at all is survivable', M.recall('groq', null) === null && M.remember('groq', [model('a')], null) === false);
}

console.log('\nA runaway list is refused rather than filling the storage:');
{
  // The API keys live in this same storage. A provider that starts answering
  // with something unbounded must not be able to crowd them out.
  const store = fakeStore();
  const huge = Array.from({ length: 20000 }, (_, i) => model('m'.repeat(60) + i));
  ok('a list past the cap is refused', M.remember('groq', huge, store) === false);
  ok('nothing was written', store._dump()[M.KEY] === undefined);
  ok('a normal list is nowhere near the cap', (() => {
    const s = fakeStore();
    M.remember('openrouter', Array.from({ length: 60 }, (_, i) => model('model-name-' + i)), s);
    return s._dump()[M.KEY].length < M.MAX_BYTES / 4;
  })());
}

console.log('\nForgetting works:');
{
  const store = fakeStore();
  M.remember('groq', [model('a')], store);
  M.forget(store);
  ok('nothing is remembered afterwards', M.recall('groq', store) === null);
  ok('forgetting an empty storage does not throw', (() => { M.forget(fakeStore()); return true; })());
}

console.log('\nThe app reaches for it, and loads it in time:');
{
  const app = readFileSync(join(root, 'src', 'js', 'app.js'), 'utf8');
  const boot = readFileSync(join(root, 'src', 'boot.js'), 'utf8');
  ok('app.js seeds every provider through the one funnel',
    !/models:\s*CLOUD_FALLBACK\./.test(app),
    'a provider seeded straight from the catalogue never learns a new model');
  // One consumer of the catalogue, so there is one answer to "what does a list
  // start as" rather than fourteen that can drift apart.
  const uses = (app.match(/CLOUD_FALLBACK/g) || []).length;
  ok('the catalogue has exactly one consumer left', uses === 2, `${uses} mentions`);
  ok('the module is in the boot list', boot.includes("'/js/cloud-model-memory.js'"));
  ok('it loads before app.js',
    boot.indexOf("'/js/cloud-model-memory.js'") < boot.indexOf("'/js/app.js'"));
}

console.log(`\n${pass} passed, ${fail} failed  (what the providers said last time)`);
process.exit(fail ? 1 : 0);
