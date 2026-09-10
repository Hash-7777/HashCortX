// ==============================================================
// Systems theme checks
//
// How a generated system's theme becomes the colours its screens are drawn in.
//
// Run with: npm run check:systems-theme
// ==============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const src = (...p) => readFileSync(join(here, '..', '..', 'src', ...p), 'utf8');
const sandbox = { window: {} };
vm.createContext(sandbox);
for (const f of [['js', 'systems', 'spec.js'], ['js', 'systems', 'domain.js'], ['js', 'systems', 'theme.js']]) vm.runInContext(src(...f), sandbox, { filename: f.join('/') });
const T = sandbox.window.HCSystemsTheme;
const mode = src('modes', 'systems', 'mode.js');

let pass = 0;
let fail = 0;
function ok(label, cond) {
  if (cond) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}`); }
}
const vars = (spec) => Object.fromEntries(T.themeVars(spec).split(';').map((d) => d.split(/:(.*)/s).slice(0, 2)));

console.log('Colour arithmetic:');
ok('a colour is read as its red, green and blue', T.hexToRgb('#92400e') === '146,64,14');
ok('shading darkens each channel', T.shadeHex('#ffffff', 0.5) === '#808080');
ok('shading by nothing changes nothing', T.shadeHex('#1d4ed8', 0) === '#1d4ed8');
ok('a short colour is left alone rather than misread', T.shadeHex('#fff', 0.5) === '#fff');

console.log('\nA theme becomes the screens\' variables:');
const light = vars({ theme: { mode: 'light', primary: '#92400e', accent: '#f59e0b', radius: 12 }, domain: 'restaurant' });
ok('its primary and accent', light['--sys-primary'] === '#92400e' && light['--sys-accent'] === '#f59e0b');
ok('over its kind of business\'s background', light['--sys-app-bg'] === T.DOMAIN_BG.restaurant.light.app);
ok('with dark text on a light theme', light['--sys-app-text'] === '#0f172a');
ok('and its corners, never sharper than 4px nor rounder than 20px', light['--sys-radius'] === '12px' && light['--sys-radius-sm'] === '8px' && light['--sys-radius-lg'] === '18px');
const dark = vars({ theme: { mode: 'dark', primary: '#7c3aed', accent: '#4ade80' }, domain: 'fitness' });
ok('a dark theme has light text and its own background', dark['--sys-app-text'] === '#e5e7eb' && dark['--sys-app-bg'] === T.DOMAIN_BG.fitness.dark.app);
ok('and a darker rail than its primary', dark['--sys-nav-bg'] === T.shadeHex('#7c3aed', 0.38));
ok('a kind of business it does not know gets the plain background', vars({ theme: { primary: '#000000' }, domain: 'zzz' })['--sys-app-bg'] === T.DOMAIN_BG.generic.light.app);
ok('a theme with no colours still draws', vars({ theme: {} })['--sys-primary'] === '#2563eb');

console.log('\nThe Systems mode draws from here:');
ok('it takes the theme from js/systems/theme.js', /const \{ themeVars \} = window\.HCSystemsTheme;/.test(mode));
ok('and keeps no copy of its own', !/function themeVars\(|function shadeHex\(|const DOMAIN_BG = \{/.test(mode));

console.log(`\n${pass} passed, ${fail} failed  (src/js/systems/theme.js)`);
process.exit(fail ? 1 : 0);
