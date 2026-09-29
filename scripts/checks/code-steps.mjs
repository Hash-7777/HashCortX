// ============================================================
// The steps of a HashCoder run, as the reply shows them —
// src/js/code/steps.js, the live line (src/js/code/live.js), and where
// the Coder uses them. Run with: npm run check:code-steps
// ============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const src = (...p) => readFileSync(join(here, '..', '..', 'src', ...p), 'utf8');
const box = { window: {} };
vm.createContext(box);
vm.runInContext(process.argv[2] ? readFileSync(process.argv[2], 'utf8') : src('js', 'code', 'steps.js'), box, { filename: 'steps.js' });
const S = box.window.HCCodeSteps;

let pass = 0, fail = 0;
const ok = (label, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`); }
};

console.log('The line a run folds to:');
ok('how many steps, one or many', S.stepsLine(1) === '1 step' && S.stepsLine(12) === '12 steps' && S.stepsLine(0) === '0 steps');
ok('and how many failed, only when some did', S.stepsLine(3, 1) === '3 steps · 1 failed' && S.stepsLine(3, 0) === '3 steps');
ok('nonsense counts read as none', S.stepsLine('x', -2) === '0 steps');
ok('the changes are headed with what is asked of the person', S.changesTitle(1) === '1 change — keep or undo' && S.changesTitle(3) === '3 changes — keep or undo');

const steps = src('js', 'code', 'steps.js');
console.log('\nWhat a step is:');
ok('a <details>, so it opens from the keyboard, with its verb, object and result', /document\.createElement\('details'\)/.test(steps) && /cdr-step-verb[\s\S]*cdr-step-object[\s\S]*cdr-step-result/.test(steps));
ok('its verb and object are written as text, never as markup', /\$\{esc\(verb\)\}/.test(steps) && /\$\{esc\(object\)\}/.test(steps) && /title="\$\{esc\(object\)\}"/.test(steps));
ok('it joins the list the reply ends with, or starts one', /last\.classList\.contains\('cdr-steps'\) && !last\.classList\.contains\('done'\)/.test(steps));
ok('a finished run folds each list to its line, and the heading opens it again', /group\.classList\.add\('done'\)/.test(steps) && /head\.textContent = stepsLine\(/.test(steps) && /group\.classList\.toggle\('open'\)/.test(steps) && /setAttribute\('aria-expanded'/.test(steps));
ok('its changes are gathered under the answer, so folding never hides Keep and Undo', /querySelectorAll\('\.cdr-steps-list > \.cdr-step--change'\)/.test(steps) && /box\.className = 'cdr-changes'/.test(steps));

const live = src('js', 'code', 'live.js');
console.log('\nThe one sign of work:');
ok('the live line is a turning ring and its label, read out as a status', /class="cdr-live-status" role="status"><span class="cdr-live-ring" aria-hidden="true">/.test(live));
const css = src('modes', 'code', 'mode.css');
ok('the ring turns and the label is drawn in a moving light', /\.cdr-live-ring \{[^}]*animation: cdr-spin/.test(css) && /\.cdr-live-label \{[^}]*animation: cdr-shimmer/.test(css));
ok('...and neither moves for someone who asked for less motion', /prefers-reduced-motion: reduce\) \{[^}]*\.cdr-live-ring, \.cdr-live-label \{ animation: none; \}/.test(css));
ok('the dot beside the status in the bar stays still', /\.cdr-status-dot\.thinking, \.cdr-status-dot\.run, \.cdr-status-dot\.running \{ background: var\(--accent-2\); \}/.test(css) && !/cdr-pulse/.test(css) && !/cdr-live-dot/.test(live + css));
ok('a folded list is hidden, and a step in a list is a short line', /\.cdr-steps\.done:not\(\.open\) \.cdr-steps-list \{ display: none; \}/.test(css) && /\.cdr-steps-list \.cdr-step-head \{[^}]*min-height: 22px/.test(css));
ok('copy, reply and regen wait for the answer', /\.cdr-msg\.running \.cdr-msg-actions \{ display: none; \}/.test(css));

const mode = src('modes', 'code', 'mode.js');
console.log('\nHashCoder:');
ok('draws every step through it, and settles a reply when its run ends, however it ends',
  /const el = window\.HCCodeSteps\.add\(contentEl, step\);/.test(mode) && /bubble\?\.classList\.add\('running'\);/.test(mode) && /\} finally \{\n\s+settleSteps\(contentEl\);\n\s+bubble\?\.classList\.remove\('running'\);/.test(mode));
ok('a saved conversation is drawn as a finished run reads', /msgs\.querySelectorAll\('\.cdr-msg\.assistant \.cdr-msg-content'\)\.forEach\(settleSteps\);/.test(mode));
ok('changes left from a last session keep their own list', /appendStep\(group, \{\n\s+flat: true,/.test(mode));
ok('a change row takes the place of the step that made it', /if \(ok && \['write_file', 'patch_file', 'delete_file', 'move_file'\]\.includes\(call\.name\)\) toolEl\?\.remove\(\);/.test(mode));
ok('the bar says Running, not a second Thinking', !/setStatus\([^)]*Thinking/.test(mode.replace(/async function legacyRun[\s\S]*?\n  \}\n/, '')) && /setStatus\('Running', 'thinking'\);/.test(mode));
ok('files are named from the project\'s folder, the folder itself by its name', /if \(place\) return shownPath\(place\);/.test(mode) && /return `\$\{root\.split\(\/\[\\\\\/\]\/\)\.pop\(\)\}\/`;/.test(mode));
const boot = src('boot.js');
ok('it is loaded before the modes', boot.indexOf("'/js/code/steps.js'") > 0 && boot.indexOf("'/js/code/steps.js'") < boot.indexOf("'/modes/boot.js'"));

console.log(`\n${pass} passed, ${fail} failed  (src/js/code/steps.js)`);
process.exit(fail ? 1 : 0);
