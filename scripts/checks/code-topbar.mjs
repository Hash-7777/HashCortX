// ============================================================
// HashCoder's top bar — src/modes/code/panel.html, and the keys and
// buttons that leave HashCoder. Run with: npm run check:code-topbar
// ============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const src = (...p) => readFileSync(join(here, '..', '..', 'src', ...p), 'utf8');

let pass = 0, fail = 0;
const ok = (label, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`); }
};

const panel = src('modes', 'code', 'panel.html');
const mode = src('modes', 'code', 'mode.js');
const app = src('js', 'app.js');

console.log('Leaving HashCoder:');
ok('the bar has no X: it read as closing the conversation', !/id="cdrBackBtn"/.test(panel) && !/cdrBackBtn|function goBack/.test(mode));
ok('the app\'s own exit button still leaves every mode', /\$\("hcSafeExitModeBtn"\)\?\.addEventListener\("click"/.test(app) && /id="hcSafeExitModeBtn"/.test(src('index.html')));
ok('the shortcut goes back to the tab HashCoder was opened from, by the name that tab is kept under',
  /if \(state\.tab !== tab\) state\[`_pre\$\{tab\}Tab`\] = state\.tab;/.test(app) && /if \(isCodeMode\(\)\) setTab\(state\._precodeTab \|\| 'chats'\);/.test(app) && !/_preCoderTab/.test(app + mode));

console.log(`\n${pass} passed, ${fail} failed  (HashCoder's top bar)`);
process.exit(fail ? 1 : 0);
