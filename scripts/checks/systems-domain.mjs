// ==============================================================
// ERP domain knowledge — checks
//
// Loads the REAL src/js/systems/domain.js alongside the spec gate, because the
// question worth asking about this file cannot be asked of it alone.
//
// This is the app's own opinion about business software: which industry a
// description belongs to, and what a record in that industry should have on
// it. It decides what a person gets when a model is unavailable or answers
// thinly — so the fields it hands out had better satisfy the validation gate
// this same mode applies to a model's work. Nobody could ask that before,
// because the two lived in one file with nothing able to reach either.
//
// Run with: npm run check:systems-domain
// ==============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const sandbox = { window: {}, structuredClone };
vm.createContext(sandbox);
for (const rel of [['src', 'js', 'systems', 'domain.js'], ['src', 'js', 'systems', 'spec.js']]) {
  vm.runInContext(readFileSync(join(root, ...rel), 'utf8'), sandbox, { filename: rel.at(-1) });
}
const D = sandbox.window.HCSystemsDomain;
const S = sandbox.window.HCSystemsSpec;

let pass = 0;
let fail = 0;
function ok(label, cond, detail = '') {
  if (cond) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}

const DOMAINS = Object.keys(D.DOMAIN_CONFIG);

console.log('\nA description is placed in an industry, or honestly in none:');
{
  ok('a pizza place is a restaurant', D.detectDomain('a pizza restaurant in Cairo') === 'restaurant');
  ok('a clinic is healthcare', D.detectDomain('small dental clinic') === 'healthcare');
  ok('a school is education', D.detectDomain('language school admin') === 'education');
  ok('a courier is logistics', D.detectDomain('courier and delivery fleet') === 'logistics');
  ok('a law firm is legal', D.detectDomain('law firm case tracker') === 'legal');
  // Nothing recognised has to be its own answer rather than the first one on
  // the list — guessing "restaurant" for a description about beekeeping would
  // furnish the whole system wrongly.
  ok('something it does not recognise is generic',
    D.detectDomain('beekeeping cooperative') === 'generic');
  ok('and so is nothing at all',
    D.detectDomain('') === 'generic' && D.detectDomain(null) === 'generic');
  ok('the case it was written in does not matter',
    D.detectDomain('HOTEL BOOKINGS') === 'hotel');
  // A domain that can be detected and has no configuration is furnished from
  // the generic one and named "Business Operating System" — a system that
  // looks like a fallback for a description the app understood perfectly.
  ok('every industry it can name has a configuration',
    ['restaurant', 'hotel', 'healthcare', 'education', 'fitness', 'realestate', 'retail',
      'logistics', 'manufacturing', 'hr', 'legal', 'jewelry', 'saas', 'generic']
      .every((d) => !!D.DOMAIN_CONFIG[d]), DOMAINS.join(','));
}

console.log('\nEvery industry it knows is described completely:');
{
  const missing = [];
  for (const [name, cfg] of Object.entries(D.DOMAIN_CONFIG)) {
    if (!cfg.name) missing.push(`${name}: no name`);
    if (!cfg.theme || !cfg.theme.primary) missing.push(`${name}: no theme`);
    if (!Array.isArray(cfg.modules) || cfg.modules.length < 5) missing.push(`${name}: ${cfg.modules?.length ?? 0} modules`);
  }
  ok('each has a name, a theme and at least five modules', missing.length === 0, missing.slice(0, 3).join(' | '));

  const badScreens = [];
  for (const [name, cfg] of Object.entries(D.DOMAIN_CONFIG)) {
    for (const m of cfg.modules || []) {
      if (m.screen && !S.VALID_SCREENS.includes(m.screen)) badScreens.push(`${name}/${m.name}: ${m.screen}`);
    }
  }
  ok('and asks only for screens this app can draw', badScreens.length === 0, badScreens.slice(0, 3).join(' | '));
}

