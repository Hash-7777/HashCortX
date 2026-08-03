// ==============================================================
// Export formatting checks
//
// Loads the real src/js/export-format.js. Export bugs are the slowest kind to
// find: nothing fails, a file is produced, and the damage shows up when
// someone opens it in Excel a week later and the accents are wrong. Each
// check below corresponds to a defect that was actually shipping.
//
// Run with: npm run check:export
// ==============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const target = process.argv[2] || join(here, '..', '..', 'src', 'js', 'export-format.js');

const sandbox = { console };
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(readFileSync(target, 'utf8'), sandbox, { filename: 'export-format.js' });

const {
  csvCell, csvDocument, pdfSafe, markdownToPlainText, safeFilename,
  extensionOf, mimeFor, dialogFilter, conversationToMarkdown,
} = sandbox.window.HCExport;

let pass = 0, fail = 0;
function check(label, condition, detail = '') {
  if (condition) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}

console.log('\nCSV — spreadsheet formula injection:');
// These cells come from a model summarising the user's own document, so their
// content is not under anyone's control.
for (const payload of ['=HYPERLINK("http://evil.test","x")', '+1+1', '-2+3', '@SUM(A1)', '\tx']) {
  check(`neutralises ${JSON.stringify(payload.slice(0, 22))}`,
    csvCell(payload).startsWith('"\''), csvCell(payload).slice(0, 12));
}
check('leaves an ordinary negative number alone in appearance',
  csvCell('normal text') === '"normal text"');

console.log('\nCSV — the file opens correctly:');
{
  const doc = csvDocument(['Category', 'Amount'], [['Café subscriptions', '€1,240']]);
  check('starts with a byte-order mark so Excel reads UTF-8', doc.charCodeAt(0) === 0xFEFF);
  check('uses CRLF line endings (RFC 4180)', doc.includes('\r\n'));
  check('keeps accented text intact', doc.includes('Café'));
  check('quotes a value containing a comma', doc.includes('"€1,240"'));
}
{
  // The header row used to be joined raw, so a comma in a label shifted every
  // value in the file one column to the left.
  const doc = csvDocument(['Name, full', 'Amount'], [['x', '1']]);
  check('escapes the HEADER row too', doc.includes('"Name, full"'), doc.split('\r\n')[0]);
}
check('embedded quotes are doubled', csvCell('say "hi"') === '"say ""hi"""');
check('embedded newline stays inside its quoted cell',
  csvCell('a\nb') === '"a\nb"');
check('null and undefined become empty cells',
  csvCell(null) === '""' && csvCell(undefined) === '""');

console.log('\nPDF text — jsPDF built-in fonts are WinAnsi only:');
check('curly apostrophe becomes straight', pdfSafe('don’t') === "don't");
check('curly quotes become straight', pdfSafe('“quoted”') === '"quoted"');
check('em-dash becomes a hyphen', pdfSafe('a — b') === 'a - b');
check('ellipsis expands', pdfSafe('wait…') === 'wait...');
check('emoji becomes a visible marker, not a silent hole',
  pdfSafe('📎 file.txt') === '[?] file.txt', pdfSafe('📎 file.txt'));
check('a run of emoji collapses to ONE marker',
  pdfSafe('🎉🎉🎉') === '[?]', pdfSafe('🎉🎉🎉'));
check('non-Latin script is marked rather than dropped',
  pdfSafe('مرحبا') === '[?]', pdfSafe('مرحبا'));
check('plain ASCII is untouched', pdfSafe('Hello, world.') === 'Hello, world.');
check('accented Latin-1 survives', pdfSafe('Café') === 'Café');

console.log('\nMarkdown flattening for PDF:');
{
  const md = 'Try this:\n\n```js\nconst a = 1;\n  const b = 2;\n```\n\nDone.';
  const flat = markdownToPlainText(md);
  check('code body is kept', flat.includes('const a = 1;'));
  check('code is marked as code', flat.includes('[code: js]') && flat.includes('[end code]'));
  check('code indentation is preserved', flat.includes('      const b = 2;'), JSON.stringify(flat));
  check('no stray fences remain', !flat.includes('```'));
}
check('headings lose their hashes', markdownToPlainText('## Title') === 'Title');
check('bold and italic lose their markers', markdownToPlainText('**a** and *b*') === 'a and b');
check('links keep text and URL',
  markdownToPlainText('[docs](https://x.test)') === 'docs (https://x.test)');
check('images become a label', markdownToPlainText('![cat](x.png)') === '[image: cat]');

console.log('\nFilenames — Windows is the strict one:');
check('strips characters Windows refuses',
  safeFilename('a<b>c:d"e/f\\g|h?i*j', 'md') === 'a-b-c-d-e-f-g-h-i-j.md',
  safeFilename('a<b>c:d"e/f\\g|h?i*j', 'md'));
check('a reserved device name is made safe',
  safeFilename('aux', 'md') === 'aux-file.md', safeFilename('aux', 'md'));
