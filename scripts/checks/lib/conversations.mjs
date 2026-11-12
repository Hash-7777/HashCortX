// ==============================================================
// Invented agent runs, for replaying through the real context rules
//
// Each builder returns one run of the HashCoder loop as its messages would
// stand at the end: the instructions, the person's requests, the model's
// calls and the results that answered them, in the shapes the loop writes
// (js/agent-shape.js appendAssistantToolCallTurn and appendToolResult). A
// message the person sent while it worked is marked `added`, as the loop
// marks it; a picture the agent opened arrives as a user message marked
// `opened`. `notes` names the steps whose request carried a note on a copy
// only, as the loop's nudges do, by the number of the model call.
//
// Everything here is invented: the project, its files, their text and every
// request. The text of a file is made from its name and a line number, so a
// run is the same on every machine and in every run.
//
// Used by scripts/checks/replay.mjs.
// ==============================================================

const SYSTEM = 'You are a coding agent working in a project on this computer. Read before you change a file, keep changes small, and say what you proved.';

const system = (extra = {}) => Object.assign({ role: 'system', content: SYSTEM }, extra);
const ask = (content, extra = {}) => Object.assign({ role: 'user', content }, extra);
const answer = (content) => ({ role: 'assistant', content });

let ids = 0;
/** One call of the model and the result that answered it. */
function step(name, args, content) {
  const id = `call_${++ids}`;
  return [
    { role: 'assistant', content: '', tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] },
    { role: 'tool', tool_call_id: id, name, content },
  ];
}

