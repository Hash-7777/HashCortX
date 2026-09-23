// ============================================================
// A Finance report from a connected system — src/js/finance/connected.js.
// Run with: npm run check:finance-connected
// ============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const src = (...p) => readFileSync(join(here, '..', '..', 'src', ...p), 'utf8');

let pass = 0, fail = 0;
const ok = (label, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`); }
};

const tool = (name) => ({ name, on: true, reads: true, approved: 'd', definition: 'd' });
const conns = [
  { id: 'c1', name: 'Company ERP', allowCloud: false, tools: [tool('search_records')] },
  { id: 'c2', name: 'Shop Books', allowCloud: true, tools: [tool('list_payments')] },
  { id: 'c3', name: 'Company ERP Archive', allowCloud: false, tools: [tool('search_records')] },
];
const sandbox = { window: {}, JSON, Math, Number, String, Array, Object, Map, Set, Promise, Error, Date };
sandbox.window.HCMcp = { available: () => true, list: () => conns, find: (id) => conns.find((c) => c.id === id) || null, RECORD_WORDS: /\binvoices?\b/i };
vm.createContext(sandbox);
for (const f of [['js', 'chat', 'sources.js'], ['js', 'mcp', 'policy.js'], ['js', 'mcp', 'records.js'], ['js', 'finance', 'connected.js']]) {
  vm.runInContext(src(...f), sandbox, { filename: f[f.length - 1] });
}
const F = sandbox.window.HCFinanceConnected;
const local = 'qwen2.5-coder:7b', cloud = 'cloud:gemini:gemini-2.5-flash';

console.log('Which system a request is about:');
{
  const readable = [{ id: 'c1', name: 'Company ERP' }, { id: 'c3', name: 'Company ERP Archive' }];
  ok('the one it names', F.wanted('Summarise the unpaid invoices in Company ERP', readable).id === 'c1');
  ok('the longest name it says, when one name holds another', F.wanted('Totals from the company erp archive', readable).id === 'c3');
  ok('none, when it names none, however much it speaks of invoices', F.wanted('How should I track my invoices?', readable) === null);
}

console.log('\nThe records as an attachment:');
{
  ok('records become CSV, one column for every field', F.csvOf([{ number: 'INV/1', amount: 120 }, { number: 'INV/2', state: 'unpaid' }]) === 'number,amount,state\nINV/1,120,\nINV/2,,unpaid');
  ok('a cell holding a comma, a quote or a line break is quoted', F.csvOf([{ a: 'x, y', b: 'say "hi"', c: 'one\ntwo' }]) === 'a,b,c\n"x, y","say ""hi""","one\ntwo"');
  ok('a pair such as [7, "Delta Foods"] is its name, and anything nested is written whole', F.csvOf([{ customer: [7, 'Delta Foods'], lines: { n: 2 } }]) === 'customer,lines\nDelta Foods,"{""n"":2}"');
  ok('no records, no text', F.csvOf([]) === '');
  const system = { id: 'c1', name: 'Company ERP' };
  const a = F.attachmentOf(system, [
    { tool: 'sys_c1_search_records', args: { table: 'invoice' }, raw: { content: [{ type: 'text', text: '{"number":"INV/1","amount":120}\n{"number":"INV/2","amount":80}' }] } },
    { tool: 'sys_c1_balance', args: {}, raw: { content: [{ type: 'text', text: 'Balance: 200.00' }] } },
  ]);
  ok('it is named for the system, marked as records, and says where it came from', a.name === 'Company ERP records' && a.kind === 'records' && a.from === 'c1' && a.extracted === true && a.records === 2);
  ok('each read is its own section: the tool in words, what it was asked, how many records', /^--- Company ERP · search records \(table=invoice\) · 2 records ---\nnumber,amount\nINV\/1,120\nINV\/2,80/.test(a.text));
  ok('what came back in words is kept in words', /--- Company ERP · balance · 0 records ---\nBalance: 200\.00/.test(a.text));
}

console.log('\nWhere the records may go afterwards:');
{
  const kept = [{ name: 'Company ERP records', from: 'c1' }];
  ok('a conversation holding them is not sent to a cloud model the system keeps them from', F.heldFrom(kept, cloud).join() === 'Company ERP');
  ok('... and is to a model on this computer', F.heldFrom(kept, local).length === 0);
  ok('... and to a cloud model the system allows', F.heldFrom([{ from: 'c2' }], cloud).length === 0);
  ok('records from a system since removed stay from cloud models only', F.heldFrom([{ from: 'gone' }], cloud).join() === 'a connected system' && F.heldFrom([{ from: 'gone' }], local).length === 0);
  ok('a file is no record of a system', F.heldFrom([{ name: 'march.csv' }], cloud).length === 0);
}

console.log('\nBefore a request is sent:');
{
  const sent = [];
  let reads = 0;
  const mcp = {
    toolsFor: async (model, opts) => { reads++; return opts && opts.readsOnly && opts.only === 'c1' ? [{ type: 'function', function: { name: 'sys_c1_search_records', parameters: { type: 'object', properties: { table: {}, field: {}, value: {} }, required: ['table'] } } }] : []; },
    run: async (name, args, opts) => { sent.push(args); return { result: 'framed', ...(opts && opts.raw ? { raw: { content: [{ type: 'text', text: '{"number":"INV/2","amount":80,"state":"unpaid"}' }] } } : {}) }; },
  };
  const guessing = { run: async ({ tools, runTool, needsTool }) => {
    const name = tools[0].function.name;
    await runTool({ name, arguments: { table: 'invoice', field: 'customer', value: 'Acme Corp' } });
    return { text: '', calls: [{ name }], needsTool };
  } };
  const deps = { mcp, decide: guessing, shape: {}, modelValue: local, ask: async () => '' };
  const held = await F.prepare({ text: 'And the paid ones?', files: [], history: [{ role: 'user', attachments: [{ from: 'c1' }] }], modelValue: cloud }, { deps });
  ok('a conversation holding records a model may not see is not sent to it, and nothing is read', /^This conversation holds records read from Company ERP, which are kept to models on this computer, so it was not sent\./.test(held.refusal) && reads === 0);
  ok('a request that names no system reads nothing', Object.keys(await F.prepare({ text: 'What is a good margin for a bakery?', files: [], history: [], modelValue: local }, { deps })).length === 0 && reads === 0);
  const blocked = await F.prepare({ text: 'Totals from Company ERP', files: [], history: [], modelValue: cloud }, { deps });
  ok('one it names that keeps its records from this model is said, not reported without', /^Company ERP keeps its records to models on this computer, so they were not read\./.test(blocked.refusal) && reads === 0);
  const got = await F.prepare({ text: 'Summarise the unpaid invoices in Company ERP', files: [], history: [], modelValue: local }, { deps });
  ok('one it names is read with that system\'s reading tools only', reads === 1 && got.system.id === 'c1');
  ok('... a filter the person never asked for is not sent', JSON.stringify(sent) === '[{"table":"invoice"}]');
  ok('... and what came back is the attachment', got.attachment && got.attachment.from === 'c1' && /INV\/2,80,unpaid/.test(got.attachment.text));
  const empty = await F.prepare({ text: 'Totals from Company ERP', files: [], history: [], modelValue: local }, { deps: { ...deps, decide: { run: async () => ({ text: '', calls: [] }) } } });
  ok('when the system sends nothing back, no report is made from nothing', /^Company ERP sent nothing back to make a report from, so none was made\.$/.test(empty.refusal));
}

console.log('\nFinance uses it:');
{
  const mode = src('modes', 'finance', 'mode.js');
  const at = mode.indexOf('window.HCFinanceConnected.prepare(');
  ok('before a request is built, with the files and the whole conversation', at > 0 && at < mode.indexOf('const hasFiles = filesForPrompt.length > 0;') && /prepare\(\{ text: input\?\.value\?\.trim\(\) \|\| "", files: filesForPrompt, history: chatHistory, modelValue: getModel\(\) \}/.test(mode));
  ok('what it says instead is shown, and nothing is sent', /if \(prep\.refusal\) \{ send\.disabled = false; hideEmpty\(\); appendMessage\("ai", prep\.refusal\); return; \}/.test(mode));
  ok('what it read goes with the request as an attachment', /if \(prep\.attachment\) filesForPrompt\.push\(prep\.attachment\);/.test(mode));
  ok('the conversation keeps where each attachment came from, across a restart too', /extracted: !!f\.extracted, \.\.\.\(f\.from \? \{ from: f\.from \} : \{\}\),/.test(mode));
  const boot = src('boot.js');
  ok('it loads with Finance\'s own pieces', boot.indexOf("'/js/finance/prompt.js'") > 0 && boot.indexOf("'/js/finance/prompt.js'") < boot.indexOf("'/js/finance/connected.js'"));
}

console.log(`\n${pass} passed, ${fail} failed  (src/js/finance/connected.js)`);
process.exit(fail ? 1 : 0);
