// ==============================================================
// What a Swarm team is meant to hand back
//
// Loads the REAL src/js/swarm/deliverables.js and holds the property the
// module exists for: the deliverables come from the task, so two different
// requests do not get the same list, and a request is never held to a
// requirement it did not make.
//
// The defect it replaces, kept here as a control: every code build used to
// receive exactly index.html, styles.css and app.js, and every code build was
// told to wire a working cart. A shop had nowhere to put its catalogue; a
// portfolio was marked against a cart nobody asked for.
//
// Run with: npm run check:swarm-deliverables
// ==============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const sandbox = { window: {} };
vm.createContext(sandbox);
// task-kind.js first: deliverables.js asks it whether a request is a build,
// rather than keeping a second reading of that question. Loading it here means
// the check exercises the path the app actually takes.
vm.runInContext(readFileSync(join(root, 'src', 'js', 'swarm', 'task-kind.js'), 'utf8'), sandbox, { filename: 'task-kind.js' });
vm.runInContext(readFileSync(join(root, 'src', 'js', 'swarm', 'deliverables.js'), 'utf8'), sandbox, { filename: 'deliverables.js' });
const D = sandbox.window.HCSwarmDeliverables;

let pass = 0;
let fail = 0;
function ok(label, cond, detail = '') {
  if (cond) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}
const names = (task) => D.derive(task).items.map((i) => i.name);
const bar = (task) => D.derive(task).bar.join(' | ').toLowerCase();
const has = (task, name) => names(task).some((n) => n.toLowerCase() === name.toLowerCase());

const SHOP = 'build me an e-commerce website for a coffee shop with a product catalogue and a cart';
const PORTFOLIO = 'a portfolio website for a software developer';
const GAME = 'code a snake game I can play in the browser';
const CAMPAIGN = 'plan a marketing campaign for a new fitness app launch';
const MARKET = 'do a market analysis of the electric scooter market in Egypt';
const BUG = 'fix the login bug where users get logged out after a refresh';

console.log('A request gets somewhere to put what it asks for:');
ok('a shop gets its catalogue as data', has(SHOP, 'catalogue.js'));
ok('a shop gets its cart', has(SHOP, 'cart.js'));
ok('a game gets its loop', has(GAME, 'game.js'));
ok('a store that signs people in gets a server', has('an online store with login, orders and checkout', 'server.js'));
ok('a blog gets its entries as data', has('build a blog site with articles', 'posts.js'));
ok('a dashboard gets its figures', has('build a sales dashboard with charts', 'charts.js'));

console.log('\nAnd nothing it did not ask for:');
ok('a portfolio gets no cart', !has(PORTFOLIO, 'cart.js'));
ok('a portfolio gets no catalogue', !has(PORTFOLIO, 'catalogue.js'));
ok('a portfolio gets no server', !has(PORTFOLIO, 'server.js'));
ok('a landing page is not marked against a cart', !bar('a landing page for a new app').includes('cart'));
ok('a portfolio is not marked against a cart', !bar(PORTFOLIO).includes('cart'));
ok('a shop IS marked against its cart', bar(SHOP).includes('cart'));
ok('a game is marked against being playable', bar(GAME).includes('playable'));

console.log('\nTwo different requests do not get the same list:');
const same = JSON.stringify(names(SHOP)) === JSON.stringify(names(PORTFOLIO));
ok('a shop and a portfolio differ', !same, 'both got ' + names(SHOP).join(', '));
ok('a shop and a game differ', JSON.stringify(names(SHOP)) !== JSON.stringify(names(GAME)));
ok('a campaign and an analysis differ', JSON.stringify(names(CAMPAIGN)) !== JSON.stringify(names(MARKET)));

console.log('\nWork that is not a build is not given files to write:');
ok('a campaign is writing', D.derive(CAMPAIGN).kind === 'writing', D.derive(CAMPAIGN).kind);
ok('an analysis is analysis', D.derive(MARKET).kind === 'analysis', D.derive(MARKET).kind);
ok('a bug is a fix', D.derive(BUG).kind === 'fix', D.derive(BUG).kind);
ok('a fix names the cause on its own', has(BUG, 'cause.md'));
ok('a fix has to show it worked', has(BUG, 'proof.md'));
ok('a fix mentioning a login is not asked to build one', D.derive(BUG).pieces.length === 0, D.derive(BUG).pieces.join(','));
ok('an analysis is not given a stylesheet', !has(MARKET, 'styles.css'));
ok('a campaign is asked for the finished piece', bar(CAMPAIGN).includes('finished piece'));

console.log('\nPages are only added when the request names them:');
ok('a one-page request stays one page', D.extraPagesOf('a one-page landing page with an about page').length === 0);
ok('a named about page is added', D.extraPagesOf('a site with an about page and a contact page').includes('about.html'));
ok('and the contact page too', D.extraPagesOf('a site with an about page and a contact page').includes('contact.html'));
ok('a request naming no pages adds none', D.extraPagesOf('a website for a bakery').length === 0);

