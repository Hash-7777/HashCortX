// ==============================================================
// Agent context-budgeting checks
//
// Loads the real src/js/agent-context.js and asserts what the model ends up
// seeing. The first check is the regression test for the defect that made the
// coding agent weak: a file it had just read arriving as 800 characters.
//
// Run with: npm run check:agent
// ==============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const target = process.argv[2] || join(here, '..', '..', 'src', 'js', 'agent-context.js');

const sandbox = { console };
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(readFileSync(target, 'utf8'), sandbox, { filename: 'agent-context.js' });

const { DEFAULTS, TIERS, optionsFor, budgetToolResults, hiddenCount, hideOldResults, withContext, compressHistory } = sandbox.window.HCAgentContext;

let pass = 0, fail = 0;
function check(label, condition, detail = '') {
  if (condition) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}
/** The note on earlier requests: its own message, marked, or '' when nothing rolled. */
const rolledOf = (out) => ((out || []).find((m) => m && m.rolled) || {}).content || '';

const tool = (content, id = 't') => ({ role: 'tool', tool_call_id: id, content });
const user = (content) => ({ role: 'user', content });
const asst = (content) => ({ role: 'assistant', content });
const sys  = (content) => ({ role: 'system', content });

const bigFile = 'x'.repeat(40000);

console.log('\nWhat arrives whole:');
{
  const out = compressHistory([sys('p'), user('read main.rs'), asst(''), tool(bigFile)]);
  check('a 40,000-char file the agent just read arrives WHOLE',
    out[3].content.length === 40000,
    `got ${out[3].content.length} chars`);
}
{
  const out = budgetToolResults([tool('y'.repeat(1200))]);
  check('a 1,200-char result is not trimmed either',
    out[0].content.length === 1200, `got ${out[0].content.length}`);
}

