// ==============================================================
// Systems forms checks
//
// The form a generated system's record is edited in: every value escaped, a
// choice field never quietly changing a record it opens, and every control
// named by its label.
//
// Run with: npm run check:systems-forms
// ==============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const src = (...p) => readFileSync(join(here, '..', '..', 'src', ...p), 'utf8');
const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(src('js', 'systems', 'forms.js'), sandbox, { filename: 'forms.js' });
const F = sandbox.window.HCSystemsForms;
const mode = src('modes', 'systems', 'mode.js');

let pass = 0;
let fail = 0;
function ok(label, cond) {
  if (cond) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}`); }
}

const orders = { fields: [
  { id: 'order_number', label: 'Order #', type: 'text', required: true },
  { id: 'status', label: 'Status', type: 'select', options: ['New', 'Cooking', 'Served'] },
  { id: 'customer', label: 'Guest', type: 'link', entity: 'customers' },
  { id: 'subtotal', label: 'Subtotal', type: 'number' },
  { id: 'total', label: 'Total', type: 'number', formula: 'subtotal * 1.12' },
  { id: 'notes', label: 'Notes', type: 'textarea' },
  { id: 'placed', label: 'Placed', type: 'date' },
] };
const html = (rec, names = []) => F.formHtml(rec, orders, { linkNames: () => names });
const selected = (h, field) => (new RegExp(`data-sys-field="${field}"[\\s\\S]*?</select>`).exec(h)?.[0].match(/<option value="([^"]*)" selected>/) || [])[1];

console.log('A choice field never changes a record it opens:');
{
  const h = html({ status: 'Waiting' });
  ok('a value that is not an option is offered, and chosen', selected(h, 'status') === 'Waiting');
  ok('alongside the field\'s own options', /<option value="Cooking">/.test(h));
  ok('an option is chosen without regard to case', selected(html({ status: 'cooking' }), 'status') === 'Cooking');
  ok('F.withValue puts the record\'s own value first when it is missing', F.withValue(['A', 'B'], 'C').join() === 'C,A,B' && F.withValue(['A'], 'a').join() === 'A');
}

console.log('\nA link offers the records it can point at:');
{
  const h = html({ customer: 'Rania Khoury' }, ['Rania Khoury', 'Karim Nassar']);
  ok('each of them', /<option value="Karim Nassar">/.test(h));
  ok('with the current one chosen', selected(h, 'customer') === 'Rania Khoury');
  ok('and an empty choice to clear it', /data-sys-field="customer"[\s\S]*?<option value="">—<\/option>/.test(h));
  ok('a name that matches none is kept, not lost', selected(html({ customer: 'Old Name' }, ['Karim Nassar']), 'customer') === 'Old Name');
}

console.log('\nA worked-out number is shown, not typed:');
{
  const h = html({ subtotal: 10, total: 11.2 });
  ok('read-only, with how it is worked out', /value="11.2" readonly title="Worked out: subtotal \* 1.12"/.test(h));
  ok('and never saved from the form', !/data-sys-field="total"/.test(h));
}

console.log('\nEverything written into the form is escaped:');
{
  const h = html({ order_number: '"><img src=x onerror=alert(1)>', notes: '</textarea><script>x()</script>', status: '<b>' });
  ok('in an input\'s value', !/<img src=x/.test(h) && /value="&quot;&gt;&lt;img/.test(h));
  ok('in a text area', !/<script>x\(\)<\/script>/.test(h) && /&lt;\/textarea&gt;/.test(h));
  ok('in a choice', /<option value="&lt;b&gt;" selected>&lt;b&gt;<\/option>/.test(h));
  const lab = F.formHtml({}, { fields: [{ id: 'x', label: '<i>X</i>', type: 'text' }] });
  ok('in a label', /&lt;i&gt;X&lt;\/i&gt;/.test(lab) && !/<i>X<\/i>/.test(lab));
}

console.log('\nEvery control is named by its label:');
{
  const h = html({});
  const labels = [...h.matchAll(/<label class="sys-form-label" for="([^"]+)"/g)].map((m) => m[1]);
  ok('every label names a control that exists', labels.length === orders.fields.length && labels.every((id) => h.includes(`id="${id}"`)));
  ok('a required field is marked and required', /for="sys-f-order_number">Order #<span class="sys-required">\*<\/span>/.test(h) && /data-sys-field="order_number" type="text" value=""\s*required/.test(h));
  ok('numbers take decimals and dates are dates', /data-sys-field="subtotal" type="number" value="" step="any"/.test(h) && /data-sys-field="placed" type="date"/.test(h));
}

console.log('\nThe Systems mode uses it:');
ok('its record window is drawn by formHtml', /window\.HCSystemsForms\.formHtml\(record, entity/.test(mode));

console.log(`\n${pass} passed, ${fail} failed  (src/js/systems/forms.js)`);
process.exit(fail ? 1 : 0);
