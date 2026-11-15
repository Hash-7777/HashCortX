// ==============================================================
// Where HashCoder keeps its conversations — checks
//
// Loads the real src/js/code/store.js into a Node VM with a small stand-in
// for IndexedDB and a localStorage with a quota, and holds it to its word:
// what localStorage held is moved across once and removed there only after
// it is kept; reads come from memory at once; writes are kept in the order
// made; a write made before the store opened is not overwritten by what it
// held; a conversation larger than localStorage's quota is kept whole; and
// where IndexedDB cannot be opened, localStorage is used as before.
//
// Run with: npm run check:code-store
// ==============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const src = (...p) => readFileSync(join(here, '..', '..', 'src', ...p), 'utf8');
let pass = 0, fail = 0;
function ok(label, cond, detail = '') {
  if (cond) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? `\n        ${String(detail).slice(0, 300)}` : ''}`); }
}

/** A localStorage that refuses a write past `quota` characters, as a browser's does. */
function makeLocal(quota = Infinity, start = {}) {
  const m = new Map(Object.entries(start));
  const used = () => [...m].reduce((n, [k, v]) => n + k.length + v.length, 0);
  return { map: m, getItem: (k) => (m.has(k) ? m.get(k) : null), removeItem: (k) => m.delete(k),
    setItem: (k, v) => { const was = m.get(k); m.set(k, String(v)); if (used() > quota) { if (was == null) m.delete(k); else m.set(k, was); throw new Error('QuotaExceededError'); } } };
}

/** Enough of IndexedDB for the store: one database, object stores of key and value, requests answered later. */
function makeIdb({ failOpen = false, failPut = false } = {}) {
  const stores = new Map();
  const later = (req, fn) => setTimeout(() => { try { req.result = fn(); req.onsuccess && req.onsuccess(); } catch (e) { req.error = e; req.onerror && req.onerror(); } }, 1);
  const store = (name) => ({
    get: (k) => { const r = {}; later(r, () => stores.get(name).get(k)); return r; },
    put: (v, k) => { const r = {}; later(r, () => { if (failPut) throw new Error('disk full'); stores.get(name).set(k, v); return k; }); return r; },
    delete: (k) => { const r = {}; later(r, () => { stores.get(name).delete(k); }); return r; },
  });
  const db = { objectStoreNames: { contains: (n) => stores.has(n) }, createObjectStore: (n) => { stores.set(n, new Map()); }, transaction: (n) => ({ objectStore: () => store(n) }) };
  return { stores, open: () => { const r = {}; setTimeout(() => { if (failOpen) { r.error = new Error('not allowed'); r.onerror && r.onerror(); return; } r.result = db; if (!stores.size) r.onupgradeneeded && r.onupgradeneeded(); r.onsuccess && r.onsuccess(); }, 1); return r; } };
}

function load({ ls, idb }) {
  const box = { console: { warn: () => {}, log: console.log }, setTimeout, Promise };
  box.window = box;
  box.localStorage = ls;
  if (idb) box.indexedDB = idb;
  vm.createContext(box);
  vm.runInContext(src('js', 'code', 'store.js'), box, { filename: 'store.js' });
  return box.HCCodeStore;
}

const S_KEY = 'hc-coder-sessions', C_KEY = 'hashui_coder_state';

console.log('Moving across once:');
{
  const ls = makeLocal(Infinity, { [S_KEY]: '[{"title":"Old chat"}]', [C_KEY]: '{"chatHistory":[1,2]}', other: 'x' });
  const idb = makeIdb(); const St = load({ ls, idb });
  await St.ready();
  ok('what localStorage held is read back the same', St.getItem(S_KEY) === '[{"title":"Old chat"}]' && St.getItem(C_KEY) === '{"chatHistory":[1,2]}');
  ok('...is kept in IndexedDB', idb.stores.get('kv').get(S_KEY) === '[{"title":"Old chat"}]' && idb.stores.get('kv').get(C_KEY) === '{"chatHistory":[1,2]}');
  ok('...and removed from localStorage, and nothing else there is touched', ls.getItem(S_KEY) === null && ls.getItem(C_KEY) === null && ls.getItem('other') === 'x');
  const St2 = load({ ls, idb }); await St2.ready();
  ok('the next start reads it from IndexedDB', St2.getItem(S_KEY) === '[{"title":"Old chat"}]');
  ok('a key it never held reads as none, as localStorage says', St2.getItem('nothing') === null);
}

console.log('\nWriting:');
{
  const ls = makeLocal(); const idb = makeIdb(); const St = load({ ls, idb });
  await St.ready();
  St.setItem(C_KEY, 'one'); St.setItem(C_KEY, 'two'); St.setItem(C_KEY, 'three');
  ok('a read after a write gives it at once, before it is kept', St.getItem(C_KEY) === 'three');
  await St.settled();
  ok('writes are kept in the order made: the last one is what is kept', idb.stores.get('kv').get(C_KEY) === 'three' && St.lastError() === '');
  St.removeItem(C_KEY); await St.settled();
  ok('a key removed is gone from both', St.getItem(C_KEY) === null && !idb.stores.get('kv').has(C_KEY));
  ok('nothing is written to localStorage', ls.map.size === 0);
}
{
  const ls = makeLocal(Infinity, { [C_KEY]: 'from before' }); const idb = makeIdb(); const St = load({ ls, idb });
  St.setItem(C_KEY, 'written while it opened');
  await St.ready(); await St.settled();
  ok('a write made before the store opened is not overwritten by what it held', St.getItem(C_KEY) === 'written while it opened' && idb.stores.get('kv').get(C_KEY) === 'written while it opened');
}

console.log('\nA conversation larger than localStorage has room for:');
{
  const QUOTA = 200000;
  const big = JSON.stringify({ chatHistory: Array.from({ length: 160 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: 'x'.repeat(4000) })) });
  const ls = makeLocal(QUOTA); let refused = false; try { ls.setItem(C_KEY, big); } catch { refused = true; }
  ok('localStorage refuses it (the stand-in has a browser\'s kind of quota)', refused && ls.getItem(C_KEY) === null);
  const idb = makeIdb(); const St = load({ ls, idb }); await St.ready();
  St.setItem(C_KEY, big); await St.settled();
  const back = load({ ls, idb }); await back.ready();
  ok('kept whole, every message, and read back whole on the next start', JSON.parse(back.getItem(C_KEY)).chatHistory.length === 160 && back.getItem(C_KEY) === big);
}

console.log('\nWhere IndexedDB cannot be opened:');
{
  const ls = makeLocal(Infinity, { [S_KEY]: '[1]' }); const St = load({ ls, idb: makeIdb({ failOpen: true }) });
  await St.ready();
  ok('what localStorage holds is read as before, and left there', St.getItem(S_KEY) === '[1]' && ls.getItem(S_KEY) === '[1]');
  ok('...the reason is said', /localStorage instead/.test(St.lastError()), St.lastError());
  St.setItem(S_KEY, '[2]'); await St.settled();
  ok('...and writes go to localStorage', ls.getItem(S_KEY) === '[2]');
  const none = load({ ls: makeLocal(), idb: null }); await none.ready();
  ok('with no IndexedDB at all, it starts all the same', none.getItem(S_KEY) === null);
}
{
  const ls = makeLocal(); const St = load({ ls, idb: makeIdb({ failPut: true }) }); await St.ready();
  St.setItem(C_KEY, 'x'); await St.settled();
  ok('a write that is not kept says why, and the next write still runs', /disk full/.test(St.lastError()) && St.getItem(C_KEY) === 'x');
}

console.log('\nWhere it is used:');
{
  const mode = src('modes', 'code', 'mode.js'), boot = src('boot.js');
  ok('HashCoder keeps its conversation and Sessions here, and nowhere in localStorage', /window\.HCCodeStore\.setItem\(STATE_KEY, JSON\.stringify\(state\)\)/.test(mode) && /window\.HCCodeStore\.getItem\(STATE_KEY\)/.test(mode) && /window\.HCCodeStore\.getItem\(SESSIONS_KEY\)/.test(mode) && /window\.HCCodeStore\.setItem\(SESSIONS_KEY, /.test(mode) && /window\.HCCodeStore\.removeItem\(SESSIONS_KEY\)/.test(mode) && !/localStorage\.(get|set|remove)Item\((STATE_KEY|SESSIONS_KEY)/.test(mode));
  ok('the last conversation comes back only once what was kept is read', /window\.HCCodeStore\.ready\(\)\.then\(restoreCoderState\);/.test(mode));
  ok('the keys it moves are the mode\'s own', /const SESSIONS_KEY {5}= 'hc-coder-sessions';/.test(mode) && /const STATE_KEY {8}= 'hashui_coder_state';/.test(mode));
  ok('it is loaded before the modes', boot.indexOf("'/js/code/store.js'") > 0 && boot.indexOf("'/js/code/store.js'") < boot.indexOf("'/modes/boot.js'"));
  ok('it is part of npm run check', /npm run check:code-store\b/.test(readFileSync(join(here, '..', '..', 'package.json'), 'utf8')));
}

console.log(`\n${pass} passed, ${fail} failed  (src/js/code/store.js)`);
process.exit(fail ? 1 : 0);
