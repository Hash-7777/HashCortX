// ==============================================================
// Swarm Workspace checks
//
// The Agent Swarm's work lives in the Swarm tab and nowhere else. These checks
// hold that, and grow with the Workspace: the run store, who a message is
// for, and the sandboxed preview each add a section here.
//
// Run with: npm run check:swarm-workspace
// ==============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const src = (...p) => readFileSync(join(here, '..', '..', 'src', ...p), 'utf8');
const mode = src('modes', 'agent-maker', 'mode.js');
const code = mode.split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n');

let pass = 0;
let fail = 0;
function ok(label, cond) {
  if (cond) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}`); }
}

console.log('The Swarm does not write into the normal chat:');
{
  // A finished run used to be pushed into the normal chat's messages and saved
  // there — into whichever chat happened to be open.
  ok('it never touches the chat\'s messages', !/_H\??\.state\??\.messages/.test(code));
  ok('it never saves a chat', !/persistCurrentChat/.test(code));
  ok('it never redraws the chat', !/_H\??\.render\b/.test(code));
}

console.log(`\n${pass} passed, ${fail} failed  (Swarm Workspace)`);
process.exit(fail ? 1 : 0);
