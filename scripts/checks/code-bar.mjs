// ==============================================================
// HashCoder's top bar — checks
//
// A message in the bar's status is as long as the provider's own words, and the
// bar is a row: the project, the status, the model picker, the buttons. The
// status was written not to wrap and nothing in the row was allowed to shrink
// or clip, so a long message ran on past its place and under the controls to
// its right. These hold that the status alone gives way, is cut with an
// ellipsis, and keeps the whole message as its title, and that nothing else in
// the left of the bar shrinks in its place.
//
// The layout itself is measured in a browser, not here; this reads the rules.
//
// Run with: npm run check:code-bar
// ==============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const src = (...p) => readFileSync(join(here, '..', '..', 'src', ...p), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

let pass = 0;
let fail = 0;
function ok(label, cond, detail = '') {
  if (cond) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}

const css = src('modes', 'code', 'mode.css');
/** The declarations of the first rule whose selector list is exactly `selector`. */
const rule = (selector) => {
  const esc = selector.replace(/[.*+?^${}()|[\]\\>]/g, '\\$&').replace(/\s+/g, '\\s*');
  const m = new RegExp(`(?:^|\\})\\s*${esc}\\s*\\{([^}]*)\\}`, 'm').exec(css);
  return m ? m[1] : '';
};

console.log('The status gives way, and nothing else in the left of the bar does:');
{
  const status = rule('.cdr-status');
  ok('the status may shrink below its text', /min-width:\s*0/.test(status) && /flex:\s*0 1 auto/.test(status), status.trim());
  const word = rule('.cdr-status-word');
  ok('and its words are cut with an ellipsis', /overflow:\s*hidden/.test(word) && /text-overflow:\s*ellipsis/.test(word), word.trim());
  ok('it still does not wrap', /white-space:\s*nowrap/.test(status));
  const left = rule('.cdr-top-left');
  ok('the left of the bar takes the room the right leaves', /flex:\s*1 1 auto/.test(left), left.trim());
  ok('and everything in it but the status keeps its size', /\.cdr-top-left\s*>\s*:not\(\.cdr-status\)\s*\{\s*flex-shrink:\s*0/.test(css));
  ok('the right of the bar is not made to shrink', /\.cdr-top-right\s*\{[^}]*flex:\s*none/.test(css));
}

console.log('\nNothing is lost by cutting it:');
{
  const mode = src('modes', 'code', 'mode.js');
  ok('the whole message is the status\'s title', /txt\.textContent = text \|\| 'Ready'; txt\.title = text \|\| '';/.test(mode));
  ok('and the status is still read out as it changes', /class="cdr-status" aria-live="polite"/.test(src('modes', 'code', 'panel.html')));
}

console.log(`\n${pass} passed, ${fail} failed  (src/modes/code/mode.css)`);
process.exit(fail ? 1 : 0);
