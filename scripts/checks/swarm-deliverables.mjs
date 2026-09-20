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

console.log('\nThe rest of the Swarm gets what it already speaks:');
const c = D.contractsOf(D.derive(SHOP));
ok('contracts carry a name, an owner and a format', c.every((x) => x.name && x.ownerRole && x.format));
ok('the files come back page first', D.filesOf(D.derive(SHOP))[0].endsWith('.html'));
ok('then the stylesheet', D.filesOf(D.derive(SHOP))[1] === 'styles.css');
ok('a plan with no files has none', D.filesOf(D.derive(MARKET)).length === 0);
ok('the summary names what is owed', /deliverable/.test(D.summaryOf(D.derive(SHOP))));

console.log(`\n${pass} passed, ${fail} failed  (src/js/swarm/deliverables.js)`);
process.exit(fail ? 1 : 0);
