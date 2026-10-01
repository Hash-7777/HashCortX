// ============================================================
// The plan HashCoder keeps for a request with several parts —
// src/js/code/plan.js, and where the Coder uses it.
// Run with: npm run check:code-plan
// ============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const src = (...p) => readFileSync(join(here, '..', '..', 'src', ...p), 'utf8');
const box = { window: {} };
vm.createContext(box);
vm.runInContext(process.argv[2] ? readFileSync(process.argv[2], 'utf8') : src('js', 'code', 'plan.js'), box, { filename: 'plan.js' });
vm.runInContext(src('js', 'fences.js'), box, { filename: 'fences.js' });
vm.runInContext(src('js', 'code', 'verify.js'), box, { filename: 'verify.js' });
const P = box.window.HCCodePlan;
const V = box.window.HCCodeVerify;

let pass = 0, fail = 0;
const ok = (label, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`); }
};

console.log('A plan from the call:');
{
  const plan = P.fromCall({ steps: [{ step: 'Add the --json flag', status: 'done' }, { step: '  Print   results as JSON ', status: 'doing' }, { step: 'Test it', status: 'todo' }] });
  ok('keeps each step, tidied, with its status', plan.steps.length === 3 && plan.steps[1].step === 'Print results as JSON' && plan.steps.map((x) => x.status).join() === 'done,doing,todo');
  ok('reads the other ways a model writes a status', P.fromCall({ steps: [{ step: 'a', status: 'completed' }, { step: 'b', status: 'in progress' }, { step: 'c', done: true }, { step: 'd', status: 'weird' }] }).steps.map((x) => x.status).join() === 'done,doing,done,todo');
  ok('and a step written as a plain sentence', P.fromCall({ steps: ['Write the test'] }).steps[0].status === 'todo');
  ok('an empty plan is refused, saying what it needs', /steps: a list of \{ step, status \}/.test(P.fromCall({ steps: [] }).error) && !!P.fromCall({}).error && !!P.fromCall({ steps: [{ status: 'todo' }] }).error);
  ok('a plan is kept short', P.fromCall({ steps: Array.from({ length: 40 }, (_, i) => `step ${i}`) }).steps.length === P.MAX_STEPS);
}

console.log('\nWhat the model is told:');
{
  const plan = P.fromCall({ steps: [{ step: 'Add the flag', status: 'done' }, { step: 'Test it', status: 'todo' }] });
  const said = JSON.parse(P.answer(plan));
  ok('the call answers how many steps are open', said.ok === true && said.steps === 2 && said.open === 1 && /open steps/.test(said.note));
  ok('and, when none are, to check the work against the request', /Check the work against the request/.test(JSON.parse(P.answer(P.fromCall({ steps: [{ step: 'x', status: 'done' }] }))).note));
  const back = P.recite(plan);
  ok('the plan is read back while steps are open, marked as from the app', back.startsWith('Note from HashCortX, not from the person:') && /\[x\] Add the flag\n\[ \] Test it$/.test(back));
  ok('and not at all once every step is done, or with no plan', P.recite(P.fromCall({ steps: [{ step: 'x', status: 'done' }] })) === '' && P.recite(null) === '');
  ok('the person sees how far it is', P.stepLine({ steps: [{ step: 'a', status: 'done' }, { step: 'b', status: 'todo' }, { step: 'c', status: 'todo' }] }) === '3 steps, 1 done' && P.stepLine({}) === '');
}

console.log('\nFinishing with steps open:');
{
  const log = V.proofLog();
  log.edited('/p/cli.js');
  const msgs = [{ role: 'system', content: 's' }, { role: 'user', content: 'Add a --json flag and test it' }];
  const plan = P.fromCall({ steps: [{ step: 'Add the flag', status: 'done' }, { step: 'Test it', status: 'todo' }] });
  const back = V.sendBack(log, msgs, 'Added the flag.', { plan, prove: false });
  ok('sends the agent back once, naming the open steps', back && back.kind === 'plan' && /your plan still has open steps: "Test it"/.test(back.message) && V.isAppNote(back.message));
  ok('not a second time', V.sendBack(log, msgs, 'Added the flag.', { plan, prove: false, sent: { plan: 1 } }) === null);
  ok('not when every step is done', V.sendBack(log, msgs, 'Done.', { plan: P.fromCall({ steps: [{ step: 'x', status: 'done' }] }), prove: false }) === null);
  ok('not when the reply asks the person something', V.sendBack(log, msgs, 'Which file should the flag go in?', { plan, prove: false }) === null);
  ok('a change written into the reply and not made comes first', V.sendBack(V.proofLog(), msgs, 'Here it is:\n```js\nexport function toJson(rows) {\n  const out = rows.map((r) => ({ ...r }));\n  return JSON.stringify(out, null, 2);\n}\n```', { plan }).kind === 'make');
  ok('a saved conversation names the step', V.noteStep(back.message) === 'Sent back to finish the steps of its plan');
}

console.log('\nHashCoder:');
{
  const tools = src('platform', 'tauri', 'hashcoder.js');
  ok('offers update_plan, keeping what it was given for the panel and the loop', /name: 'update_plan'/.test(tools) && /HC\.code\.plan = plan;/.test(tools));
  ok('a larger model keeps its plan with the tool, not written out in a reply held to a few sentences', /Complex tasks → keep the plan with update_plan rather than in your reply/.test(tools) && !/announce the plan/.test(tools));
  ok('to a mid-sized model too, but not a small one', /MID_MODEL_TOOLS = \[\.\.\.HC\.code\.SMALL_MODEL_TOOLS, [^\]]*'update_plan'/.test(tools) && !/SMALL_MODEL_TOOLS = \[[^\]]*update_plan/.test(tools));
  const mode = src('modes', 'code', 'mode.js');
  ok('clears the plan for each request', /HC\.code\.plan = null; HC\.code\.asks = asks; HC\.code\.request = task; \}   \/\/ a plan, a checklist and the request's words are for one request/.test(mode));
  ok('reads it back on a copy, never saved', /const told = \[verdict\.nudge, loopNote, window\.HCCodePlan\?\.recite\(HC\?\.code\?\.plan\)\]/.test(mode) && /\[\.\.\.messages, \{ role: 'user', content: told, note: true \}\]/.test(mode));
  ok('and hands it to the finishing checks', /plan: HC\?\.code\?\.plan, asks: HC\?\.code\?\.asks \}\)/.test(mode) && /const sent = \{ make: 0, plan: 0, prove: 0, review: 0, asks: 0, fresh: 0, site: 0, named: 0 \};/.test(mode));
  ok('the run shows the step as a plan, with how far it is', /update_plan: 'PLAN'/.test(mode) && /if \(name === 'update_plan'\) return window\.HCCodePlan\?\.stepLine\(a\)/.test(mode));
  ok('it is loaded before the mode', src('boot.js').indexOf("'/js/code/plan.js'") > 0 && src('boot.js').indexOf("'/js/code/plan.js'") < src('boot.js').indexOf("'/modes/boot.js'"));
}

console.log(`\n${pass} passed, ${fail} failed  (src/js/code/plan.js)`);
process.exit(fail ? 1 : 0);
