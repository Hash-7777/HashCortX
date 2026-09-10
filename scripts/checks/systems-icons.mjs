// ==============================================================
// Systems icons checks
//
// Which icon a generated system's module gets from its name, and that every
// icon it can get is a drawing that exists and carries nothing but lines.
//
// Run with: npm run check:systems-icons
// ==============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const src = (...p) => readFileSync(join(here, '..', '..', 'src', ...p), 'utf8');
const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(src('js', 'systems', 'icons.js'), sandbox, { filename: 'icons.js' });
const I = sandbox.window.HCSystemsIcons;
const mode = src('modes', 'systems', 'mode.js');

let pass = 0;
let fail = 0;
function ok(label, cond) {
  if (cond) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}`); }
}

console.log('A module gets an icon for what it is:');
const cases = { 'Sales Pipeline': 'chart', Customers: 'customers', 'Stock & Warehouse': 'box', 'Purchase Orders': 'orders', Menu: 'menu', Invoices: 'coin', Payroll: 'people', Reports: 'reports', Appointments: 'calendar', Dispatch: 'truck', 'Help Desk': 'support', Campaigns: 'marketing', Overview: 'dashboard' };
for (const [name, icon] of Object.entries(cases)) ok(`${name} → ${icon}`, I.moduleIcon(name) === icon);
ok('a name it does not know gets the grid', I.moduleIcon('Zorblax') === 'grid');

console.log('\nEvery icon it can give is a drawing that exists:');
const names = [...new Set([...Object.values(cases), 'grid', 'settings', 'docs', 'flow', 'supplier'])];
ok('each has its own drawing, not the grid by default', names.filter((n) => n !== 'grid').every((n) => I.iconSvg(n) !== I.iconSvg('grid')));
ok('an unknown one falls back to the grid', I.iconSvg('<script>') === I.iconSvg('grid'));
const all = [...names.map(I.iconSvg), ...I.KPI_ICONS];
ok('every drawing is one svg', all.every((svg) => /^<svg [^>]*>[\s\S]*<\/svg>$/.test(svg)));
ok('and carries nothing but shapes: no script, no handlers, no links', all.every((svg) => !/<script|\son\w+=|href=|<foreignObject/i.test(svg)));

console.log('\nThe Systems mode draws from here:');
ok('it takes the icons from js/systems/icons.js', /\} = window\.HCSystemsIcons;/.test(mode));
ok('and keeps no copy of its own', !/function iconSvg\(|function moduleIcon\(|const KPI_ICONS = \[/.test(mode));

console.log(`\n${pass} passed, ${fail} failed  (src/js/systems/icons.js)`);
process.exit(fail ? 1 : 0);
