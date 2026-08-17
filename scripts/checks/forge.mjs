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
const src = readFileSync(join(here, '..', '..', 'src', 'modes', 'forge', 'mode.js'), 'utf8');

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

console.log('\nA run that failed does not report success:');
{
  // The property these used to hold — a partial run must not read as a
  // finished one — still matters; what can be partial has changed. There is no
  // three-pass pipeline to lose a pass from any more, so the equivalent is that
  // the one design call failing ends the run as failed and says so.
  check('a design that fails ends the run',
    /failForgeRun\("Parameter Agent", "Model generation failed/.test(src) ||
    /failForgeRun\([\s\S]{0,120}generation failed/i.test(src),
    'the design call must route into failForgeRun, not fall through to the success line');
  check('a plan that produced nothing ends the run',
    /failForgeRun\([\s\S]{0,160}No model plan was produced/.test(src));
  check('"Forge complete" is not claimed for an empty scene',
    /partCount = renderableNodes\(plan\.nodes\)\.length/.test(src),
    'the closing message must count what actually reached the viewport');

  // The appending passes are gone on purpose. If one comes back, it should be a
  // decision rather than a drift, so their absence is pinned.
  check('the three appending passes stay gone',
    !/ROLE_PIPELINE/.test(src) && !/askRoleAgentWithFailover/.test(src),
    'Structure, Surface and Detail grew a pile rather than refining a model');
  check('the Audit Agent stays gone', !/id: "audit"/.test(src));
}

console.log('\nThe measurements are done in code, not asked of a model:');
{
  check('the deterministic stage runs before anything is drawn',
    /assembleDeterministically\(plan\)[\s\S]{0,200}buildPlan\(plan\)/.test(src));
  check('it reports what it corrected', /log\("Assemble"/.test(src));
  check('it never hands back an empty scene',
    /if \(!out\.parts\.length\)[\s\S]{0,220}return plan;/.test(src));
  check('one floor height, read from the constant',
    /const FLOOR_Y = 0;/.test(src) && /grid\.position\.y = FLOOR_Y/.test(src) && /floor\.position\.y = FLOOR_Y/.test(src));
}

console.log('\nA generated model is not replaced by a built-in one:');
{
  // Six branches used to test a generated plan against a hand-written idea of
  // the subject and serve a template when it disagreed — so the app paid for a
  // design and then quietly substituted its own, which also made the design
  // prompt impossible to judge.
  check('the override chain is gone',
    !/reconstructPhoneStructure|reconstructLaptopStructure|reconstructKnownObjectStructure/.test(src));
  check('the animal and skull rebuilds are gone',
    !/reconstructMeshStructure|reconstructSkullStructure/.test(src));
  check('the plan-shape predicates that fed it are gone',
    !/isAnimalPlanSane|isPhonePlanSane|isLaptopPlanSane|isDronePlanSane|isToolPlanSane/.test(src));
  check('one subject is still enforced, and only that',
    /function enforceSingleMainModel[\s\S]{0,900}centerAndGroundPlan\(keepLargestConnectedModel/.test(src),
    'it should centre and ground a single subject, not rebuild it');
  check('no padding pass tops a plan up to a node count',
    !/ensurePlanRichness/.test(src),
    'padding a good twelve-part model up to forty is the opposite of what the prompt asks for');

  // Mock is a deliberate choice to build from a template, and stays.
  check('the built-in plans are still reachable for Mock', /function fallbackPlan\(/.test(src));
  check('Mock still routes to them', /frgMockBtn/.test(src));
}

console.log('\nThe design prompt asks for a model, not a part count:');
{
  check('no node-count demand', !/\b24 to 56\b|\b38 to 86\b/.test(src),
    'asking for dozens of parts is what produced a pile of shards');
  check('symmetry is delegated to the app', /"mirror": true/.test(src));
  check('audit markers are forbidden rather than requested',
    /Do not add audit markers/.test(src));
  check('few parts that read correctly is stated', /FEW PARTS THAT READ CORRECTLY/.test(src));
}

console.log(`\n${pass} passed, ${fail} failed  (src/modes/forge/mode.js)`);
process.exit(fail ? 1 : 0);
