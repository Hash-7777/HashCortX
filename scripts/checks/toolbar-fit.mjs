// ==============================================================
// Which controls stay in a bar, and which go behind a menu
//
// The defect: the ERP bar was a fixed-height row that was allowed to wrap,
// with everything past that height cut off. Its last two controls were already
// gone on a full-width window, and narrowing it took more. A control that has
// been cut off is worse than one never offered — the app still believes it is
// there, so nothing stands in for it.
//
// What is held here is the whole of the rule: nothing is ever dropped, what
// does not fit goes to the menu in its own order, and a control the caller
// named as one that must not move never goes there at all.
//
// Run with: npm run check:toolbar-fit
// ==============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(readFileSync(join(root, 'src', 'js', 'toolbar-fit.js'), 'utf8'), sandbox, { filename: 'toolbar-fit.js' });
const { fit } = sandbox.window.HCToolbarFit;

let pass = 0;
let fail = 0;
function ok(label, cond, detail = '') {
  if (cond) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// The ERP bar as it really is, measured in the browser.
const BAR = [
  { key: 'status', width: 54, keep: true },
  { key: 'model', width: 250, keep: true },
  { key: 'generate', width: 108, keep: true },
  { key: 'change', width: 69 },
  { key: 'doit', width: 62 },
  { key: 'undo', width: 91 },
  { key: 'new', width: 68 },
  { key: 'reset', width: 118 },
  { key: 'back', width: 86 },
];
const OPTS = { gap: 7, menuWidth: 38 };

console.log('Everything stays when everything fits:');
{
  const r = fit(4000, BAR, OPTS);
  ok('every control is in the bar', r.shown.length === BAR.length);
  ok('and the menu is not needed', same(r.hidden, []));
  ok('exactly at the width it needs, nothing moves', same(fit(962, BAR, OPTS).hidden, []));
}

console.log('\nWhat does not fit goes to the menu, from the right:');
{
  const r = fit(900, BAR, OPTS);
  // The menu lists them left to right as the bar did, so the one that left
  // the bar FIRST — the rightmost — is the last name in it.
  ok('the rightmost control is the first to leave the bar', r.hidden[r.hidden.length - 1] === 'back');
  ok('and it is no longer in the bar', !r.shown.includes('back'));
  ok('nothing is lost between the two lists', r.shown.length + r.hidden.length === BAR.length);
  const tight = fit(620, BAR, OPTS);
  ok('a narrower bar moves more of them', tight.hidden.length > r.hidden.length);
  ok('and they keep the order they had', same(tight.hidden, BAR.map((i) => i.key).filter((k) => tight.hidden.includes(k))));
}

console.log('\nNothing is ever dropped:');
{
  for (const room of [2000, 1200, 900, 700, 500, 300, 120, 1]) {
    const r = fit(room, BAR, OPTS);
    const keys = [...r.shown, ...r.hidden].sort();
    ok(`at ${room}px every control is still somewhere`, same(keys, BAR.map((i) => i.key).sort()));
  }
}

console.log('\nA control that must not move, never moves:');
{
  const keeps = BAR.filter((i) => i.keep).map((i) => i.key);
  for (const room of [900, 600, 400, 200, 40]) {
    const r = fit(room, BAR, OPTS);
    ok(`at ${room}px the bar still does its work`, keeps.every((k) => r.shown.includes(k)), r.hidden.join(', '));
  }
  // Even when the ones that must stay cannot fit, they stay: a bar that has
  // lost the button that does the work has not been made to fit.
  const r = fit(40, BAR, OPTS);
  ok('and the ones that may move have all moved by then', r.shown.length === keeps.length);
}

console.log('\nThe menu pays for its own room:');
{
  // 962 is the bar's exact span. One pixel less and it cannot simply drop the
  // 86px Back button and call it done — the menu that now holds it takes room
  // of its own, which has to come out of the same width.
  const r = fit(961, BAR, OPTS);
  const widths = Object.fromEntries(BAR.map((i) => [i.key, i.width]));
  const span = r.shown.reduce((s, k) => s + widths[k], 0) + OPTS.gap * r.shown.length + OPTS.menuWidth;
  ok('what stays, plus the menu, fits the width given', span <= 961, `${span} > 961`);
}

console.log('\nA control that is not on screen takes no room, and does not move:');
{
  const hiddenUndo = BAR.map((i) => (i.key === 'undo' ? { ...i, width: 0 } : i));
  const r = fit(900, hiddenUndo, OPTS);
  ok('it is not put in the menu', !r.hidden.includes('undo'));
  ok('it is counted as being in the bar, so it returns there', r.shown.includes('undo'));
  ok('and its absence leaves room for another', fit(900, hiddenUndo, OPTS).hidden.length <= fit(900, BAR, OPTS).hidden.length);
}

console.log('\nA width that cannot be measured changes nothing:');
{
  for (const bad of [0, -20, NaN, undefined, null, 'wide']) {
    const r = fit(bad, BAR, OPTS);
    ok(`${String(bad)} leaves the bar exactly as it was`, r.shown.length === BAR.length && r.hidden.length === 0);
  }
  ok('no items at all is not an error', same(fit(500, [], OPTS), { shown: [], hidden: [] }));
  ok('nor is nothing where the items should be', same(fit(500, null, OPTS), { shown: [], hidden: [] }));
}

console.log('\nIt reads no DOM of its own:');
{
  const src = readFileSync(join(root, 'src', 'js', 'toolbar-fit.js'), 'utf8');
  ok('nothing is measured here — the caller measures', !/getBoundingClientRect|offsetWidth|querySelector/.test(src));
  ok('and it is published for the modes to use', /window\.HCToolbarFit = \{ fit \}/.test(src));
  ok('it is loaded', /\/js\/toolbar-fit\.js/.test(readFileSync(join(root, 'src', 'boot.js'), 'utf8')));
}

console.log(`\n${pass} passed, ${fail} failed  (src/js/toolbar-fit.js)`);
process.exit(fail ? 1 : 0);
