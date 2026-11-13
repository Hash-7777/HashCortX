// ==============================================================
// The HashCoder agent loop — checks
//
// Loads the real src/js/agent-loop.js with the real modules it reads (the
// step policy, the record of changes and checks, the call memory, places,
// the live line's words, the turn shapes) and runs it with a scripted model,
// stand-in tools and a stand-in screen that only writes down what it was
// asked to show. There is no page here at all, which is the proof that the
// loop left the screen code: what it shows goes through `ui`, and what it
// needs from the mode comes in `o`.
//
// The run's own decisions are held: results kept in the order of the calls
// that asked for them, reads run together, a failed change drawing no change
// row, an error shown with what was kept, a message added while it works
// read at the next step, a step given way for a message sent now, a step cut
// off at its limit, the finishing checks walked in order until one answers,
// a stop at the step limit with no dangling call, and a stopped run.
//
// Run with: npm run check:agent-loop
// ==============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const src = (...p) => readFileSync(join(here, '..', '..', 'src', ...p), 'utf8');

const sandbox = { console, performance, setTimeout, clearTimeout, DOMException };
sandbox.window = sandbox;
vm.createContext(sandbox);
for (const f of ['fences.js', 'code/host-tools.js', 'code/translate.js', 'code/asks.js', 'code/added.js', 'agent-policy.js', 'agent-shape.js', 'code/verify.js', 'code/plan.js', 'code/calls.js', 'code/paths.js', 'code/live.js', 'code/steps.js', 'code/debug-export.js', 'code/router.js', 'agent-loop.js']) {
  vm.runInContext(src('js', ...f.split('/')), sandbox, { filename: f });
}
const S = sandbox.HCAgentShape;
sandbox._H = { appendAssistantToolCallTurn: S.appendAssistantToolCallTurn, appendToolResult: S.appendToolResult };
const loop = sandbox.HCAgentLoop;

let pass = 0, fail = 0;
function ok(label, cond, detail = '') {
  if (cond === true) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}
const json = (x) => JSON.stringify(x);
const later = (ms) => new Promise((r) => setTimeout(r, ms));

/** A stand-in screen: every call written down, a live line and a tool row as handles. */
function screen(receipt = false) {
  const log = [];
  const handle = (kind) => ({ finish: (said) => log.push([kind + ':finish', said]), remove: () => log.push([kind + ':remove']) });
  const ui = {
    trace: (stage, text, level) => log.push(['trace', stage, text, level]),
    status: (text) => log.push(['status', text]),
    terminal: (text) => log.push(['terminal', text]),
    wait: (o) => { log.push(['wait', o || null]); return handle('wait'); },
    step: (s) => log.push(['step', s.verb, s.object]),
    tool: (name) => { log.push(['tool', name]); return handle('tool'); },
    toolDone: (el, result, okay) => log.push(['toolDone', okay]),
    answer: (text) => log.push(['answer', text]),
    added: (text, pictures, kinds) => log.push(['added', text, kinds]),
    error: (e, kept) => log.push(['error', e.message, kept]),
    changed: (call) => log.push(['changed', call.name]),
    ...(receipt ? { receipt: (parts) => { log.push(['receipt', parts]); return [{ from: 'proof', label: 'Not checked' }]; } } : {}),
  };
  return { ui, log, of: (kind) => log.filter((e) => e[0] === kind) };
}

let ids = 0;
const callOf = (name, args) => ({ id: `c${++ids}`, name, arguments: args });
const turnOf = (...calls) => ({ content: '', tool_calls: calls });
const words = (content) => ({ content, tool_calls: [] });

/** The tools a run is given: reads answer at once or later, a change and a command, and one that fails. */
function project() {
  const files = { '/p/a.js': 'const a = 1;\n', '/p/b.js': 'const b = 2;\n' };
  const ran = [], given = [];
  const tools = [
    { name: 'read_file', fn: async (a) => { if (a.path === '/p/a.js') await later(15); ran.push(['read', a.path]); return files[a.path] ?? JSON.stringify({ error: 'no such file' }); } },
    { name: 'patch_file', fn: async (a) => { given.push(Object.keys(a).sort().join()); if (a.path === '/p/locked.js') throw new Error('Permission denied: write /p/locked.js.'); ran.push(['patch', a.path]); files[a.path] = 'changed'; return JSON.stringify({ ok: true, path: a.path }); } },
    { name: 'shell_run', fn: async (a) => { if (a.command === 'refused') throw new Error('Not allowed: the person said no.'); ran.push(['run', a.command, ...(a.args || [])]); return JSON.stringify({ code: (a.args || []).includes('--bail') ? 1 : 0, stdout: 'ok', stderr: '' }); } },
  ];
  return { files, ran, given, tools };
}

