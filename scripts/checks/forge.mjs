// ==============================================================
// 3D Forge — checks on the properties that cannot be unit-tested
//
// Forge is a WebGL scene driven by a multi-agent run. Its geometry needs a GPU
// and its pipeline needs providers, so neither can be exercised here. What can
// be pinned is the shape of the source, and the three defects worth pinning
// were all the same kind: the panel said one thing while the scene did
// another, and nothing failed.
//
//   • Re-entering Forge reset the header to "Void ready · 0 mesh parts" while
//     the model was still on screen.
//   • The GPU reclaiming the drawing context left the canvas white for good,
//     because nothing listened for it. Everything else kept working, which is
//     what made it look like the preview had simply stopped.
//   • A refinement agent that failed was marked done, and the run reported
//     "Forge complete" — so a model missing its whole surface pass looked
//     finished, and the user went to fix a prompt that was never the problem.
//
// Same approach as native-surface.mjs: read the real source and assert on it.
//
// Run with: npm run check:forge
// ==============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, '..', '..', 'src', 'js', 'forge-mode.js'), 'utf8');

let pass = 0, fail = 0;
function check(label, condition, detail = '') {
  if (condition) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}

/** The body of a named function, to the matching closing brace at its indent. */
function bodyOf(name) {
  const start = src.search(new RegExp(`^  (?:async )?function ${name}\\(`, 'm'));
  if (start < 0) return '';
  const end = src.indexOf('\n  }\n', start);
  return end < 0 ? src.slice(start) : src.slice(start, end);
}

console.log('\nThe panel is seeded from what is actually loaded:');
{
  const mount = bodyOf('mount');
  check('mount() reads the live plan', /updatePlanList\(activePlan\)/.test(mount));
  // The exact regression: entering Forge a second time blanked a header that
  // described a model still sitting in the scene.
  check('mount() does not blank the panel', !/updatePlanList\(null\)/.test(mount),
    'a fresh mount must describe the plan it already has, not nothing');
}

console.log('\nLosing the drawing context is survivable:');
{
  check('the context-lost event is handled', /addEventListener\("webglcontextlost"/.test(src));
  check('the context-restored event is handled', /addEventListener\("webglcontextrestored"/.test(src));
  // Without preventDefault the browser never offers a restore, so the handler
  // would observe the loss and be unable to do anything about it.
  const lost = src.slice(src.indexOf('webglcontextlost'), src.indexOf('webglcontextrestored'));
  check('the default is prevented, so a restore is possible',
    /preventDefault\(\)/.test(lost),
    'without this the canvas stays blank for the rest of the session');
  check('the loop stops while the context is gone', /stopLoop\(\)/.test(lost));
  check('the scene is rebuilt on restore',
    /webglcontextrestored[\s\S]{0,900}buildPlan\(/.test(src),
    'every buffer and texture is gone, so the scene cannot be assumed to survive');

  // The power handler restarts the loop whenever the window becomes visible,
  // so the guard has to be inside startLoop rather than at its callers.
  const start = bodyOf('startLoop');
  check('startLoop refuses while the context is gone', /contextLost/.test(start),
    'a visibility change would otherwise resume drawing into a dead context');
  check('the render loop itself checks too', /!mounted \|\| contextLost/.test(src));
}

console.log('\nA run that lost an agent does not report success:');
{
  // The failure path must not mark the agent done. This is the line that made
  // a partial model indistinguishable from a finished one.
  check('a failed agent is marked failed, not done',
    /catch \(err\) \{[\s\S]{0,600}setAgentState\(role, "failed"\)/.test(src));
  check('failures are collected', /failedRoles\.push\(/.test(src));
  check('the closing message reports them', /failedRoles\.length/.test(src));
  check('"Forge complete" is only said when nothing failed',
    /failedRoles\.length\)[\s\S]{0,700}Forge complete/.test(src),
    'the success line must sit in the branch where no agent failed');
  // Which pass is missing decides what the user does next: the surface pass is
  // what shapes the silhouette, so losing it is not a detail.
  check('the message names which agents did not run', /failedRoles\.join\(/.test(src));
}

console.log(`\n${pass} passed, ${fail} failed  (src/js/forge-mode.js)`);
process.exit(fail ? 1 : 0);
