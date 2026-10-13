// ==============================================================
// A wheel event on a canvas, read as what the hand did — checks
//
// Loads the REAL src/js/wheel.js and holds that a pinch zooms as far as the
// fingers moved, never by more than a set amount in one event, a mouse wheel
// one step for each notch whatever units it reports,
// that two fingers on a trackpad move the view, and that the Agent Swarm
// canvas and the memory map both read their wheel through it. Also holds
// that dragging an agent on the Swarm canvas is listened to once, not once
// for every agent at every redraw.
//
// Run with: npm run check:wheel
// ==============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const src = (...p) => readFileSync(join(here, '..', '..', 'src', ...p), 'utf8');
const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(src('js', 'wheel.js'), sandbox, { filename: 'wheel.js' });
const W = sandbox.window.HCWheel;

let pass = 0;
let fail = 0;
function ok(label, cond, detail = '') {
  if (cond) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}

// Events as WebKit and Chromium send them.
const trackpad = (dx, dy, extra = {}) => ({ deltaX: dx, deltaY: dy, deltaMode: 0, wheelDeltaX: -3 * dx, wheelDeltaY: -3 * dy, ...extra });
const notch = (dy, extra = {}) => ({ deltaX: 0, deltaY: dy, deltaMode: 0, wheelDeltaY: dy < 0 ? 120 : -120, ...extra });
const pinch = (dy) => ({ deltaX: 0, deltaY: dy, deltaMode: 0, wheelDeltaY: -3 * dy, ctrlKey: true });

console.log('Telling a trackpad from a mouse:');
ok('two fingers on a trackpad', W.fromTrackpad(trackpad(0, 4)) && W.fromTrackpad(trackpad(3, -1.5)));
ok('a notch of a mouse wheel, as Chromium and as WebKit send it', !W.fromTrackpad(notch(100)) && !W.fromTrackpad(notch(-4.000244140625)));
ok('with no legacy delta, pixels are a trackpad and lines a mouse', W.fromTrackpad({ deltaY: 5, deltaMode: 0 }) && !W.fromTrackpad({ deltaY: 3, deltaMode: 1 }));

console.log('\nWhat each gesture asks for:');
{
  const up = W.read(trackpad(0, 6)), side = W.read(trackpad(-8, 0));
  ok('two fingers move the view, the way they moved', up && up.pan && up.pan.dy === -6 && up.pan.dx === -0 && side && side.pan.dx === 8);
  ok('...and never zoom', !up.zoom && !side.zoom);
  const s = W.read(trackpad(0, 10, { shiftKey: true }));
  ok('Shift turns a vertical scroll sideways', s && s.pan.dx === -10 && s.pan.dy === 0);
  const inP = W.read(pinch(-4)), outP = W.read(pinch(4));
  ok('a pinch outward zooms in, inward zooms out', inP.zoom > 1 && outP.zoom < 1);
  ok('a pinch zooms as far as the fingers moved', W.read(pinch(-2)).zoom < inP.zoom && Math.abs(inP.zoom * outP.zoom - 1) < 1e-9);
  const wIn = W.read(notch(-100)), wOut = W.read(notch(100));
  ok('a mouse wheel zooms, toward the pointer when rolled up', wIn.zoom > 1 && wOut.zoom < 1 && !wIn.pan);
  ok('one notch zooms one step, the same however the browser measures the notch', wIn.zoom === W.NOTCH && W.read(notch(-4.000244140625)).zoom === W.NOTCH && W.read({ deltaY: -3, deltaMode: 1 }).zoom === W.NOTCH && wOut.zoom === 1 / W.NOTCH);
  ok('a hard pinch zooms no more than the cap in one event', W.read(pinch(-400)).zoom <= W.MOST + 1e-9 && W.read(pinch(400)).zoom >= 1 / W.MOST - 1e-9);
  ok('Ctrl with a mouse wheel zooms as a pinch does', W.read(notch(-50, { ctrlKey: true })).zoom > 1);
  ok('nothing moved, nothing to do', W.read(trackpad(0, 0)) === null && W.read(pinch(0)) === null && W.read(null) === null);
}

console.log('\nThe canvases:');
{
  const swarm = src('modes', 'agent-maker', 'mode.js');
  const map = src('core', 'memory', 'map.js');
  ok('the Agent Swarm canvas reads its wheel through it, moving or zooming as asked', /const did = window\.HCWheel\.read\(e\);[\s\S]{0,200}if \(did\.pan\) \{ dagPan\.x \+= did\.pan\.dx; dagPan\.y \+= did\.pan\.dy; _dagTransform\(\); return; \}[\s\S]{0,200}applyDagZoom\(dagZoom \* did\.zoom/.test(swarm));
  ok('the memory map does too', /const did = window\.HCWheel\.read\(e\);[\s\S]{0,120}if \(did\.zoom\) \{ zoomAbout\(atPoint\(e\), did\.zoom\); return; \}/.test(map));
  ok('neither zooms by a fixed step on every event', !/applyDagZoom\(dagZoom \+ \(e\.deltaY/.test(swarm) && !/zoomAbout\(atPoint\(e\), e\.deltaY < 0/.test(map));
  const moves = (swarm.match(/document\.addEventListener\("mousemove"/g) || []).length;
  const ups = (swarm.match(/document\.addEventListener\("mouseup"/g) || []).length;
  ok('dragging an agent is listened to once, beside the canvas pan, not once for each agent at each redraw', moves === 1 && ups === 1, `${moves} move, ${ups} release`);
  ok('a drag released outside the window ends when the pointer comes back', /if \(\(nodeDrag \|\| panning\) && !e\.buttons\) return endDrag\(\);/.test(swarm) && /document\.addEventListener\("mouseup", endDrag\);/.test(swarm));
  const boot = src('boot.js');
  ok('it loads before the app, the modes and the memory map', boot.indexOf("'/js/wheel.js'") > 0 && boot.indexOf("'/js/wheel.js'") < boot.indexOf("'/js/app.js'") && boot.indexOf("'/js/wheel.js'") < boot.indexOf("'/core/memory/map.js'"));
  ok('this check is part of npm run check', /npm run check:wheel\b/.test(readFileSync(join(here, '..', '..', 'package.json'), 'utf8')));
}

console.log(`\n${pass} passed, ${fail} failed  (src/js/wheel.js)`);
process.exit(fail ? 1 : 0);
