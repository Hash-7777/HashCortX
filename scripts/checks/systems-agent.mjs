// ==============================================================
// ERP agent checks
//
// Loads the REAL src/js/systems/agent.js and holds what the agent is shown of
// the open system, how its answer is read into an action or into words alone,
// and the empty starter system. Reads the Systems mode and its panel for how
// the agent is wired: what each action does, that a model's answer is never
// carried out as it arrives, and that an exported file never talks to one.
//
// Run with: npm run check:systems-agent
// ==============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const src = (...p) => readFileSync(join(here, '..', '..', 'src', ...p), 'utf8');
const sandbox = { window: {} };
vm.createContext(sandbox);
for (const f of ['fences.js', 'systems/spec.js', 'systems/domain.js', 'systems/money.js', 'systems/samples.js', 'systems/scaffold.js', 'systems/agent.js']) {
  vm.runInContext(src('js', ...f.split('/')), sandbox, { filename: f });
}
const A = sandbox.window.HCSystemsAgent;
const SC = sandbox.window.HCSystemsScaffold;
const mode = src('modes', 'systems', 'mode.js');
const panel = src('modes', 'systems', 'panel.html');
const chat = src('js', 'systems', 'agent-chat.js');

let pass = 0;
let fail = 0;
function ok(label, cond) {
  if (cond) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}`); }
}

const spec = {
  name: 'Pages', description: 'A bookshop in Cairo', currency: 'EGP',
  modules: [{ id: 'books', name: 'Books', entity: 'books', screen: 'list' }],
  entities: { books: { id: 'books', name: 'Books', fields: [
    { id: 'title', label: 'Title', type: 'text' },
    { id: 'price', label: 'Price', type: 'number' },
    { id: 'status', label: 'Status', type: 'select', options: ['In stock', 'Sold out'] },
  ] } },
};
const rows = Array.from({ length: 30 }, (_, i) => ({ id: `b${i + 1}`, title: `Book ${i + 1}`, price: 10, status: 'In stock' }));

console.log('What the agent is shown of the open system:');
{
  const ctx = A.contextOf(spec, { books: rows }, { today: '2026-09-22' });
  ok('its name, what it is and its money', /System: Pages/.test(ctx) && /A bookshop in Cairo/.test(ctx) && /counted in EGP/.test(ctx));
  ok('each table with how many records it has, and the totals of its numbers', /Table "Books" \(id books\): 30 records · Price total 300/.test(ctx));
  ok('its fields and the choices a field offers', /status \(select: In stock\/Sold out\)/.test(ctx));
  ok('only the most recent records, said to be so', /The 12 most recent of them:/.test(ctx) && ctx.includes('"Book 30"') && !ctx.includes('"Book 1"'));
  ok('today\'s date', /Today is 2026-09-22/.test(ctx));
  const many = { ...spec, entities: Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`t${i}`, { name: `T${i}`, fields: spec.entities.books.fields }])) };
  const manyData = Object.fromEntries(Object.keys(many.entities).map((id) => [id, rows]));
  const shownRows = (A.contextOf(many, manyData).match(/^\{"id"/gm) || []).length;
  ok('however many tables, the records shown stay few enough for a free account', shownRows <= 50 && shownRows >= 30);
  ok('... while every table still says how many it has', (A.contextOf(many, manyData).match(/: 30 records/g) || []).length === 10);
  ok('a long value is cut to one short line', !A.contextOf(spec, { books: [{ id: 'x', title: 'a'.repeat(500) }] }).includes('a'.repeat(100)));
  ok('the starter is named as the starter', /the empty starter system/.test(A.contextOf(spec, {}, { starter: true })));
  ok('with nothing open it says so', A.contextOf(null, {}) === 'No system is open.');
}

console.log('\nWhat the model is sent:');
{
  const history = Array.from({ length: 20 }, (_, i) => ({ role: i % 2 ? 'agent' : 'user', text: `turn ${i}` }));
  const m = A.messages({ spec, data: { books: rows }, history, text: 'How many books?', today: '2026-09-22' });
  ok('the rules, then the conversation, then the message', m[0].role === 'system' && m[m.length - 1].content === 'How many books?');
  ok('the rules carry the open system', /THE SYSTEM THAT IS OPEN:[\s\S]*Table "Books"/.test(m[0].content));
  ok('only the last twelve turns of the conversation', m.length === 14 && m[1].content === 'turn 8');
  ok('the agent\'s turns are the assistant\'s', m.some((x) => x.role === 'assistant') && !m.some((x) => x.role === 'agent'));
  ok('it is told to ask for a business\'s name, trade and place before building, and never invent a name', /You must know three things first/.test(A.SYSTEM) && /Never invent a business name/.test(A.SYSTEM));
  ok('and that records are shown to the person before they change', /shows the person exactly what will change/.test(A.SYSTEM));
  ok('and never to claim an action it is not taking', /never say you are building, changing or adding anything unless "do" is the action that does it/.test(A.SYSTEM));
}

console.log('\nWhat is done with its answer:');
{
  const r = A.readReply('{"say":"Building it now.","do":"build","request":"a bookshop","business":{"name":"Pages","does":"sells books","place":"Cairo","currency":"egp"}}');
  ok('a build carries the business, its currency as a code', r.do === 'build' && r.business.name === 'Pages' && r.business.currency === 'EGP' && r.say === 'Building it now.');
  ok('a fenced answer is read too', A.readReply('```json\n{"say":"Hi","do":"none"}\n```').say === 'Hi');
  ok('words that are not the JSON asked for are shown, and do nothing', (() => { const x = A.readReply('Sure! I can help.'); return x.do === 'none' && x.say === 'Sure! I can help.' && x.readable === false; })());
  ok('an action it does not know is no action', A.readReply('{"say":"x","do":"delete_everything","request":"all"}').do === 'none');
  ok('an action with nothing to carry out is no action', A.readReply('{"say":"x","do":"change","request":"  "}').do === 'none');
  ok('a currency that is not a code is dropped', A.readReply('{"say":"x","do":"build","request":"r","business":{"does":"x","currency":"dollars"}}').business.currency === '');
  ok('a business only comes with a build', A.readReply('{"say":"x","do":"records","request":"Sara paid","business":{"name":"n"}}').business === null);
  ok('what it says is cut to size', A.readReply(JSON.stringify({ say: 'x'.repeat(5000), do: 'none' })).say.length === 1200);
  ok('an empty answer still says something', A.readReply('').say.length > 0);
}

console.log('\nWhat the app does with an answer, whatever the model:');
{
  ok('a local model is held to the answer\'s shape', A.REPLY_SCHEMA.properties.do.enum.join() === 'none,build,change,records' && A.REPLY_SCHEMA.required.includes('do'));
  ok('a business name and place the person never gave are not used', A.unsaid({ name: 'Bookstore', place: 'USA' }, ['Build me an ERP for a bookstore']).join() === 'name,place');
  ok('... what they did give is, with a trade word or a country added', A.unsaid({ name: 'Pages Bookshop', place: 'Cairo, Egypt' }, ['a bookshop called Pages in Cairo']).length === 0);
  ok('... in any language', A.unsaid({ name: 'مكتبة النور', place: 'القاهرة' }, ['مكتبة النور في القاهرة']).length === 0);
  ok('... and a plain name is fine when they said it has none', A.unsaid({ name: 'Bookshop', place: 'Cairo' }, ['a bookshop in Cairo, no name yet']).length === 0);
  ok('the question asked instead names only what is missing', /what the business is called/.test(A.askFor(['name'])) && !/where it is/.test(A.askFor(['name'])));
  const described = A.readReply('{"say":"What should it include?","do":"none","business":{"name":"Pages","does":"sells books","place":"Cairo"}}');
  const texts = ['Build me an ERP for a bookstore', "It's called Pages and it's in Cairo"];
  ok('a build it described and did not start is started, on the starter', A.settleBuild(described, { starter: true, userTexts: texts }).do === 'build');
  ok('... never over a system already built', A.settleBuild(described, { starter: false, userTexts: texts }).do === 'none');
  ok('... nor without a system asked for', A.settleBuild(described, { starter: true, userTexts: ["It's called Pages and it's in Cairo"] }).do === 'none');
  const claim = A.readReply('{"say":"Customer Sara Ali added successfully.","do":"none"}');
  ok('a change it claims and did not ask for is carried out, as records', A.noFalseClaim(claim, 'Add a customer: Sara Ali').do === 'records');
  ok('... or as a design change when it names a field or a screen', A.noFalseClaim(claim, 'Add a phone column to customers').do === 'change');
  ok('... and when nothing was asked, the claim is replaced by the truth', /^Nothing was changed/.test(A.noFalseClaim(claim, 'hello').say));
  ok('a design change sent down the records road is sent to the design', A.settle(A.readReply('{"say":"ok","do":"records","request":"ALTER TABLE"}'), { text: 'Add an ISBN field to the products table' }).do === 'change');
  ok('... while adding a record is left as records', A.settle(A.readReply('{"say":"ok","do":"records","request":"add"}'), { text: 'Add a customer called Sara' }).do === 'records');
  const none = (text) => A.settle(A.readReply('{"say":"Sure.","do":"none"}'), { text }).do;
  ok('a change to how the system looks, let pass with nothing done, is made', none('Use a serif typeface and compact density.') === 'change' && none('Switch the layout to a top bar.') === 'change');
  ok('... and so is showing a screen another way', none('Show Customers as a list instead.') === 'change' && none('show the orders as a kanban board') === 'change');
  ok('a new table asked for is made, while a record for a table is not a table', none('Add a Suppliers table with name, phone and city.') === 'change' && none('Create a new Staff table') === 'change' && A.settle(A.readReply('{"say":"ok","do":"records","request":"add"}'), { text: 'Add a customer to the customers table' }).do === 'records');
  ok('... while a question about the design is still only answered', none('What font does it use?') === 'none' && none('Can you show me the orders as a list?') === 'none' && none('How many customers do we have?') === 'none');
  ok('what it says as it acts is the app\'s, in the person\'s words, never a claim it is done',
    /^Working out what to change in your records: Add Sara/.test(A.leadIn({ do: 'records', say: 'Added!', request: 'INSERT INTO' }, 'Add Sara')) && A.leadIn({ do: 'none', say: 'Hi' }) === 'Hi');
}

console.log('\nThe empty starter system:');
{
  const opts = A.starterOptions('EGP');
  ok('an overview, customers, products, orders and invoices', opts.modules.map((m) => m.name).join() === 'Overview,Customers,Products,Orders,Invoices');
  ok('in the currency of the last system, or dollars', opts.currency === 'EGP' && A.starterOptions('nope').currency === 'USD');
  ok('an order and an invoice point at their customer', opts.modules.filter((m) => /orders|invoices/.test(m.entity)).every((m) => m.fields.some((f) => f.type === 'link' && f.entity === 'customers')));
  const built = SC.build(A.STARTER_NAME, '2026-09-22', { setup: opts });
  ok('it can be built with no model', !!built && built.modules.length === 5 && built.name === 'My business');
  const orderFields = (built.entities.find ? built.entities.find((e) => e.id === 'orders') : built.entities.orders).fields.map((f) => f.id);
  ok('its orders keep their own fields though the dashboard names the table first', ['order_number', 'customer', 'date', 'total', 'status'].every((f) => orderFields.includes(f)));
  const empty = A.emptied(built);
  ok('and holds no records at all', Object.values(empty.mockData).every((r) => Array.isArray(r) && r.length === 0));
  ok('and says it is the starter', empty.starter === true);
  ok('an untouched starter gives way to a system that is built', A.isUntouchedStarter(empty, {}) === true);
  ok('one with a record in it does not', A.isUntouchedStarter(empty, { customers: [{ id: 'c1' }] }) === false);
  ok('nor one that has been changed', A.isUntouchedStarter({ ...empty, revisionHistory: [{}] }, {}) === false);
  ok('nor any system that is not the starter', A.isUntouchedStarter({ name: 'x' }, {}) === false);
}

console.log('\nHow the Systems mode uses it:');
{
  ok('whichever model can answer does', /window\.HCModelRoutes\.askWithFailover\(\{/.test(mode) && /options: availableModels/.test(mode));
  ok('the answer is read, and settled by the app, before anything is done', /const said = A\.settle\(A\.readReply\(answer\.text\), \{ starter: !!spec\?\.starter, userTexts, text \}\);/.test(mode)
    && /C\.reply\(unsaid\.length \? A\.askFor\(unsaid\) : A\.leadIn\(said, text\)\);/.test(mode) && /json: A\.REPLY_SCHEMA/.test(mode));
  ok('build, change and records go down the paths the ERP already had', /said\.do === "build" && !unsaid\.length\) await createSystem\(said\.business, said\.request\)/.test(mode)
    && /said\.do === "change"\) await reviseSystem\(said\.request, text\)/.test(mode) && /said\.do === "records"\) await workSystem\(said\.request, text\)/.test(mode));
  ok('a new system replaces the untouched starter, never one in use', /systems = \[spec, \.\.\.systems\.filter\(s => !window\.HCSystemsAgent\.isUntouchedStarter\(s, getRuntimeData\(s\)\)\)\];/.test(mode));
  ok('the ERP opens on the starter when there is no system', /if \(!systems\.length\) openStarter\(\);/.test(mode));
  ok('an exported file never wires the agent', /if \(!STANDALONE\) CHAT\(\)\?\.init\(/.test(mode));
  ok('a stop stops both the asking and a build under way', /function agentStop\(\) \{\s*agentAbort\?\.abort\(\);\s*stopSystemGeneration\(\);/.test(mode));
  ok('models are ranked by the shared ranking, which does not take "gemini" for "mini"', /const modelScore = \(value, label\) => [^\n]*window\.HCChatFailover\.strengthOf\(value, label\)/.test(mode) && !/function modelScore/.test(mode));
  ok('a build and a change are each routed by what they will send, not by the instructions alone', (mode.match(/runRoutes = newRoutes\(asking\);/g) || []).length === 1 && /runRoutes = newRoutes\(E\.messages\(spec, request\)\);/.test(mode));
  ok('the form that came before is gone', !/HCSystemsSetupDialog/.test(mode) && !/id="sysSetup"/.test(panel));
}

console.log('\nThe conversation on screen:');
{
  ok('the button and the panel are in the ERP\'s markup', /id="sysAgentFab"/.test(panel) && /id="sysAgent"/.test(panel) && /id="sysAgentLog"/.test(panel) && /id="sysAgentInput"/.test(panel));
  ok('it chooses its model in its own header', /id="sysModelSelect"/.test(panel));
  ok('nothing anyone said is written as markup', !/innerHTML|insertAdjacentHTML|outerHTML/.test(chat));
  ok('it is kept between visits, and cut to the most recent', /STORE_KEY = 'hc_sys_agent_chat_v1'/.test(chat) && /turns\.slice\(-MAX_KEPT\)/.test(chat));
  ok('Enter sends and Shift+Enter starts a new line', /e\.key === 'Enter' && !e\.shiftKey && !e\.isComposing/.test(chat));
  ok('nothing is sent while it is busy', /if \(!text \|\| busy \|\| !deps\) return;/.test(chat));
}

console.log(`\n${pass} passed, ${fail} failed  (src/js/systems/agent.js)`);
process.exit(fail ? 1 : 0);
