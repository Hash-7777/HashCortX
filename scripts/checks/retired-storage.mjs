// ==============================================================
// Retired storage — checks
//
// Loads the REAL src/js/retired-storage.js. It deletes saved data, so what it
// must get right is the boundary: every store it names is cleared, nothing it
// does not name is touched, and no name it holds is still read by the app.
//
// Run with: npm run check:retired-storage
// ==============================================================
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const srcDir = join(root, 'src');
const code = readFileSync(join(srcDir, 'js', 'retired-storage.js'), 'utf8');

let pass = 0;
let fail = 0;
function ok(label, cond, detail = '') {
  if (cond) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}

/** A window with storage that records what was asked of it. */
function fakeWindow(saved) {
  const keys = new Map(Object.entries(saved));
  const deleted = [];
  const win = {
    localStorage: { removeItem: (k) => { keys.delete(k); } },
    indexedDB: { deleteDatabase: (name) => { deleted.push(name); return {}; } },
  };
  win.window = win;
  return { win, keys, deleted };
}

function load(win) {
  const sandbox = { window: win };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: 'retired-storage.js' });
  return win.HCRetiredStorage;
}

console.log('\nWhat it clears at launch:');
const live = { hashui_agent_memory_v1: '[]', hashui_forge_projects: '[]', hashui_swarm_blueprints: '[]' };
const { win, keys, deleted } = fakeWindow({ ...live, hashui_void_studio_meta_v1: '{"activeId":"p1"}', hashui_system_ui_v1: '{}' });
const R = load(win);
ok('it publishes the list it clears', !!R && Array.isArray(R.RETIRED.databases) && Array.isArray(R.RETIRED.keys));
ok('the list cannot be changed by other code', Object.isFrozen(R.RETIRED) && Object.isFrozen(R.RETIRED.databases) && Object.isFrozen(R.RETIRED.keys));
ok('the Virtual OS projects and wallpaper are deleted', deleted.includes('hashui_void_studio_v1') && deleted.includes('hashui_wallpaper_v1'));
ok('... and only those', deleted.length === R.RETIRED.databases.length, deleted.join(', '));
ok('which project was open is removed', !keys.has('hashui_void_studio_meta_v1'));
ok('the ERP\'s old panel record is removed', !keys.has('hashui_system_ui_v1'));
ok('every saved setting still in use is kept', Object.keys(live).every((k) => keys.has(k)));

console.log('\nIt never stops the app from opening:');
{
  let threw = false;
  try { load({ window: null }); } catch { threw = true; }
  ok('with no storage at all', !threw);
  const blocked = {};
  Object.defineProperty(blocked, 'localStorage', { get() { throw new Error('denied'); } });
  Object.defineProperty(blocked, 'indexedDB', { get() { throw new Error('denied'); } });
  blocked.window = blocked;
  threw = false;
  try { load(blocked); } catch { threw = true; }
  ok('with storage that refuses to be read', !threw);
}

console.log('\nNo name it clears is still read by the app:');
{
  const names = [...R.RETIRED.databases, ...R.RETIRED.keys];
  const files = [];
  (function walk(dir) {
    for (const entry of readdirSync(dir)) {
      const p = join(dir, entry);
      if (statSync(p).isDirectory()) { if (entry !== 'vendor' && entry !== 'wheels') walk(p); }
      else if (/\.(js|html)$/.test(entry)) files.push(p);
    }
  })(srcDir);
  const users = files
    .filter((f) => !f.endsWith(join('js', 'retired-storage.js')))
    .filter((f) => { const t = readFileSync(f, 'utf8'); return names.some((n) => t.includes(n)); })
    .map((f) => relative(srcDir, f));
  ok('no other file names any of them', users.length === 0, users.join(', '));
}

console.log('\nIt runs at launch:');
{
  const boot = readFileSync(join(srcDir, 'boot.js'), 'utf8');
  const at = boot.indexOf("'/js/retired-storage.js'");
  ok('the loader lists it, before app.js and the modes', at > 0 && at < boot.indexOf("'/js/app.js'") && at < boot.indexOf("'/modes/boot.js'"));
  const pkg = readFileSync(join(root, 'package.json'), 'utf8');
  ok('this check is part of npm run check', /npm run check:retired-storage/.test(pkg) && /"check:retired-storage": "node scripts\/checks\/retired-storage\.mjs"/.test(pkg));
}

console.log(`\n${pass} passed, ${fail} failed  (src/js/retired-storage.js)\n`);
process.exit(fail === 0 ? 0 : 1);
