// ==============================================================
// Systems design edits — checks
//
// Loads the REAL src/js/systems/edits.js and holds that a design change is
// asked for as a short list of edits, held to a schema naming only what the
// system has, and made by the app: each kind of edit, what it keeps (a field
// renamed keeps its values, a new field starts empty), what it refuses and
// why in words a model can be sent back with, and that the ERP mode asks for
// edits, asks once more with what could not be made, and still shows the
// change before making it.
//
// Run with: npm run check:systems-edits
// ==============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const src = (...p) => readFileSync(join(here, '..', '..', 'src', ...p), 'utf8');
const sandbox = { window: {} };
vm.createContext(sandbox);
for (const f of [['js', 'forge', 'expr.js'], ['js', 'systems', 'spec.js'], ['js', 'systems', 'theme.js'], ['js', 'systems', 'edits.js']]) vm.runInContext(src(...f), sandbox, { filename: f.at(-1) });
const E = sandbox.window.HCSystemsEdits;
const mode = src('modes', 'systems', 'mode.js');

let pass = 0;
let fail = 0;
function ok(label, cond) {
  if (cond) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}`); }
}

const base = () => ({
  id: 'sys1', name: 'Nile Books', description: 'A bookshop.',
  theme: { mode: 'dark', radius: 10, font: 'sans', density: 'comfortable', surface: 'flat' },
  layout: { shell: 'sidebar', nav: 'sidebar' },
  modules: [
    { id: 'overview', name: 'Overview', entity: 'orders', screen: 'dashboard' },
    { id: 'catalogue', name: 'Catalogue', entity: 'books', screen: 'list' },
    { id: 'people', name: 'Customers', entity: 'customers', screen: 'cards' },
    { id: 'orders', name: 'Orders', entity: 'orders', screen: 'kanban' },
    { id: 'suppliers', name: 'Suppliers', entity: 'suppliers', screen: 'list' },
  ],
  entities: {
    books: { id: 'books', name: 'Books', fields: [{ id: 'title', label: 'Title', type: 'text' }, { id: 'author', label: 'Author', type: 'text' }, { id: 'price', label: 'Price', type: 'number' }, { id: 'quantity', label: 'Quantity', type: 'number' }] },
    customers: { id: 'customers', name: 'Customers', fields: [{ id: 'name', label: 'Name', type: 'text' }, { id: 'email', label: 'Email', type: 'text' }] },
    orders: { id: 'orders', name: 'Orders', fields: [{ id: 'order_number', label: 'Order #', type: 'text' }, { id: 'total', label: 'Total', type: 'number' }, { id: 'stage', label: 'Stage', type: 'select', options: ['New', 'Paid', 'Shipped'] }, { id: 'date', label: 'Date', type: 'date' }] },
    suppliers: { id: 'suppliers', name: 'Suppliers', fields: [{ id: 'name', label: 'Name', type: 'text' }, { id: 'phone', label: 'Phone', type: 'text' }] },
  },
  mockData: { books: [{ id: 'b1', title: 'Palace Walk', price: 12 }] },
});
const run = (changes, spec = base()) => E.apply(spec, changes, { icon: (n) => `icon:${n}` });

console.log('What the model is shown and may write:');
{
  const d = E.describe(base());
  ok('the system as names and types, no records', /- Books: Title \(text\); Author \(text\); Price \(number\); Quantity \(number\)/.test(d) && /- Orders: .*Stage \(select: New, Paid, Shipped\)/.test(d) && !/Palace Walk/.test(d));
  ok('its screens and look, and that colours cannot change', /- Catalogue: shows Books as list/.test(d) && /Colours are the app's own/.test(d));
  const s = E.schema(base());
  const kinds = s.properties.changes.items.anyOf.map((x) => x.properties.op.enum[0]);
  ok('every kind of edit, and only those', kinds.join() === 'add_field,rename_field,change_field,remove_field,add_table,remove_table,add_screen,rename_screen,change_screen,remove_screen,rename_system,set_look');
  const addField = s.properties.changes.items.anyOf[0].properties;
  ok('a table it names is one the system has', addField.table.enum.join() === 'Books,Customers,Orders,Suppliers');
  ok('and so are a field and a screen', s.properties.changes.items.anyOf[1].properties.field.enum.includes('Price') && s.properties.changes.items.anyOf[7].properties.screen.enum.join() === 'Overview,Catalogue,Customers,Orders,Suppliers');
  const m = E.messages(base(), 'add an ISBN', ['there is no table called "Bookz"']);
  ok('it is asked for edits, not the system written out, with the change and what went wrong last time', /Never rewrite the system/.test(m[0].content) && /The change: add an ISBN/.test(m[1].content) && /there is no table called "Bookz"/.test(m[1].content));
  const forms = m[0].content;
  ok('shown every edit written the one way it is read, for a model not held to the schema', kinds.every((k) => forms.includes(`{"op":"${k}"`)));
  const D = sandbox.window.HCSystemsTheme.DESIGN;
  ok('... with the look\'s choices as the system has them', forms.includes(`"layout":"${D.shell.join('|')}"`) && forms.includes(`"typeface":"${D.font.join('|')}"`) && forms.includes(`"density":"${D.density.join('|')}"`) && forms.includes(`"surfaces":"${D.surface.join('|')}"`));
  ok('told what the app has already done, so it leaves it out', /Already done by the app, so leave it out: change the look: corners 16\./.test(E.messages(base(), 'x', [], ['change the look: corners 16'])[1].content));
  ok('its answer is read however it is wrapped', E.read('Here: {"changes":[{"op":"rename_system","name":"X"}]} done').length === 1 && E.read('no') === null && E.read('{"changes":"x"}') === null);
  const cut = E.read('{"changes": [{"op": "add_field", "table": "Books", "label": "A {b}", "type": "text"}, {"op": "rename_system", "name": "X"}, {"op": "add_fi');
  ok('an answer cut off part-way keeps every edit it finished', cut.length === 2 && cut[0].label === 'A {b}' && cut[1].name === 'X');
  ok('the mode does not carry a cut-off list on', /need: 2000, untilFinished: false \}/.test(mode));
}

console.log('\nFields:');
{
  const r = run([{ op: 'add_field', table: 'books', label: 'ISBN', type: 'text' }]);
  ok('added to the table named, however the name is written', r.spec.entities.books.fields.at(-1).label === 'ISBN' && r.spec.entities.books.fields.at(-1).id === 'isbn' && r.done[0].includes('Books: add "ISBN"'));
  ok('empty on the records the table has: nothing is invented', r.done[0].includes('empty on the records it already has') && !('isbn' in r.spec.mockData.books[0]));
  const sel = run([{ op: 'add_field', table: 'Books', label: 'Format', type: 'select', options: ['Paperback', 'Hardback'] }]);
  ok('a select field keeps its options', sel.spec.entities.books.fields.at(-1).options.join() === 'Paperback,Hardback');
  ok('... and needs two of them', run([{ op: 'add_field', table: 'Books', label: 'Format', type: 'select', options: ['One'] }]).problems[0].includes('at least two options'));
  const link = run([{ op: 'add_field', table: 'Orders', label: 'Customer', type: 'link', link_to: 'Customers' }]);
  ok('a link points at the table it names', link.spec.entities.orders.fields.at(-1).entity === 'customers');
  ok('... and not at one the system does not have', run([{ op: 'add_field', table: 'Orders', label: 'Shop', type: 'link', link_to: 'Shops' }]).problems[0].includes('does not have'));
  const f = run([{ op: 'add_field', table: 'Books', label: 'Stock value', type: 'number', formula: 'Quantity * Price' }]);
  ok('a worked-out number is written in the ids the system uses', f.spec.entities.books.fields.at(-1).formula === 'quantity * price' && f.done[0].includes('worked out as Quantity * Price'));
  ok('a formula that cannot be read is said so', run([{ op: 'add_field', table: 'Books', label: 'V', type: 'number', formula: 'Quantity *' }]).problems[0].includes('could not be read'));
  const lookField = run([{ op: 'add_field', table: 'Books', label: 'Square Corners', type: 'select', options: ['Yes', 'No'] }, { op: 'add_field', table: 'Books', label: 'Font', type: 'text' }]);
  ok('a field named for the look is a look request misread, and is left out quietly', lookField.done.length === 0 && lookField.unchanged.length === 2 && lookField.problems.length === 0);
  ok('... while a field that only mentions a look word is a field', run([{ op: 'add_field', table: 'Books', label: 'Cover font notes', type: 'text' }]).done.length === 1);
  ok('a field it already has is not added twice', run([{ op: 'add_field', table: 'Books', label: 'title', type: 'text' }]).problems[0].includes('already has'));
  const ren = run([{ op: 'rename_field', table: 'Books', field: 'Price', label: 'Retail price' }]);
  ok('renamed, keeping its id and so its values', ren.spec.entities.books.fields[2].id === 'price' && ren.spec.entities.books.fields[2].label === 'Retail price' && ren.done[0].includes('keeping its values'));
  const ch = run([{ op: 'change_field', table: 'Books', field: 'Author', type: 'select', options: ['Mahfouz', 'Other'] }]);
  ok('changed to another type with its options', ch.spec.entities.books.fields[1].type === 'select' && ch.spec.entities.books.fields[1].options.length === 2);
  const same = run([{ op: 'change_field', table: 'Books', field: 'Author', type: 'text' }]);
  ok('a change that changes nothing is said so, and is not a fault to send back', same.unchanged[0].includes('already like that') && same.problems.length === 0);
  const rm = run([{ op: 'remove_field', table: 'Books', field: 'Author' }]);
  ok('removed, its values kept in the records', !rm.spec.entities.books.fields.some((x) => x.id === 'author') && rm.done[0].includes('kept in the records'));
  ok('a table it does not have, or a field it does not have, is said so', run([{ op: 'add_field', table: 'Bookz', label: 'X', type: 'text' }]).problems[0] === 'there is no table called "Bookz"' && run([{ op: 'remove_field', table: 'Books', field: 'Colour' }]).problems[0] === 'Books has no field called "Colour"');
}

console.log('\nTables and screens:');
{
  const t = run([{ op: 'add_table', name: 'Loyalty Members', fields: [{ label: 'Member', type: 'text' }, { label: 'Points', type: 'number' }], screen: 'metric' }]);
  const id = t.newTables[0];
  ok('a new table, with a screen to show it', id === 'loyalty_members' && t.spec.entities[id].fields.length === 2 && t.spec.modules.at(-1).entity === id && t.spec.modules.at(-1).screen === 'metric' && t.spec.modules.at(-1).icon === 'icon:Loyalty Members');
  const bare = run([{ op: 'add_table', name: 'Scores', fields: [{ label: 'Points', type: 'number' }] }]);
  ok('given a name field when it has no text field, and said to be new so records can be written for it', bare.spec.entities.scores.fields[0].label === 'Name' && bare.newTables.length === 1 && t.newTables.length === 1);
  const own = run([{ op: 'add_table', name: 'Returns', fields: [{ label: 'order', type: 'text' }, { label: 'date', type: 'date' }], screen: 'timeline' }]);
  ok('... but not when a text field of its own can name its records; names start with a capital', own.spec.entities.returns.fields.map((f) => f.label).join() === 'Order,Date' && own.spec.modules.at(-1).screen === 'timeline');
  const k = run([{ op: 'add_table', name: 'Events', fields: [{ label: 'Title', type: 'text' }], screen: 'kanban' }]);
  ok('shown as a list when it cannot be shown as asked, and said why', k.spec.modules.at(-1).screen === 'list' && k.done[0].includes('not as kanban'));
  ok('a table it already has is not added again', run([{ op: 'add_table', name: 'Book', fields: [] }]).problems[0].includes('already a table'));
  const gone = run([{ op: 'add_table', name: 'Staff', fields: [{ label: 'Name', type: 'text' }], screen: 'list' }, { op: 'remove_table', table: 'Suppliers' }]);
  ok('removed with its screens', !gone.spec.entities.suppliers && !gone.spec.modules.some((m) => m.entity === 'suppliers'));
  ok('... but never below five screens', run([{ op: 'remove_table', table: 'Suppliers' }]).problems[0].includes('fewer than 5 screens'));
  const linked = run([{ op: 'add_field', table: 'Books', label: 'Supplier', type: 'link', link_to: 'Suppliers' }, { op: 'add_table', name: 'Staff', fields: [{ label: 'Name', type: 'text' }] }, { op: 'remove_table', table: 'Suppliers' }]);
  ok('a link to a removed table becomes plain text', linked.spec.entities.books.fields.find((x) => x.label === 'Supplier').type === 'text');
  const scr = run([{ op: 'add_screen', name: 'Stock', table: 'Books', screen: 'report' }]);
  ok('a screen added for a table it has', scr.spec.modules.at(-1).name === 'Stock' && scr.spec.modules.at(-1).screen === 'report');
  ok('not one its table cannot fill, said why', run([{ op: 'add_screen', name: 'Diary', table: 'Books', screen: 'calendar' }]).problems[0].includes('no date field'));
  const cs = run([{ op: 'change_screen', screen: 'Catalogue', to: 'cards' }, { op: 'rename_screen', screen: 'Customers', name: 'Readers' }]);
  ok('a screen shown another way, and renamed', cs.spec.modules[1].screen === 'cards' && cs.spec.modules[2].name === 'Readers');
  ok('a screen it does not have is said so', run([{ op: 'rename_screen', screen: 'Nowhere', name: 'X' }]).problems[0].includes('no screen called'));
  ok('a system keeps at least five screens', run([{ op: 'remove_screen', screen: 'Suppliers' }]).problems[0].includes('at least 5 screens'));
}

console.log('\nNothing is removed unless the request asks:');
{
  const r = E.apply(base(), [{ op: 'remove_table', table: 'Customers' }], { request: 'Show Customers as a list instead.' });
  ok('a removal the request did not ask for is not made, and said so to be asked again', r.problems[0].includes('does not ask to remove') && r.spec.entities.customers && !r.done.length);
  const asked = E.apply(base(), [{ op: 'add_table', name: 'Staff', fields: [{ label: 'Name', type: 'text' }] }, { op: 'remove_table', table: 'Suppliers' }], { request: 'Add a staff table and delete the suppliers.' });
  ok('one it asked for is made', !asked.spec.entities.suppliers && asked.done.length === 2);
  ok('other edits in the same list still are', E.apply(base(), [{ op: 'rename_system', name: 'X' }, { op: 'remove_field', table: 'Books', field: 'Author' }], { request: 'Rename it X' }).done.length === 1);
  ok('the mode judges a removal by the person\'s own words, not the agent\'s retelling', /E\.apply\(spec, \[\.\.\.plain\.changes, \.\.\.edits\], \{ icon: moduleIcon, request: asked \}\)/.test(mode) && /await reviseSystem\(said\.request, text\)/.test(mode) && /E\.plainEdits\(spec, asked\)/.test(mode));
}

console.log('\nThe system and its look:');
{
  const r = run([{ op: 'rename_system', name: 'Nile Books & Coffee' }, { op: 'set_look', layout: 'top', typeface: 'serif', density: 'compact', surfaces: 'elevated', corners: 40 }]);
  ok('renamed', r.spec.name === 'Nile Books & Coffee');
  ok('layout, typeface, density, surfaces and corners, within what a system can take', r.spec.layout.shell === 'top' && r.spec.layout.nav === 'top' && r.spec.theme.font === 'serif' && r.spec.theme.density === 'compact' && r.spec.theme.surface === 'elevated' && r.spec.theme.radius === 20);
  ok('a look it cannot take is a fault; one it already has is only said', run([{ op: 'set_look', typeface: 'comic' }]).problems.length === 1 && run([{ op: 'set_look', layout: 'sidebar' }]).unchanged.length === 1);
  ok('an edit that is not one is said so', run([{ op: 'paint', colour: 'blue' }]).problems[0].includes('not an edit'));
  const before = base();
  run([{ op: 'rename_system', name: 'Changed' }], before);
  ok('the system handed in is never changed', before.name === 'Nile Books');
}

console.log('\nWhat a request plainly asks for is read by the app:');
{
  const p = (t) => E.plainEdits(base(), t);
  const look = p('Use a serif typeface and compact density.');
  ok('a typeface and a density', look.whole && JSON.stringify(look.changes) === '[{"op":"set_look","typeface":"serif","density":"compact"}]');
  ok('a layout, corners and surfaces', p('Make the corners rounded and put the menu at the top').changes[0].layout === 'top' && p('Make the corners rounded and put the menu at the top').changes[0].corners === 16 && p('Give the cards shadows').changes[0].surfaces === 'elevated' && p('Use 6px corners').changes[0].corners === 6);
  const show = p('Show Catalogue as cards instead.');
  ok('a screen shown another way, named by the screen', show.whole && show.changes[0].op === 'change_screen' && show.changes[0].screen === 'Catalogue' && show.changes[0].to === 'cards');
  ok('... or by the table it shows, when one screen shows it', p('show the books as a board').changes[0].screen === 'Catalogue' && p('show the invoices as a list').changes.length === 0);
  ok('a request that asks for more is not whole: the model is asked for the rest', p('Add an ISBN field and use a serif font').whole === false && p('Add an ISBN field and use a serif font').changes.length === 1);
  ok('a request with nothing plain in it has nothing read', p('Add an ISBN field to Books').changes.length === 0);
  ok('the mode makes a whole one without a model, and puts what it read first otherwise, telling the model', /let made = plain\.whole \? E\.apply\(spec, plain\.changes/.test(mode) && /E\.apply\(spec, \[\.\.\.plain\.changes, \.\.\.edits\]/.test(mode) && /E\.messages\(spec, request, problems, already\)/.test(mode));
}

console.log('\nThe ERP mode asks for edits:');
{
  ok('the agent changes the open system when it says so, and only one is open', /else if \(said\.do === "change"\) await reviseSystem\(said\.request, text\);/.test(mode) && /if \(!spec \|\| runAbort \|\| !String\(request\)\.trim\(\)\) return;/.test(mode));
  ok('the answer is held to the edits schema, not the whole system', /callModel\(model, E\.messages\(spec, request, problems, already\), signal, 0\.2, \{ json: E\.schema\(spec\), need: 2000, untilFinished: false \}\)/.test(mode) && !/You are CHANGING an existing system/.test(mode));
  ok('what could not be made is sent back once', /for \(let round = 1; round <= 2 && !made; round\+\+\)/.test(mode) && /problems = out\.problems/.test(mode));
  ok('the records are kept, and a new table gets records written for this business', /mockData: \{ \.\.\.data \}/.test(mode) && /if \(made\.newTables\.length\) next = await writeMissingRecords\(next/.test(mode));
  ok('a design change is shown and asked about before it is made, with what could not be done', /if \(!\(await window\._H\.themedConfirm\(`This will change the design of \$\{spec\.name\}:/.test(mode) && /Could not be done:/.test(mode));
  ok('the system as it was is kept as a version, records and all', /next\.revisionHistory = \[snapshot\(spec, request\)/.test(mode) && /mockData: getRuntimeData\(spec\), revisionHistory: \[\]/.test(mode));
  ok('restoring a version saves its records', /saveRuntimeData\(restored, restored\.mockData\);/.test(mode));
  ok('a change that fails leaves the system as it was, and says so', /the system is as it was/.test(mode));
  ok('the exported app carries it', /'\/js\/systems\/edits\.js'/.test(src('js', 'systems', 'export-app.js')));
}

console.log(`\n${pass} passed, ${fail} failed  (src/js/systems/edits.js)`);
process.exit(fail ? 1 : 0);
