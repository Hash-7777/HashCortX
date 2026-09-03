// ==============================================================
// Line-diff checks
//
// Loads the REAL src/js/diff.js into a Node VM. The diff is what the Coder
// panel shows a user before they decide whether to keep a change the agent
// already made, so "it looked right on one example" is not good enough: a diff
// that quietly drops a line is worse than no diff, because it is believed.
//
// Run with: npm run check:diff
// ==============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, '..', '..', 'src', 'js', 'diff.js'), 'utf8');
const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(src, sandbox, { filename: 'diff.js' });
const D = sandbox.window.HCDiff;

let pass = 0;
let fail = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log(`  ok    ${label}`); }
  else {
    fail++;
    console.log(`  FAIL  ${label}\n          wanted ${JSON.stringify(want)}\n          got    ${JSON.stringify(got)}`);
  }
}
function ok(label, cond) {
  if (cond) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}`); }
}

// The property that matters most: rebuilding each side from the rows must give
// back exactly the text that went in. If that holds, the diff cannot be hiding
// or inventing a line.
function rebuild(rows, side) {
  return rows
    .filter(r => (side === 'before' ? r.type !== 'add' : r.type !== 'del'))
    .map(r => r.text)
    .join('\n');
}

console.log('\nBoth files can be rebuilt from the diff, exactly:');
for (const [label, before, after] of [
  ['one line changed in the middle', 'a\nb\nc\nd\ne', 'a\nb\nCHANGED\nd\ne'],
  ['a line added at the top', 'a\nb', 'new\na\nb'],
  ['a line added at the end', 'a\nb', 'a\nb\nnew'],
  ['a line removed', 'a\nb\nc', 'a\nc'],
  ['everything replaced', 'a\nb\nc', 'x\ny\nz'],
  ['empty to content — a new file', '', 'a\nb'],
  ['content to empty — everything deleted', 'a\nb', ''],
  ['identical files', 'a\nb\nc', 'a\nb\nc'],
  ['repeated lines', 'x\nx\nx', 'x\nx'],
  ['indentation only', '  a\n  b', '    a\n  b'],
  ['trailing blank line added', 'a\nb', 'a\nb\n'],
]) {
  const rows = D.diffLines(before, after);
  const norm = (s) => String(s).replace(/\r\n/g, '\n');
  check(`${label} — before`, rebuild(rows, 'before'), norm(before));
  check(`${label} — after`, rebuild(rows, 'after'), norm(after));
}

console.log('\nWindows line endings are not reported as a whole-file change:');
{
  const rows = D.diffLines('a\r\nb\r\nc', 'a\nb\nc');
  const { added, removed } = D.countChanges(rows);
  check('same text, different line endings', { added, removed }, { added: 0, removed: 0 });
}

console.log('\nThe change counts are the ones a reader would count:');
{
  const rows = D.diffLines('a\nb\nc', 'a\nB\nc');
  check('one line edited is one added and one removed', D.countChanges(rows), { added: 1, removed: 1 });
}
{
  const rows = D.diffLines('a\nb', 'a\nb\nc\nd');
  check('two lines appended', D.countChanges(rows), { added: 2, removed: 0 });
}
{
  const rows = D.diffLines('', 'a\nb\nc');
  check('a brand new file is all additions', D.countChanges(rows), { added: 3, removed: 0 });
}

console.log('\nLine numbers point at the right side of the change:');
{
  const rows = D.diffLines('a\nb\nc', 'a\nB\nc');
  const del = rows.find(r => r.type === 'del');
  const add = rows.find(r => r.type === 'add');
  ok('a removed line carries its old number and no new one', del.beforeNo === 2 && del.afterNo === null);
  ok('an added line carries its new number and no old one', add.afterNo === 2 && add.beforeNo === null);
  const same = rows.filter(r => r.type === 'same');
  ok('unchanged lines carry both numbers', same.every(r => r.beforeNo != null && r.afterNo != null));
}

console.log('\nA large rewrite still returns every line, without matching them one by one:');
{
  const big = Array.from({ length: D.MAX_MATCHED_LINES + 50 }, (_, i) => `old ${i}`).join('\n');
  const big2 = Array.from({ length: D.MAX_MATCHED_LINES + 50 }, (_, i) => `new ${i}`).join('\n');
  const t0 = Date.now();
  const rows = D.diffLines(big, big2);
  const ms = Date.now() - t0;
  check('before rebuilds', rebuild(rows, 'before'), big);
  check('after rebuilds', rebuild(rows, 'after'), big2);
  ok(`it does not hang (${ms}ms)`, ms < 3000);
}

console.log('\nA small edit in a long file is not shown as the whole file:');
{
  const lines = Array.from({ length: 400 }, (_, i) => `line ${i}`);
  const before = lines.join('\n');
  const after = lines.slice();
  after[200] = 'line 200 CHANGED';
  const rows = D.diffLines(before, after.join('\n'));
  const collapsed = D.collapseUnchanged(rows, 3);
  ok('the collapsed view is far shorter than the file', collapsed.length < 20);
  ok('it says how many lines it hid', collapsed.some(r => r.type === 'gap' && r.hidden > 100));
  const shown = collapsed.filter(r => r.type === 'add' || r.type === 'del');
  ok('every changed line is still shown', shown.length === 2);
}

console.log('\nNothing is collapsed away when everything changed:');
{
  const rows = D.diffLines('a\nb', 'x\ny');
  const collapsed = D.collapseUnchanged(rows, 3);
  ok('no gap markers', !collapsed.some(r => r.type === 'gap'));
  ok('all four rows kept', collapsed.length === 4);
}

console.log('\nWord diff — what changed when a message is edited:');
{
  const { parts, truncated } = D.diffWords('the quick brown fox', 'the slow brown fox');
  ok('unchanged words kept once', parts.filter(p => p.type === 'same').map(p => p.word).join(' ') === 'the brown fox');
  ok('the replaced word is marked removed', parts.some(p => p.type === 'del' && p.word === 'quick'));
  ok('the new word is marked added', parts.some(p => p.type === 'add' && p.word === 'slow'));
  ok('a short edit is not called cut short', truncated === false);
  ok('reading the added and same words back gives the new text',
    parts.filter(p => p.type !== 'del').map(p => p.word).join(' ') === 'the slow brown fox');
  ok('reading the removed and same words back gives the old text',
    parts.filter(p => p.type !== 'add').map(p => p.word).join(' ') === 'the quick brown fox');
}

{
  ok('two identical texts produce no marked words',
    D.diffWords('same text', 'same text').parts.every(p => p.type === 'same'));
  ok('empty on both sides produces nothing', D.diffWords('', '').parts.length === 0);
  ok('null and undefined are treated as empty', D.diffWords(null, undefined).parts.length === 0);
  ok('runs of whitespace do not become empty words',
    D.diffWords('a  \n  b', 'a b').parts.every(p => p.word.trim().length > 0));
}

console.log('\nA diff cut short says so — including when exactly one word is dropped:');
{
  const words = (n) => Array.from({ length: n }, (_, i) => 'w' + i).join(' ');
  const max = D.MAX_DIFFED_WORDS;
  ok(`exactly ${max} words is complete`, D.diffWords(words(max), words(max)).truncated === false);
  ok(`${max + 1} words says cut short`, D.diffWords(words(max + 1), words(max)).truncated === true);
  ok('a long side on the right also says cut short', D.diffWords(words(max), words(max + 1)).truncated === true);
  ok(`no more than ${max} words are compared`, D.diffWords(words(400), words(400)).parts.length <= max);

  // Control: the test this replaced joined the dropped words and asked whether
  // the join held a space. One dropped word has no space, so it answered "no".
  // If this control ever passes, the old mistake is back.
  const oldTest = (a, b) => /\s/.test(String(a).trim().split(/\s+/).slice(max).join(' ')) ||
    /\s/.test(String(b).trim().split(/\s+/).slice(max).join(' '));
  ok('control: the join-and-look-for-a-space test misses a single dropped word',
    oldTest(words(max + 1), words(max)) === false);
}

console.log(`\n${pass} passed, ${fail} failed  (src/js/diff.js)`);
process.exit(fail ? 1 : 0);
