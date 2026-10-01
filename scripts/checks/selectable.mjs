// ==============================================================
// What a person can copy — checks
//
// The app is built like a native one: nothing on it can be selected unless it
// is opted in, so a button's label or a tab's name is never dragged into a
// selection. The conversations are opted in, and a panel left off the list
// cannot be copied from at all, with nothing to say why. HashCoder's was: its
// messages, its steps and its errors could not be selected, and the right-click
// menu that copies was blocked there too.
//
// Two lists have to name the same places: the styles that allow selecting, and
// the places the context menu may open (src/main.js). These hold that they
// agree, that each place named exists in the app, and that what is clicked
// rather than read inside them stays unselectable.
//
// The cascade itself is measured in a browser, not here.
//
// Run with: npm run check:selectable
// ==============================================================
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', 'src');
const read = (...p) => readFileSync(join(root, ...p), 'utf8');

let pass = 0;
let fail = 0;
function ok(label, cond, detail = '') {
  if (cond) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}

const styles = read('styles.css');
const block = (styles.match(/\/\* Every conversation and result[\s\S]*?\*\/\s*([^{]+)\{\s*user-select: text;/) || [])[1] || '';
// Each place is written as what is inside it (`.x *`), so no selector is a copy of one a panel's own sheet has.
const inCss = block.split(',').map((s) => s.trim()).filter((s) => / \*$/.test(s)).map((s) => s.replace(/ \*$/, ''));

const guard = (read('main.js').match(/const ok = t\.closest\('([^']+)'\)/) || [])[1] || '';
const inGuard = guard.split(',').map((s) => s.trim());

console.log('The two lists name the same places:');
{
  ok('the styles name the conversations', inCss.length >= 7, inCss.join(' '));
  ok('every one is a place a context menu may open on', inCss.every((s) => inGuard.includes(s)), inCss.filter((s) => !inGuard.includes(s)).join(' '));
  ok('and every one of those in the menu list is selectable, apart from the long-standing ones',
    inGuard.filter((s) => !['input', 'textarea', '[contenteditable="true"]', '.messages .msg .bubble', 'pre', 'code', '.selectable'].includes(s)).every((s) => inCss.includes(s)),
    inGuard.filter((s) => !inCss.includes(s)).join(' '));
  ok('and none is written as the container alone, which a panel\'s own sheet already has', !block.split(',').map((x) => x.trim()).some((x) => x && !/ \*$/.test(x)));
}

console.log('\nEach place named is in the app:');
{
  const files = [];
  (function walk(dir) {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (/vendor|node_modules|wheels|models|assets/.test(full)) continue;
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(html|js)$/.test(name) && !/styles\.css|main\.js/.test(name)) files.push(full);
    }
  })(root);
  const text = files.map((f) => readFileSync(f, 'utf8')).join('\n');
  for (const sel of inCss) {
    const name = sel.replace(/^[.#]/, '');
    const bare = name.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
    ok(`${sel} is in the markup or the code that draws it`, new RegExp(`(^|[^\\w-])${bare}([^\\w-]|$)`).test(text), name);
  }
}

console.log('\nWhat is clicked rather than read is left alone:');
{
  ok('the app as a whole still cannot be selected', /html,body\s*\{[^}]*user-select:\s*none/.test(styles));
  ok('a button or a step\'s heading inside a conversation is not selected by dragging across it',
    /#messages button, #messages summary, \.cdr-messages button, \.cdr-messages summary,[^{]*\{\s*user-select: none;/.test(styles));
}

console.log(`\n${pass} passed, ${fail} failed  (src/styles.css)`);
process.exit(fail ? 1 : 0);
