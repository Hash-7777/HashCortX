// ==============================================================
// Where HashCoder keeps its conversations
//
// HashCoder kept the open conversation and its Sessions in localStorage:
// the store that also holds the provider keys, with a few megabytes for the
// whole app, which throws when it is full. A run that reads and writes whole
// files fills it in a few requests, and from then on every save was refused
// in silence: the last save that fitted, often the first exchange, was what
// came back. Sessions were cut the same way.
//
// They are kept in IndexedDB now, which has room for them. The mode reads
// them as it did, through getItem, setItem and removeItem on a copy held in
// memory, so a read is never waited for; each change is written behind it,
// one after another, as text, the way localStorage held it. What was in
// localStorage is moved across once, on the first start, and removed there
// only after it is written here. Where IndexedDB cannot be opened, the
// store falls back to localStorage, as before.
//
// ready() opens it and must have finished before the first read; it never
// fails. lastError() says why the last write did not keep, or ''.
//
// Published as window.HCCodeStore. Checked by scripts/checks/code-store.mjs.
// ==============================================================
(function () {
  'use strict';

  const DB_NAME = 'hashcortx_coder';
  const STORE = 'kv';
  /** The keys the mode keeps here, under the names they had in localStorage. */
  const KEYS = ['hc-coder-sessions', 'hashui_coder_state'];

  const held = new Map(), touched = new Set();   // touched: changed before the store had opened, so what it holds is older
  let db = null, opening = null, chain = Promise.resolve(), error = '';
  const local = () => { try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; } };
  const done = (req) => new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });

  function openDb() {
    return new Promise((resolve, reject) => {
      const idb = typeof indexedDB !== 'undefined' ? indexedDB : null;
      if (!idb) { reject(new Error('IndexedDB is not here')); return; }
      const req = idb.open(DB_NAME, 1);
      req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE); };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  const put = (key, text) => done(db.transaction(STORE, 'readwrite').objectStore(STORE).put(text, key));
  const drop = (key) => done(db.transaction(STORE, 'readwrite').objectStore(STORE).delete(key));

  /** Open the store, take in what it holds, and move across what localStorage still holds. Never fails. */
  function ready() {
    if (opening) return opening;
    opening = (async () => {
      const ls = local();
      try {
        db = await openDb();
        for (const key of KEYS) {
          const kept = await done(db.transaction(STORE, 'readonly').objectStore(STORE).get(key));
          const old = ls ? ls.getItem(key) : null;
          if (touched.has(key)) { /* written since: that write follows this */ }
          else if (typeof kept === 'string') held.set(key, kept);
          else if (old != null) { await put(key, old); held.set(key, old); }
          if (old != null) { try { ls.removeItem(key); } catch { /* left where it was */ } }   // removed only once it is kept here
        }
      } catch (e) {
        db = null;
        error = `kept in localStorage instead: ${String((e && e.message) || e)}`;
        for (const key of KEYS) { const old = ls ? ls.getItem(key) : null; if (old != null && !touched.has(key)) held.set(key, old); }
      }
    })();
    return opening;
  }

  /** Each write after the store has opened and after the one before it, so the last one made is the one kept. */
  function behind(job) {
    chain = chain.then(ready).then(job).then(() => { error = ''; }, (e) => { error = String((e && e.message) || e); console.warn('[HashCoder] not kept:', error); });
    return chain;
  }

  function getItem(key) { return held.has(key) ? held.get(key) : null; }

  function setItem(key, value) {
    const text = String(value);
    held.set(key, text); touched.add(key);
    return behind(() => { if (db) return put(key, text); const ls = local(); if (ls) ls.setItem(key, text); });
  }

  function removeItem(key) {
    held.delete(key); touched.add(key);
    return behind(() => { if (db) return drop(key); const ls = local(); if (ls) ls.removeItem(key); });
  }

  /** Why the last write was not kept, or '' when it was. */
  const lastError = () => error;
  /** Every write made so far, finished. */
  const settled = () => chain;

  window.HCCodeStore = { DB_NAME, KEYS, ready, getItem, setItem, removeItem, lastError, settled };
  ready();
})();
