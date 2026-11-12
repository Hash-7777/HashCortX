// ==============================================================
// The preview: what a HashCoder run will do, shown before it starts
//
// Loads the real src/js/code/preview.js and holds when the card is shown
// (the setting "Show me the plan first": Never, Big tasks, Always), what it
// says (the asks, the files the app found, its plan once there is one, and
// what it will ask you before doing, by the permission mode and the tools
// the run is given), that only Manual waits for Start, and where it is
// wired. The drawing itself is looked at in a browser. Every request, file
// and step here is invented.
//
// Run with: npm run check:code-preview
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
vm.runInContext(src('js', 'code', 'preview.js'), box, { filename: 'preview.js' });
const P = box.HCCodePreview;

let pass = 0, fail = 0;
function ok(label, cond, detail = '') {
  if (cond === true) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}
const json = (x) => JSON.stringify(x);
const tools = (...names) => names.map((name) => ({ type: 'function', function: { name } }));
const ALL = tools('read_file', 'grep_code', 'write_file', 'patch_file', 'delete_file', 'move_file', 'shell_run', 'fetch_url', 'web_search', 'update_plan');

console.log('\nWhen it is shown:');
ok('the setting has three choices, Big tasks when none was made or the one kept is not known', json(P.PREFS.map((p) => p.id)) === '["never","big","always"]' && P.prefOf(undefined) === 'big' && P.prefOf('sometimes') === 'big' && P.prefOf('always') === 'always');
ok('Never: never; Always: for every request', !P.wanted('never', { asks: 5, whole: false }) && P.wanted('always', { asks: 0, whole: true }));
ok('Big tasks: a request of three asks or more, or a project too large to show whole', P.wanted('big', { asks: 3, whole: true }) && P.wanted('big', { asks: 0, whole: false }) && !P.wanted('big', { asks: 2, whole: true }) && !P.wanted(undefined, { asks: 0, whole: true }));

console.log('\nWhat it will ask you before doing:');
ok('Manual: changing a file, running a command, reading a web page', json(P.questions('ask', ALL)) === '["changing a file","running a command","reading a web page or a search"]', json(P.questions('ask', ALL)));
ok('Accept edits: a command, a deletion or a move, a web page; never an edit inside the project', json(P.questions('edits', ALL)) === '["running a command","deleting a file, or moving one out of the project","reading a web page or a search"]', json(P.questions('edits', ALL)));
ok('Auto: a command that is not a read, a search or the project\'s own checks, a deletion or a move, a web page', json(P.questions('auto', ALL)) === '["running a command other than a read, a search or the project\'s own checks","deleting a file, or moving one out of the project","reading a web page or a search"]', json(P.questions('auto', ALL)));
ok('...only for the tools this run is given: no web tools, no web page; no tools at all, nothing', json(P.questions('ask', tools('read_file', 'write_file', 'shell_run'))) === '["changing a file","running a command"]' && json(P.questions('ask', [])) === '[]');
ok('...and in light mode, where the app writes each file itself, writing each file', json(P.questions('auto', [], true)) === '["writing each file"]');
ok('...and in light mode, where the app writes each file itself, writing each file', json(P.questions('auto', [], true)) === '["writing each file"]');
ok('...and a mode not known is read as Manual, the mode that asks most', json(P.questions(undefined, ALL)) === json(P.questions('ask', ALL)));

console.log('\nWhat it says:');
const found = { by: 'search', files: [{ path: 'src/pricing/bundle.js' }, { path: 'src/pricing/index.js' }, { path: 'src/pricing/bundle.js' }] };
const p = P.preview({ asks: ['Fix the discount', 'Add a test for it', 'Rename priceFor'], found, plan: null, mode: 'ask', tools: ALL });
ok('the asks, the files the app found (each once), no plan yet, and the questions', json(p.asks) === '["Fix the discount","Add a test for it","Rename priceFor"]' && json(p.files) === '["src/pricing/bundle.js","src/pricing/index.js"]' && json(p.plan) === '[]' && p.questions.length === 3, json(p));
ok('only Manual waits for Start; every other mode shows it and carries on', p.waits === true && P.preview({ mode: 'edits', tools: ALL }).waits === false && P.preview({ mode: 'auto', tools: ALL }).waits === false);
ok('its plan, once the model has written one, step by step with what is done', json(P.preview({ plan: { steps: [{ step: 'Read bundle.js', status: 'done' }, { step: 'Change the discount', status: 'pending' }] } }).plan) === '[{"step":"Read bundle.js","done":true},{"step":"Change the discount","done":false}]');
ok('fewer than three asks are not listed: the request is shown whole just above', json(P.preview({ asks: ['Fix it', 'Test it'] }).asks) === '[]');
ok('its one line, once folded: asks, files, plan', P.line(p) === '3 asks · 2 files found' && P.line(P.preview({ plan: { steps: [{ step: 'a', status: 'done' }, { step: 'b' }] } })) === 'a plan of 2 steps, 1 done' && P.line(P.preview({})) === '');
ok('nothing given, nothing guessed', json(P.preview()) === json({ asks: [], files: [], plan: [], questions: [], waits: true }));

