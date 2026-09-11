// ==============================================================
// Trace copy checks
//
// A run's trace is where a failure explains itself, and the application
// switches text selection off everywhere by default. These hold that every
// mode's trace is granted selection back, that the Agent Swarm, the Systems
// run log and the Forge each have a Copy button wired to it, and that a trace
// reads out as one line per row.
//
// Run with: npm run check:trace-copy
// ==============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const src = (...p) => readFileSync(join(here, '..', '..', 'src', ...p), 'utf8');
const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(src('js', 'trace-copy.js'), sandbox, { filename: 'trace-copy.js' });
const T = sandbox.window.HCTraceCopy;

let pass = 0;
let fail = 0;
function ok(label, cond) {
  if (cond) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}`); }
}

// A stand-in for the few DOM surfaces the reader touches.
const cell = (text) => ({ textContent: text });
const row = (...texts) => ({ children: texts.map(cell) });
const host = (rows) => ({ querySelectorAll: () => rows });

console.log('A trace as text:');
ok('a row reads its cells in order', T.rowText(row('[0.2s]', 'God Agent', 'failed')) === '[0.2s]  God Agent  failed');
ok('an icon cell with no text is left out', T.rowText(row('[1.0s]', '', 'done')) === '[1.0s]  done');
ok('a cell broken over lines is one line', T.rowText(row('a\n  b')) === 'a b');
const now = new Date(2026, 8, 11, 9, 30);
const text = T.asText(host([row('[0.0s]', 'Agent', 'start'), row('[1.5s]', 'Done', 'finished')]), { rowSelector: '.x', title: 'Run log', now });
ok('the text is headed with the run it came from', text.startsWith('Run log  ·  '));
ok('every row is a line of its own', text.includes('\n[0.0s]  Agent  start\n[1.5s]  Done  finished\n'));
ok('an empty trace gives nothing to copy', T.asText(host([]), { rowSelector: '.x' }) === '');
ok('no trace at all gives nothing to copy', T.asText(null, { rowSelector: '.x' }) === '');

console.log('\nEvery trace can be selected:');
const selectable = (css, sel) => new RegExp(`${sel.replace(/[.*]/g, (c) => `\\${c}`)}[^{]*\\{[^}]*user-select:\\s*text`).test(css);
ok('the Agent Swarm trace', selectable(src('modes', 'agent-maker', 'mode.css'), '.amk-trace-entries *'));
ok('the Systems run log', selectable(src('modes', 'systems', 'mode.css'), '.sys-trace-entries *'));
ok('the Forge trace', selectable(src('modes', 'forge', 'mode.css'), '.frg-trace-entries *'));
ok('the Coder trace', selectable(src('modes', 'code', 'mode.css'), '.cdr-trace-entries *'));
ok('the Virtual OS trace', selectable(src('modes', 'virtual-os', 'mode.css'), '.void-trace-entries *'));

console.log('\nEvery trace with a Copy button copies it:');
ok('the Agent Swarm has a Copy button', /id="amkTraceCopyBtn"/.test(src('modes', 'agent-maker', 'panel.html')));
ok('... wired to its trace rows', /HCTraceCopy\.wire\(document\.getElementById\("amkTraceCopyBtn"\)[\s\S]{0,200}rowSelector: "\.amk-trace-entry"/.test(src('modes', 'agent-maker', 'mode.js')));
ok('the Systems run log has a Copy button', /id="sysTraceCopyBtn"/.test(src('modes', 'systems', 'panel.html')));
ok('... wired to its log rows', /HCTraceCopy\.wire\(\$\("sysTraceCopyBtn"\)[\s\S]{0,200}rowSelector: "\.sys-trace-entry"/.test(src('modes', 'systems', 'mode.js')));
ok('the Forge copies through the same helper', /HCTraceCopy\.copy\(e\.currentTarget, traceAsText\(\)/.test(src('modes', 'forge', 'mode.js')));
ok('the helper loads before the modes', src('boot.js').indexOf("'/js/trace-copy.js'") !== -1
  && src('boot.js').indexOf("'/js/trace-copy.js'") < src('boot.js').indexOf("'/modes/manifest.js'"));

console.log(`\n${pass} passed, ${fail} failed  (trace copy)`);
if (fail) process.exit(1);
