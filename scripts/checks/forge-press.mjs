// ==============================================================
// Whether a click on the 3D Forge canvas picks a part — checks
//
// Loads the REAL src/js/forge/press.js and holds that letting go of a gizmo
// drag, or of a turn of the camera, does not count as a click on empty
// space, and that the Forge mode asks it before picking: what a press began
// as is noted when it begins, by the canvas or by the gizmo, whichever hears
// it first.
//
// Run with: npm run check:forge-press
// ==============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const src = (...p) => readFileSync(join(here, '..', '..', 'src', ...p), 'utf8');
const sandbox = { window: {}, Math, Number };
vm.createContext(sandbox);
vm.runInContext(src('js', 'forge', 'press.js'), sandbox, { filename: 'press.js' });
const P = sandbox.window.HCForgePress;

let pass = 0;
let fail = 0;
function ok(label, cond) {
  if (cond) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}`); }
}

console.log('A click on the canvas:');
const at = (x, y) => ({ x, y });
ok('a press and release in one place picks', P.isPick({ from: at(100, 100), to: at(100, 100) }));
ok('a hand that shakes a little still picks', P.isPick({ from: at(100, 100), to: at(103, 102) }));
ok('letting go of a gizmo drag picks nothing, even released where it began', !P.isPick({ from: at(100, 100), to: at(100, 100), gizmo: true }) && !P.isPick({ from: at(100, 100), to: at(240, 180), gizmo: true }));
ok('a click while the gizmo is still dragging picks nothing', !P.isPick({ from: at(5, 5), to: at(5, 5), dragging: true }));
ok('letting go after turning the camera picks nothing', !P.isPick({ from: at(100, 100), to: at(160, 130) }));
ok('a click with no press seen is a click', P.isPick({ to: at(1, 1) }) && P.isPick());

console.log('\nThe Forge mode:');
{
  const mode = src('modes', 'forge', 'mode.js');
  ok('the canvas notes where each press begins, and whether the gizmo already holds it', /renderer\.domElement\.addEventListener\("pointerdown", \(e\) => \{ canvasPress = \{ from: \{ x: e\.clientX, y: e\.clientY \}, gizmo: !!transformControls\?\.dragging \}; \}\);/.test(mode));
  ok('the gizmo marks the press it takes hold of', /addEventListener\("dragging-changed", \(event\) => \{[\s\S]{0,120}if \(event\.value && canvasPress\) canvasPress\.gizmo = true;/.test(mode));
  ok('a click picks only when the rule says so', /function handleCanvasClick\(event\) \{[\s\S]{0,400}if \(!window\.HCForgePress\.isPick\(\{ \.\.\.canvasPress, to: \{ x: event\.clientX, y: event\.clientY \}, dragging: !!transformControls\?\.dragging \}\)\) return;/.test(mode));
  const boot = src('boot.js');
  ok('it loads before the Forge mode', boot.indexOf("'/js/forge/press.js'") > 0);
  ok('this check is part of npm run check', /npm run check:forge-press\b/.test(readFileSync(join(here, '..', '..', 'package.json'), 'utf8')));
}

console.log(`\n${pass} passed, ${fail} failed  (src/js/forge/press.js)`);
process.exit(fail ? 1 : 0);
