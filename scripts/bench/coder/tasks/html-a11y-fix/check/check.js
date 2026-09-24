const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'page.html'), 'utf8');
const imgs = html.match(/<img\b[^>]*>/gi) || [];
assert.strictEqual(imgs.length, 3, 'all three images are still there');
for (const img of imgs) {
  const alt = img.match(/\balt=["']([^"']*)["']/i);
  assert.ok(alt && alt[1].trim().length >= 3, `alt text on ${img}`);
}
const menu = html.match(/<button\b[^>]*class=["'][^"']*menu[^"']*["'][^>]*>([\s\S]*?)<\/button>/i);
assert.ok(menu, 'the menu button is still there');
const named = /aria-label=["'][^"']{2,}["']/i.test(menu[0]) || /aria-labelledby=/i.test(menu[0]) ||
  menu[1].replace(/<svg[\s\S]*?<\/svg>/gi, '').replace(/<[^>]+>/g, '').trim().length >= 2;
assert.ok(named, 'the menu button has a name');
const input = html.match(/<input\b[^>]*id=["']email["'][^>]*>/i);
assert.ok(input, 'the email field is still there');
const labelled = /<label\b[^>]*for=["']email["']/i.test(html) || /aria-label=["'][^"']{2,}["']/i.test(input[0]) ||
  /<label\b[^>]*>[\s\S]*?<input\b[^>]*id=["']email["'][\s\S]*?<\/label>/i.test(html);
assert.ok(labelled, 'the email field has a label');
assert.ok(/<form\b/i.test(html) && /Subscribe/.test(html) && /Fresh bread every morning/.test(html), 'nothing removed');
console.log('check passed');
