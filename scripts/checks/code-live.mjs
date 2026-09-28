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
const sandbox = { window: {} };
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

console.log('\nHow long a wait reads:');
{
  ok('seconds', L.elapsed(7400) === '7s');
  ok('minutes and seconds', L.elapsed(65000) === '1m 05s' && L.elapsed(600000) === '10m 00s');
  ok('nothing is not negative', L.elapsed(-5) === '0s' && L.elapsed(undefined) === '0s');
}

console.log('\nThe words reach it as they are written:');
{
  const mode = src('modes', 'code', 'mode.js');
  ok('the Coder draws the live line where the dots were', /function appendThinking\(contentEl\) \{\s*return contentEl \? window\.HCCodeLive\.start\(contentEl/.test(mode));
  ok('and hands it to the model call', /callWithRouter\(callMessages, tools, temperature, signal, coderModel, thinkEl\)/.test(mode)
    && /H\.runModelTurn\(\{ adapter, messages, tools, temperature, signal, onText: live\?\.text, onThinking: live\?\.thinking \}\)/.test(mode));
  ok('a model asked again starts the line again', /live\?\.reset\?\.\(\);/.test(mode));
  const shape = src('js', 'agent-shape.js');
  ok('the router passes the listeners to the client', /function routeOnce\(\{[^}]*onText, onThinking \}/.test(shape) && /\.\.\.\(onText \? \{ onText \} : \{\}\)/.test(shape));
  const app = src('js', 'app.js');
  const ollama = app.slice(app.indexOf('async function agentTurnOllama'), app.indexOf('async function agentTurnOpenAI'));
  ok('and the client for a model on this computer hands them each piece', /onToken: onText, onThinking/.test(ollama));
  const openai = app.slice(app.indexOf('async function agentTurnOpenAI'), app.indexOf('async function agentTurnAnthropic'));
  ok('an OpenAI-shaped provider streams when someone watches, and answers whole when not',
    /async function agentTurnOpenAI\(\{[^}]*onText, onThinking \}\)/.test(openai) && /stream: !!onText/.test(openai)
    && /HCStreamSSE\.openAIReply\(r, \{ onText, onThinking, fail:/.test(openai));
  const gemini = app.slice(app.indexOf('async function agentTurnGemini'), app.indexOf('// Pick the right adapter'));
  ok('so does Gemini', /agentTurnGemini\(\{[^}]*onText, onThinking \}\)/.test(gemini) && /onText \? "streamGenerateContent\?alt=sse&" : "generateContent\?"/.test(gemini)
    && /HCStreamSSE\.geminiReply\(r, \{ onText, onThinking, fail:/.test(gemini));
  const anthropic = app.slice(app.indexOf('async function agentTurnAnthropic'), app.indexOf('async function agentTurnGemini'));
  ok('and Anthropic', /agentTurnAnthropic\(\{[^}]*onText, onThinking \}\)/.test(anthropic) && /\.\.\.\(onText \? \{ stream: true \} : \{\}\)/.test(anthropic)
    && /HCStreamSSE\.anthropicReply\(r, \{ onText, onThinking, fail:/.test(anthropic));
  const boot = src('boot.js');
  ok('it loads before the Coder', boot.includes("'/js/code/live.js'") && boot.indexOf("'/js/code/live.js'") < boot.indexOf("'/js/app.js'"));
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
