// ==============================================================
// The ERP bar of controls, and the menu that holds what will not fit
//
// The deciding is in js/toolbar-fit.js and checked there, without a browser.
// What is held here is the wiring that a browser would otherwise be the only
// thing to notice: that the two sides agree on the one number the layout turns
// on, that the menu is not placed where the header will cut it off, and that
// the controls are MOVED rather than copied — a second Reset data button that
// does nothing is a worse answer than the missing one it replaced.
//
// Run with: npm run check:systems-header-bar
// ==============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const read = (...p) => readFileSync(join(root, ...p), 'utf8');

const src = read('src', 'js', 'systems', 'header-bar.js');
const css = read('src', 'styles.css');
const panel = read('src', 'modes', 'systems', 'panel.html');
const mode = read('src', 'modes', 'systems', 'mode.js');
const boot = read('src', 'boot.js');

let pass = 0;
let fail = 0;
function ok(label, cond, detail = '') {
  if (cond) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}

console.log('It loads, and after the file it reads:');
{
  ok('js/toolbar-fit.js is loaded first', boot.indexOf('/js/toolbar-fit.js') < boot.indexOf('/js/systems/header-bar.js'));
  ok('and the bar after it', /\/js\/systems\/header-bar\.js/.test(boot));
  ok('it is what decides, not this file', /window\.HCToolbarFit\.fit\(/.test(src));
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: 'header-bar.js' });
  ok('it publishes itself without touching the page to do it', typeof sandbox.window.HCSystemsHeaderBar?.init === 'function');
  ok('and offers a way to fit it again', typeof sandbox.window.HCSystemsHeaderBar?.refit === 'function');
}

console.log('\nThe markup it needs is in the panel:');
{
  for (const id of ['sysHeaderRight', 'sysMoreWrap', 'sysMoreMenu', 'sysMoreBtn']) {
    ok(`#${id} exists`, new RegExp(`id="${id}"`).test(panel));
  }
  ok('the menu says what it is to a reader who cannot see it', /id="sysMoreMenu"[^>]*role="menu"/.test(panel));
  ok('and the button says it opens one', /id="sysMoreBtn"[^>]*aria-haspopup="menu"/.test(panel));
  ok('the button carries a name, not just a drawing', /id="sysMoreBtn"[^>]*aria-label="/.test(panel));
  ok('its mark is drawn, not typed', /id="sysMoreBtn"[\s\S]{0,400}<svg/.test(panel));
  ok('the menu starts closed', /id="sysMoreWrap"[^>]*hidden/.test(panel) && /id="sysMoreMenu"[^>]*hidden/.test(panel));
}

console.log('\nBoth sides read the same number for the room the bar has:');
{
  // Guessed at instead of shared, it was smaller than the real one, and the
  // bar worked out that it fitted while the browser drew it past the header.
  ok('the stylesheet declares it', /--sys-centre-min:\s*300px/.test(css));
  ok('and lays the row out with it', /minmax\(var\(--sys-centre-min\), 1fr\)/.test(css));
  ok('it changes with the layout, not by a second guess', (css.match(/--sys-centre-min:/g) || []).length >= 3);
  ok('where the centre has a row of its own it is nought', /--sys-centre-min:\s*0px/.test(css));
  ok('and the bar reads it from there', /getPropertyValue\('--sys-centre-min'\)/.test(src));
  ok('nothing hard-codes a number of its own for it', !/centreMin\s*=\s*\d/.test(src));
}

console.log('\nThe menu is not put where the header would cut it off:');
{
  // Hanging below the bar, its lower half was cut away by the header — and a
  // cut-away menu item is not a menu item: the click reached what was drawn
  // underneath it instead.
  ok('it is placed against the window', /\.sys-more-menu\s*\{[^}]*position:\s*fixed/.test(css));
  ok('and the bar places it on every open', /menu\.style\.top =/.test(src) && /menu\.style\.right =/.test(src));
  ok('the header still cuts off anything else that leaves it', /#system-maker-wrap \.sys-header \{[^}]*overflow:\s*hidden/.test(css));
  ok('nothing tells the bar to demand room it has not got', !/\.sys-header-right \{\s*min-width:\s*max-content/.test(css));
}

console.log('\nThe controls are moved, not copied:');
{
  ok('they are put into the menu as they are', /menu\.appendChild\(el\)/.test(src));
  ok('and put back into the bar as they are', /bar\.insertBefore\(el, wrap\)/.test(src));
  ok('nothing is built from their text', !/innerHTML|createElement\('button'\)|cloneNode/.test(src));
  ok('the menu only closes behind them', /menu\.addEventListener\('click'[\s\S]{0,140}setOpen\(false\)/.test(src));
}

console.log('\nThree controls never move:');
{
  for (const id of ['sysRunStatus', 'sysModelSelect', 'sysCreateBtn']) {
    ok(`${id} is kept in the bar`, new RegExp(`'${id}'`).test(src.slice(src.indexOf('const KEEP'), src.indexOf('const KEEP') + 220)));
  }
}

console.log('\nIt is fitted again whenever what it holds could have changed:');
{
  ok('when a control is enabled, disabled or shown', /window\.HCSystemsHeaderBar\?\.refit\(\);\s*\/\/ a control appearing/.test(mode));
  ok('when the list of models arrives', /window\.HCSystemsHeaderBar\?\.refit\(\);\s*\/\/ the widest thing/.test(mode));
  ok('and it is started with the rest of the mode', /window\.HCSystemsHeaderBar\?\.init\(\);/.test(mode));
  ok('the window changing size is watched', /new ResizeObserver\(\(\) => refit\(\)\)/.test(src));
  ok('with something for a browser that has none', /window\.addEventListener\('resize'/.test(src));
  // Mounted before the panel has a size, a pass measures every control as
  // nothing wide, decides it all fits, and nothing resizes to correct it.
  ok('a pass that can measure nothing asks for another frame', /if \(!items\.some\(\(it\) => it\.width > 0\)\)[\s\S]{0,140}requestAnimationFrame/.test(src));
  ok('and it does not ask for ever', /refit\(tries - 1\)/.test(src) && /tries = 12/.test(src));
  ok('an open menu is closed before it is emptied', /if \(menu\.children\.length\) setOpen\(false\);/.test(src));
}

console.log(`\n${pass} passed, ${fail} failed  (src/js/systems/header-bar.js)`);
process.exit(fail ? 1 : 0);