/**
 * One run. `script(messages, n)` gives the model's n-th turn (from 1); a turn
 * that is an Error is thrown. `finish` is the finishing list the mode builds.
 */
async function runWith({ script, finish = [], size = 'full', queue = null, signal, request = 'Fix the totals in /p/a.js.', prefs = { prove: true }, asks = [], receipt = false, offerThen = false, offerPaths = false } = {}) {
  const P = project();
  sandbox.HC = { code: { TOOL_DEFINITIONS: P.tools.map((t) => ({ name: t.name, fn: t.fn })), request, asks, plan: null, readWholeQuietly: async () => '', linesQuietly: async () => '' }, undo: { lastFor: () => null }, guard: { noteBlocked: () => {} } };
  const scr = screen(receipt);
  const messages = [{ role: 'system', content: 'You are a coding agent.' }, { role: 'user', content: request }];
  const sent = [];
  let n = 0, ctx = null;
  const o = {
    messages, tools: P.tools.map((t) => ({ type: 'function', function: { name: t.name, ...(offerThen && t.name === 'patch_file' ? { parameters: { type: 'object', properties: { path: { type: 'string' }, search: { type: 'string' }, replace: { type: 'string' }, then_run: { type: 'object' } } } } : {}), ...(offerPaths && t.name === 'read_file' ? { parameters: { type: 'object', properties: { path: { type: 'string' }, paths: { type: 'array' } } } } : {}) } })), label: '', signal,
    ui: scr.ui, temperature: 0.2,
    state: { size, local: size !== 'full', light: false, projectRoot: '/p', projectChecks: null, codeMap: null },
    prefs: () => prefs,
    call: async (msgs, tools, temperature, sig, live) => { n++; sent.push({ msgs: msgs.map((m) => ({ ...m })), tools: tools.length, live: !!live }); const t = script(msgs, n, tools); if (t instanceof Error) throw t; return t; },
    compress: (msgs) => msgs,
    queue: () => queue, conversation: () => messages,
    opened: () => {}, baseName: (p) => String(p).split('/').pop(), toolObject: (name) => name,
    checks: (c) => { ctx = c; return { finish, left: () => ({ unconfirmed: null, gone: null }), wrap: async () => null }; },
  };
  let result, error = null;
  try { result = await loop.run(o); } catch (e) { error = e; }
  return { result, error, messages, scr, P, sent, ctx, calls: () => n, state: o.state };
}

console.log('\nThe receipt under the answer:');
{
  const script = (m, n) => (n === 1 ? turnOf(callOf('patch_file', { path: '/p/a.js', patch: 'x' })) : words('Changed the totals.'));
  const r = await runWith({ script, receipt: true });
  const given = r.scr.of('receipt')[0];
  ok('the mode is handed what the record shows, part by part: the proof, the files changed, and each line said under an answer', !!given && given[1].proof?.proof?.kind === 'none' && json(given[1].files) === '["/p/a.js"]' && ['facts', 'gone', 'outside', 'claim', 'said', 'passed', 'left'].every((k) => k in given[1]), json(given && given[1]));
  ok('...and when it draws a receipt, the same words are not said again in italics, and the receipt is kept for the answer', !r.scr.of('answer').some((a) => /^\*/.test(a[1])) && json(r.state.receipt) === '[{"from":"proof","label":"Not checked"}]' && /^Not checked: no test ran/.test(r.state.proven));
  const plain = await runWith({ script });
  ok('a screen that draws no receipt still says it in italics, as before', plain.scr.of('answer').some((a) => /^\*Not checked: no test ran/.test(a[1])) && plain.state.receipt === null);
}

