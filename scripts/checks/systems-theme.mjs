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

console.log('\nA design beyond colour:');
{
  ok('five typefaces, all already on the machine', Object.keys(T.FONTS).join() === 'sans,serif,rounded,humanist,mono' && !Object.values(T.FONTS).some((f) => /url\(|https?:/.test(f)));
  ok('written so they fit a double-quoted style attribute', Object.values(T.FONTS).every((f) => !f.includes('"')));
  ok('a system\'s typeface reaches its controls through --sans', vars({ theme: { font: 'serif' } })['--sans'] === T.FONTS.serif);
  ok('an unknown one is the plain sans', T.fontStack('comic') === T.FONTS.sans);
  ok('a design is read from a spec', JSON.stringify(T.designOf({ layout: { shell: 'top' }, theme: { font: 'mono', density: 'compact', surface: 'flat' } })) === JSON.stringify({ shell: 'top', font: 'mono', density: 'compact', surface: 'flat' }));

  let n = 0;
  const pick = (list) => list[(n++) % list.length];
  const prev = { shell: 'sidebar', font: 'sans', density: 'comfortable', surface: 'outlined' };
  const same = T.varyFrom(prev, { ...prev }, pick);
  const differ = Object.keys(prev).filter((k) => same[k] !== prev[k]);
  ok('a copy of the last design is changed on at least two choices', differ.length >= 2);
  ok('typeface and surface first, keeping the model\'s shell', differ.includes('font') && differ.includes('surface') && same.shell === 'sidebar');
  ok('a design already different is left as the model chose it', JSON.stringify(T.varyFrom(prev, { shell: 'top', font: 'serif', density: 'spacious', surface: 'flat' }, pick)) === JSON.stringify({ shell: 'top', font: 'serif', density: 'spacious', surface: 'flat' }));
  const filled = T.varyFrom(null, { shell: 'weird' }, (list) => list[0]);
  ok('a choice missing or unknown is picked from the ones there are', filled.shell === 'sidebar' && filled.font === 'sans' && filled.density === 'compact' && filled.surface === 'flat');
  // Over many random runs, no design ever repeats the last one on three or more choices.
  const rnd = (list) => list[Math.floor(Math.random() * list.length)];
  let worst = 0;
  for (let i = 0; i < 500; i++) {
    const p = { shell: rnd(T.DESIGN.shell), font: rnd(T.DESIGN.font), density: rnd(T.DESIGN.density), surface: rnd(T.DESIGN.surface) };
    const c = T.varyFrom(p, { ...p, shell: Math.random() < .5 ? p.shell : rnd(T.DESIGN.shell) }, rnd);
    worst = Math.max(worst, Object.keys(p).filter((k) => c[k] === p[k]).length);
  }
  ok('in 500 random runs, never more than two choices repeat', worst <= 2);
  const r1 = Array.from({ length: 200 }, () => T.varyFrom(null, {}, rnd, 'restaurant'));
  ok('when the app picks for a restaurant, never a terminal\'s typeface', r1.every((d) => ['serif', 'rounded', 'humanist'].includes(d.font)));
  const r2 = Array.from({ length: 200 }, () => T.varyFrom(null, {}, rnd, 'logistics'));
  ok('nor a dispatch desk spaced like a boutique', r2.every((d) => d.density !== 'spacious'));
  ok('a kind of business not listed may take any', new Set(Array.from({ length: 300 }, () => T.varyFrom(null, {}, rnd, 'zoo').font)).size === 5);
  ok('the model\'s own choice is kept even when the app would not have picked it', T.varyFrom(null, { shell: 'top', font: 'mono', density: 'spacious', surface: 'flat' }, rnd, 'restaurant').font === 'mono');
  const shells = Array.from({ length: 200 }, () => T.varyFrom(null, {}, rnd, 'legal').shell);
  ok('a shell the app picks suits the business too: a law firm is a command or sidebar desk', shells.every((x) => ['command', 'sidebar'].includes(x)));
  ok('the mode keeps a system\'s kind of business, which these picks read', /spec\.domain = spec\.domain \|\| detectDomain\(desc\);/.test(mode));
  ok('and keeps no shell table of its own', !/DOMAIN_SHELL_OPTIONS/.test(mode));
  ok('the mode applies it to every new system and says what it chose', /HCSystemsTheme\.varyFrom\(window\.HCSystemsTheme\.designOf\(systems\[0\]\), window\.HCSystemsTheme\.designOf\(spec\), pickRandom, spec\.domain\)/.test(mode) && /trace\(`Design: /.test(mode));
  ok('and tells the model the last system\'s look', /choose a different look/.test(mode));
  ok('density and surface are drawn', /density-\$\{esc\(spec\.theme\.density/.test(mode) && /surface-\$\{esc\(spec\.theme\.surface/.test(mode));
}

console.log('\nThe Systems mode draws from here:');
ok('it takes the theme from js/systems/theme.js', /const \{ themeVars \} = window\.HCSystemsTheme;/.test(mode));
ok('and keeps no copy of its own', !/function themeVars\(|function shadeHex\(|const DOMAIN_BG = \{/.test(mode));

console.log(`\n${pass} passed, ${fail} failed  (src/js/systems/theme.js)`);
process.exit(fail ? 1 : 0);
