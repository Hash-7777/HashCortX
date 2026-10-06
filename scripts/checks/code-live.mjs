// ==============================================================
// The live line under a HashCoder reply — checks
//
// Loads the REAL src/js/code/live.js and holds what it decides: which text is
// a tool call being written rather than words for the person, and how long a
// wait reads. Then that the model's words reach it as they are written, from
// the Coder's call through the router to the client for a model on this
// computer, and that what the model says before a step stays in the reply.
//
// Run with: npm run check:code-live
// ==============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const src = (...p) => readFileSync(join(here, '..', '..', 'src', ...p), 'utf8');
const sandbox = { window: {}, URL };
vm.createContext(sandbox);
vm.runInContext(src('js', 'fences.js'), sandbox, { filename: 'fences.js' });
vm.runInContext(src('js', 'code', 'live.js'), sandbox, { filename: 'live.js' });
const L = sandbox.window.HCCodeLive;

let pass = 0;
let fail = 0;
function ok(label, cond, detail = '') {
  if (cond) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}

console.log('A call being written is not shown as words:');
{
  const calls = ['{"name": "read_file"', '  [{"name"', '<tool_call>{"name"', '<function=read_file>', '```json\n{"name"', '```json', '```tool_code\n[{'];
  for (const t of calls) ok(`${JSON.stringify(t.slice(0, 18))} is a call`, L.looksLikeCalls(t));
  const words = ['I will read the stylesheet first.', 'Here is what changed:\n\n```js\nconst a = 1;\n```', 'The page `{}` was empty.', ''];
  for (const t of words) ok(`${JSON.stringify(t.slice(0, 18))} is words`, !L.looksLikeCalls(t));
}

console.log('\nWhat the line says, from what has happened:');
{
  const P = (o) => L.phaseOf(o);
  ok('before anything has happened it thinks', P({}).phase === 'thinking' && P({}).label === 'Thinking');
  ok('its own thinking arriving is still said as thinking, and moves more slowly', P({ thinking: true }).phase === 'reasoning' && P({ thinking: true }).label === 'Thinking');
  ok('words arriving are writing', P({ text: 'I will' }).phase === 'writing' && P({ text: 'I will' }).label === 'Writing');
  ok('a call being written is choosing the next step, and not shown as words', P({ text: '{"name": "read_file"' }).phase === 'choosing' && P({ text: '{"name": "read_file"' }).label === 'Choosing the next step');
  ok('words win over thinking, and a check over neither', P({ text: 'x', thinking: true }).phase === 'writing' && P({ checking: true }).phase === 'checking' && P({ checking: true, thinking: true }).phase === 'reasoning');
  const after = (tool, object, failed = false) => P({ after: { tool, object, failed } });
  ok('after a file is read, it studies that file by its name', after('read_file', 'src/js/app.js').label === 'Studying app.js' && after('read_file', 'C:\\p\\a.css').label === 'Studying a.css' && after('read_file', '').label === 'Studying the file');
  ok('after a page is fetched, it reads that host', after('fetch_url', 'https://www.example.org/a/b?q=1').label === 'Reading example.org');
  ok('after a search, a look through the matches, or a web search, it reads them', after('grep_code', 'TODO').label === 'Going through the matches' && after('web_search', 'drones').label === 'Reading the search results');
  ok('after a command, it reads that command\'s output', after('shell_run', 'npm test').label === 'Reading the output of npm test' && after('shell_run', '').label === 'Reading the output');
  ok('after a change, it checks the change', after('patch_file', 'src/a.js').label === 'Checking its change to a.js' && after('write_file', 'index.html').label === 'Checking its change to index.html');
  ok('after listing a folder, the folder by its name', after('list_dir', '/p/src/').label === 'Taking in the layout of src/');
  ok('after a step that failed, whatever it was, it works out what went wrong', after('read_file', 'a.js', true).label === 'Working out what went wrong' && after('shell_run', 'x', true).phase === 'reading');
  ok('after a step it has no words for, it analyzes the result', after('some_other_tool', 'x').label === 'Analyzing the result' && after('sys_crm_lookup', '').phase === 'reading');
  ok('what it worked on is cut when long', L.brief('shell_run', 'x'.repeat(90)).length === 36 && L.brief('shell_run', 'x'.repeat(90)).endsWith('…'));
  ok('a step with no name says nothing of one', P({ after: {} }).phase === 'thinking' && P({ after: null }).phase === 'thinking');
}

