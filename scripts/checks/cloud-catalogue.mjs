// ==============================================================
// Model list catalogue checks
//
// Loads the REAL src/js/cloud-catalogue.js and src/js/cloud-model-memory.js
// and runs them against stand-in fetchers. Holds when a provider is asked,
// what the menu gets when it cannot be, that each listed model's limits reach
// js/model-limits.js, and that what happened is recorded for Settings.
//
// Run with: npm run check:cloud-catalogue
// ==============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const src = (...p) => readFileSync(join(here, '..', '..', 'src', ...p), 'utf8');
const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(src('js', 'cloud-model-memory.js'), sandbox, { filename: 'cloud-model-memory.js' });
vm.runInContext(src('js', 'cloud-catalogue.js'), sandbox, { filename: 'cloud-catalogue.js' });
const M = sandbox.window.HCCloudModelMemory;
const C = sandbox.window.HCCloudCatalogue;

let pass = 0;
let fail = 0;
function ok(label, cond) {
  if (cond) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}`); }
}

function setup(fetchers) {
  const store = new Map();
  const storage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
  // The memory module takes its storage per call; bind it here.
  const memory = {
    seed: (p, f) => M.seed(p, f, storage), remember: (p, m) => M.remember(p, m, storage),
    failedRecently: M.failedRecently, noteFailure: M.noteFailure,
  };
  const limits = new Map();
  let clock = 1_000_000;
  const cat = C.create({
    fetchers, memory,
    fallback: { groq: [{ value: 'cloud:groq:hand-written', label: 'x' }], samba: [{ value: 'cloud:samba:hand-written', label: 'x' }] },
    visible: (list) => list.filter((m) => !/hidden/.test(m.value)),
    isBlocked: (p) => p === 'samba',
    limits: { remember: (v, info) => limits.set(v, info) },
    now: () => clock,
  });
  return { cat, limits, storage, tick: (ms) => { clock += ms; } };
}
const model = (id, extra = {}) => ({ value: `cloud:groq:${id}`, label: id, ...extra });

console.log('A provider with a key is asked, and its answer kept:');
{
  let asked = 0;
  const { cat, limits } = setup({ groq: async () => { asked++; const l = [model('a', { ctx: 1000, out: 500 }), model('hidden-b')]; l.note = 'a note'; return l; } });
  const got = await cat.load('groq', 'k1');
  ok('the list comes back, less what the app does not offer', got.length === 1 && got[0].value === 'cloud:groq:a');
  ok('each model\'s limits reach the request sizing', limits.get('cloud:groq:a').out === 500);
  ok('what happened is recorded, with the provider\'s note', (() => { const r = cat.report().find((x) => x.provider === 'groq'); return r.state === 'ok' && r.count === 1 && r.note === 'a note'; })());
  await cat.load('groq', 'k1');
  ok('the same key is not asked twice', asked === 1);
  await cat.load('groq', 'k2');
  ok('a new key is asked at once', asked === 2);
  await cat.load('groq', 'k2', { force: true });
  ok('Update model lists asks again even for the same key', asked === 3);
  await Promise.all([cat.load('groq', 'k3'), cat.load('groq', 'k3')]);
  ok('two asks at once make one request', asked === 4);
}

console.log('\nA provider that cannot be asked:');
{
  let asked = 0;
  const { cat } = setup({ groq: async () => { asked++; throw new Error('Groq would not list its models (HTTP 401): Invalid API Key'); }, samba: async () => { asked++; return [model('x')]; } });
  const blocked = await cat.load('samba', 'k');
  ok('a provider that refuses the app gets no models at all — not its hand-written list', blocked.length === 0 && asked === 0);
  ok('... and the record says so', cat.report().find((x) => x.provider === 'samba').state === 'blocked');
  ok('its starting list is empty too', cat.seed('samba').length === 0);
  const failed = await cat.load('groq', 'k');
  ok('a refusal falls back to the list it had', failed.map((m) => m.value).join() === 'cloud:groq:hand-written');
  ok('... and records the provider\'s reason', /Invalid API Key/.test(cat.report().find((x) => x.provider === 'groq').error));
  await cat.load('groq', 'k');
  ok('it is not asked again moments later', asked === 1);
  await cat.load('groq', 'k', { force: true });
  ok('but Update model lists asks again', asked === 2);
  const none = await cat.load('groq', '');
  ok('no key means no request, and the list it had', asked === 2 && none.length === 1 && cat.report().find((x) => x.provider === 'groq').state === 'no-key');
}

console.log('\nA list that arrives is kept for the next launch, limits and all:');
{
  const { cat, storage } = setup({ groq: async () => [model('kept', { ctx: 131072, out: 65536, tools: true, free: true })] });
  // A key of its own: the block above left a recent failure recorded for 'k'.
  await cat.load('groq', 'k-fresh');
  const next = setup({});
  const raw = storage.getItem(M.KEY);
  next.storage.setItem(M.KEY, raw);
  const seeded = next.cat.seed('groq');
  ok('the next launch starts from it', seeded[0].value === 'cloud:groq:kept');
  ok('... with its limits', seeded[0].ctx === 131072 && seeded[0].out === 65536 && seeded[0].tools === true && seeded[0].free === true);
  ok('... handed to the request sizing before any list arrives', next.limits.get('cloud:groq:kept').out === 65536);
}

console.log('\nThe app uses it:');
{
  const app = src('js', 'app.js');
  ok('the app asks through the catalogue', /const loadCloudModelsFor = \(provider, keyEl, options\) => _catalogue\.load\(provider, keyEl\?\.value, options\);/.test(app));
  ok('a provider that refuses the app is told apart', /isBlocked: \(provider\) => HCProviders\.isBrowserBlocked\(provider\)/.test(app));
  ok('listed limits go to the request sizing', /limits: window\.HCModelLimits,/.test(app));
  ok('Update model lists forgets learnt limits and asks every provider again', /async function refreshModelLists\(\) \{\s*window\.HCModelLimits\.forgetLearned\(\);\s*await refreshCloudModelsFromAPIs\(\{ force: true \}\);/.test(app));
  ok('the menu leaves out models their provider said are gone', /const offeredModels = \(models\) => visibleCloudModels\(models\)\.filter\(m => !window\.HCModelRoutes\.isRetired\(m\.value\)\);/.test(app));
  ok('Settings has the button, and the pane redraws the report when it opens', /id="modelListsUpdate"/.test(src('core', 'settings', 'panel.html')) && /window\.HCSettingsModelLists\?\.render\(\);/.test(app));
  const boot = src('boot.js');
  ok('it loads after the memory it uses and before the app', boot.indexOf("'/js/cloud-model-memory.js'") < boot.indexOf("'/js/cloud-catalogue.js'") && boot.indexOf("'/js/cloud-catalogue.js'") < boot.indexOf("'/js/app.js'"));
}

console.log(`\n${pass} passed, ${fail} failed  (model list catalogue)`);
if (fail) process.exit(1);
