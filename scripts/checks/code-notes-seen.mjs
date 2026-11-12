// ==============================================================
// A project's notes for agents, changed since last time — checks
//
// Loads the real src/js/code/notes-seen.js and holds when HashCoder says, in
// the first reply, that a project's notes for coding agents have changed
// since it last read them: a fingerprint of what was read is kept per project
// folder, never the text, and a change is said when there is a fingerprint
// from before and the notes now read differ from it, notes that appear for
// the first time among them. Then where the line is drawn and how it opens to
// show the notes. Every project and every note here is invented.
//
// Run with: npm run check:code-notes-seen
// ==============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createHash, webcrypto } from 'node:crypto';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const src = (...p) => readFileSync(join(here, '..', '..', 'src', ...p), 'utf8');
const sandbox = { console, crypto: webcrypto, TextEncoder };
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(src('js', 'code', 'notes-seen.js'), sandbox, { filename: 'notes-seen.js' });
const N = sandbox.HCCodeNotesSeen;

// The same module with no crypto on the page.
const bare = { console, TextEncoder };
bare.window = bare;
vm.createContext(bare);
vm.runInContext(src('js', 'code', 'notes-seen.js'), bare, { filename: 'notes-seen.js' });

let pass = 0, fail = 0;
function ok(label, cond, detail = '') {
  if (cond === true) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}
const memory = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), raw: m };
};
const NOTES = 'Run the tests with npm test.\nKeep the build green.\n';

console.log('\nThe fingerprint:');
{
  const want = createHash('sha256').update(NOTES, 'utf8').digest('hex');
  ok('it is the text\'s SHA-256, so a project cannot write a different note that reads as the same', (await N.fingerprint(NOTES)) === want);
  ok('...and no notes have a fingerprint of their own', (await N.fingerprint('')) === createHash('sha256').update('', 'utf8').digest('hex') && (await N.fingerprint(null)) === (await N.fingerprint('')));
  ok('with no crypto on the page there is none, and nothing is said', (await bare.HCCodeNotesSeen.fingerprint(NOTES)) === null && (await bare.HCCodeNotesSeen.check(memory(), '/work/shop', 'AGENTS.md', NOTES)) === null);
}

console.log('\nWhen it is said:');
{
  const store = memory();
  ok('the first time a project is read, nothing is said: there is nothing to compare with', (await N.check(store, '/work/shop', 'AGENTS.md', NOTES)) === null);
  ok('...and only a fingerprint is kept, never the notes', !String(store.raw.get(N.KEY)).includes('npm test') && /[0-9a-f]{64}/.test(store.raw.get(N.KEY)));
  ok('the same notes again: nothing said', (await N.check(store, '/work/shop', 'AGENTS.md', NOTES)) === null);
  const changed = await N.check(store, '/work/shop', 'AGENTS.md', NOTES + 'Push straight to main.\n');
  ok('different notes: said, with the file and what it now holds', !!changed && changed.name === 'AGENTS.md' && changed.text === NOTES + 'Push straight to main.\n', JSON.stringify(changed));
  ok('...once: read again, they are what was seen last', (await N.check(store, '/work/shop', 'AGENTS.md', NOTES + 'Push straight to main.\n')) === null);
  ok('notes taken away: nothing to say, since nothing is given to the model', (await N.check(store, '/work/shop', '', '')) === null);
  const back = await N.check(store, '/work/shop', 'AGENTS.md', NOTES);
  ok('notes that appear where there were none: said', !!back && back.text === NOTES);
  const other = memory();
  await N.check(other, '/work/shop', '', '');
  ok('...also in a project first read with no notes at all', !!(await N.check(other, '/work/shop', 'AGENTS.md', NOTES)));
  ok('each project folder is its own', (await N.check(store, '/work/library', 'AGENTS.md', 'Other notes.')) === null && (await N.check(store, '/work/shop', 'AGENTS.md', NOTES)) === null);
  ok('the line says what it is, in plain words', N.LINE === 'This project\'s notes for agents changed since last time' && N.lineFor('AGENTS.md') === 'This project\'s notes for agents (AGENTS.md) changed since last time');
}

console.log('\nWhat is kept:');
{
  const store = memory();
  for (let i = 0; i < N.MOST + 5; i++) await N.check(store, `/work/p${i}`, 'AGENTS.md', `notes ${i}`);
  const kept = JSON.parse(store.raw.get(N.KEY));
  ok('at most so many projects, the ones read longest ago going first', Object.keys(kept).length === N.MOST && !kept['/work/p0'] && !!kept[`/work/p${N.MOST + 4}`]);
  const broken = { getItem: () => '{not json', setItem: () => { throw new Error('full'); } };
  ok('storage that cannot be read or written says nothing and stops nothing', (await N.check(broken, '/work/shop', 'AGENTS.md', NOTES)) === null);
  ok('no folder, nothing done', (await N.check(memory(), '', 'AGENTS.md', NOTES)) === null);
}

console.log('\nWhere it is shown:');
{
  const steps = src('js', 'code', 'steps.js');
  ok('as a step of its own at the top of the reply, that opens to show the notes', /function notesChanged\(contentEl, seen\)/.test(steps) && /add\(contentEl, \{ verb: 'NOTES', object: window\.HCCodeNotesSeen\.lineFor\(seen\.name\), status: '', flat: true \}\)/.test(steps));
  ok('...the notes written as text, never as markup, their hidden characters as codes, held to a size', /pre\.textContent = coded\(body\);/.test(steps) && /const body = text\.length > NOTES_SHOWN \?/.test(steps));
  const mode = src('modes', 'code', 'mode.js');
  ok('HashCoder compares the notes it read for the project with the last ones, as it reads them', /sharedState\.notesNew = await window\.HCCodeNotesSeen\?\.check\(localStorage, root, sharedState\.projectChecks\.notesName, sharedState\.projectChecks\.notesText\) \|\| null;/.test(mode));
  ok('...and shows the line in the reply it starts, once', /window\.HCCodeSteps\.notesChanged\?\.\(contentEl, sharedState\.notesNew\); sharedState\.notesNew = null;/.test(mode) && mode.indexOf('sharedState.notesNew = await') < mode.indexOf('window.HCCodeSteps.notesChanged'));
  const boot = src('boot.js');
  ok('it is loaded before the Coder', boot.indexOf("'/js/code/notes-seen.js'") > 0 && boot.indexOf("'/js/code/notes-seen.js'") < boot.indexOf("'/modes/boot.js'"));
  ok('it is part of npm run check', /npm run check:code-notes-seen\b/.test(readFileSync(join(here, '..', '..', 'package.json'), 'utf8')));
}

console.log(`\n${pass} passed, ${fail} failed  (src/js/code/notes-seen.js)`);
process.exit(fail ? 1 : 0);