console.log('\nThe step that decides what it reads next:');
{
  const calls = [{ name: 'read_file', arguments: { path: '/p/a.js' } }, { name: 'update_plan', arguments: {} }];
  const results = new Map([[calls[0], '{"ok":true}'], [calls[1], '{"ok":true}']]);
  const A = L.afterOf(calls, results, (n, a) => a.path || '');
  ok('the last call that is not a change to the plan', A.tool === 'read_file' && A.object === '/p/a.js' && A.failed === false);
  ok('a plan alone is the plan', L.afterOf([calls[1]], results).tool === 'update_plan');
  ok('a failed call is told from its result', L.afterOf([calls[0]], new Map([[calls[0], '{"error":"not found"}']])).failed === true && L.afterOf([calls[0]], new Map([[calls[0], 'plain text']])).failed === false);
  ok('an object that cannot be worked out is left out, not a crash', L.afterOf([calls[0]], results, () => { throw new Error('x'); }).object === '');
  ok('no calls, no step', L.afterOf([], results) === null && L.afterOf(null, null) === null);
  ok('a map of results that is missing is no failure', L.afterOf([calls[0]], undefined).failed === false);
}

console.log('\nHow long a wait reads:');
{
  ok('seconds', L.elapsed(7400) === '7s');
  ok('minutes and seconds', L.elapsed(65000) === '1m 05s' && L.elapsed(600000) === '10m 00s');
  ok('nothing is not negative', L.elapsed(-5) === '0s' && L.elapsed(undefined) === '0s');
  const live = src('js', 'code', 'live.js'), mode = src('modes', 'code', 'mode.js');
  ok('the clock counts from when the request was sent, and shows that from its first frame', /began: since = null \} = \{\}\) \{\n    const began = Number\.isFinite\(since\) && since > 0 && since <= Date\.now\(\) \? since : Date\.now\(\);/.test(live)
    && /aria-hidden="true">\$\{elapsed\(Date\.now\(\) - began\)\}<\/span>/.test(live));
  ok('every live line of a request is given that moment, set as the request is sent and as a reply is asked for again', /HCCodeLive\.start\(contentEl, \{ render: renderMarkdown, scroll: scrollMessages, began: sharedState\.runBegan, \.\.\.now \}\)/.test(mode)
    && /routing = null; sharedState\.runBegan = Date\.now\(\);/.test(mode) && /runAbort = new AbortController\(\); sharedState\.runBegan = Date\.now\(\);/.test(mode));
}