console.log('\nOlder results give way, newest-first:');
{
  // Three results of 30k against a 60k budget: the newest stays whole, and
  // older ones are hidden, enough at once to bring what is shown to half.
  const msgs = [sys('p'), user('go')];
  for (const [id, ch] of [['1', 'a'], ['2', 'b'], ['3', 'c']]) {
    msgs.push({ role: 'assistant', content: '', tool_calls: [{ id, function: { name: 'read_file', arguments: `{"path":"/p/${ch}.js"}` } }] }, tool(ch.repeat(30000), id));
  }
  const out = compressHistory(msgs).filter((m) => m.role === 'tool');
  check('the newest result survives intact', out[2].content.length === 30000);
  check('the older ones are hidden, saying what they were', /Earlier result of read_file \/p\/a\.js/.test(out[0].content) && /Earlier result of read_file \/p\/b\.js/.test(out[1].content));
  const shown = out.filter((m) => !/^\[Earlier result/.test(m.content)).reduce((t, m) => t + m.content.length, 0);
  check('what is shown after a step fits the budget', shown <= DEFAULTS.toolBudget, `${shown}`);
}
{
  // Results of uneven size over a long run: what is shown never passes the budget.
  const msgs = [sys('p'), user('go')];
  let worst = 0;
  for (let i = 0; i < 60; i++) {
    msgs.push({ role: 'assistant', content: '', tool_calls: [{ id: 'w' + i, function: { name: 'read_file', arguments: `{"path":"/p/w${i}.js"}` } }] }, tool('w'.repeat(3000 + (i % 3) * 2500), 'w' + i));
    const shown = compressHistory(msgs).filter((m) => m.role === 'tool' && !/^\[Earlier result/.test(m.content)).reduce((t, m) => t + m.content.length, 0);
    worst = Math.max(worst, shown);
  }
  check('over a long run, what is shown never passes the budget', worst <= DEFAULTS.toolBudget, `${worst}`);
}
{
  check('nothing is hidden while the results fit the budget and the count', hiddenCount([5000, 5000, 5000]) === 0);
  check('the newest result is never hidden, however large', hiddenCount([100, 90000]) === 1 && hiddenCount([90000]) === 0);
  check('by count, older results go several at a time',
    hiddenCount(Array(DEFAULTS.keepResults + DEFAULTS.hideStep - 1).fill(10)) === 0 && hiddenCount(Array(DEFAULTS.keepResults + DEFAULTS.hideStep).fill(10)) === DEFAULTS.hideStep);
}

console.log('\nTruncation is legible:');
{
  const out = budgetToolResults([tool('a'.repeat(200000)), tool('b'.repeat(60000))]);
  const trimmed = out[0].content;
  check('a result longer than the most one may be is cut', trimmed.length < 200000 && out[1].content.length === 60000);
  check('says how much was dropped', /characters omitted/.test(trimmed));
  check('says how to get it back', /Re-read the file|narrower query/.test(trimmed));
  check('keeps the head', trimmed.startsWith('aaaa'));
  check('keeps some of the tail', trimmed.endsWith('aaaa'));
  check('a cut result is cut the same way every time', budgetToolResults([tool('a'.repeat(200000))])[0].content === trimmed);
}

console.log('\nEach request is the last one with more on the end:');
{
  // A run of 60 steps with results of uneven size. Between two steps of
  // hiding, what is sent must begin with exactly what was sent before, or
  // nothing of it can be reused; count the steps where it does not.
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const run = (options) => {
    const msgs = [sys('prompt'), user('Fix the failing test')];
    let breaks = 0, prev = null;
    for (let i = 0; i < 60; i++) {
      const size = 1500 + ((i * 7919) % 5) * 1000;
      msgs.push({ role: 'assistant', content: '', tool_calls: [{ id: 'c' + i, function: { name: 'read_file', arguments: `{"path":"/p/f${i}.js"}` } }] });
      msgs.push({ role: 'tool', tool_call_id: 'c' + i, name: 'read_file', content: 'r'.repeat(size) });
      const out = compressHistory(msgs, options);
      if (prev && !prev.every((m, k) => same(m, out[k]))) breaks++;
      prev = out;
    }
    return breaks;
  };
  const stepped = run();
  const sliding = run({ hideStep: 1, hideTo: 0.99 });
  check('at most one step in four starts differently from the one before', stepped <= 15, `${stepped} of 60`);
  check('...where hiding one result a turn would start differently at most of them', sliding >= 40 && stepped * 2 < sliding, `${sliding} of 60`);
}

console.log('\nSized to the model:');
{
  const [small, mid, local, cloud] = [optionsFor('small', true), optionsFor('mid', true), optionsFor('full', true), optionsFor('full', false)];
  check('a smaller model is shown less, of results and of a command\'s output',
    small.toolBudget < mid.toolBudget && mid.toolBudget < local.toolBudget && local.toolBudget < cloud.toolBudget &&
    small.shellOutput < mid.shellOutput && mid.shellOutput < local.shellOutput && local.shellOutput < cloud.shellOutput &&
    small.keepResults < mid.keepResults && mid.keepResults < cloud.keepResults);
  check('a cloud model is shown what it always was', cloud.toolBudget === DEFAULTS.toolBudget && cloud.keepResults === DEFAULTS.keepResults && cloud.maxResult === DEFAULTS.maxResult);
  check('a size it does not know is treated as the largest', optionsFor(undefined, false).toolBudget === cloud.toolBudget);
  check('every size keeps the rules it does not set', ['small', 'mid', 'full'].every((size) => ['keepRequests', 'requestStep', 'longArgument'].every((k) => optionsFor(size, true)[k] === DEFAULTS[k])) && optionsFor('full', true).hideTo === DEFAULTS.hideTo);
  check('no size cuts a whole numbered read of a file short', Object.values(TIERS).every((t) => t.maxResult >= 10000));
  // A small model's long run: what is shown stays within its budget, and the
  // request still starts the same way at most steps.
  const msgs = [sys('prompt'), user('Fix the failing test')];
  let worst = 0, breaks = 0, prev = null;
  for (let i = 0; i < 40; i++) {
    msgs.push({ role: 'assistant', content: '', tool_calls: [{ id: 'c' + i, function: { name: 'read_file', arguments: `{"path":"/p/f${i}.js"}` } }] });
    msgs.push({ role: 'tool', tool_call_id: 'c' + i, name: 'read_file', content: 'r'.repeat(1200 + (i % 4) * 900) });
    const out = compressHistory(msgs, small);
    const shown = out.filter((m) => m.role === 'tool' && !/^\[Earlier result/.test(m.content)).reduce((t, m) => t + m.content.length, 0);
    worst = Math.max(worst, shown);
    if (prev && !prev.every((m, k) => JSON.stringify(m) === JSON.stringify(out[k]))) breaks++;
    prev = out;
  }
  check('a small model is never shown more tool output than its budget', worst <= small.toolBudget, `${worst}`);
  check('...and its requests still start the same way at most steps', breaks <= 16, `${breaks} of 40`);
  const mode = readFileSync(join(here, '..', '..', 'src', 'modes', 'code', 'mode.js'), 'utf8');
  check('HashCoder passes the size of the model in use', /compressHistory\(msgs, \{ \.\.\.window\.HCAgentContext\.optionsFor\(sharedState\.size, sharedState\.local, window\.HCModelLimits\?\.forContext\?\.\([^\n]*\)\), dropOldThinking: /.test(mode) && /const local = !\/\^cloud:\/\.test\(model\);/.test(mode) && /sharedState\.size = size; sharedState\.local = local;/.test(mode));
}

console.log('\nInputs are not mutated:');
{
  const original = tool('q'.repeat(200000));
  const before = original.content.length;
  budgetToolResults([original]);
  check('the caller keeps its untrimmed copy', original.content.length === before);
}

console.log('\nNon-tool messages:');
{
  const msgs = [sys('p'), user('u'.repeat(50000)), asst('a'.repeat(50000))];
  const out = budgetToolResults(msgs);
  check('user and assistant turns are never trimmed',
    out[1].content.length === 50000 && out[2].content.length === 50000);
  check('a tool message with non-string content is left alone',
    budgetToolResults([{ role: 'tool', content: null }])[0].content === null);
}

console.log('\nSummarising older turns:');
{
  const short = [sys('p'), user('a'), asst('b')];
  check('a short conversation is not summarised',
    compressHistory(short).length === 3);

  const long = [sys('prompt')];
  for (let i = 0; i < 30; i++) { long.push(user('u' + i)); long.push(asst('a' + i)); }
  const out = compressHistory(long);
  check('a long conversation is shortened', out.length < long.length,
    `${long.length} -> ${out.length}`);
  check('exactly one system turn survives',
    out.filter(m => m.role === 'system').length === 1);
  check('the original system prompt is still there', out[0].content.startsWith('prompt'));
  check('the note on earlier requests is a message of its own, not in the instructions', /Earlier in this conversation/.test(rolledOf(out)) && out[0].content === 'prompt');
  check('the note keeps what the earlier requests asked', /"u0"/.test(rolledOf(out)) && /"u25"/.test(rolledOf(out)) && !/"u26"/.test(rolledOf(out)));
  check('the most recent turn is kept verbatim',
    out[out.length - 1].content === 'a29', out[out.length - 1].content);
}
{
  // An orphaned tool result — one with no assistant turn that asked for it —
  // is rejected outright by most provider APIs.
  const msgs = [sys('p')];
  for (let i = 0; i < 30; i++) msgs.push(user('u' + i));
  for (let i = 0; i < 6; i++) { msgs.push(asst('call')); msgs.push(tool('result ' + i)); }
  const out = compressHistory(msgs);
  const firstNonSystem = out.find(m => m.role !== 'system');
  check('the window never opens on an orphaned tool result',
    firstNonSystem.role !== 'tool', `starts with ${firstNonSystem.role}`);
}

console.log('\nA long task keeps its request:');
{
  // One request followed by thirty steps, each a call and its result.
  const call = (id, name, args) => ({ role: 'assistant', content: '', tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] });
  const res = (id, name, content) => ({ role: 'tool', tool_call_id: id, name, content });
  const msgs = [sys('prompt'), user('Fix the failing test in src/range.js')];
  for (let i = 0; i < 30; i++) {
    msgs.push(i === 0 ? call('c0', 'write_file', { path: '/p/src/big.js', content: 'w'.repeat(5000) }) : call('c' + i, 'read_file', { path: `/p/src/f${i}.js` }));
    msgs.push(res('c' + i, i === 0 ? 'write_file' : 'read_file', 'r'.repeat(900) + i));
  }
  const out = compressHistory(msgs);
  check('the request is still there, word for word', out.some((m) => m.role === 'user' && m.content === 'Fix the failing test in src/range.js'));
  check('no message is taken out of the request in progress', out.length === msgs.length, `${msgs.length} -> ${out.length}`);
  const results = out.filter((m) => m.role === 'tool');
  const hide = hiddenCount(msgs.filter((m) => m.role === 'tool').map((m) => m.content.length));
  check('the newest results arrive whole', hide > 0 && results.slice(hide).every((m) => m.content.startsWith('rrrr')) && results.length - hide >= DEFAULTS.keepResults);
  check('older results are hidden, saying what they were', new RegExp(`Earlier result of read_file /p/src/f${hide - 1}\\.js`).test(results[hide - 1].content));
  check('and how to see them again, a read saying what it showed', /hidden to keep the conversation short: it showed all 1 line\. Read it again for the exact text before you change it\.\]$/.test(results[1].content), results[1].content);

  // What a hidden read showed (readShown).
  const { readShown } = sandbox.window.HCAgentContext;
  check('a read of a long file says the window of lines it showed', readShown('read_file', '[rooms.py: lines 201-400 of 912. The numbers and "| " are not part of the file.]\n201| x') === 'it showed lines 201-400 of 912');
  check('a file read whole says how many lines', readShown('read_file', 'a\nb\nc\n') === 'it showed all 3 lines' && readShown('read_file', '[notes.md is empty.]') === 'the file was empty');
  check('a read that failed, and any other tool, say nothing of it', readShown('read_file', '{"error":"No such file"}') === '' && readShown('grep_code', 'x\ny') === '');
  const other = hideOldResults([{ role: 'assistant', content: '', tool_calls: [{ id: 'g', function: { name: 'grep_code', arguments: '{"pattern":"rate"}' } }] }, tool('x'.repeat(70000), 'g'),
    { role: 'assistant', content: '', tool_calls: [{ id: 'h', function: { name: 'grep_code', arguments: '{"pattern":"tax"}' } }] }, tool('y'.repeat(70000), 'h')]);
  check('a hidden search still says to call it again', /^\[Earlier result of grep_code rate, hidden to keep the conversation short\. Call the tool again if you need it\.\]$/.test(other[1].content), other[1].content);
  const written = out[2].tool_calls[0].function.arguments;
  check('a whole file written long ago is not sent again', !/w{400}/.test(written) && /5,000 characters/.test(written));
  check('its call still reads as JSON, with its path', JSON.parse(written).path === '/p/src/big.js');
  check('every result still follows the call it answers', out.every((m, i) => m.role !== 'tool' || (out[i - 1].role === 'assistant' || out[i - 1].role === 'tool')));
  check('what the caller holds is not changed', msgs[3].content.startsWith('rrrr') && /w{5000}/.test(msgs[2].tool_calls[0].function.arguments));
}
{
  const msgs = [sys('p'), user('look at the mockup')];
  for (let i = 0; i < 20; i++) {
    msgs.push({ role: 'assistant', content: '', tool_calls: [{ id: 'v' + i, function: { name: 'view_image', arguments: '{}' } }] });
    msgs.push({ role: 'tool', tool_call_id: 'v' + i, content: 'ok' });
    msgs.push({ role: 'user', content: 'This is shot.png, the image you opened.', images: ['QUJD'], opened: true });
  }
  const out = compressHistory(msgs);
  const pics = out.filter((m) => m.role === 'user' && m.images);
  check('a picture opened long ago is not sent again', pics.length < 20 && pics.length > 0);
  check('a picture message is not taken for a new request', out.some((m) => m.content === 'look at the mockup') && !out.some((m) => m && m.rolled) && !/Earlier in this conversation/.test(JSON.stringify(out)));
}
{
  const msgs = [sys('p'), user('Fix the loop in range.js'), { role: 'assistant', content: '', tool_calls: [{ id: 'r', function: { name: 'read_file', arguments: '{"path":"/p/range.js"}' } }] }, tool('function range() {}', 'r')];
  for (const why of ['no file in the project was changed', 'no test has run since', 'check your work against the request']) {
    msgs.push({ role: 'assistant', content: 'Done.' }, { role: 'user', content: 'Note from HashCortX, not from the person: ' + why, note: true });
  }
  const out = compressHistory(msgs);
  check('a note sending the agent back is not taken for a new request, however many there are',
    out.some((m) => m.content === 'Fix the loop in range.js') && out.some((m) => m.role === 'tool') && !out.some((m) => m && m.rolled) && !/Earlier in this conversation/.test(JSON.stringify(out)));
  const mode = readFileSync(join(here, '..', '..', 'src', 'modes', 'code', 'mode.js'), 'utf8');
  check('the note is marked where HashCoder adds it, and so is a nudge from the step budget', /\{ role: 'user', content: back\.message, note: true \}/.test(mode) && /\[verdict\.nudge, loopNote, window\.HCCodePlan\?\.recite\(HC\?\.code\?\.plan\)\]/.test(mode) && /\{ role: 'user', content: told, note: true \}/.test(mode));
}
{
  const asked = (i) => ({ role: 'user', content: 'request ' + i, images: ['QUJD'] });
  const msgs = [sys('p'), asked(1), { role: 'assistant', content: 'done' }, asked(2), { role: 'assistant', content: 'done' },
    asked(3), { role: 'assistant', content: 'done' }, asked(4), { role: 'assistant', content: 'done' }, asked(5)];
  const out = compressHistory(msgs);
  check('a request with pictures the person attached is a request', /Earlier in this conversation[^\]]*"request 1"/.test(rolledOf(out)) && out.some((m) => m.content === 'request 5'));
}
{
  const convo = (n) => { const m = [sys('p')]; for (let i = 1; i <= n; i++) m.push(user('r' + i), asst('done')); return m; };
  check('earlier requests roll into the note several at a time, not one a request',
    !rolledOf(compressHistory(convo(DEFAULTS.keepRequests + 1))) &&
    /"r1"; "r2"\)/.test(rolledOf(compressHistory(convo(DEFAULTS.keepRequests + 2)))) &&
    rolledOf(compressHistory(convo(DEFAULTS.keepRequests + 3))) === rolledOf(compressHistory(convo(DEFAULTS.keepRequests + 2))));
  const before = compressHistory(convo(DEFAULTS.keepRequests))[0], after = compressHistory(convo(DEFAULTS.keepRequests + 4))[0];
  check('the instructions are the same, byte for byte, before and after a roll', JSON.stringify(before) === JSON.stringify(after) && before.content === 'p', JSON.stringify([before, after]));
  const out = compressHistory(convo(DEFAULTS.keepRequests + 2));
  const at = out.findIndex((m) => m && m.rolled);
  check('the note comes right after the instructions, before the first request kept, as a note from the app', at === 1 && out[at].role === 'user' && out[at].note === true && out[2].content === 'r3', JSON.stringify(out.slice(0, 3)));
  check('...one note, however much rolled', out.filter((m) => m && m.rolled).length === 1 && compressHistory(convo(DEFAULTS.keepRequests + 6)).filter((m) => m && m.rolled).length === 1);
  const bare = (n) => { const m = []; for (let i = 1; i <= n; i++) m.push(user('r' + i), asst('done')); return m; };
  const noSystem = compressHistory(bare(DEFAULTS.keepRequests + 2));
  check('with no instructions at all, no system message is made for it', !noSystem.some((m) => m.role === 'system') && noSystem[0].rolled === true, JSON.stringify(noSystem.slice(0, 2)));
}

console.log('\nWhat the app adds to one request:');
{
  const req = { role: 'user', content: 'Make the header darker', context: 'For this request, from HashCortX (not from the person):\nActive file: /p/index.html' };
  const out = compressHistory([sys('p'), req]);
  check('is read after the person\'s own words', out[1].content.startsWith('Make the header darker\n\nFor this request') && /Active file/.test(out[1].content));
  check('is not sent as a field of its own', !('context' in out[1]));
  check('leaves the saved request as the person wrote it', req.content === 'Make the header darker' && 'context' in req);
  check('leaves the instructions alone', out[0].content === 'p');
  check('stays with its own request, not the next one', (() => {
    const two = compressHistory([sys('p'), req, asst('done'), user('And the footer')]);
    return /Active file/.test(two[1].content) && two[3].content === 'And the footer';
  })());
  check('a note from the app or a tool result is left as it is', withContext({ role: 'tool', content: 'x', context: 'y' }).content === 'x' && withContext({ role: 'user', content: 'n', note: true }).content === 'n');
  check('an empty addition changes nothing', withContext({ role: 'user', content: 'hi', context: '' }).content === 'hi');
}
{
  const few = [sys('p'), user('a'), { role: 'assistant', content: '', tool_calls: [{ id: 'x', function: { name: 'read_file', arguments: '{"path":"/a"}' } }] }, tool('whole', 'x')];
  check('a short run is sent as it is', JSON.stringify(hideOldResults(few)) === JSON.stringify(few));
}

console.log('\nThe project\'s notes:');
{
  const system = { role: 'system', content: 'rules', notes: 'NOTES from AGENTS.md' };
  const msgs = [system, user('Add a flag'), asst('done'), user('And a test')];
  const out = compressHistory(msgs);
  check('are read at the start of the first request, before the person\'s words', out[1].content === 'NOTES from AGENTS.md\n\nAdd a flag' && out[3].content === 'And a test');
  check('are not in the instructions, nor sent as a field', out[0].content === 'rules' && !('notes' in out[0]));
  check('the saved conversation keeps them where they were', system.notes === 'NOTES from AGENTS.md' && msgs[1].content === 'Add a flag');
  const run = [system, user('Fix it')];
  const at = [];
  for (let i = 0; i < 12; i++) {
    run.push({ role: 'assistant', content: '', tool_calls: [{ id: 'n' + i, function: { name: 'read_file', arguments: '{}' } }] }, tool('x'.repeat(500), 'n' + i));
    at.push(compressHistory(run)[1].content);
  }
  check('and stay the same from one step to the next', at.every((c) => c === at[0]) && at[0].startsWith('NOTES'));
  const convo = [system]; for (let i = 1; i <= 6; i++) convo.push(user('r' + i), asst('done'));
  const rolled = compressHistory(convo);
  check('when earlier requests roll away, the first request kept carries them', rolled.filter((m) => /^NOTES/.test(m.content || '')).length === 1 && /^NOTES[^]*r3$/.test(rolled[2].content) && rolled[1].rolled === true && !/NOTES/.test(rolled[1].content));
  check('a note from the app is never the one to carry them', compressHistory([system, { role: 'user', content: 'n', note: true }, user('ask')])[2].content.startsWith('NOTES'));
}

console.log('\nDegenerate inputs:');
check('a non-array is not fatal', budgetToolResults(null).length === 0 && compressHistory(null).length === 0);
check('an empty array is not fatal', budgetToolResults([]).length === 0);
check('a null message is not fatal', budgetToolResults([null, tool('x')]).length === 2);

console.log('\nThe thinking of older requests, at the roll:');
{
  const conv = [sys('rules')];
  for (let r = 0; r < 6; r++) { conv.push(user(`ask ${r}`), { role: 'assistant', content: `done ${r}`, thinking: `thought ${r}`, thinkingFrom: 'glm' }); }
  const kept = compressHistory(conv, { dropOldThinking: true, keepRequests: 3, requestStep: 2 });
  const asst = kept.filter((m) => m.role === 'assistant');
  check('when older requests roll, the thinking of those kept before the newest is dropped, and the newest keeps its own', asst.length > 0 && asst.slice(0, -1).every((m) => !('thinking' in m)) && asst[asst.length - 1].thinking === 'thought 5', JSON.stringify(asst.map((m) => m.thinking || null)));
  const few = [sys('rules'), user('ask 0'), { role: 'assistant', content: 'done 0', thinking: 'thought 0' }, user('ask 1')];
  check('...while nothing rolls, nothing is dropped, so a request still grows only at its end', compressHistory(few, { dropOldThinking: true })[2].thinking === 'thought 0');
  check('...and without the option, it is kept as before', compressHistory(conv, { keepRequests: 3, requestStep: 2 }).filter((m) => m.role === 'assistant').every((m) => typeof m.thinking === 'string'));
}

console.log('\nSized from what the model can take:');
{
  const json = (x) => JSON.stringify(x);
  const kinds = [['small', true], ['mid', true], ['full', true], ['full', false]];
  check('with no limits, or limits that say nothing, every size gets its tier exactly as before',
    kinds.every(([s, l]) => [undefined, null, {}, { window: NaN, charsPerToken: 3 }, { window: 0, charsPerToken: 3 }, { window: 200000 }].every((lim) => json(optionsFor(s, l, lim)) === json(optionsFor(s, l)))));
  check('a small or mid model on this computer keeps its tier, whatever its window', json(optionsFor('small', true, { window: 1e6, charsPerToken: 3 })) === json(optionsFor('small', true)) && json(optionsFor('mid', true, { window: 1e6, charsPerToken: 3 })) === json(optionsFor('mid', true)));
  const wide = optionsFor('full', false, { window: 200000, answer: 8000, charsPerToken: 3, fixed: 20000 });
  check('a wide window shows more: its share of what it can read, less the instructions and tools', wide.toolBudget === 325600 && wide.maxResult === 108533, json([wide.toolBudget, wide.maxResult]));
  check('...and only those two change', json({ ...wide, toolBudget: 0, maxResult: 0 }) === json({ ...optionsFor('full', false), toolBudget: 0, maxResult: 0 }));
  const narrow = optionsFor('full', false, { window: 8192, answer: 2048, charsPerToken: 3 });
  check('a narrow window never shows less than its tier', narrow.toolBudget === TIERS.cloud.toolBudget && narrow.maxResult === TIERS.cloud.maxResult, json([narrow.toolBudget, narrow.maxResult]));
  const perMinute = optionsFor('full', false, { window: 200000, answer: 8000, perMinuteIn: 12000, charsPerToken: 3 });
  check('a per-minute allowance holds it down to what fits in a minute', perMinute.toolBudget === TIERS.cloud.toolBudget, String(perMinute.toolBudget));
  const most = optionsFor('full', false, { window: 1e7, answer: 8000, charsPerToken: 3 });
  check('there is a most it ever shows, and one result is at most twice its tier', most.toolBudget === 600000 && most.maxResult === 2 * TIERS.cloud.maxResult, json([most.toolBudget, most.maxResult]));
  let rising = true, prev = optionsFor('full', false);
  for (let w = 4096; w <= 4e6; w *= 1.5) {
    const now = optionsFor('full', false, { window: Math.floor(w), answer: 8000, charsPerToken: 3, fixed: 15000 });
    if (now.toolBudget < prev.toolBudget || now.maxResult < prev.maxResult) rising = false;
    prev = now;
  }
  check('a larger window never shows less than a smaller one', rising);
  const local = optionsFor('full', true, { window: 131072, answer: 8000, charsPerToken: 3 });
  check('a large model on this computer is sized from its window too, never below its tier', local.toolBudget > TIERS.local.toolBudget && local.maxResult >= TIERS.local.maxResult, json([local.toolBudget, local.maxResult]));
  const mode = readFileSync(join(here, '..', '..', 'src', 'modes', 'code', 'mode.js'), 'utf8');
  check('HashCoder sizes what it shows from what the limits know of the model in use, with its instructions and tools counted', /optionsFor\(sharedState\.size, sharedState\.local, window\.HCModelLimits\?\.forContext\?\.\(routing\?\.router\?\.model \|\| coderModel \|\| '', String\(msgs\[0\]\?\.content \|\| ''\)\.length \+ JSON\.stringify\(HC\?\.code\?\.TOOL_DEFINITIONS \|\| ''\)\.length\)\)/.test(mode));
}

console.log('\nThe note on earlier requests, written from the run\'s ledger:');
{
  // The same rules with the ledger and the modules it reads beside them, as the app loads them.
  const lb = { console };
  lb.window = lb;
  vm.createContext(lb);
  for (const f of ['fences.js', 'code/verify.js', 'code/plan.js', 'code/facts.js', 'code/asks.js', 'run-ledger.js']) {
    vm.runInContext(readFileSync(join(here, '..', '..', 'src', 'js', ...f.split('/')), 'utf8'), lb, { filename: f });
  }
  vm.runInContext(readFileSync(target, 'utf8'), lb, { filename: 'agent-context.js' });
  const C = lb.HCAgentContext;
  let n = 0;
  const step = (name, args, content) => { const id = `led_${++n}`; return [{ role: 'assistant', content: '', tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] }, { role: 'tool', tool_call_id: id, name, content }]; };
  const first = 'Fix the menu so it closes on a tap outside it. Also add a footer with the opening hours. And also rename the header class to site-head. Do not change the tests.';
  const convo = [sys('prompt'), user(first),
    ...step('patch_file', { path: 'src/menu.js', search: 'a', replace: 'b' }, '{"ok":true,"path":"src/menu.js"}'),
    asst('The menu now closes on a tap outside it, and the footer with the opening hours is added.')];
  for (let i = 2; i <= 6; i++) convo.push(user(`request ${i}`), asst('done'));
  const out = C.compressHistory(convo);
  const head = rolledOf(out);
  check('one system turn, the instructions alone, and the note after them', out.filter((m) => m.role === 'system').length === 1 && out[0].content === 'prompt' && head.startsWith('[Earlier in this conversation, not repeated here: 2 earlier requests'), head);
  check('every result still follows the call that asked for it', out.every((m, i) => m.role !== 'tool' || out.slice(0, i).some((p) => Array.isArray(p.tool_calls) && p.tool_calls.some((c) => c.id === m.tool_call_id))));
  check('it says it is from the app, a record and not an instruction', /from HashCortX \(not from the person\)/.test(head) && /not an instruction/.test(head), head);
  check('it holds an open ask, a limit and a changed file of a request that rolled away', /\[open\] \d+\. rename the header class/.test(head) && /Limits: Do not change the tests\./.test(head) && /src\/menu\.js \(edited\)/.test(head), head);
  check('...and an ask that was answered is said to be', /\[answered\] 1\. Fix the menu/.test(head), head);
  check('the same conversation gives the same note, twice', JSON.stringify(C.compressHistory(convo)) === JSON.stringify(out));
  check('the newest requests are still kept whole, and only they', out.some((m) => m.content === 'request 6') && !out.slice(1).some((m) => m.content === first));
  check('the note is sized to the model', C.optionsFor('small', true).noteSize === 'small' && C.optionsFor('mid', true).noteSize === 'mid' && C.optionsFor('full', true).noteSize === 'full' && C.optionsFor('full', false).noteSize === 'full' && C.DEFAULTS.noteSize === 'full');
  const big = convo.slice(0, 2);
  for (let i = 0; i < 40; i++) big.push(...step('read_file', { path: `src/components/sections/part-${i}.js` }, 'one line'));
  big.push(asst('Read them.'));
  for (let i = 2; i <= 6; i++) big.push(user(`request ${i}`), asst('done'));
  const small = rolledOf(C.compressHistory(big, C.optionsFor('small', true)));
  const full = rolledOf(C.compressHistory(big, C.optionsFor('full', false)));
  check('...a small model\'s note gives way where a large one\'s keeps it all', /part-39\.js/.test(full) && !/part-39\.js/.test(small) && /rename the header class/.test(small), small);
  check('with the ledger missing, the note is the one the rules wrote before it (the checks above this hold it)', /"u0"/.test(rolledOf(compressHistory((() => { const l = [sys('p')]; for (let i = 0; i < 30; i++) l.push(user('u' + i), asst('a' + i)); return l; })()))));
}

console.log(`\n${pass} passed, ${fail} failed  (src/js/agent-context.js)`);
process.exit(fail ? 1 : 0);
