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

console.log('\nStarting over:');
ok('New chat is said in words, where the + was, and says the conversation is kept',
  /<button type="button" class="cdr-new-btn" id="cdrClearChatBtn" title="Start a new conversation\. This one is kept in Sessions\.">\s*<svg[^>]*>[\s\S]*?<\/svg>\s*<span>New chat<\/span>/.test(panel) && !/class="cdr-icon-btn" id="cdrClearChatBtn"/.test(panel));
ok('...and it keeps it: the conversation goes to History before a new one starts',
  /if \(clearBtn\)\s+clearBtn\.addEventListener\('click', clearChat\);/.test(mode) && /function clearChat\(\) \{\n\s+saveCurrentSession\(\);/.test(mode));
const css = src('modes', 'code', 'mode.css');
ok('it is a flat button with a hairline, its icon drawn with the panel\'s own stroke',
  /\.cdr-new-btn \{[^}]*border: 1px solid var\(--cdr-border-strong\);[^}]*background: transparent;/.test(css) && /\.cdr-new-btn svg \{ width: 14px; height: 14px; \}/.test(css) && /\.cdr-new-btn:focus-visible/.test(css));

console.log('\nPast conversations are Sessions, and a new launch is a new conversation:');
ok('the button says Sessions in words, beside New chat, and the panel it opens is called Sessions',
  /<button type="button" class="cdr-new-btn cdr-sessions-btn" id="cdrSessionsBtn" title="Past conversations" aria-expanded="false" aria-controls="cdrSessionsPanel">\s*<svg[^>]*>[\s\S]*?<\/svg>\s*<span>Sessions<\/span>/.test(panel)
  && /id="cdrSessionsPanel" role="dialog" aria-label="Sessions"/.test(panel) && /<span class="cdr-pane-label">Sessions<\/span>/.test(panel) && !/>History</.test(panel) && !/id="cdrHistoryBtn"/.test(panel));
ok('...and the old clock-only button is gone from the code that wires it', /\$\('cdrSessionsBtn'\)/.test(mode) && !/cdrHistoryBtn/.test(mode));
ok('a launch keeps the last conversation in Sessions and starts a new one, with the project still open',
  /function restoreCoderState\(\) \{[\s\S]*?syncProjectLabel\(\);[\s\S]*?conversationMsgs = state\.chatHistory; saveCurrentSession\(\); conversationMsgs = \[\];[^\n]*saveCoderState\(\); \}/.test(mode) && !/conversationMsgs = state\.chatHistory;\s+renderConversation\(\)/.test(mode));
ok('going out of HashCoder and back in does not restore anything: the second mount returns before it', /if \(setUp\) \{ syncTerminalPrompt\(\); updateCoderStatus\(\); return; \}/.test(mode) && mode.indexOf('if (setUp) {') < mode.indexOf('restoreCoderState();'));
ok('the sessions button is quiet until it is the open one, like New chat in the same bar', /\.cdr-sessions-btn \{ border-color: transparent; \}/.test(css) && /\.cdr-sessions-btn\[aria-expanded="true"\]/.test(css));

console.log(`\n${pass} passed, ${fail} failed  (HashCoder's top bar)`);
process.exit(fail ? 1 : 0);
