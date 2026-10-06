// ==============================================================
// Filled buttons keep their fill under the pointer — checks
//
// css/tabs.css gives every button a hover: `button:hover` sets a faint
// translucent background. Its weight is one pseudo-class and one element,
// which is more than a lone class, so a button styled by one class alone,
// `.run { background: var(--accent); color: var(--surface-0) }`, loses its
// fill the moment the pointer is over it, and keeps its dark text. The label
// of the button a person is about to press goes dark on dark, and nothing
// fails: the rule is right, the button is right, and only the two together
// are wrong.
//
// So every rule that paints a button-like fill under dark text, through a
// selector of one class, must have a hover of its own that sets a
// background. Run with: npm run check:filled-hover
// ==============================================================
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { stylesheets } from './lib/page-assets.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = join(here, '..', '..', 'src');

let pass = 0, fail = 0;
function check(label, condition, detail = '') {
  if (condition) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}

// Innermost rules only: a selector and its declarations, at any depth.
export function rulesOf(css) {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  return [...text.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
    selectors: m[1].trim().split(',').map((s) => s.trim()).filter(Boolean),
    body: m[2],
  })).filter((r) => r.selectors.length && !r.selectors[0].startsWith('@'));
}

function declared(body, prop) {
  const m = body.match(new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`, 'i'));
  return m ? m[1].replace(/!important/, '').trim() : null;
}

// Text a translucent hover would leave unreadable: the app's dark inks.
const DARK_INK = /^var\(--(surface-0|surface-1|bg-0|bg-1|accent-ink)\)$/;
function darkLiteral(v) {
  const hex = v.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  let rgb = null;
  if (hex) { const h = hex[1].length === 3 ? [...hex[1]].map((c) => c + c).join('') : hex[1]; rgb = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)); }
  const fn = v.match(/^rgba?\(\s*(\d+)[ ,]+(\d+)[ ,]+(\d+)/i);
  if (fn) rgb = fn.slice(1, 4).map(Number);
  return !!rgb && 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2] < 70;
}
export const isDarkInk = (v) => !!v && (DARK_INK.test(v) || darkLiteral(v));

// A fill that is meant to be seen: not transparent, not a faint wash.
export function isFill(v) {
  if (!v) return false;
  if (/^(transparent|none|inherit|initial|unset|currentcolor)$/i.test(v)) return false;
  const a = v.match(/^rgba\([^)]*[ ,/]\s*([\d.]+)\s*\)$/i);
  if (a && Number(a[1]) < 0.5) return false;
  return /var\(--|#|rgb|hsl|gradient/i.test(v);
}

// One class and nothing else: lighter than `button:hover`.
export const loneClass = (sel) => /^\.[A-Za-z0-9_-]+$/.test(sel);

// The classes the app puts on a <button>, in its markup or when it makes one.
export function buttonClassesIn(text) {
  const out = new Set();
  const add = (list) => list.split(/\s+/).forEach((c) => { if (/^[A-Za-z0-9_-]+$/.test(c)) out.add('.' + c); });
  for (const m of text.matchAll(/<button\b[^>]*?\bclass=["'`]([^"'`]+)/g)) add(m[1]);
  for (const m of text.matchAll(/createElement\(\s*['"]button['"]\s*\)[\s\S]{0,300}?className\s*=\s*['"`]([^'"`]+)/g)) add(m[1]);
  return out;
}
function sourceText(dir) {
  let text = '';
  for (const name of readdirSync(dir)) {
    if (name === 'vendor' || name === 'wheels') continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) text += sourceText(path);
    else if (/\.(html|js)$/.test(name)) text += readFileSync(path, 'utf8') + '\n';
  }
  return text;
}

export function unguarded(sheets, buttons = null) {
  const all = sheets.flatMap(({ file, css }) => rulesOf(css).map((r) => ({ ...r, file })));
  const hovered = new Set();
  for (const r of all) {
    const bg = declared(r.body, 'background') || declared(r.body, 'background-color');
    if (!bg) continue;
    for (const s of r.selectors) { const m = s.match(/^(\.[A-Za-z0-9_-]+)(?::not\([^)]*\))*:hover/); if (m) hovered.add(m[1]); }
  }
  const out = [];
  for (const r of all) {
    const bg = declared(r.body, 'background') || declared(r.body, 'background-color');
    if (!isFill(bg) || !isDarkInk(declared(r.body, 'color'))) continue;
    for (const s of r.selectors) if (loneClass(s) && !hovered.has(s) && (!buttons || buttons.has(s))) out.push({ file: r.file, selector: s });
  }
  return out;
}

const sheets = stylesheets(srcDir).map((file) => ({ file, css: readFileSync(join(srcDir, file), 'utf8') }));

console.log('\nThe rule this guards against is still there:');
const generic = sheets.find((s) => s.file === 'css/tabs.css');
check('css/tabs.css gives every button a translucent hover', !!generic && rulesOf(generic.css).some((r) => r.selectors.includes('button:hover') && /background/.test(r.body)));

console.log('\nThe reading of a stylesheet:');
check('a lone class is lighter than button:hover', loneClass('.run') && !loneClass('button.run') && !loneClass('.bar .run') && !loneClass('#run'));
check('the accent under dark ink is a filled button', isFill('var(--accent)') && isDarkInk('var(--surface-0)') && isDarkInk('#021a0e'));
check('a faint wash is not a fill, and light text is not dark ink', !isFill('rgba(255,255,255,0.07)') && !isFill('transparent') && !isDarkInk('var(--text)') && !isDarkInk('#ece7dc'));
check('a button without its own hover is found', unguarded([{ file: 't.css', css: '.run { background: var(--accent); color: var(--surface-0); }' }]).length === 1);
check('a hover of its own that sets a background clears it', unguarded([{ file: 't.css', css: '.run { background: var(--accent); color: var(--surface-0); } .run:hover:not(:disabled) { background: var(--accent-2); }' }]).length === 0);
check('a class on a button is read from markup and from a button the code makes', (() => { const b = buttonClassesIn('<button type="button" class="run big">Run</button> <span class="badge">2</span> const x = document.createElement(\'button\'); x.className = \'send\';'); return b.has('.run') && b.has('.big') && b.has('.send') && !b.has('.badge'); })());
check('a filled span inside a button is not a button', unguarded([{ file: 't.css', css: '.badge { background: var(--accent); color: var(--surface-0); }' }], new Set(['.run'])).length === 0);
check('a hover that only fades does not clear it', unguarded([{ file: 't.css', css: '.run { background: var(--accent); color: var(--surface-0); } .run:hover { opacity: .88; }' }]).length === 1);

console.log('\nEvery filled button in the app:');
const buttons = buttonClassesIn(sourceText(srcDir));
check('the buttons the app makes are read', buttons.has('.cdr-run-btn') && buttons.has('.hc-perm-btn--allow') && buttons.has('.fin-send-btn'));
const found = unguarded(sheets, buttons);
if (!found.length) check('every filled button with dark text keeps its fill under the pointer', true);
for (const f of found) check(`${f.selector} keeps its fill under the pointer`, false, `${f.file}: give it a :hover that sets its background`);

console.log(`\n${pass} passed, ${fail} failed  (filled buttons on hover)`);
process.exit(fail ? 1 : 0);
