// ==============================================================
// Systems shells checks
//
// The frame a generated system is drawn in. Every shell must carry the
// system's modules, mark the open one, hold the screen and the search, and
// escape everything that came from the model.
//
// Run with: npm run check:systems-shells
// ==============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const src = (...p) => readFileSync(join(here, '..', '..', 'src', ...p), 'utf8');
const sandbox = { window: {} };
vm.createContext(sandbox);
for (const f of [['js', 'systems', 'icons.js'], ['js', 'systems', 'shells.js']]) vm.runInContext(src(...f), sandbox, { filename: f.join('/') });
const S = sandbox.window.HCSystemsShells;
const mode = src('modes', 'systems', 'mode.js');

let pass = 0;
let fail = 0;
function ok(label, cond) {
  if (cond) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}`); }
}

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const spec = {
  name: 'Saffron <b>Table</b>', description: 'Lebanese & grill',
  modules: [{ id: 'overview', name: 'Overview', icon: 'dashboard', color: '#92400e' }, { id: 'orders', name: 'Orders <i>', icon: 'orders' }],
};
const draw = (shell) => S.shellHtml({ shell, spec, module: spec.modules[1], screen: 'kanban', screenDiv: '<div class="SCREEN"></div>', searchInput: '<input id="sysAppSearch">', cls: 'dark density-compact', vars: '--sys-primary:#000', activeModuleId: 'orders', esc });

console.log('Every shell frames the system:');
for (const shell of S.SHELLS) {
  const h = draw(shell);
  ok(`${shell}: one app, in its own shell class, with the design classes and colours`, h.includes(`sys-shell-${shell === 'cards-nav' ? 'cardsnav' : shell}`) && h.includes('dark density-compact') && h.includes('style="--sys-primary:#000"'));
  ok(`${shell}: every module, the open one marked`, (h.match(/data-module-id="/g) || []).length === 2 && /class="[^"]*\bactive\b[^"]*" data-module-id="orders"/.test(h.replace(/\s+/g, ' ')));
  ok(`${shell}: the screen inside it`, h.includes('<div class="SCREEN"></div>'));
  ok(`${shell}: the model's names escaped`, !/<b>Table<\/b>|Orders <i>/.test(h) && /Orders &lt;i&gt;/.test(h));
}
ok('a shell it does not know is drawn as the sidebar', draw('nope').includes('sys-shell-sidebar'));
ok('every shell keeps the search', S.SHELLS.every((s) => draw(s).includes('id="sysAppSearch"')));

console.log('\nA module colour is used only when it is a hex colour:');
{
  const hostile = { ...spec, modules: spec.modules.map((m, i) => (i === 0 ? { ...m, color: 'red;position:fixed;inset:0' } : { ...m, color: '#123456' })) };
  for (const shell of S.SHELLS) {
    const html = S.shellHtml({ shell, spec: hostile, module: hostile.modules[1], screen: 'kanban', screenDiv: '', searchInput: '', cls: '', vars: '', activeModuleId: 'orders', esc });
    ok(`${shell}: nothing but a colour is written`, !/position:fixed/.test(html));
  }
  const sidebar = S.shellHtml({ shell: 'sidebar', spec: hostile, module: hostile.modules[1], screen: 'kanban', screenDiv: '', searchInput: '', cls: '', vars: '', activeModuleId: 'orders', esc });
  ok('and a real one still is', sidebar.includes('--mod-color:#123456'));
}

console.log('\nThe Systems mode draws from here:');
ok('it takes its frame from js/systems/shells.js', /host\.innerHTML = window\.HCSystemsShells\.shellHtml\(/.test(mode));
ok('and keeps no copy of its own', !/case "cards-nav":/.test(mode));

console.log(`\n${pass} passed, ${fail} failed  (src/js/systems/shells.js)`);
process.exit(fail ? 1 : 0);
