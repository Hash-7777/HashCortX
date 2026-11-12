// ==============================================================
// The run signal: one line for a HashCoder run — checks
//
// Loads the real src/js/run-signal.js and holds the line's arithmetic: each
// phase a wave of its own shape, its width from how long it took (the
// square root, so a long one cannot swallow the rest, none narrower than its
// name), its height from how much it did, the stretches blended into one
// line, a finished run settling at its end, the marks where the app checked
// in, you added a message or a step failed, and what pointing at it says;
// and where it is wired. The drawing itself is looked at in a browser.
//
// Run with: npm run check:run-signal
// ==============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const src = (...p) => readFileSync(join(here, '..', '..', 'src', ...p), 'utf8');
const box = { console };
box.window = box;
vm.createContext(box);
vm.runInContext(src('js', 'run-signal.js'), box, { filename: 'run-signal.js' });
const G = box.HCRunSignal;

let pass = 0, fail = 0;
function ok(label, cond, detail = '') {
  if (cond === true) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}
const json = (x) => JSON.stringify(x);
const near = (a, b, e = 0.6) => Math.abs(a - b) <= e;

console.log('\nEach phase, its shape:');
ok('a shape for each phase, each repeating within a period, all within the band', ['finding', 'reading', 'changing', 'checking', 'reviewing'].every((p) => G.SHAPES[p] && G.SHAPES[p].period > 0 && [0, 0.7, 1.9, 3.1, 4.4, 5.6].every((th) => Math.abs(G.SHAPES[p].f(th)) <= 1.25)));
ok('each shape is its own: no two phases draw the same wave', new Set(['finding', 'reading', 'changing', 'checking', 'reviewing'].map((p) => [0.4, 1.3, 2.2].map((th) => G.SHAPES[p].f(th).toFixed(3)).join())).size === 5);

console.log('\nIts width and height:');
const w = G.widths([400, 1600, 100], 600, 64);
ok('widths fill the line and follow the square root of how long each took', near(w.reduce((a, b) => a + b, 0), 600) && w[1] > w[0] && w[0] >= 64, json(w));
ok('...none narrower than its name, however short', G.widths([1, 100000, 1], 600, 64).every((x) => x >= 64 - 0.01));
ok('...and a phase of no time yet still has its room', G.widths([0, 0], 300, 64).every((x) => near(x, 150)));
ok('height grows with how much a phase did, and stays within the band', G.ampOf(1) < G.ampOf(4) && G.ampOf(4) < G.ampOf(40) && G.ampOf(40) <= 1 && G.ampOf(0) > 0);

console.log('\nOne line:');
const segs = [{ phase: 'finding', ms: 400, steps: 1 }, { phase: 'reading', ms: 4200, steps: 6 }, { phase: 'changing', ms: 900, steps: 2 }];
const done = G.line(segs, 700, { live: false });
ok('one path, left to right, across the whole width', /^M0\.0 /.test(done.d) && done.d.split(' L').length > 400 && near(done.H, 700), done.d.slice(0, 40));
ok('a finished run settles flat at its end', (() => { const last = done.d.split(' L').pop().split(' ').map(Number); return near(last[1], G.MID, 0.05); })());
const live = G.line(segs, 700, { live: true });
ok('a run going on leaves room after its "now" for the newest stretch, which slides', near(live.H, 700 - G.HEAD) && live.head && /^M0\.0 /.test(live.head.d) && live.head.w > 0);
ok('the same run always draws the same line', G.line(segs, 700, { live: false }).d === done.d);
ok('stretches start where the one before ends', near(done.starts[1], done.widths[0]) && near(done.starts[2], done.widths[0] + done.widths[1]));

console.log('\nIts marks, and pointing at it:');
const marked = [{ phase: 'reading', ms: 1000, steps: 4, marks: [{ kind: 'checkin', at: 2, what: 'The app checked: 1 ask open' }] }, { phase: 'changing', ms: 1000, steps: 2, marks: [{ kind: 'added', at: 1, what: 'You added a message' }, { kind: 'failed', at: 0, what: 'A step failed' }] }];
const L2 = G.line(marked, 600, { live: false });
ok('a mark where the app checked in, you added a message, or a step failed, placed by where in its phase it came', json(L2.marks.map((m) => m.kind)) === '["checkin","added","failed"]' && near(L2.marks[0].x, L2.widths[0] * 2 / 4) && near(L2.marks[1].x, L2.starts[1] + L2.widths[1] / 2));
ok('pointing at a stretch says its phase and what it did; near a mark, what the mark is', G.whatAt(L2, [{ what: 'Reading · 4 files' }, { what: 'Changing · 2 edits' }], 10).text === 'Reading · 4 files' && G.whatAt(L2, [{ what: 'a' }, { what: 'b' }], L2.marks[0].x + 3).text === 'The app checked: 1 ask open' && G.whatAt(L2, [{ what: 'a' }, { what: 'b' }], 590).index === 1);
ok('nothing to draw, nothing drawn', G.line([], 600, {}).d === '' && G.line(null, 600, {}).d === '');

console.log('\nWhere it is drawn:');
const sig = src('js', 'run-signal.js'), view = src('js', 'run-view.js'), steps = src('js', 'code', 'steps.js'), css = src('modes', 'code', 'mode.css');
ok('the run view hands it each phase, as it is now, at each step, each ended step, each message you add, and when the run ends', (view.match(/signal\(contentEl\);/g) || []).length >= 4 && /window\.HCRunView\?\.note\(contentEl, 'added', /.test(steps));
ok('it is shown once a run has two phases, under the brief, above the steps', /if \(list\.length < 2\) return null;/.test(sig) && /contentEl\.insertBefore\(band, after \? after\.nextSibling : contentEl\.firstChild\)/.test(sig));
ok('it is drawn again at most once a frame, never frame by frame: only the newest stretch moves, by transform, while the run goes on', /requestAnimationFrame/.test(sig) && !/setInterval|requestAnimationFrame\(loop/.test(sig) && /\.cdr-msg\.running \.cdr-signal-head svg \{ animation: cdr-slide /.test(css) && /@keyframes cdr-slide \{ to \{ transform: translateX\(-50%\); \} \}/.test(css));
ok('...and stands still for someone who asked for less motion', /@media \(prefers-reduced-motion: reduce\) \{[^}]*\.cdr-signal-head svg \{ animation: none; \}/.test(css));
ok('pointing at it lights the phase it points at, with no coloured edge', /cdr-phase--lit/.test(sig) && /\.cdr-phase--lit \.cdr-phase-h \{ background: var\(--surface-raised\); \}/.test(css) && !/\.cdr-phase--lit[^{]*\{[^}]*box-shadow/.test(css));
ok('it is a picture, so a screen reader is told what it shows in words', /role="img"/.test(sig) && /aria-label/.test(sig));
const boot = src('boot.js');
ok('it is loaded after the run view and before the steps that call it', boot.indexOf("'/js/run-signal.js'") > boot.indexOf("'/js/run-view.js'") && boot.indexOf("'/js/run-signal.js'") < boot.indexOf("'/js/code/steps.js'"));
ok('it is part of npm run check', /npm run check:run-signal\b/.test(readFileSync(join(here, '..', '..', 'package.json'), 'utf8')));

console.log(`\n${pass} passed, ${fail} failed  (src/js/run-signal.js)`);
process.exit(fail ? 1 : 0);
