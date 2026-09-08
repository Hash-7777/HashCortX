// ==============================================================
// Terminal-colour checks
//
// Loads the REAL src/js/code/ansi.js into a Node VM.
//
// This turns the output of a real command into HTML for the Coder terminal, so
// it is both an escaping surface and a place where a mistake stops the app
// rather than looking wrong. The first check below is the one that matters:
// the reset sequence used to run for ever.
//
// Run with: npm run check:code-ansi
// ==============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const sandbox = { window: {}, console };
vm.createContext(sandbox);
vm.runInContext(readFileSync(join(here, '..', '..', 'src', 'js', 'code', 'ansi.js'), 'utf8'),
  sandbox, { filename: 'ansi.js' });
const { ansiToHtml, stripAnsi } = sandbox.window.HCCodeAnsi;

const E = '\x1b[';
let pass = 0;
let fail = 0;
function ok(label, cond) {
  if (cond) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}`); }
}
const depthOf = (html) => {
  let d = 0, max = 0;
  for (const t of html.match(/<span|<\/span>/g) || []) { d += t === '<span' ? 1 : -1; max = Math.max(max, d); }
  return max;
};

console.log('Colouring something and resetting it finishes:');
{
  // The commonest sequence in terminal output, and the one that never
  // returned: the loop closing the open tags never took any off the stack it
  // was testing, so it ran until the memory did and the app went with it.
  const started = Date.now();
  const out = ansiToHtml(E + '31m' + 'ERROR' + E + '0m' + ' done');
  ok('it returns at all', typeof out === 'string');
  ok('and quickly', Date.now() - started < 1000);
  ok('the coloured part is coloured', /<span style="color:#d98a85">ERROR<\/span>/.test(out));
  ok('the part after the reset is not', out.endsWith(' done'));
  ok('every tag opened is closed', (out.match(/<span/g) || []).length === (out.match(/<\/span>/g) || []).length);

  // Control: the loop as it was, with a cap so this file can still finish.
  let spins = 0;
  const stack = ['span'];
  while (stack.length) { spins++; if (spins > 10000) break; }
  ok('control: the old closing loop never ends on its own', spins > 10000);
}

console.log('\nA reset with no number is still a reset:');
{
  const out = ansiToHtml(E + '31m' + 'red' + E + 'm' + 'plain');
  ok('the text after it is plain', out.endsWith('plain'));
  ok('and it did not hang', typeof out === 'string');
}

console.log('\nColours replace one another rather than nesting:');
{
  // Treating them as nesting grew the markup without limit: a long build log
  // that changed colour on every line ended up thousands of tags deep.
  let log = '';
  for (let i = 0; i < 2000; i++) log += E + (31 + i % 7) + 'm' + 'line ' + i + '\n';
  const html = ansiToHtml(log);
  ok('the markup never nests more than one deep', depthOf(html) === 1);
  ok('it stays a sane size', html.length < log.length * 6);
  ok('every line is still there', /line 1999/.test(html));
  ok('a later colour wins over an earlier one',
    !/color:#d98a85">[^<]*line 1</.test(ansiToHtml(E + '31m' + E + '32m' + 'line 1')));
}

console.log('\nThe colours a modern tool actually emits:');
{
  // These carry their own arguments. Read as codes in their own right, the 2
  // in a true colour was taken for "dim", so a coloured line came out faint
  // and left a tag open behind it.
  const t = ansiToHtml(E + '38;2;255;0;0m' + 'red');
  ok('a true colour is drawn in that colour', t.includes('color:rgb(255,0,0)'));
  ok('and is not dimmed by its own arguments', !t.includes('opacity'));
  ok('and closes cleanly', (t.match(/<span/g) || []).length === (t.match(/<\/span>/g) || []).length);

  const p = ansiToHtml(E + '38;5;196m' + 'red');
  ok('a 256-palette colour is drawn', /color:rgb\(/.test(p));
  ok('and is not dimmed', !p.includes('opacity'));
  ok('a grey from the top of the palette is drawn', /color:rgb\(/.test(ansiToHtml(E + '38;5;240m' + 'grey')));
  ok('a colour out of range does not break it', typeof ansiToHtml(E + '38;5;999m' + 'x') === 'string');
  ok('a true colour with missing arguments does not break it',
    typeof ansiToHtml(E + '38;2m' + 'x') === 'string');
}

console.log('\nThe codes that turn something off:');
{
  ok('39 returns to the default colour', ansiToHtml(E + '31m' + 'red' + E + '39m' + 'plain').endsWith('plain'));
  ok('22 returns to normal weight', !/font-weight/.test(ansiToHtml(E + '1m' + 'a' + E + '22m' + 'b').split('</span>').pop()));
  ok('bold and colour hold together', (() => {
    const out = ansiToHtml(E + '1;32m' + 'ok');
    return out.includes('color:#5fb88a') && out.includes('font-weight:600');
  })());
  ok('dim is still dim', ansiToHtml(E + '2m' + 'faint').includes('opacity:0.6'));
  ok('underline is drawn', ansiToHtml(E + '4m' + 'u').includes('text-decoration:underline'));
}

console.log('\nCommand output cannot put markup on the page:');
{
  // A command can print anything at all, including a tag.
  const attacks = [
    '<script>alert(1)</script>',
    '<img src=x onerror=alert(1)>',
    '"><script>alert(1)</script>',
    "'><img src=x>",
    '</span><script>alert(1)</script>',
  ];
  for (const attack of attacks) {
    const plain = ansiToHtml(attack);
    const coloured = ansiToHtml(E + '31m' + attack);
    ok(`escaped without colour: ${attack.slice(0, 24)}`, !/<(script|img)/i.test(plain));
    ok(`escaped with colour: ${attack.slice(0, 24)}`, !/<(script|img)/i.test(coloured));
  }
  ok('a quote cannot close the style attribute',
    !/style="[^"]*"[^>]*on/i.test(ansiToHtml(E + '31m' + '" onload="alert(1)')));
  ok('an ampersand is escaped once', ansiToHtml('a & b') === 'a &amp; b');
}

console.log('\nOrdinary text passes through unharmed:');
{
  ok('plain text with no escapes is escaped and returned', ansiToHtml('plain <b>x</b>') === 'plain &lt;b&gt;x&lt;/b&gt;');
  ok('an empty string stays empty', ansiToHtml('') === '');
  ok('null does not throw', ansiToHtml(null) === '');
  ok('undefined does not throw', ansiToHtml(undefined) === '');
  ok('a number is rendered', ansiToHtml(42) === '42');
  ok('newlines survive', ansiToHtml('a\nb') === 'a\nb');
  ok('an unfinished escape is left as text', typeof ansiToHtml(E + '31') === 'string');
}

console.log('\nEscape sequences can be removed entirely:');
{
  ok('colour is removed', stripAnsi(E + '31m' + 'red' + E + '0m') === 'red');
  ok('a cursor move is removed', stripAnsi(E + '2J' + E + 'H' + 'text') === 'text');
  ok('plain text is untouched', stripAnsi('plain') === 'plain');
  ok('null comes back as it was', stripAnsi(null) === null);
}

console.log(`\n${pass} passed, ${fail} failed  (src/js/code/ansi.js)`);
process.exit(fail ? 1 : 0);
