const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
assert.ok(fs.existsSync(path.join(root, 'index.html')), 'index.html exists');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
assert.ok(/<html[^>]*\blang=["']?[a-z]/i.test(html), 'the page names its language');
assert.ok(/<meta[^>]+name=["']viewport["'][^>]*width=device-width/i.test(html) ||
          /<meta[^>]+content=["'][^"']*width=device-width[^>]*name=["']viewport["']/i.test(html), 'a viewport for phones');
assert.ok(/<title>[^<]*Pricing[^<]*<\/title>/i.test(html), 'a title');
assert.ok(/<h1[^>]*>\s*Pricing\s*<\/h1>/i.test(html), 'the heading');
assert.ok(/<link[^>]+href=["']\.?\/?styles\.css["']/i.test(html), 'styles.css is linked');
const css = path.join(root, 'styles.css');
assert.ok(fs.existsSync(css) && fs.readFileSync(css, 'utf8').trim().length > 40, 'styles.css has styles');
for (const [plan, price] of [['Basic', 9], ['Pro', 29], ['Team', 99]]) {
  assert.ok(new RegExp(`\\$${price}\\s*/\\s*month`).test(text), `${plan} costs $${price}/month`);
  assert.ok(new RegExp(`<(button|a)\\b[^>]*>\\s*Choose ${plan}\\s*</(button|a)>`, 'i').test(html), `a "Choose ${plan}" button`);
}
console.log('check passed');