console.log('\nThe words reach it as they are written:');
{
  const mode = src('modes', 'code', 'mode.js');
  ok('the Coder draws the live line where the dots were', /function appendThinking\(contentEl, now = \{\}\) \{[^\n]*\n\s*return contentEl \? window\.HCCodeLive\.start\(contentEl, \{ render: renderMarkdown, scroll: scrollMessages, began: sharedState\.runBegan, \.\.\.now \}\)/.test(mode));
  ok('after tools run it is told which step ended last, and after a note from the app that it is checking', /appendThinking\(contentEl, \{ after: window\.HCCodeLive\.afterOf\(turn\.tool_calls, results, toolObject\) \}\)/.test(mode) && /appendThinking\(contentEl, \{ checking: true \}\);\n\s+continue;/.test(mode));
  ok('a second look, which is a model call with nothing else on screen, has the line, and takes it away however it ends', /const wait = appendThinking\(contentEl, \{ checking: true \}\);/.test(mode) && /finally \{ wait\?\.remove\(\); \}/.test(mode));
  ok('and hands it to the model call', /callWithRouter\(callMessages, tools, temperature, signal, coderModel, thinkEl\)/.test(mode)
    && /router\.turn\(\{ messages, tools, temperature, signal, onText: live\?\.text, onThinking: live\?\.thinking, cache: true, reset: live\?\.reset \}\)/.test(mode));
  const routerSrc = src('js', 'code', 'router.js');
  ok('a model asked again starts the line again: the routing calls it before every try, and again before a retry', (routerSrc.match(/request\.reset\(\)/g) || []).length >= 2 && /typeof request\.reset === 'function'/.test(routerSrc));
  const shape = src('js', 'agent-shape.js');
  ok('the router passes the listeners to the client', /function routeOnce\(\{[^}]*onText, onThinking, cache \}/.test(shape) && /\.\.\.\(onText \? \{ onText \} : \{\}\)/.test(shape));
  const app = src('js', 'app.js');
  const ollama = app.slice(app.indexOf('async function agentTurnOllama'), app.indexOf('async function agentTurnOpenAI'));
  ok('and the client for a model on this computer hands them each piece', /onToken: onText, onThinking/.test(ollama));
  const openai = app.slice(app.indexOf('async function agentTurnOpenAI'), app.indexOf('async function agentTurnAnthropic'));
  ok('an OpenAI-shaped provider streams when someone watches, and answers whole when not',
    /async function agentTurnOpenAI\(\{[^}]*onText, onThinking \}\)/.test(openai) && /stream: !!onText/.test(openai)
    && /HCStreamSSE\.openAIReply\(r, \{ onText, onThinking, fail:/.test(openai));
  const gemini = app.slice(app.indexOf('async function agentTurnGemini'), app.indexOf('// Pick the right adapter'));
  ok('so does Gemini', /agentTurnGemini\(\{[^}]*onText, onThinking \}\)/.test(gemini) && /onText \? "streamGenerateContent\?alt=sse" : "generateContent"/.test(gemini)
    && /HCStreamSSE\.geminiReply\(r, \{ onText, onThinking, fail:/.test(gemini));
  const anthropic = app.slice(app.indexOf('async function agentTurnAnthropic'), app.indexOf('async function agentTurnGemini'));
  ok('and Anthropic', /agentTurnAnthropic\(\{[^}]*onText, onThinking, cache \}\)/.test(anthropic) && /\.\.\.\(onText \? \{ stream: true \} : \{\}\)/.test(anthropic)
    && /HCStreamSSE\.anthropicReply\(r, \{ onText, onThinking, fail:/.test(anthropic));
  const boot = src('boot.js');
  ok('it loads before the Coder', boot.includes("'/js/code/live.js'") && boot.indexOf("'/js/code/live.js'") < boot.indexOf("'/js/app.js'"));
}

console.log('\nThe mesh:');
{
  const live = src('js', 'code', 'live.js');
  const css = src('modes', 'code', 'mode.css');
  ok('fifteen dots, hidden from a screen reader, beside a label read out as a status', /const MESH = `<span class="cdr-marks" aria-hidden="true">\$\{'<i><\/i>'\.repeat\(15\)\}<\/span>`/.test(live) && /role="status">\$\{MESH\}/.test(live));
  ok('five across and three down, on hairlines through their middles that do not move', /\.cdr-marks \{[^}]*grid-template-columns: repeat\(5, 3px\); grid-auto-rows: 3px; gap: 3px;/.test(css)
    && /\.cdr-marks::before \{[^}]*inset: 1px;[^}]*repeating-linear-gradient\(to right, var\(--accent\) 0 1px, transparent 1px 6px\), repeating-linear-gradient\(to bottom, var\(--accent\) 0 1px, transparent 1px 6px\)/.test(css)
    && !/\.cdr-marks::before \{[^}]*animation/.test(css));
  ok('each dot knows its column, its row and its ring from the centre, and the centre is the second accent', /nth-child\(5n\+2\) \{ --c: 1; \}/.test(css) && /nth-child\(5n\) \{ --c: 4; --ring: 2; \}/.test(css) && /nth-child\(n\+11\) \{ --r: 2; \}/.test(css) && /nth-child\(8\) \{ --ring: 0; background: var\(--accent-2\); \}/.test(css));
  ok('the clock, which changes every second, is not read out', /class="cdr-live-time" aria-hidden="true"/.test(live));
  ok('a movement for each thing it can be doing', ['reasoning', 'reading', 'writing', 'choosing', 'checking'].every((p) => new RegExp(`\\.cdr-live\\[data-phase="${p}"\\]`).test(css)));
  const frames = [...css.matchAll(/@keyframes (cdr-(?:wave|sweep|gather|ring)) \{((?:[^{}]|\{[^{}]*\})*)\}/g)];
  ok('a wave, a sweep, a gathering and rings: the keyframes of the mesh', frames.length === 4, frames.map((f) => f[1]).join());
  ok('which change transform and opacity and nothing else, so the page does no layout or paint for them', frames.every(([, , body]) => [...body.matchAll(/([a-z-]+)\s*:/g)].every((m) => ['opacity', 'transform'].includes(m[1]))));
  ok('only the dots animate, timed from where each one is', (css.match(/\.cdr-marks i[^{]*\{[^}]*animation/g) || []).length >= 5 && /animation-delay: calc\(\(var\(--c\) \+ var\(--r\)\) \* 0\.12s\)/.test(css) && /animation-delay: calc\(var\(--ring\) \* 0\.16s\)/.test(css) && !/filter:|box-shadow:[^;}]*;[^}]*animation/.test(css.slice(css.indexOf('.cdr-live {'), css.indexOf('.cdr-live-text {'))));
  ok('they stand still for someone who asked for less motion', /prefers-reduced-motion: reduce\) \{[^}]*\.cdr-marks i, \.cdr-live\[data-phase\] \.cdr-marks i \{ animation: none; \}/.test(css));
  ok('it reports state, so it is not one of the decorations that rest', !/cdr-live|cdr-marks/.test(src('js', 'power.js')) && !/cdr-live|cdr-marks/.test(src('css', 'base.css')));
  ok('and uses no colour of its own but the theme\'s', !/#[0-9a-f]{3,8}\b|rgba?\(/i.test(css.slice(css.indexOf('.cdr-live {'), css.indexOf('.cdr-live-text {'))));
}

console.log('\nThe line never outlives its run:');
{
  const mode = src('modes', 'code', 'mode.js');
  ok('a run stopped between steps takes the line with it', /if \(signal\?\.aborted\) \{ thinkEl\?\.remove\(\); throw new DOMException\('Aborted', 'AbortError'\); \}/.test(mode));
  ok('and a line off the page stops its clock', /if \(!el\.isConnected\) \{ done = true; clearInterval\(tick\); return; \}/.test(src('js', 'code', 'live.js')));
}

console.log('\nWhat the model says before a step stays:');
{
  const mode = src('modes', 'code', 'mode.js');
  ok('words said with a step are kept in the reply; a call written as text is not',
    /const said = turn\.tool_calls\?\.length && turn\.content && !window\.HCCodeLive\.looksLikeCalls\(turn\.content\) \? turn\.content : '';\s*thinkEl\?\.finish\(said\);/.test(mode));
  ok('a larger model is asked to say what it is doing before each step, one on this computer under 15B is not',
    /sharedState\.size === 'small' \|\| sharedState\.size === 'mid' \? '1\. One change at a time\. Use tool calls[^']*'\s*: '1\. One change at a time\. Before each tool call, say in one short sentence/.test(mode));
  ok('a saved conversation draws those words before their step', /if \(m\.content && m\.tool_calls\?\.length && !window\.HCCodeLive\.looksLikeCalls\(m\.content\)\) appendTextToBubble\(reply, m\.content\);/.test(mode));
}

console.log(`\n${pass} passed, ${fail} failed  (src/js/code/live.js)`);
process.exit(fail ? 1 : 0);
