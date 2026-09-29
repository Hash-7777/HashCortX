// ============================================================
// Lessons HashCoder keeps about a project — src/js/code/lessons.js,
// and where the Coder uses them. Run with: npm run check:code-lessons
// ============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const src = (...p) => readFileSync(join(here, '..', '..', 'src', ...p), 'utf8');
const box = { window: {} };
vm.createContext(box);
vm.runInContext(process.argv[2] ? readFileSync(process.argv[2], 'utf8') : src('js', 'code', 'lessons.js'), box, { filename: 'lessons.js' });
vm.runInContext(src('js', 'code', 'context.js'), box, { filename: 'context.js' });
const L = box.window.HCCodeLessons;
const C = box.window.HCCodeContext;

let pass = 0, fail = 0;
const ok = (label, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`); }
};
const store = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m }; };

console.log('Keeping a lesson:');
{
  const s = store();
  const saved = L.save(s, '/p/app/', 'Tests run with  npm test; the fixtures live in test/data.', { local: false });
  ok('is kept for its project, tidied, and says when it will be read', saved.ok && /next conversation/.test(saved.note) && L.forProject(s, '/p/app').join() === 'Tests run with npm test; the fixtures live in test/data.');
  ok('a folder is the same folder with or without its last slash, or written with backslashes', L.forProject(s, '/p/app/').length === 1 && L.save(s, 'C:\\w\\app', 'x', {}).ok && L.forProject(s, 'C:/w/app').length === 1);
  ok('the same lesson twice is kept once', L.save(s, '/p/app', 'Tests run with npm test; the fixtures live in test/data.', {}).ok && L.forProject(s, '/p/app').length === 1);
  ok('a lesson names the one it corrects, which goes', L.save(s, '/p/app', 'Tests run with npm run test:unit.', { replaces: 'Tests run with npm test; the fixtures live in test/data.' }).ok && L.forProject(s, '/p/app').join() === 'Tests run with npm run test:unit.');
  for (let i = 0; i < 20; i++) L.save(s, '/p/app', `lesson ${i}`, {});
  const list = L.forProject(s, '/p/app');
  ok(`a project keeps ${L.PER_PROJECT} at most, the newest`, list.length === L.PER_PROJECT && list[list.length - 1] === 'lesson 19' && !list.includes('lesson 0'));
  ok('projects are kept apart', L.forProject(s, '/p/other').length === 0);
}

console.log('\nWhat is never kept:');
{
  const s = store();
  ok('a key', /never kept/.test(L.save(s, '/p', `Use sk-proj-${'a'.repeat(24)} for the tests`, {}).error || ''));
  ok('an email address', /never kept/.test(L.save(s, '/p', 'Ask ops@example.com before deploying', {}).error || ''));
  ok('an empty or long lesson', !!L.save(s, '/p', '  ', {}).error && !!L.save(s, '/p', 'x'.repeat(L.MAX_CHARS + 1), {}).error);
  ok('a lesson with no project open', !!L.save(s, '', 'x', {}).error);
  ok('none of these left anything behind', s.m.size === 0);
}

console.log('\nWho is given them:');
{
  const s = store();
  L.save(s, '/p', 'Learnt on this computer', { local: true });
  L.save(s, '/p', 'Learnt by a cloud model', { local: false });
  ok('a model on this computer, every lesson', L.forProject(s, '/p', { local: true }).length === 2);
  ok('a cloud model, never one a model on this computer kept', L.forProject(s, '/p', { local: false }).join() === 'Learnt by a cloud model');
  const text = L.notes(L.forProject(s, '/p', { local: true }));
  ok('read as lessons written by a model and checked by nobody, to be replaced when wrong', /checked by nobody/.test(text) && /replace it with save_lesson/.test(text) && /- Learnt on this computer/.test(text));
  ok('no lessons, nothing said', L.notes([]) === '' && L.notes(null) === '');
  ok('Forget all lessons removes every one', L.forgetAll(s) && L.forProject(s, '/p', { local: true }).length === 0);
  const turn = C.systemTurn('rules', null, 'full', (t) => t.replace('Learnt', '[marked]'), 'Learnt this');
  ok('they go beside the project\'s notes, marked as any material is', turn.notes === '[marked] this' && turn.content === 'rules');
}

console.log('\nHashCoder:');
{
  const tools = src('platform', 'tauri', 'hashcoder.js');
  ok('save_lesson keeps nothing while lessons are switched off', /if \(!at \|\| !window\.HCCodeLessons\) return JSON\.stringify\(\{ ok: false, error: 'Keeping lessons is switched off in Settings/.test(tools));
  ok('and keeps it where the panel says, saying whether a local model wrote it', /window\.HCCodeLessons\.save\(localStorage, at\.root, p\.text, \{ local: at\.local, replaces: p\.replaces \}\)/.test(tools));
  ok('a small or mid-sized model is never offered it', !/MID_MODEL_TOOLS = \[[^\]]*save_lesson/.test(tools) && !/SMALL_MODEL_TOOLS = \[[^\]]*save_lesson/.test(tools));
  const mode = src('modes', 'code', 'mode.js');
  ok('the panel says where only when switched on, for a large model', /HC\.code\.lessonsFor = cdrPrefs\(\)\.lessons === true && root && size === 'full' \? \{ root, local \} : null;/.test(mode));
  ok('and offers the tool only then', /\.filter\(\(t\) => t\.function\.name !== 'save_lesson' \|\| !!HC\.code\.lessonsFor\)/.test(mode));
  ok('lessons are read into the start of a conversation only when switched on, for the model in use', /cdrPrefs\(\)\.lessons === true && sharedState\.size === 'full' && window\.HCCodeLessons \? window\.HCCodeLessons\.notes\(window\.HCCodeLessons\.forProject\(localStorage, sharedState\.projectRoot, \{ local: sharedState\.local \}\)\) : ''/.test(mode));
  ok('a switch from a model on this computer to a cloud one rebuilds them', /if \(size !== sharedState\.size \|\| local !== sharedState\.local(?: \|\| mapped)?\) \{/.test(mode));
  ok('the switch starts off, and Forget asks first', /lessonsEl\.checked = prefs\.lessons === true;/.test(mode) && /themedConfirm\('Forget every lesson HashCoder kept, for every project\?'/.test(mode));
  const panel = src('core', 'settings', 'panel.html');
  ok('Settings says what is kept, where, and where it never goes', /id="cdrSetLessons" class="check-box" \/>/.test(panel) && !/id="cdrSetLessons"[^>]*checked/.test(panel) && /never in the project/.test(panel) && /never go to a cloud model/.test(panel) && /id="cdrForgetLessons"/.test(panel));
  ok('it is loaded before the mode', src('boot.js').includes("'/js/code/lessons.js'"));
}

console.log(`\n${pass} passed, ${fail} failed  (src/js/code/lessons.js)`);
process.exit(fail ? 1 : 0);
