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
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, '..', '..', 'src', 'modes', 'forge', 'mode.js'), 'utf8');
const panel = readFileSync(join(here, '..', '..', 'src', 'modes', 'forge', 'panel.html'), 'utf8');
const css = readFileSync(join(here, '..', '..', 'src', 'modes', 'forge', 'mode.css'), 'utf8');
const vars = readFileSync(join(here, '..', '..', 'src', 'css', 'vars.css'), 'utf8');
const modelPlan = readFileSync(join(here, '..', '..', 'src', 'js', 'model-plan.js'), 'utf8');

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
    /function enforceSingleMainModel[\s\S]{0,900}centerPlanOnAxis\(keepLargestConnectedModel/.test(src),
    'it should keep and centre a single subject, not rebuild it');
  check('no padding pass tops a plan up to a node count',
    !/ensurePlanRichness/.test(src),
    'padding a good twelve-part model up to forty is the opposite of what the prompt asks for');

  // The comment here used to say the built-in subject templates stayed because
  // Mock built from them. Mock loads the sample mark and always has; every one
  // of those templates — spoons, swords, drones, a skeleton — was unreachable
  // from any button while reading as a working feature.
  check('Mock loads the sample mark', /if \(useSample\) \{[\s\S]{0,60}hLogoPlan\(\)/.test(src));
  check('and the unreachable subject templates are gone',
    !/function (fallbackPlan|genericPlan|spoonPlan|swordPlan|dronePlan|personPlan|humanSkeletonLibraryNodes)\(/.test(src));
  check('Mock still routes to them', /frgMockBtn/.test(src));
}

console.log('\nThe inspector asks one question at a time:');
{
  check('three tabs', /data-frg-tab="parts"/.test(panel) && /data-frg-tab="properties"/.test(panel) && /data-frg-tab="run"/.test(panel));
  // Each pane's own markup, so a check cannot be satisfied by something that
  // happens to sit in the next one.
  const paneOf = (name) => {
    const parts = panel.split(/data-frg-pane="/).slice(1);
    const found = parts.find((chunk) => chunk.startsWith(`${name}"`));
    return found ? found.split(/data-frg-pane="/)[0] : '';
  };
  check('the parts of the model are under Parts',
    /id="frgPlanList"/.test(paneOf('parts')));
  check('and nothing else competes with them there',
    !/id="frgProjectsList"/.test(paneOf('parts')));
  check('saved models have a tab of their own',
    /data-frg-tab="saved"/.test(panel) && /id="frgProjectsList"/.test(paneOf('saved')));
  check('every tab has the pane it names',
    (panel.match(/data-frg-tab="(\w+)"/g) || []).every((t) =>
      panel.includes(t.replace('data-frg-tab=', 'data-frg-pane='))));
  check('the selection is under Properties',
    /id="frgSelectionCard"/.test(paneOf('properties')));
  check('the agents and pipeline are under Run',
    /id="frgAgents"/.test(paneOf('run')));
  check('a list that grows without limit scrolls inside its own section',
    /\.frg-plan-list,\s*\n\.frg-project-list \{[\s\S]{0,160}overflow-y: auto/.test(css));
  check('panel rows are the height of what is in them',
    /\.frg-plan-list \{[\s\S]{0,400}align-content: start/.test(css) ||
    /align-content: start/.test(css.split('.frg-agent-list')[1] || ''));
  // Forge had a mint accent of its own, and a second off-white, and a second
  // gold, and panel grounds tinted green — which is what made walking into it
  // feel like leaving the app. The hues it used are named here so they cannot
  // come back one rule at a time.
  check('Forge is on the app accent, not a palette of its own',
    /body\.forge-studio-mode \{[\s\S]{0,240}--accent: var\(--gold\)/.test(vars));
  check('no mint is left in the mode stylesheet',
    !/75,\s*210,\s*190|159,\s*244,\s*231|180,\s*255,\s*245|#9ff4e7|#4bd2be/.test(css));
  check('and no second off-white or second gold',
    !/223,\s*251,\s*245|245,\s*201,\s*122/.test(css));
  check('the header is three groups, not six columns',
    /grid-template-columns: auto minmax\(0, 1fr\) auto/.test(css));
  check('the prompt, Generate and Options are one group',
    /class="frg-command"[\s\S]{0,1200}id="frgGodBtn"/.test(panel) &&
    /class="frg-command"[\s\S]{0,2000}id="frgMoreBtn"/.test(panel));
  check('the particle count is gone from the bar',
    !/frgParticleCount/.test(panel));
  check('and nothing still looks for it',
    !/frgParticleCount/.test(src));
  // The scene itself was lit mint — the rim light, the ambient and the sky —
  // so a model came out tinted whatever colour it had been given.
  check('the scene is not lit in a colour of its own',
    /DirectionalLight\(0xf6efe3/.test(src) && /DirectionalLight\(0xc9a96e/.test(src) &&
    /AmbientLight\(0x8a857e/.test(src) && !/0xdffbf5|0x6a8f8a|0xb0d9d2|0x4bd2be/.test(src));
  // A part used to be coloured by its role, over whatever colour the design
  // call had picked for it. So a fish read as a beige body beside a gold fin
  // beside a grey tail: the joins were the loudest thing on screen, and three
  // objects stood where one animal was asked for.
  check('every part of a model is the same material',
    /PRINT_COLOR = 0xd7d2c8/.test(src) && !/ROLE_COLORS/.test(src));
  check('and the design call cannot colour one of them',
    !/node\.color \? new THREE\.Color\(node\.color\)/.test(src));
  check('it is matte, so no part shines like a different material',
    /roughness: 0\.72/.test(src) && /metalness: 0\.04/.test(src));
  check('a finished part is solid, not slightly see-through',
    !/targetOpacity: node\.opacity \?\? \(node\.type === "mesh" \? 0\.98 : 0\.86\)/.test(src));
  check('and stops being drawn as glass once it has arrived',
    /mat\.transparent = false/.test(bodyOf('updateReveal')));
  check('the floor is a faint neutral reference, not part of the palette',
    /GridHelper\(18, 36, 0xffffff, 0xffffff\)/.test(src) && /grid\.material\.opacity = 0\.16/.test(src));
  check('nothing decorative is left drifting behind the model',
    !/starField|makeStarField/.test(src));
  // A twelve-part model spent about two seconds assembling itself on screen,
  // part by part, each one trailing its own cloud of motes — a picture of an
  // assembly of pieces, in front of the one object that had been asked for.
  check('nothing is assembled on screen any more',
    !/spawnFlightsTo|updateFlights|HCAssemblyMotes|particleGroup/.test(src));
  check('and the module that laid the motes out is gone with it',
    !existsSync(join(here, '..', '..', 'src', 'js', 'assembly-motes.js')));
  check('the model fades up whole, in a quarter of a second',
    /REVEAL_MS = 260/.test(src));
  check('every part on the same clock, not one after another',
    /start: revealStart/.test(src) && !/GATHER_STAGGER_MS/.test(src));
  check('and that clock is read once, before the parts are made',
    /const revealStart = performance\.now\(\);[\s\S]{0,120}addNodeMesh\(node, revealStart\)/.test(bodyOf('buildPlan')));
  check('the floating mark is not set on the floor',
    /if \(activePlan\?\._introLogo\) return;/.test(bodyOf('groundBuiltModel')));
  check('and the flag that says so survives being normalised',
    /_introLogo: src\._introLogo === true/.test(src));
  check('the old scatter-from-anywhere helper is gone',
    !/randomSpherePoint/.test(src));
  check('the intro mark has no halo layer',
    !/hcx_teal_halo/.test(src));
  check('grounding moves the floating mark for good',
    /logoBaseY \+= dy/.test(src));
  check('the menu styles its own controls',
    /\.frg-more-menu select \{/.test(css));
  check('a run does not throw the trace open over the model',
    !/classList\.add\("expanded"\)/.test(src));
  check('but the collapsed bar still names the latest line',
    /frgTraceSummary[\s\S]{0,120}textContent = `\$\{label\}: \$\{message\}`/.test(src));
  check('the keyboard caption carries the keys, not just the words',
    /class="frg-help"[\s\S]{0,400}<b>W<\/b>/.test(panel) && /\.frg-help b \{/.test(css));
  check('the options menu is labelled, not three dots',
    /id="frgMoreBtn"[\s\S]{0,600}<span>Options<\/span>/.test(panel));
  check('style, detail and export target moved into the menu',
    /id="frgMoreMenu"[\s\S]{0,1400}id="frgOutputTarget"/.test(panel));
  check('the menu closes on an outside click', /if \(e\.target\.closest\("\.frg-more-wrap"\)\) return;/.test(src));
}

// The mode rebuilds every part from a fixed list of fields before handing it to
// the assembler. A field missing from that list is not an error and not a
// crash — it is silently dropped, and whatever depended on it stops happening.
// That is how symmetry died: the design prompt asks the model to build one side
// and mark the part mirrored, the model does, and the flag was thrown away on
// the way through. Every generated model arrived as the half that was asked for.
console.log('\nA shape the app cannot build is read, and said out loud:');
{
  const body = bodyOf('normalizePlan');
  // The old line turned every unrecognised type into a one-unit box with no
  // trace of it having happened.
  check('a part takes its type from the resolver, not an inline list',
    /type: shapeOf\(node, i\)/.test(body));
  check('and the resolver is the tested one',
    /MP\?\.resolveType/.test(body) && /function resolveType/.test(modelPlan));
  check('and every substitution is carried on the plan',
    /shapeSubstitutions/.test(body));
  check('the run says how many parts were substituted',
    /named a shape this app does not build/.test(src));
  check('and lists which ones', /swapped\.join/.test(src));
  // A design answered entirely in blocks and balls is the model's doing. Saying
  // nothing about it made it look like the app's.
  check('a design of plain blocks and balls is called out',
    /plain boxes or balls/.test(bodyOf('reportShapeQuality')));
  check('it is a warning, not a failure', /stand-ins/.test(src) && !/failForgeRun\("Design"/.test(src));
  check('and Improve is told the same thing',
    /plain boxes or spheres/.test(bodyOf('describeBuiltModel')));
  check('the report runs on everything that reaches the screen',
    /reportShapeQuality\(activePlan, nodes\)/.test(bodyOf('buildPlan')));
}

console.log('\nA model knows how big it is, and says so in millimetres:');
{
  const build = bodyOf('buildPlan');
  // Every tolerance downstream is an absolute number, so it is only correct at
  // one scale — and models were arriving between 1.2 and 4.8 units across.
  check('the assembler is told what span the scene runs at',
    /targetSize: U\(\)\?\.WORKING_SPAN/.test(src));
  // Measured after the meshes exist, because normalising works from declared
  // parameters and lands near the span rather than on it.
  check('the size is measured from the built geometry',
    /Box3\(\)\.setFromObject\(modelGroup\)/.test(bodyOf('measureRealSize')));
  check('and measured before anything shows a dimension',
    /measureRealSize\(\);[\s\S]{0,200}updatePlanList\(activePlan\)/.test(build),
    'measuring after the badge labels the first model with the previous scale');
  check('the panel is redrawn for the new model too',
    /renderSelection\(\);/.test(build));
  check('the badge carries the size, not only the part count',
    /part\$\{nodes\.length === 1 \? "" : "s"\}`[\s\S]{0,80}measured\.text/.test(src));
  check('the whole model size is editable where nothing is selected',
    /data-frg-model-size/.test(src) && /function setModelSizeMm/.test(src));
  check('changing it rebuilds nothing',
    !/buildPlan\(/.test(bodyOf('setModelSizeMm')));
  check('a part position is shown and read back in the same units',
    /units\.toMm\(pos\[axis\], mmPerUnit\)/.test(src) && /units\.fromMm\(Number\(value\)/.test(src));
  check('a written file carries the units its format is read in',
    /units\.exportScale\(kind, mmPerUnit\)/.test(bodyOf('exportableObject')));
  check('and the format is known before the copy is made',
    /const object = exportableObject\(kind\)/.test(src));
  check('the design is asked for a real size', /Set "sizeMm" to how long/.test(src));
}

console.log('\nA design may do arithmetic, and say a thing once:');
{
  const body = bodyOf('normalizePlan');
  // Every field on this list was once missing from it, and each time the
  // feature simply stopped happening without a word.
  check('the named values survive normalising', /vars: src\.vars/.test(body));
  check('and so does a request to repeat', /repeat: node\.repeat/.test(body));
  check('and the pairing repeating leaves behind', /repeatedFrom: typeof node\.repeatedFrom/.test(body));
  check('the run says how many parts a repeat made',
    /part\(s\) made by repeating/.test(src));
  check('the design is told it may write a sum instead of a number',
    /Any number may be written as a sum/.test(src));
  check('and told never to write a ring out by hand',
    /NEVER write out a ring of teeth/.test(src));
  check('a size written as arithmetic reaches the model',
    /sizeMm: out\.sizeMm \?\? plan\.sizeMm/.test(bodyOf('assembleDeterministically')),
    'the assembler is the only place arithmetic is resolved');
  check('the arithmetic itself is not in this file',
    !/function tokenise|function resolveVars/.test(src),
    'it belongs in the tested module, not in the mode');
}

console.log('\nThe design prompt asks for shape, not stand-ins:');
{
  check('the biggest part must carry the silhouette',
    /The largest part carries the silhouette/.test(src));
  check('a body answered with a box is named as a placeholder',
    /is a placeholder, not a design/.test(src));
  check('and the type names are stated as a closed list',
    /Use only the type names in the schema/.test(src));
}

console.log('\nWhat the assembler reads survives being normalised:');
{
  const planSrc = readFileSync(join(here, '..', '..', 'src', 'js', 'model-plan.js'), 'utf8');
  const body = bodyOf('normalizePlan');
  // Fields the assembler takes off a part it is given.
  const read = new Set([...planSrc.matchAll(/\b(?:raw|part)\.([a-zA-Z_]\w*)/g)].map((m) => m[1]));
  // Fields the mode writes onto the part it hands over.
  const written = new Set([...body.matchAll(/^\s{8}([a-zA-Z_]\w*):/gm)].map((m) => m[1]));
  const ignore = new Set(['map', 'filter', 'slice', 'length', 'push', 'forEach', 'toFixed']);
  const missing = [...read].filter((k) => !written.has(k) && !ignore.has(k));
  check('every field the assembler reads is one the mode passes on',
    missing.length === 0, `dropped: ${missing.join(', ')}`);
  check('the mirror flag in particular', /mirror: node\.mirror === true/.test(body));
  check('and the pairing the assembler writes back', /mirroredFrom/.test(body));
}

console.log('\nImprove is a patch, not another design:');
{
  check('it asks for a patch shape', /"remove":\[/.test(src) && /"replace":\[/.test(src) && /"add":\[/.test(src));
  check('it is told to change as little as possible', /Change as little as possible/.test(src));
  check('it is given what the model measures, not the prompt again',
    /function describeBuiltModel/.test(src) && /Measured size: width/.test(src));
  check('the measurements come from the built geometry',
    /new THREE\.Box3\(\)\.setFromObject\(modelGroup\)[\s\S]{0,400}getSize/.test(src));
  check('a patch that changes nothing is not applied',
    /reported nothing to change/.test(src));
  check('it refuses to run over a generation in progress',
    /wait for the run to finish/.test(src));
  check('the button is off until there is something to improve',
    /function syncImproveAvailability[\s\S]{0,300}btn\.disabled = !count/.test(src));
}

// A run is "in flight" only while it is running. That sounds too obvious to
// pin, and it is exactly what broke: the controller a run created was never
// put back, so it answered "a run is happening" for the rest of the session
// and Improve refused every time it was offered — button enabled, note
// inviting the click, and not one call ever made.
console.log('\nA finished run stops counting as one in flight:');
{
  const owner = bodyOf('runGodAgent');
  const body = bodyOf('forgeRun');
  const improve = bodyOf('improveModel');
  check('the run puts the controller back when it ends',
    /finally \{[\s\S]{0,120}abortCtrl = null/.test(owner));
  check('and only while it is still its own',
    /if \(abortCtrl === ctrl\) abortCtrl = null/.test(owner));
  check('a superseded run does not read the controller that replaced it',
    body.length > 0 && !/abortCtrl/.test(body));
  check('Improve holds the controller while it is in flight',
    /abortCtrl = ctrl/.test(improve));
  check('Improve puts it back too',
    /if \(abortCtrl === ctrl\) abortCtrl = null/.test(improve));
  check('a patch is not applied over the run that replaced it',
    /if \(abortCtrl !== ctrl\)[\s\S]{0,120}return;[\s\S]{0,200}parseJsonPayload/.test(improve));
}

console.log('\nThe design call is the only network call a run makes:');
{
  const body = bodyOf('forgeRun');
  check('no reference brief is gathered', !/gatherReferenceBrief/.test(src));
  check('the run runs no web search', !/web_search/.test(src));
  check('the run fetches no page', !/fetch_url/.test(src));
  check('and the design call is not handed one', !/referenceBrief/.test(src));
  check('the run goes straight from the prompt to the design call',
    /updateStage\("generate", "active", "parameter agent"\)[\s\S]{0,120}requestForgeKernelPlan/.test(body));
}

console.log('\nThe model is grounded once, by one estimator:');
{
  check('the horizontal centring no longer touches height',
    /function centerPlanOnAxis[\s\S]{0,900}\(node\.position\?\.\[1\] \|\| 0\),/.test(src),
    'it used to ground to FLOOR_Y + 0.015 and then be overruled by the assembler');
  check('nothing grounds twice', !/centerAndGroundPlan/.test(src));
  check('grounding is left to the tested stage',
    /assembleDeterministically/.test(src) &&
    !/const dy = FLOOR_Y \+ 0\.015/.test(src),
    'the second grounding must be gone from the code, not just from the comment');
  // Parts within the contact tolerance passed as connected and were never
  // moved, so a fin could sit a visible line clear of the body it belonged to.
  check('and the seams are closed by it too',
    /seated: seated\.seams\.length/.test(modelPlan) && /seatParts\(joined\.parts, opts\)/.test(modelPlan));
  check('the run says how many seams it closed',
    /seam\(s\) closed/.test(bodyOf('assembleDeterministically')));
}

console.log('\nThe design prompt asks for a model, not a part count:');
{
  check('no node-count demand', !/\b24 to 56\b|\b38 to 86\b/.test(src),
    'asking for dozens of parts is what produced a pile of shards');
  check('symmetry is delegated to the app', /"mirror": true/.test(src));
  check('audit markers are forbidden rather than requested',
    /Do not add audit markers/.test(src));
  check('few parts that read correctly is stated', /FEW PARTS THAT READ CORRECTLY/.test(src));
  // A real run returned a fish standing on its tail. The prompt had never said
  // which way is up, so the model had no reason to lay it down.
  check('the axis convention is stated', /\+Y is up/.test(src));
  check('length-wise objects are told to lie down', /HORIZONTAL axis/.test(src));
}

console.log(`\n${pass} passed, ${fail} failed  (src/modes/forge/mode.js)`);
process.exit(fail ? 1 : 0);