console.log('\nWhere it is drawn:');
const preview = src('js', 'code', 'preview.js'), mode = src('modes', 'code', 'mode.js'), view = src('js', 'run-view.js'), css = src('modes', 'code', 'mode.css');
ok('the mode keeps what the app\'s finder found, and shows the card after it and before the run\'s first step', /sharedState\.found = null; if \(tools\.length && window\.HCCodeFind\) \{ setStatus\('Finding the files this needs…', 'thinking'\); sharedState\.found = await window\.HCCodeFind\.before\(conversationMsgs, \{/.test(mode) && /await window\.HCCodePreview\?\.before\(contentEl, \{ pref: cdrPrefs\(\)\.preview, asks: HC\.code\.asks, whole: sharedState\.codeMap\?\.root === sharedState\.projectRoot \? sharedState\.codeMap\.whole !== false : true, found: sharedState\.found, mode: HC\.guard\?\.mode\?\.\(\), tools, light: sharedState\.light, signal, status: setStatus \}\); const finalText = await agentLoop\(conversationMsgs, tools, contentEl/.test(mode));
ok('waiting for Start ends with Stop, as a stopped run, with nothing changed', /signal\.addEventListener\('abort', \(\) => \{[^}]*reject\(new DOMException\('Aborted', 'AbortError'\)\)/.test(preview) && /if \(signal && signal\.aborted\) throw new DOMException\('Aborted', 'AbortError'\);/.test(preview));
ok('...and Start never takes the keyboard from the box a message is typed in', !/\.focus\(/.test(preview));
ok('each step brings its plan up to date, and the first change folds it to one line', /window\.HCCodePreview\?\.onStep\(contentEl, phase\);/.test(view) && /if \(phase === 'changing' \|\| phase === 'end'\) fold\(card, true\);/.test(preview) && /window\.HCCodePreview\?\.onStep\(contentEl, 'end'\);/.test(view));
ok('the card becomes the brief: once the brief is drawn, its asks are said there and not twice; the brief goes under the card', /card\.classList\.toggle\('has-brief', !!contentEl\.querySelector\('\.cdr-brief'\)\);/.test(preview) && /\.cdr-preview\.has-brief \.cdr-preview-asks \{ display: none; \}/.test(css) && /contentEl\.insertBefore\(box, top \? top\.nextSibling : contentEl\.firstChild\)/.test(view));
ok('...and while it waits for Start, the card alone says it: the brief under it is hidden until it starts', /card\.classList\.add\('is-waiting'\);/.test(preview) && /\.cdr-preview\.is-waiting ~ \.cdr-brief \{ display: none; \}/.test(css) && (preview.match(/card\.classList\.remove\('is-waiting'\)/g) || []).length === 2);
ok('...and nothing turns while it waits: the phase mark stands still until Start', /\.cdr-msg\.running \.cdr-preview\.is-waiting ~ \.cdr-steps \.cdr-phase\.now \.cdr-reticle svg \{ animation: none; \}/.test(css));
ok('Settings has the choice, kept with HashCoder\'s other settings', /id="cdrSetPreview"/.test(src('core', 'settings', 'panel.html')) && /window\.HCCodePreview\?\.wire\(\$\('cdrSetPreview'\), prefs\.preview, \(v\) => cdrSavePrefs\(\{ preview: v \}\)\);/.test(mode));
ok('nothing in it moves', !/\.cdr-preview[^{]*\{[^}]*(?:animation|transition)(?!: none)/.test(css));
const boot = src('boot.js');
ok('it is loaded after the run view and before the modes', boot.indexOf("'/js/code/preview.js'") > boot.indexOf("'/js/run-view.js'") && boot.indexOf("'/js/code/preview.js'") < boot.indexOf("'/modes/boot.js'"));
ok('it is part of npm run check', /npm run check:code-preview\b/.test(readFileSync(join(here, '..', '..', 'package.json'), 'utf8')));

console.log(`\n${pass} passed, ${fail} failed  (src/js/code/preview.js)`);
process.exit(fail ? 1 : 0);
