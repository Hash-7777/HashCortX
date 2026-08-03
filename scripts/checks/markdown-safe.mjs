// ==============================================================
// Markdown and HTML-safety checks
//
// Loads the REAL src/js/markdown-safe.js into a Node VM.
//
// The link sanitiser is the reason this file exists. Everything a model writes
// is rendered as markdown, and an agent that has fetched a web page may quote
// whatever that page contained — so a link in a reply is not necessarily
// something the user wrote or the model invented. It shipped untested.
//
// Run with: npm run check:markdown
// ==============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, '..', '..', 'src', 'js', 'markdown-safe.js'), 'utf8');
const sandbox = { window: {}, URL };
vm.createContext(sandbox);
vm.runInContext(src, sandbox, { filename: 'markdown-safe.js' });
const M = sandbox.window.HCMarkdown;

let pass = 0;
let fail = 0;
function ok(label, cond, detail = '') {
  if (cond) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}

console.log('\nA link that would run something is refused:');
for (const href of [
  'javascript:alert(1)',
  'JavaScript:alert(1)',
  '  javascript:alert(1)  ',
  'java\tscript:alert(1)',
  'data:text/html,<script>alert(1)</script>',
  'vbscript:msgbox(1)',
  'file:///etc/passwd',
  'blob:https://example.com/x',
]) ok(`refused: ${href.trim().slice(0, 40)}`, M.safeMarkdownHref(href) === null);

console.log('\nA link that disguises its destination is refused:');
for (const href of [
  'https://trusted.example@evil.example/',
  'https://user:password@evil.example/',
]) ok(`refused: ${href}`, M.safeMarkdownHref(href) === null);

console.log('\nNothing relative or empty gets through:');
for (const href of ['', '   ', '/settings', './x', '#anchor', 'not a url']) {
  ok(`refused: ${href || '(empty)'}`, M.safeMarkdownHref(href) === null);
}

console.log('\nOrdinary links still work:');
for (const href of [
  'https://example.com/',
  'http://example.com/page?q=1#frag',
  'https://en.wikipedia.org/wiki/Rust_(programming_language)',
]) ok(`allowed: ${href}`, typeof M.safeMarkdownHref(href) === 'string');
ok('the returned href is absolute', M.safeMarkdownHref('https://example.com') === 'https://example.com/');

console.log('\nText placed in the page cannot become markup:');
{
  const nasty = `<img src=x onerror="alert(1)">&'"`;
  const escaped = M.escapeHtml(nasty);
  ok('no raw angle brackets survive', !/[<>]/.test(escaped));
  ok('quotes are encoded', !escaped.includes('"') && !escaped.includes("'"));
  ok('ampersands are encoded first, not doubled', M.escapeHtml('&lt;') === '&amp;lt;');
  ok('the fallback formatter escapes too', !/[<>]/.test(M.fallbackFormatContent(nasty)));
  ok('the fallback keeps line breaks', M.fallbackFormatContent('a\nb') === 'a<br>b');
}

console.log('\nEntity decoding does not re-create markup:');
{
  // &amp; must be decoded LAST. Decoding it first turns &amp;lt; into &lt;
  // and then into a real <, which is an escaped character becoming a tag.
  ok('a double-escaped tag stays text', M.decodeHtmlEntities('&amp;lt;script&amp;gt;') === '&lt;script&gt;');
  ok('numeric decimal entities decode', M.decodeHtmlEntities('&#65;&#66;') === 'AB');
  ok('numeric hex entities decode', M.decodeHtmlEntities('&#x41;&#x42;') === 'AB');
  ok('named entities decode', M.decodeHtmlEntities('&lt;b&gt;') === '<b>');
  ok('apostrophes in both spellings', M.decodeHtmlEntities('&#39;&apos;') === "''");
  ok('an out-of-range code point is left alone', M.decodeHtmlEntities('&#1114112;') === '&#1114112;');
  ok('nonsense is left alone', M.decodeHtmlEntities('&notanentity;') === '&notanentity;');
  ok('empty input is safe', M.decodeHtmlEntities('') === '' && M.decodeHtmlEntities(null) === '');
}

console.log('\nMarked argument shapes, old and new, both read correctly:');
{
  const modern = M.extractMarkedLinkArgs([{ href: 'https://a.example', title: 't', text: 'label' }]);
  ok('token object: href', modern.href === 'https://a.example');
  ok('token object: text', modern.text === 'label');

  const withTokens = M.extractMarkedLinkArgs([{ href: 'https://a.example', tokens: [{ raw: 'he' }, { raw: 'llo' }] }]);
  ok('token object with sub-tokens joins them', withTokens.text === 'hello');

  const legacy = M.extractMarkedLinkArgs(['https://a.example', 'title', 'label']);
  ok('positional: href', legacy.href === 'https://a.example');
  ok('positional: text', legacy.text === 'label');
  ok('positional with no text falls back to the href', M.extractMarkedLinkArgs(['https://a.example']).text === 'https://a.example');

  const codeModern = M.extractMarkedCodeArgs([{ text: 'x = 1', lang: 'python' }]);
  ok('code token object', codeModern.text === 'x = 1' && codeModern.lang === 'python');
  const codeLegacy = M.extractMarkedCodeArgs(['x = 1', 'python']);
  ok('code positional', codeLegacy.text === 'x = 1' && codeLegacy.lang === 'python');
}

console.log('\nA reply quote is shown once, not twice:');
{
  const wrapped = 'Replying to my earlier message:\n> hello\n\nwhat about it?';
  ok('the quote block is removed', M.stripReplyPrelude(wrapped) === 'what about it?');
  ok('an ordinary message is untouched', M.stripReplyPrelude('just text') === 'just text');
  ok('a message that merely mentions replying is untouched',
    M.stripReplyPrelude('Replying to you is fun') === 'Replying to you is fun');
  ok('empty input is safe', M.stripReplyPrelude('') === '' && M.stripReplyPrelude(null) === '');
}

console.log(`\n${pass} passed, ${fail} failed  (src/js/markdown-safe.js)`);
process.exit(fail ? 1 : 0);