/** The text of an invented file: `lines` lines made from its name. */
function fileText(path, lines) {
  const stem = path.replace(/^.*\//, '').replace(/\.\w+$/, '').replace(/\W/g, '_');
  const out = [];
  for (let i = 1; i <= lines; i++) out.push(`  const ${stem}${i} = total(${stem}${i - 1 || 0}, ${i % 17}) * ${(i % 5) + 1};   // line ${i}`);
  return out.join('\n');
}

/** A whole read of a short file. */
const read = (path, lines) => step('read_file', { path }, fileText(path, lines));
/** A read of a long file in a window, headed the way js/code/patch.js linesWindow heads one. */
function readWindow(path, from, to, total) {
  const text = fileText(path, to).split('\n').slice(from - 1).join('\n');
  return step('read_file', { path, from, to }, `[${path}: lines ${from}-${to} of ${total}.]\n${text}`);
}
const search = (query, hits) => step('search_files', { query }, hits.map((h, i) => `${h}:${(i + 1) * 12}:  ${query} in use here`).join('\n'));
const patch = (path, line) => step('patch_file', { path, find: `line ${line}`, replace: `line ${line} (changed)` }, `Changed ${path}:\n  ${line} | (changed)`);
const run = (command, output) => step('run_command', { command }, output);
const look = (path) => step('open_image', { path }, `Opened ${path}.`);

/** A picture's bytes, invented: long enough to count, the same every time. */
const PICTURE = 'iVBORw0KGgo' + 'QUJD'.repeat(600);

function shortRun() {
  return {
    name: 'short',
    about: 'one request, four steps, a small project',
    messages: [
      system(),
      ask('Round the totals in src/rates.js to two places.'),
      ...read('src/rates.js', 60),
      ...patch('src/rates.js', 31),
      ...run('npm test', 'rates: 12 passed, 0 failed'),
      answer('Totals in src/rates.js are rounded to two places; the tests pass.'),
    ],
  };
}

function longRun() {
  const messages = [system(), ask('Move the ledger totals into their own module and keep every caller working.')];
  const files = ['src/ledger.js', 'src/ledger-view.js', 'src/totals.js', 'src/report.js', 'src/import.js'];
  for (let i = 0; i < 40; i++) {
    const f = files[i % files.length];
    if (i % 10 === 4) messages.push(...search('ledgerTotal', files));
    else if (i % 10 === 9) messages.push(...run('npm test', `ledger: ${i} passed, 0 failed`));
    else if (i % 3 === 2) messages.push(...patch(f, 40 + i));
    else messages.push(...readWindow(f, 1 + (i % 4) * 100, 200 + (i % 4) * 100, 900));
  }
  messages.push(answer('The totals are in src/totals.js and every caller uses it; the tests pass.'));
  return { name: 'long', about: 'one request, forty steps, large reads, a note at one step', messages, notes: { 20: 'Steps still open: update src/report.js.' } };
}

function threeRequests() {
  const messages = [system({ notes: 'Project notes: tests run with npm test.' })];
  const asks = ['Add a currency field to the invoice form.', 'Show the currency in the invoice list too.', 'Default the currency to the one used last.'];
  const files = ['src/invoice-form.js', 'src/invoice-list.js', 'src/settings.js'];
  asks.forEach((text, n) => {
    messages.push(ask(text));
    messages.push(...read(files[n], 120), ...search('currency', files), ...patch(files[n], 20 + n), ...run('npm test', `invoice: ${8 + n} passed, 0 failed`));
    messages.push(answer(`Done: ${files[n]} changed and the tests pass.`));
  });
  return { name: 'three-requests', about: 'three requests one after another, with project notes', messages };
}

function midway() {
  const messages = [system(), ask('Rename the stock count to on-hand count across the project.')];
  const files = ['src/stock.js', 'src/stock-view.js', 'src/orders.js'];
  for (let i = 0; i < 6; i++) messages.push(...(i % 2 ? patch(files[i % 3], 10 + i) : read(files[i % 3], 150)));
  messages.push(ask('Also keep the old name working for saved files.', { added: true }));
  for (let i = 0; i < 6; i++) messages.push(...(i % 2 ? patch(files[i % 3], 60 + i) : readWindow(files[i % 3], 1, 300, 600)));
  messages.push(...run('npm test', 'stock: 20 passed, 0 failed'));
  messages.push(answer('Renamed, with the old name still read from saved files; the tests pass.'));
  return { name: 'mid-way', about: 'a message sent while it works, read at the next step', messages };
}

function pictures() {
  const messages = [system(), ask('Make the header match this picture.', { images: [PICTURE] })];
  messages.push(...read('src/header.css', 80), ...look('docs/header-now.png'));
  messages.push(ask('[The picture opened: docs/header-now.png]', { opened: true, images: [PICTURE] }));
  for (let i = 0; i < 12; i++) messages.push(...(i % 3 === 2 ? patch('src/header.css', 10 + i) : readWindow(i % 2 ? 'src/header.js' : 'src/header.css', 1, 400, 800)));
  messages.push(answer('The header now matches the picture.'));
  return { name: 'pictures', about: 'a picture with the request and one the agent opened', messages };
}

function sixRequests() {
  const messages = [system()];
  const asks = [
    'Fix the totals in src/cart.js so they round to two places. Also show the tax on its own line. And also keep the old total for saved carts. Do not change the tests.',
    'Add a discount code field to src/checkout.js.',
    'Show the discount in the order summary.',
    'Make the discount field accept lower case codes.',
    'Log a warning when a code has run out.',
    'Explain how the discount is worked out.',
  ];
  const files = ['src/cart.js', 'src/checkout.js', 'src/summary.js', 'src/checkout.js', 'src/codes.js', 'src/codes.js'];
  asks.forEach((text, n) => {
    messages.push(ask(text));
    messages.push(...read(files[n], 80), ...patch(files[n], 10 + n), ...run('npm test', `shop: ${6 + n} passed, 0 failed`));
    messages.push(answer(`Done: ${files[n]} changed and the tests pass.`));
  });
  return { name: 'six-requests', about: 'six requests one after another, so the earlier ones roll into the note', messages };
}

/** Every invented run, built fresh, in a fixed order. */
export function conversations() {
  ids = 0;
  return [shortRun(), longRun(), threeRequests(), midway(), pictures(), sixRequests()];
}
