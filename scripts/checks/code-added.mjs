// ==============================================================
// A message sent while HashCoder works — checks
//
// Loads the real src/js/code/added.js, with the real asks module it reads,
// and holds how a message the person sends while a run works is taken: a
// correction to the work in hand, a new request for after it, or an addition
// to it. The person's own choice always wins over this guess; the guess only
// decides what is chosen to begin with. Every request, file and message here
// is invented.
//
// Run with: npm run check:code-added
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
for (const f of [['js', 'fences.js'], ['js', 'code', 'asks.js'], ['js', 'code', 'added.js']]) vm.runInContext(src(...f), box, { filename: f[f.length - 1] });
const D = box.HCCodeAdded;

// The same module alone, to show it stands without the asks module.
const bare = { console };
bare.window = bare;
vm.createContext(bare);
vm.runInContext(src('js', 'code', 'added.js'), bare, { filename: 'added.js' });

let pass = 0, fail = 0;
function ok(label, cond, detail = '') {
  if (cond === true) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}

const facts = {
  request: 'Fix the discount on bundles so it applies once per order, and rename priceFor to priceOf everywhere.',
  plan: ['Change bundleDiscount to count the order once', 'Rename priceFor across the cart files'],
  changed: ['/work/shop/src/pricing/bundle.js', '/work/shop/src/cart/total.js'],
};
const kind = (text) => D.kindOf(text, facts);

console.log('\nA correction to the work in hand:');
for (const t of ['Stop, that is the wrong file.', 'wait — leave the cart alone', 'No, not that function.', 'Not that one, the bundle total.', 'Undo the change to total.js', 'Revert the rename please', "Don't touch the tests.", 'Do not rename the export.', 'Use a map instead.', 'That is wrong, the discount is per bundle.', 'Keep going, but no, the tax stays as it is.']) {
  ok(`"${t}"`, kind(t) === 'correct', kind(t));
}
ok('...a word inside another word is not one ("stopwatch", "nowhere", "insteadly")', kind('Add a stopwatch to the bundle page') !== 'correct' && kind('the bundle total is nowhere on the page, add it') !== 'correct');

console.log('\nA new request, for after this work:');
for (const t of ['Then write a README for the whole repository.', 'Can you also set up a deploy script for the server?', 'Afterwards add dark mode to the settings screen.']) {
  ok(`"${t}"`, kind(t) === 'after', kind(t));
}

console.log('\nAn addition to the work in hand:');
for (const t of ['Also keep the old priceFor export working.', 'Make sure the bundle discount shows on the receipt too.', 'And round the order total to two places.', 'Add a test for the bundle discount.']) {
  ok(`"${t}"`, kind(t) === 'add', kind(t));
}
ok('a word from a file the run changed ties a message to the work', kind('Also update total.js comments.') === 'add' && kind('Write the changelog entry for the cart.') === 'add');
ok('a message that asks for nothing is not a new request ("thanks", "looks good")', kind('thanks!') === 'add' && kind('looks good so far') === 'add');
ok('nothing, or nothing known about the run, is an addition, never dropped', kind('') === 'add' && D.kindOf('Then write a README for the whole repository.', {}) === 'after' && D.kindOf('Also round the total.', null) === 'add');

console.log('\nWhat it is and is not:');
ok('three kinds, each with what it means in plain words', JSON.stringify(D.KINDS) === JSON.stringify(['correct', 'add', 'after']) && D.KINDS.every((k) => typeof D.SAYS[k] === 'string' && D.SAYS[k].length > 8));
ok('the same message and run always give the same kind', kind('Use a map instead.') === kind('Use a map instead.'));
ok('without the asks module, a message that would be for after stays an addition: it is never held back on a guess it cannot make', bare.HCCodeAdded.kindOf('Then write a README for the whole repository.', facts) === 'add' && bare.HCCodeAdded.kindOf('Stop, wrong file.', facts) === 'correct');
const boot = src('boot.js');
ok('it is loaded after the asks module it reads, before the Coder', boot.indexOf("'/js/code/added.js'") > boot.indexOf("'/js/code/asks.js'") && boot.indexOf("'/js/code/added.js'") < boot.indexOf("'/modes/boot.js'"));
ok('it is part of npm run check', /npm run check:code-added\b/.test(readFileSync(join(here, '..', '..', 'package.json'), 'utf8')));

console.log(`\n${pass} passed, ${fail} failed  (src/js/code/added.js)`);
process.exit(fail ? 1 : 0);
