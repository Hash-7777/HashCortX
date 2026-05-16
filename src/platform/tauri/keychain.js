// ==============================================================
// platform/tauri/keychain.js
//
// API keys are stored in localStorage.
//
// Why not macOS Keychain: keychain items have an application ACL
// tied to the binary's code signature. Each new DMG build has a
// different signature, so macOS prompts for every key on every build.
//
// In Tauri, localStorage is written to the app's WebKit data dir:
//   ~/Library/Application Support/com.hashcortx.app/WebKit/...
// That directory is keyed by the bundle identifier, NOT the binary,
// so it survives every rebuild with zero password prompts.
//
// One-time migration: on first run, silently tries to pull any keys
// from the old keychain bundle (one macOS prompt if it exists), copies
// them here, then deletes the bundle so it never prompts again.
//
// Usage (unchanged from callers):
//   await HC.keychain.store("groqKey", "gsk-...")
//   const key = await HC.keychain.retrieve("groqKey")
//   await HC.keychain.loadAll([...providers...])
// ==============================================================

(function () {
  'use strict';

  const LS_BUNDLE_KEY  = 'hc_api_bundle_v2';
  const LS_MIGRATED    = 'hc_migrated_v2';

  function lsGet(k)    { try { return localStorage.getItem(k); }     catch { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); }         catch {} }

  function getBundle() {
    try {
      const raw = lsGet(LS_BUNDLE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch { return {}; }
  }

  function saveBundle(data) {
    lsSet(LS_BUNDLE_KEY, JSON.stringify(data));
  }

  // ── One-time migration from old macOS Keychain bundle ───────
  let _migrationDone = !!lsGet(LS_MIGRATED);
  let _migrationPromise = null;

  async function ensureMigrated() {
    if (_migrationDone) return;
    if (_migrationPromise) return _migrationPromise;
    _migrationPromise = (async () => {
      if (HC.isTauri) {
        try {
          const json = await HC.invoke('keychain_retrieve_bundle');
          if (json) {
            const parsed = JSON.parse(json);
            if (parsed && typeof parsed === 'object') {
              // Merge keychain data into localStorage (don't overwrite newer local values)
              const local = getBundle();
              const merged = Object.assign({}, parsed, local);
              saveBundle(merged);
            }
            // Delete the old keychain bundle so it can never prompt again
            HC.invoke('keychain_delete', { provider: '__api_bundle__' }).catch(() => {});
          }
        } catch { /* no bundle or already deleted — that's fine */ }
      }
      lsSet(LS_MIGRATED, '1');
      _migrationDone = true;
    })();
    return _migrationPromise;
  }

  // ── Public API ──────────────────────────────────────────────

  HC.keychain = {
    async store(provider, secret) {
      await ensureMigrated();
      const data = getBundle();
      if (secret) data[provider] = secret;
      else delete data[provider];
      saveBundle(data);
    },

    async retrieve(provider) {
      await ensureMigrated();
      return getBundle()[provider] || null;
    },

    async delete(provider) {
      return this.store(provider, '');
    },

    async loadAll(providers) {
      await ensureMigrated();
      const data = getBundle();
      const result = {};
      for (const p of providers) result[p] = data[p] || '';
      return result;
    },
  };
})();