// ── The one that could not be asked before ───────────────────────────────
console.log("\nThe app's own fields satisfy the app's own gate:");
{
  // defaultFields is what a person gets when a model is unavailable or thin.
  // validate() is what this mode demands of a model's work. If the built-in
  // answer would fail the built-in gate, the app holds a model to a standard
  // it does not meet itself.
  const failures = [];
  for (const domain of DOMAINS) {
    for (const entity of ['orders', 'customers', 'invoices', 'employees', 'products', 'anything_else']) {
      const fields = D.defaultFields(entity, domain);
      if (!Array.isArray(fields) || fields.length < 3) {
        failures.push(`${domain}/${entity}: ${fields?.length ?? 0} fields`);
        continue;
      }
      const hasValue = fields.some((f) => f.type === 'number'
        || /amount|total|price|cost|revenue|salary|qty|quantity|balance|value/i.test(f.id || f.label || ''));
      const hasDate = fields.some((f) => f.type === 'date'
        || /date|time|due|created|updated/i.test(f.id || f.label || ''));
      if (!hasValue) failures.push(`${domain}/${entity}: nothing countable`);
      if (!hasDate) failures.push(`${domain}/${entity}: nothing dated`);
    }
  }
  ok(`every one of ${DOMAINS.length} industries × 6 kinds of record passes the gate`,
    failures.length === 0, failures.slice(0, 4).join(' | '));

  // And end to end: a whole system built from the built-in knowledge must
  // validate, not merely have fields of the right shape.
  const built = [];
  for (const domain of DOMAINS) {
    const cfg = D.DOMAIN_CONFIG[domain];
    const entities = {};
    for (const m of cfg.modules) {
      const id = D.slug(m.entity || m.name);
      entities[id] = { id, fields: D.defaultFields(id, domain) };
    }
    const issues = S.validate({ name: cfg.name, modules: cfg.modules, entities });
    if (issues.length) built.push(`${domain}: ${issues[0]}`);
  }
  ok('and a whole system built from each industry validates',
    built.length === 0, built.slice(0, 3).join(' | '));
}

console.log('\nFields are usable, whatever was asked for:');
{
  const every = DOMAINS.flatMap((d) => ['orders', 'staff', 'unknown_thing'].map((e) => D.defaultFields(e, d))).flat();
  ok('every field has an identifier and a label',
    every.every((f) => f.id && f.label), 'one has neither');
  ok('every identifier is a single word', every.every((f) => /^[a-z0-9_]+$/.test(f.id)));
  ok('every choice list actually has choices',
    every.filter((f) => f.type === 'select').every((f) => Array.isArray(f.options) && f.options.length > 1));
  ok('no field is listed twice on one record', DOMAINS.every((d) => {
    const ids = D.defaultFields('orders', d).map((f) => f.id);
    return new Set(ids).size === ids.length;
  }));
  ok('an industry nobody named still gives usable fields',
    D.defaultFields('orders', 'beekeeping').length >= 3);
  ok('and so does a record nobody named',
    D.defaultFields('', 'retail').length >= 3);
}

console.log('\nMoney is labelled in the currency that was asked for:');
{
  const usd = D.financeFields('USD');
  const egp = D.financeFields('EGP');
  ok('a currency produces a set of finance records', Object.keys(usd).length > 0);
  ok('and the same set whichever currency it is',
    Object.keys(usd).join() === Object.keys(egp).join());
  const label = (pack) => JSON.stringify(pack);
  ok('the currency asked for is the one shown', label(egp).includes('EGP') && !label(egp).includes('USD'));
  ok('and it is not hard-coded to dollars', label(usd).includes('USD'));

  // A profile is the shape of the business, not its currency: what it turns
  // over, what it keeps, who it sells to and who it buys from.
  const clinic = D.financeProfile({}, 'a small dental clinic');
  ok('a profile follows the industry that was detected', clinic.domain === 'healthcare');
  ok('and carries figures to build a year from',
    clinic.baseRevenue > 0 && clinic.grossMargin > 0 && clinic.grossMargin < 1);
  ok('with people to sell to and buy from',
    clinic.customers.length >= 3 && clinic.vendors.length >= 3);
  ok('an industry it does not know still gets a profile',
    D.financeProfile({}, 'beekeeping cooperative').baseRevenue > 0);
  ok('and a margin is never a loss anywhere',
    Object.keys(D.DOMAIN_CONFIG).concat(['saas']).every((d) => {
      const p = D.financeProfile({ domain: d }, '');
      return p.grossMargin > 0 && p.grossMargin < 1 && p.taxRate >= 0 && p.taxRate < 0.5;
    }));
}

console.log(`\n${pass} passed, ${fail} failed  (src/js/systems/domain.js)\n`);
process.exit(fail === 0 ? 0 : 1);