check('empty title still yields a filename', safeFilename('', 'json') === 'export.json');
check('no trailing dot or space', !safeFilename('name. ', 'md').includes('. '));
check('long titles are capped', safeFilename('x'.repeat(300), 'md').length <= 84);
check('spaces become hyphens', safeFilename('my chat log', 'md') === 'my-chat-log.md');

console.log('\nConversation markdown:');
{
  const snapshot = {
    title: 'do u know…',
    model: 'cloud:groq:openai/gpt-oss-120b',
    exportedAt: '2026-08-02T21:52:17.646Z',
    messages: [
      { role: 'user', content: 'do u know my name ?' },
      { role: 'assistant', content: 'I don’t know it.', durationMs: 1400, tps: 210,
        inputTokens: 18, outputTokens: 9 },
    ],
  };
  const md = conversationToMarkdown(snapshot);
  check('keeps the title', md.startsWith('# do u know…'));
  check('records the model', md.includes('cloud:groq:openai/gpt-oss-120b'));
  check('records per-message timing and tokens',
    md.includes('210 tok/s') && md.includes('18 in / 9 out'));
  check('totals the tokens', md.includes('**Tokens:** 18 in · 9 out'));
  check('both turns are present',
    md.includes('## You') && md.includes('## Assistant'));
}
{
  // A reply is often a document in its own right. Its headings must survive
  // intact, and the turn structure must still be unambiguous — which is what
  // the rule before each turn heading is for.
  const md = conversationToMarkdown({
    title: 't', messages: [{ role: 'assistant', content: '## Findings\nall good' }],
  });
  check("a reply's own headings are left intact", md.includes('## Findings'));
  const turns = (md.match(/^---\n\n## (You|Assistant)$/gm) || []).length;
  check('every turn is delimited by a rule', turns === 1, `found ${turns}`);
  const md2 = conversationToMarkdown({ title: 't', messages: [
    { role: 'user', content: 'hi' }, { role: 'assistant', content: '## You\nnot a turn' }] });
  check('a reply containing "## You" does not add a turn delimiter',
    (md2.match(/^---\n\n## (You|Assistant)$/gm) || []).length === 2);
}
check('an empty message is marked, not dropped',
  conversationToMarkdown({ title: 't', messages: [{ role: 'user', content: '' }] })
    .includes('_(empty)_'));
check('attachments are listed',
  conversationToMarkdown({ title: 't', messages: [
    { role: 'user', content: 'see this', attachments: [{ name: 'report.pdf' }] }] })
    .includes('report.pdf'));
check('tool calls are recorded',
  conversationToMarkdown({ title: 't', messages: [
    { role: 'assistant', content: 'done', toolCalls: [{ name: 'read_file', arguments: { path: '/x' } }] }] })
    .includes('read_file'));
check('a missing messages array is not fatal',
  typeof conversationToMarkdown({ title: 't' }) === 'string');

// ── What a saved file is ──────────────────────────────────────────────────
//
// These decide the type the save dialog offers and the type the bytes are
// labelled with. Getting one wrong does not fail: it produces a file the OS
// opens with the wrong application, or appends a second extension to a name
// the user already typed.
console.log('\nA filename says what the file is:');
check('a plain extension is read', extensionOf('report.PDF') === 'pdf');
check('only the last one counts', extensionOf('archive.tar.gz') === 'gz');
check('a path is not mistaken for an extension',
  extensionOf('/home/a.b/notes') === '', extensionOf('/home/a.b/notes'));
check('a dotfile has no extension', extensionOf('.gitignore') === '');
check('a trailing dot is not an extension', extensionOf('draft.') === '');
check('no name is safe', extensionOf('') === '' && extensionOf(null) === '');

console.log('\nEach one is labelled with what it actually is:');
check('markdown', mimeFor('notes.md').startsWith('text/markdown'));
check('csv carries a charset so Excel reads accents',
  /charset=utf-8/.test(mimeFor('rows.csv')));
check('a 3D model', mimeFor('plane.glb') === 'model/gltf-binary');
check('a Word document', /wordprocessingml/.test(mimeFor('brief.docx')));
check('a spreadsheet', /spreadsheetml/.test(mimeFor('books.xlsx')));
// The default must be the binary one: labelling unknown bytes as text invites
// something downstream to re-encode them, which corrupts the file silently.
check('anything unrecognised stays binary',
  mimeFor('model.weights') === 'application/octet-stream');
check('a file with no extension stays binary',
  mimeFor('README') === 'application/octet-stream');

console.log('\nThe save dialog filters to the type being saved:');
check('one filter, matching the extension',
  JSON.stringify(dialogFilter('a.csv')) === JSON.stringify({ name: 'CSV', extensions: ['csv'] }));
check('an unknown extension is still offered',
  dialogFilter('a.weights').extensions[0] === 'weights');
// Null, not a filter of "": a filter the file cannot match hides it from the
// dialog the user is trying to save it with.
check('no extension means no filter', dialogFilter('README') === null);

console.log(`\n${pass} passed, ${fail} failed  (src/js/export-format.js)`);
process.exit(fail ? 1 : 0);