console.log('\nRoom follows the work:');
const shopRoom = D.budgetsFor(D.derive(SHOP)).maxContextCharsPerDependency;
const portfolioRoom = D.budgetsFor(D.derive(PORTFOLIO)).maxContextCharsPerDependency;
const campaignRoom = D.budgetsFor(D.derive(CAMPAIGN)).maxContextCharsPerDependency;
ok('a shop gets more room per dependency than a portfolio', shopRoom > portfolioRoom, `${shopRoom} vs ${portfolioRoom}`);
ok('and more than the six thousand every build used to get', shopRoom > 6000, String(shopRoom));
ok('writing needs less than a build', campaignRoom < portfolioRoom, `${campaignRoom} vs ${portfolioRoom}`);
ok('room is capped so one plan cannot ask for everything', D.budgetsFor({ kind: 'build', items: Array.from({ length: 14 }, (_, i) => ({ name: `f${i}.js` })) }).maxContextCharsPerDependency <= 24000);
ok('a build does not hand its agents tools by default', D.budgetsFor(D.derive(SHOP)).allowToolUseByDefault === false);

console.log('\nA model answer is read, checked and topped up:');
const good = D.readPlan('{"kind":"build","items":[{"name":"index.html","owner":"coder","format":"the page"}],"bar":["it works"]}');
ok('a plain answer is read', good !== null && good.items.length === 1);
ok('an answer that is not JSON at all is null, not empty', D.readPlan('I think you should build a website') === null);
ok('a fenced answer is read', D.readPlan('```json\n{"kind":"build","items":[{"name":"a.js"}],"bar":[]}\n```') !== null);
const merged = D.merge(good, SHOP);
ok('a thin answer for a shop still gets its catalogue', merged.items.some((i) => i.name === 'catalogue.js'));
ok('and its cart', merged.items.some((i) => i.name === 'cart.js'));
ok('and the cart is in its bar', merged.bar.join(' ').toLowerCase().includes('cart'));
ok('an unreadable answer falls back to the task', D.merge(null, SHOP).items.some((i) => i.name === 'catalogue.js'));
// A model asked for this task's bar answers about this task and has no reason
// to repeat what is true of everything, so those lines are put back.
{
  const thin = D.readPlan('{"kind":"writing","items":[{"name":"campaign.md","owner":"writer"}],"bar":["every post is ready to publish"]}');
  const m = D.merge(thin, 'plan a marketing campaign');
  ok('what holds for every result is put back', D.ALWAYS.every((l) => m.bar.includes(l)));
  ok('and what the model said is kept', m.bar.includes('every post is ready to publish'));
  ok('the model\'s own deliverables are kept', m.items.some((i) => i.name === 'campaign.md'));
  ok('they are not repeated when the model said them too', D.merge({ kind: 'writing', items: [{ name: 'a.md' }], bar: [D.ALWAYS[0]] }, 'write a thing').bar.filter((b) => b === D.ALWAYS[0]).length === 1);
}
ok('an empty answer falls back to the task', D.merge({ kind: 'build', items: [], bar: [] }, SHOP).items.length > 0);

const messy = D.normalise({
  kind: 'nonsense',
  items: [
    { name: 'a.js', owner: 'wizard' }, { name: 'a.js', owner: 'coder' }, { name: '', owner: 'coder' },
    { name: '../../etc/passwd', owner: 'coder' },
    ...Array.from({ length: 30 }, (_, i) => ({ name: `x${i}.md` })),
  ],
  bar: ['ok fine here', 'ok fine here', 'no', ...Array.from({ length: 30 }, (_, i) => `line number ${i} of the bar`)],
}, SHOP);
ok('a kind it does not know falls back to the task', messy.kind === 'build', messy.kind);
ok('a repeated deliverable is kept once', messy.items.filter((i) => i.name === 'a.js').length === 1);
ok('an empty name is dropped', !messy.items.some((i) => !i.name));
ok('a path is not a name', !messy.items.some((i) => i.name.includes('/')), messy.items.map((i) => i.name).join(','));
ok('an owner it does not know is replaced', messy.items[0].owner === 'coder', messy.items[0].owner);
ok('the list is capped', messy.items.length <= D.MAX_ITEMS, String(messy.items.length));
ok('the bar is capped', messy.bar.length <= D.MAX_BAR, String(messy.bar.length));
ok('a bar line too short to check is dropped', !messy.bar.includes('no'));
ok('a repeated bar line is kept once', messy.bar.filter((b) => b === 'ok fine here').length === 1);