console.log('\nA reading command answered by the app:');
{
  const r = await runWith({ script: (m, n) => (n === 1 ? turnOf(callOf('shell_run', { command: 'cat', args: ['/p/b.js'] })) : words('Read it.')) });
  const result = r.messages.find((m) => m.role === 'tool');
  ok('a model\'s cat is answered by read_file: the file is read, no command is started', json(r.P.ran) === '[["read","/p/b.js"]]', json(r.P.ran));
  ok('...and the answer says so, with the file in it', /^Answered by the app's own reading \(read_file\), with no program started; call read_file directly next time\.\nconst b = 2;/.test(result && result.content), result && result.content);
  const ls = await runWith({ script: (m, n) => (n === 1 ? turnOf(callOf('shell_run', { command: 'npm', args: ['test'] })) : words('Ran it.')) });
  ok('a command it cannot answer runs as before', json(ls.P.ran) === '[["run","npm","test"]]', json(ls.P.ran));
}

console.log('\nA change and its check in one call (then_run):');
{
  const change = (extra) => ({ path: '/p/a.js', search: 'const a = 1;', replace: 'const a = 2;', ...extra });
  const one = (args) => (m, n) => (n === 1 ? turnOf(callOf('patch_file', args)) : words('Changed it and the tests pass.'));
  const r = await runWith({ offerThen: true, script: one(change({ then_run: { command: 'npm', args: ['test'] } })) });
  ok('the change is made first, then the command, through the shell tool', json(r.P.ran) === '[["patch","/p/a.js"],["run","npm","test"]]', json(r.P.ran));
  ok('...the change tool is given the change alone, without the command', json(r.P.given) === '["path,replace,search"]', json(r.P.given));
  const results = r.messages.filter((m) => m.role === 'tool');
  let both = null; try { both = JSON.parse(results[0].content); } catch { both = null; }
  ok('one result answers the call, holding both: the change and what the command gave', results.length === 1 && results[0].tool_call_id === r.messages.find((m) => m.tool_calls)?.tool_calls[0].id && both?.change?.ok === true && both?.then_run?.code === 0, results.map((m) => m.content).join(' | '));
  const proof = r.ctx.proof;
  ok('the record has the file changed, then the check that ran after it, passed', json(proof.changed) === '["/p/a.js"]' && proof.checks.length === 1 && proof.checks[0].pass === true && /^npm test/.test(proof.checks[0].command), json(proof.checks));
  ok('the screen shows the change and the command as their own steps, as two calls would be', r.scr.of('changed').map((e) => e[1]).join() === 'patch_file,shell_run' && r.scr.of('tool').map((e) => e[1]).join() === 'patch_file,shell_run' && r.scr.of('terminal').some((e) => /npm test/.test(e[1])), json([r.scr.of('changed'), r.scr.of('tool'), r.scr.of('terminal')]));

  const failed = await runWith({ offerThen: true, script: one({ path: '/p/locked.js', search: 'x', replace: 'y', then_run: { command: 'npm', args: ['test'] } }) });
  ok('a change that fails runs no command, and the result is the change\'s own error', json(failed.P.ran) === '[]' && /Permission denied/.test(failed.messages.find((m) => m.role === 'tool').content) && failed.ctx.proof.checks.length === 0, json(failed.P.ran));

  const refused = await runWith({ offerThen: true, script: one(change({ then_run: { command: 'refused', args: [] } })) });
  let said = null; try { said = JSON.parse(refused.messages.find((m) => m.role === 'tool').content); } catch { said = null; }
  ok('a command refused at its question leaves the change made, and the result says both', json(refused.P.ran) === '[["patch","/p/a.js"]]' && said?.change?.ok === true && /person said no/.test(said?.then_run?.error || ''), json(said));

  const red = await runWith({ offerThen: true, script: one(change({ then_run: { command: 'npm', args: ['test', '--bail'] } })) });
  ok('a check that fails is kept as failed, after the change', red.ctx.proof.checks.length === 1 && red.ctx.proof.checks[0].pass === false && json(red.ctx.proof.changed) === '["/p/a.js"]', json(red.ctx.proof.checks));

  const notOffered = await runWith({ script: one(change({ then_run: { command: 'npm', args: ['test'] } })) });
  ok('a model not offered then_run gets no command run for it: the change alone is made', json(notOffered.P.ran) === '[["patch","/p/a.js"]]', json(notOffered.P.ran));

  const bad = await runWith({ offerThen: true, script: one(change({ then_run: 'npm test' })) });
  ok('then_run written as a line, not { command, args }, runs nothing and says how to write it', json(bad.P.ran) === '[["patch","/p/a.js"]]' && /then_run was not run/.test(JSON.parse(bad.messages.find((m) => m.role === 'tool').content).then_run?.error || '') && /"command": "npm", "args": \["test"\]/.test(JSON.parse(bad.messages.find((m) => m.role === 'tool').content).then_run.error), bad.messages.find((m) => m.role === 'tool').content);
}

console.log('\nSeveral files read in one call (paths):');
{
  const script = (m, n) => (n === 1 ? turnOf(callOf('read_file', { paths: ['/p/a.js', '/p/b.js'] })) : words('Both read.'));
  const r = await runWith({ offerPaths: true, script });
  const asked = r.messages.find((m) => m.tool_calls);
  const answered = r.messages.filter((m) => m.role === 'tool');
  ok('a model offered paths has each file read as its own read, together', json(r.P.ran.map((e) => e[1]).sort()) === '["/p/a.js","/p/b.js"]', json(r.P.ran));
  ok('...kept as one read per file, each result after its own call', asked.tool_calls.length === 2 && answered.length === 2 && answered.every((m, i) => m.tool_call_id === asked.tool_calls[i].id) && answered[0].content === 'const a = 1;\n' && answered[1].content === 'const b = 2;\n', json(asked.tool_calls));
  const plain = await runWith({ script });
  const kept = plain.messages.find((m) => m.tool_calls).tool_calls;
  ok('a model not offered it has its call left as it was, for the tool to answer', kept.length === 1 && json(JSON.parse(kept[0].function.arguments).paths) === '["/p/a.js","/p/b.js"]', json(kept));
}

console.log('\nThe loop runs with no page:');
{
  ok('there is no document, no window of a browser', typeof sandbox.document === 'undefined');
  const r = await runWith({ script: (m, n) => (n === 1 ? turnOf(callOf('read_file', { path: '/p/b.js' })) : words('The totals are right.')) });
  ok('a run that reads and answers ends with the answer', r.error === null && r.result === 'The totals are right.', String(r.error));
  ok('...shown in the reply, with the tool row and its trace', json(r.scr.of('answer')) === json([['answer', 'The totals are right.']]) && r.scr.of('tool').length === 1 && r.scr.of('toolDone')[0][1] === true);
  ok('the call and its result are kept in the conversation, the result after the call', r.messages[2].role === 'assistant' && r.messages[2].tool_calls[0].id === r.messages[3].tool_call_id && r.messages[3].content === 'const b = 2;\n');
  ok('the model is asked with the tools and the live line', r.sent[0].tools === 3 && r.sent[0].live === true);
  ok('the finishing checks are given what the run keeps', !!r.ctx && !!r.ctx.proof && !!r.ctx.sent && r.ctx.changes.constructor.name === 'Map' && r.ctx.messages === r.messages && r.ctx.ui === r.scr.ui);
}

console.log('\nTools:');
{
  const r = await runWith({ script: (m, n) => (n === 1 ? turnOf(callOf('read_file', { path: '/p/a.js' }), callOf('read_file', { path: '/p/b.js' })) : words('Read both.')) });
  ok('reads in one turn run together, the slower one finishing last', json(r.P.ran) === json([['read', '/p/b.js'], ['read', '/p/a.js']]), json(r.P.ran));
  ok('...and their results are kept in the order of the calls, whatever order they finished in', r.messages[3].content === 'const a = 1;\n' && r.messages[4].content === 'const b = 2;\n');
  const c = await runWith({ script: (m, n) => (n === 1 ? turnOf(callOf('patch_file', { path: '/p/a.js', search: 'a', replace: 'b' })) : n === 2 ? turnOf(callOf('patch_file', { path: '/p/locked.js', search: 'a', replace: 'b' })) : words('Done.')) });
  ok('a change that happened draws its change row, in place of its tool row', json(c.scr.of('changed')) === json([['changed', 'patch_file']]) && c.scr.log.some((e) => e[0] === 'tool:remove'));
  ok('...one that failed draws none, and its row says it failed', c.scr.of('toolDone').map((e) => e[1]).join() === 'true,false' && /Permission denied/.test(c.messages.find((m) => m.role === 'tool' && /locked/.test(m.content)).content));
  ok('...and only the change that happened is in the record', json(c.ctx.proof.changed) === json(['/p/a.js']));
  const s = await runWith({ script: (m, n) => (n === 1 ? turnOf(callOf('shell_run', { command: 'npm', args: ['test'] })) : words('Ran it.')) });
  ok('a command is shown in the terminal before it runs', s.scr.of('terminal').length === 1 && /npm test/.test(s.scr.of('terminal')[0][1]));
}

console.log('\nWhen the model call fails:');
{
  const r = await runWith({ script: (m, n) => (n === 1 ? turnOf(callOf('patch_file', { path: '/p/a.js', search: 'a', replace: 'b' })) : new Error('The provider refused the request.')) });
  ok('the error goes up to the mode', r.error && r.error.message === 'The provider refused the request.');
  ok('...shown in the reply, saying the change already made is kept', r.scr.of('error').length === 1 && r.scr.of('error')[0][1] === 'The provider refused the request.' && /a\.js/.test(r.scr.of('error')[0][2]), json(r.scr.of('error')));
  ok('...and the live line is taken away first', r.scr.log.findIndex((e) => e[0] === 'wait:remove') < r.scr.log.findIndex((e) => e[0] === 'error'));
  const stopped = new AbortController(); stopped.abort();
  const a = await runWith({ signal: stopped.signal, script: () => words('never') });
  ok('a run stopped before a step ends with no model call, and takes its live line', a.error && a.error.name === 'AbortError' && a.calls() === 0 && a.scr.log.some((e) => e[0] === 'wait:remove'));
}

console.log('\nMessages sent while it works:');
{
  let given = false;
  const queue = { takeNow: () => (given ? null : (given = true, { text: 'Also round the tax.', files: [], count: 1, kinds: ['add'] })) };
  const r = await runWith({ queue, script: (m, n) => (n === 1 ? turnOf(callOf('read_file', { path: '/p/b.js' })) : words('Done, the tax too.')) });
  ok('one sent while it works is read at the next step, kept as added', r.messages.some((m) => m.role === 'user' && m.added === true && m.content === 'Also round the tax.') && r.sent[0].msgs.some((m) => m.added));
  ok('...with how it was taken kept on it, for when the conversation is opened again', r.messages.some((m) => m.added && JSON.stringify(m.kinds) === '["add"]'));
  ok('...shown where it was read, with how it was taken, and joins the request the run is held to', json(r.scr.of('added')) === json([['added', 'Also round the tax.', ['add']]]) && /Also round the tax\./.test(sandbox.HC.code.request));
  const urgent = { urgent: true, takeNow: () => null };
  let tries = 0;
  const u = await runWith({ queue: urgent, script: () => (++tries === 1 ? new Error('step stopped for a message sent now') : words('Answered the new message.')) });
  ok('a step stopped for a message sent now is given way, and the run goes on', u.error === null && u.result === 'Answered the new message.' && u.scr.of('error').length === 0 && u.scr.of('trace').some((e) => /Gave way/.test(e[2])));
}

console.log('\nWhat it adds joins the checklist:');
{
  const once = (text) => { let given = false; return { takeNow: () => (given ? null : (given = true, { text, files: [], count: 1 })) }; };
  const two = 'Fix the totals in /p/a.js and add a rounding step to them.';
  const a = await runWith({ request: two, asks: [], queue: once('Also show the tax on its own line.'), script: (m, n) => (n === 1 ? turnOf(callOf('read_file', { path: '/p/b.js' })) : words('Done.')) });
  ok('a request of two asks and one added: a checklist of three, in the order asked', JSON.stringify(sandbox.HC.code.asks) === JSON.stringify(sandbox.HCCodeAsks.split(`${two}\n\nAlso show the tax on its own line.`)) && sandbox.HC.code.asks.length === 3 && /tax/.test(sandbox.HC.code.asks[2]), JSON.stringify(sandbox.HC.code.asks));
  const three = 'Fix the totals in /p/a.js. Also change the rounding to two places. And also show the tax on its own line.';
  const before = sandbox.HCCodeAsks.split(three);
  ok('(the invented request has three asks to begin with)', before.length === 3, JSON.stringify(before));
  await runWith({ request: three, asks: before, queue: once('Also add a test for the totals.'), script: (m, n) => (n === 1 ? turnOf(callOf('read_file', { path: '/p/b.js' })) : words('Done.')) });
  ok('a checklist already made grows, its asks first and numbered on', sandbox.HC.code.asks.length === before.length + 1 && before.every((x, i) => sandbox.HC.code.asks[i] === x) && /test for the totals/.test(sandbox.HC.code.asks[before.length]), JSON.stringify(sandbox.HC.code.asks));
  await runWith({ request: three, asks: before, queue: once('x'.repeat(5000)), script: (m, n) => (n === 1 ? turnOf(callOf('read_file', { path: '/p/b.js' })) : words('Done.')) });
  ok('...and never shrinks: an addition too long to split leaves the checklist as it was', JSON.stringify(sandbox.HC.code.asks) === JSON.stringify(before));
}

console.log('\nA correction sent while it works:');
{
  const said = (text, kinds) => { let asked = 0; return { takeNow: () => (++asked === 2 ? { text, files: [], count: 1, kinds } : null) }; };   // read at the second step, once the model has a plan
  const plan = () => ({ steps: [{ step: 'Change bundleDiscount', status: 'done' }, { step: 'Rename priceFor', status: 'doing' }] });
  let r = await runWith({ queue: said('No, not that function.', ['correct']), script: (m, n) => (n === 1 ? (sandbox.HC.code.plan = plan(), turnOf(callOf('read_file', { path: '/p/b.js' }))) : words('Done.')) });
  const at = r.messages.findIndex((m) => m.added);
  ok('it is followed by a note from the app naming the step it is about', at > 0 && r.messages[at + 1].note === true && /"Rename priceFor"/.test(r.messages[at + 1].content), JSON.stringify(r.messages.slice(at, at + 2)));
  ok('...that step is open again', sandbox.HC.code.plan.steps[1].status === 'todo');
  ok('...and the model reads both at its next step, the correction last of the person\'s words', r.sent[1].msgs.some((m) => m.note && /"Rename priceFor"/.test(m.content)));
  r = await runWith({ queue: said('Also keep the old export.', ['add']), script: (m, n) => (n === 1 ? (sandbox.HC.code.plan = plan(), turnOf(callOf('read_file', { path: '/p/b.js' }))) : words('Done.')) });
  ok('more for the work is read as it is, no note, the step left as it was', !r.messages.some((m) => m.note) && sandbox.HC.code.plan.steps[1].status === 'doing');
  r = await runWith({ queue: said('Undo that.', undefined), script: (m, n) => (n === 1 ? turnOf(callOf('read_file', { path: '/p/b.js' })) : words('Done.')) });
  ok('a queue that gives no kinds is read as more for the work', !r.messages.some((m) => m.note));
}

console.log('\nA step cut off at its limit:');
{
  const r = await runWith({ size: 'mid', script: (m, n) => (n <= 3 ? { content: 'partial', cutOff: true, tool_calls: [] } : words('Short answer.')) });
  ok('on a smaller model it is neither kept nor run, and the model is told, twice at most', r.messages.filter((m) => m.note && m.content === sandbox.HCCodeVerify.cutNote()).length === 2 && r.scr.of('step').filter((e) => e[2] === sandbox.HCCodeVerify.CUT_STEP).length === 2 && r.ctx.sent.cut >= 2, json(r.scr.of('step')));
}

console.log('\nThe finishing checks:');
{
  const asked = [];
  const back = { kind: 'named', step: 'Sent back to find the files its answer names', message: 'Note from HashCortX, not from the person: your answer names b.js.' };
  let once = false;
  const finish = [
    { id: 'first', run: () => { asked.push('first'); return null; } },
    { id: 'second', words: true, run: (reply) => { asked.push('second'); return once ? null : (once = true, back); } },
    { id: 'third', words: true, run: () => { asked.push('third'); return null; } },
  ];
  const r = await runWith({ finish, script: (m, n) => words(n === 1 ? 'I changed b.js.' : 'Nothing was changed; b.js is not in the project.') });
  ok('they are walked in order and stop at the first that answers', json(asked.slice(0, 2)) === json(['first', 'second']) && asked.indexOf('third') > asked.indexOf('second', 1) - 1);
  ok('...that one sends the run back with its note, counted, and shown as its step', r.messages.some((m) => m.note && m.content === back.message) && r.ctx.sent.named === 1 && r.scr.of('step').some((e) => e[2] === back.step));
  ok('...and the run goes on to its answer', r.result === 'Nothing was changed; b.js is not in the project.' && r.calls() === 2);
  const wordsOnly = [];
  const empty = await runWith({ finish: [{ id: 'a', run: () => { wordsOnly.push('a'); return null; } }, { id: 'b', words: true, run: () => { wordsOnly.push('b'); return null; } }], script: () => words('') });
  ok('a check asked only of an answer in words is not asked of an empty one', json(wordsOnly) === json(['a']) && empty.scr.of('answer').some((e) => /No response from model/.test(e[1])));
}

console.log('\nThe step limit:');
{
  const r = await runWith({ prefs: { prove: false }, script: (m, n, tools) => (tools.length ? turnOf(callOf('read_file', { path: `/p/f${n}.js` })) : words('I read the files and changed nothing yet.')) });
  const policy = sandbox.HCAgentPolicy.BUDGET;
  const withTools = r.sent.filter((s) => s.tools > 0).length, account = r.sent[r.sent.length - 1];
  ok('a run still calling tools stops at the most steps it is given', withTools === policy.hardLimit && r.error === null, String(withTools));
  ok('...then asks once, with no tools, for an account of what it did, and shows it', r.calls() === policy.hardLimit + 1 && account.tools === 0 && r.scr.of('answer').some((e) => e[1] === 'I read the files and changed nothing yet.'));
  ok('...with no call left without its result at the end of the conversation', r.messages[r.messages.length - 1].role !== 'tool' && !(r.messages[r.messages.length - 1].tool_calls || []).length);
  ok('...and says why it stopped', r.scr.of('answer').some((e) => /^\*/.test(e[1])) && r.scr.of('trace').some((e) => e[1] === 'Done' && /Stopped: /.test(e[2])));
}
{
  const script = (m, n, tools) => (tools.length ? turnOf(callOf('read_file', { path: `/p/f${n}.js` })) : words('I read the files and changed nothing yet.'));
  const r = await runWith({ prefs: { prove: false }, script, receipt: true });
  const given = r.scr.of('receipt')[0], at = r.scr.log.findIndex((e) => e[0] === 'receipt'), said = r.scr.log.findIndex((e) => e[0] === 'answer' && e[1] === 'I read the files and changed nothing yet.');
  ok('at the step limit, its account first, then the receipt with why it stopped, and no line in italics', !!given && typeof given[1].stopped === 'string' && given[1].stopped.length > 0 && said >= 0 && said < at && !r.scr.of('answer').some((e) => /^\*/.test(e[1])), json(given && given[1]));
  const account = r.messages.filter((m) => m.role === 'assistant' && m.content === 'I read the files and changed nothing yet.').pop();
  ok('...kept with the account, so a saved conversation draws it again', !!account && json(account.receipt) === '[{"from":"proof","label":"Not checked"}]' && typeof account.proven === 'string');
}

console.log('\nWhere it sits:');
{
  const loopSrc = src('js', 'agent-loop.js');
  ok('the loop names no screen helper and no part of the mode', !/document\.|appendThinking|appendStep|appendToolBlock|appendTextToBubble|cdrTraceAdd|setStatus|scrollMessages|terminalLog|addChangeEntry|callWithRouter|coderModel|coderQueue|conversationMsgs|activeContentEl|\bcontentEl\b/.test(loopSrc));
  const mode = src('modes', 'code', 'mode.js');
  ok('HashCoder runs it, handing in what it shows and what it needs', /return window\.HCAgentLoop\.run\(\{ messages, tools, label, signal, ui, temperature, state: sharedState, prefs: cdrPrefs, call: /.test(mode) && !/async function runLoop/.test(mode));
  const boot = src('boot.js');
  ok('it is loaded before the modes', boot.indexOf("'/js/agent-loop.js'") > 0 && boot.indexOf("'/js/agent-loop.js'") < boot.indexOf("'/modes/boot.js'"));
  ok('it is part of npm run check', /npm run check:agent-loop\b/.test(readFileSync(join(here, '..', '..', 'package.json'), 'utf8')));
}

console.log(`\n${pass} passed, ${fail} failed  (src/js/agent-loop.js)`);
process.exit(fail ? 1 : 0);