console.log('\nEvery deliverable has exactly one agent, and it is the right one:');
{
  const TEAM = [
    { id: 'a1', name: 'Planner', role: 'analyst' },
    { id: 'a2', name: 'Frontend Dev', role: 'coder' },
    { id: 'a3', name: 'Backend Dev', role: 'coder' },
    { id: 'a4', name: 'Validator', role: 'validator' },
    { id: 'a5', name: 'Final Polisher', role: 'supervisor' },
  ];
  const plan = D.derive('build an online shop with a catalogue, a cart and logins');
  const m = D.assign(plan, TEAM, 'a5');
  const all = [...m.values()].flat();
  ok('every deliverable is given out', all.length === plan.items.length, `${all.length} of ${plan.items.length}`);
  ok('and none of them twice', new Set(all.map((i) => i.name)).size === all.length);
  const who = (name) => [...m.entries()].find(([, items]) => items.some((i) => i.name === name))?.[0];
  const nameOf = (id) => TEAM.find((a) => a.id === id)?.name;
  ok('the stylesheet goes to whoever does the look of it', /Frontend/.test(nameOf(who('styles.css')) || ''), nameOf(who('styles.css')));
  ok('the page too', /Frontend/.test(nameOf(who('index.html')) || ''), nameOf(who('index.html')));
  ok('the server goes to whoever does servers', /Backend/.test(nameOf(who('server.js')) || ''), nameOf(who('server.js')));
  ok('the plan goes to the planner', /Planner/.test(nameOf(who('plan.md')) || ''), nameOf(who('plan.md')));

  // The deliverer has to make every piece agree, so it is not also given an
  // ordinary piece unless the plan names one that IS the finished thing.
  ok('a build leaves the deliverer free to assemble', (m.get('a5') || []).length === 0, String((m.get('a5') || []).length));
  const analysis = D.assign(D.derive('analyse the scooter market'), TEAM, 'a5');
  ok('but the final answer is the deliverer\'s', (analysis.get('a5') || []).some((i) => /answer/.test(i.name)));

  // Several agents answering to one owner share the work out.
  const twoCoders = D.assign(D.derive('build a site with a blog, a shop and charts'),
    [{ id: 'c1', name: 'Dev One', role: 'coder' }, { id: 'c2', name: 'Dev Two', role: 'coder' }, { id: 'c3', name: 'Lead', role: 'supervisor' }], 'c3');
  ok('two coders both get work', (twoCoders.get('c1') || []).length > 0 && (twoCoders.get('c2') || []).length > 0);

  ok('a plan with no team at all is survivable', D.assign(plan, [], 'x').size === 0);
  ok('an agent nothing matches still leaves every piece owned',
    [...D.assign(plan, [{ id: 'z', name: 'Someone', role: 'custom' }], 'z').values()].flat().length === plan.items.length);
}

console.log('\nAnd each agent is told which part is its own:');
{
  const TEAM = [
    { id: 'a1', name: 'Planner', role: 'analyst' },
    { id: 'a2', name: 'Frontend Dev', role: 'coder' },
    { id: 'a5', name: 'Final Polisher', role: 'supervisor' },
  ];
  const plan = D.derive('build an online shop with a catalogue and a cart');
  const front = D.ownershipNote(plan, TEAM, 'a5', 'a2');
  const deliv = D.ownershipNote(plan, TEAM, 'a5', 'a5');
  ok('an agent is told what it writes', /WHAT YOU WRITE, and nothing else/.test(front));
  ok('and told to keep off the rest', /Do not write them/.test(front));
  ok('and who has them, by name', /\(Planner\)/.test(front));

  // Telling the agent that assembles everything to keep off the others' files
  // would contradict the site rules, which ask it for every file, complete.
  ok('the deliverer is NOT told to keep off them', !/Do not write them/.test(deliv));
  ok('it is told what reaches it', /WHAT REACHES YOU/.test(deliv));
  ok('and that it must make the pieces agree', /make them agree/.test(deliv));
  ok('and to repair a piece rather than pass the fault on', /put it right yourself/.test(deliv));
  ok('a run with no plan says nothing at all', D.ownershipNote({ items: [] }, TEAM, 'a5', 'a2') === '');
}

console.log('\nThe rest of the Swarm gets what it already speaks:');
const c = D.contractsOf(D.derive(SHOP));
ok('contracts carry a name, an owner and a format', c.every((x) => x.name && x.ownerRole && x.format));
ok('the files come back page first', D.filesOf(D.derive(SHOP))[0].endsWith('.html'));
ok('then the stylesheet', D.filesOf(D.derive(SHOP))[1] === 'styles.css');
ok('a plan with no files has none', D.filesOf(D.derive(MARKET)).length === 0);
ok('the summary names what is owed', /deliverable/.test(D.summaryOf(D.derive(SHOP))));

console.log(`\n${pass} passed, ${fail} failed  (src/js/swarm/deliverables.js)`);
process.exit(fail ? 1 : 0);
