// ==============================================================
// Files and pictures attached to a HashCoder request — checks
//
// Loads the REAL src/js/code/attach.js, with js/chat/context.js beside it,
// and holds that each kind of file is read as what it is, that the request
// the model is sent carries the text of each file and names every one, that
// the conversation shows the words and the names rather than the files, and
// that a saved conversation leaves the pictures out. Then that the panel and
// the Coder use it, and that chat does not take what is pasted or dropped
// into HashCoder.
//
// Run with: npm run check:code-attach
// ==============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const src = (...p) => readFileSync(join(here, '..', '..', 'src', ...p), 'utf8');
const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(src('js', 'chat', 'context.js'), sandbox, { filename: 'context.js' });
vm.runInContext(src('js', 'code', 'attach.js'), sandbox, { filename: 'attach.js' });
const A = sandbox.window.HCCodeAttach;

let pass = 0;
let fail = 0;
function ok(label, cond, detail = '') {
  if (cond) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}

console.log('What an attachment is:');
{
  const cases = [
    ['shot.png', 'image/png', 'picture'], ['Screenshot 2026.jpg', '', 'picture'], ['photo.webp', 'image/webp', 'picture'],
    ['spec.pdf', 'application/pdf', 'pdf'], ['spec.PDF', '', 'pdf'],
    ['notes.md', '', 'text'], ['README.markdown', 'text/markdown', 'text'], ['app.tsx', '', 'text'], ['data.json', 'application/json', 'text'],
    ['style.css', 'text/css', 'text'], ['logo.svg', 'image/svg+xml', 'text'],
    ['archive.zip', 'application/zip', 'other'], ['model.bin', '', 'other'],
  ];
  for (const [name, type, want] of cases) ok(`${name} is ${want}`, A.kindOf(name, type) === want, A.kindOf(name, type));
}

console.log('\nWhat the model is sent:');
{
  ok('with nothing attached, the request is the words alone', A.requestContent('Fix the header', []) === 'Fix the header');
  const files = [
    { name: 'spec.md', kind: 'text', text: '# Header\nMake it sticky.' },
    { name: 'shot.png', kind: 'picture', base64: 'QUJD' },
    { name: 'brief.pdf', kind: 'pdf', pages: 2, text: 'Use the brand colours.' },
    { name: 'archive.zip', kind: 'other' },
  ];
  const sent = A.requestContent('Fix the header', files);
  ok('the words come first', sent.startsWith('Fix the header\n\n'));
  ok('every attachment is named', ['spec.md', 'shot.png', 'brief.pdf', 'archive.zip'].every((n) => sent.includes(n)));
  ok('the text of each file with text is sent', /Make it sticky\./.test(sent) && /Use the brand colours\./.test(sent));
  ok('a file that is neither is named as not sent, and nothing of it goes', /archive\.zip \(not sent/.test(sent));
  ok('the pictures are said to be with the message', /The pictures are with this message/.test(sent));
  ok('a picture\'s data is not written into the words', !/QUJD/.test(sent));
  const big = A.requestContent('Read it', [{ name: 'big.md', kind: 'text', text: 'x'.repeat(A.TEXT_BUDGET * 2) }]);
  ok('a long file is cut to the budget and says so', big.length < A.TEXT_BUDGET + 2000 && /truncated/i.test(big), String(big.length));
}

console.log('\nWhat the conversation shows:');
{
  const sent = A.requestContent('Fix the header', [{ name: 'spec.md', kind: 'text', text: 'Make it sticky.' }, { name: 'shot.png', kind: 'picture', base64: 'x' }]);
  const shown = A.shownRequest(sent);
  ok('the words and the names, not the files', shown === 'Fix the header\n\nAttached: spec.md, shot.png', JSON.stringify(shown));
  ok('a request with nothing attached is shown as it is', A.shownRequest('Just this') === 'Just this');
}

console.log('\nWhat is saved:');
{
  const msgs = [
    { role: 'system', content: 's' },
    { role: 'user', content: 'Match this', images: ['AAAA', 'BBBB'] },
    { role: 'user', content: 'This is shot.png, the image you opened.', images: ['CCCC'], opened: true },
    { role: 'assistant', content: 'done' },
  ];
  const kept = A.forStorage(msgs);
  ok('no picture is saved', kept.every((m) => !m.images));
  ok('each message that had one says so', /2 pictures were here/.test(kept[1].content) && /A picture was here/.test(kept[2].content));
  ok('and keeps everything else about it', kept[1].content.startsWith('Match this') && kept[2].opened === true);
  ok('messages without pictures are the same objects', kept[0] === msgs[0] && kept[3] === msgs[3]);
  ok('what the Coder holds is not changed', msgs[1].images.length === 2);
}

console.log('\nA picture is seen in the conversation, and kept as a preview:');
{
  // Data addresses are built here, so this file holds no long string of its own.
  const pic = (n) => `data:image/jpeg;base64,${'QUJD'.repeat(n)}`;
  const kept = A.forStorage([
    { role: 'user', content: 'old', images: ['AAAA'], thumbs: [pic(2000)] },
    { role: 'user', content: 'newer', images: ['BBBB'], thumbs: [pic(10), pic(10)] },
    { role: 'assistant', content: 'done' },
  ]);
  ok('the preview is kept when the picture is not', Array.isArray(kept[1].thumbs) && kept[1].thumbs.length === 2 && !kept[1].images);
  ok('and the message still says a picture was there', /A picture was here/.test(kept[1].content));
  ok('a preview from an earlier save, with no picture left, is kept as it is', A.forStorage([{ role: 'user', content: 'x', thumbs: [pic(5)] }])[0].thumbs.length === 1);
  const many = [];
  for (let i = 0; i < 12; i++) many.push({ role: 'user', content: `m${i}`, thumbs: [pic(15000)] });   // 60,000 characters each
  const saved = A.forStorage(many);
  const total = saved.reduce((n, m) => n + (m.thumbs ? m.thumbs.reduce((k, t) => k + t.length, 0) : 0), 0);
  ok('previews are kept up to a budget, so the store is not filled', total <= A.THUMB_STORE_BUDGET && total > 0, String(total));
  ok('the newest are the ones kept', !!saved[11].thumbs && !saved[0].thumbs && saved.filter((m) => m.thumbs).length === Math.floor(A.THUMB_STORE_BUDGET / pic(15000).length));
  ok('one preview over the whole budget is not kept, and does not stop the others', !A.forStorage([{ role: 'user', content: 'a', thumbs: [pic(120000)] }, { role: 'user', content: 'b', thumbs: [pic(5)] }])[0].thumbs
    && !!A.forStorage([{ role: 'user', content: 'a', thumbs: [pic(120000)] }, { role: 'user', content: 'b', thumbs: [pic(5)] }])[1].thumbs);

  const html = A.picturesHtml([{ thumb: pic(4), full: pic(8), name: 'shot "1".png' }, pic(3)]);
  ok('each preview is a button that opens its picture', (html.match(/<button type="button" class="cdr-user-pic"/g) || []).length === 2 && /<img src="data:image\/jpeg;base64,/.test(html));
  ok('with a name a screen reader can say, safely written', /aria-label="Open picture 1: shot &quot;1&quot;\.png"/.test(html) && /aria-label="Open picture 2"/.test(html));
  ok('and the picture itself is not written into the page twice: only the preview is', !html.includes(pic(8)));
  ok('nothing is drawn that is not a picture written as data: an address, a script, a bad type', A.picturesHtml(['https://example.com/a.jpg', 'javascript:alert(1)', 'data:text/html;base64,QUJD', 'data:image/jpeg;base64,QUJD" onerror="x']) === '');
  ok('no pictures, no markup', A.picturesHtml([]) === '' && A.picturesHtml(null) === '' && A.picturesHtml(undefined) === '');
  ok('a preview the app wrote is accepted by the rule that decides', A.SAFE_PICTURE.test(pic(3)) && !A.SAFE_PICTURE.test('data:image/svg+xml;base64,QUJD'));
}

console.log('\nThe person is told when the model cannot see:');
{
  const providers = { readsImages: (provider, id) => provider !== 'cerebras' };
  const box = { window: { _H: { parseCloudModel: (v) => { const [, provider, ...rest] = v.split(':'); return { provider, modelId: rest.join(':') }; } }, HCProviders: providers } };
  vm.createContext(box);
  vm.runInContext(src('js', 'code', 'attach.js'), box, { filename: 'attach.js' });
  const B = box.window.HCCodeAttach;
  ok('a cloud model whose provider cannot read pictures is said so', B.canSee('cloud:cerebras:gpt-oss-120b') === false);
  ok('one that can is not', B.canSee('cloud:gemini:gemini-3.8-flash') === true);
  ok('a model on this computer is not judged here: nothing is said', B.canSee('qwen2.5-coder:3b') === null && B.canSee('') === null);
  ok('the note reaches the box, and follows the model', /canSee\(modelOf\(\)\) === false/.test(src('js', 'code', 'attach.js')) && /window\.HCCodeAttach\?\.refresh\(\)/.test(src('modes', 'code', 'mode.js')));
}

console.log('\nThe panel and the Coder use it:');
{
  const panel = src('modes', 'code', 'panel.html');
  ok('the box has an attach button, a picker and a place for what is attached',
    /id="cdrAttachBtn"/.test(panel) && /<input type="file" id="cdrAttachInput" multiple hidden/.test(panel) && /id="cdrAttachList"/.test(panel));
  const mode = src('modes', 'code', 'mode.js');
  ok('the Coder wires it when the panel mounts', /HCCodeAttach\?\.mount\(\{ panel: \$\('coder-mode-wrap'\)/.test(mode));
  ok('a request takes what is attached, pictures included', /HCCodeAttach\.take\(task\)/.test(mode) && /images: request\.images/.test(mode));
  ok('the message is drawn with its pictures, and keeps their previews with it', /appendUserMsg\(window\.HCCodeAttach \? window\.HCCodeAttach\.shownRequest\(request\.content\) : task, request\.pictures\)/.test(mode) && /thumbs: request\.thumbs/.test(mode) && /shownRequest\(m\.content\) : m\.content, m\.thumbs\)/.test(mode));
  ok('the bubble holds them above the words', /<div class="cdr-user-bubble">\$\{window\.HCCodeAttach\?\.picturesHtml\(pictures\) \|\| ''\}\$\{esc\(text\)\}<\/div>/.test(mode));
  ok('a saved conversation and a saved session leave the pictures out', (mode.match(/HCCodeAttach\.forStorage\(conversationMsgs\)/g) || []).length === 2);
  ok('the conversation shows the names, not the files', (mode.match(/HCCodeAttach\.shownRequest\(/g) || []).length >= 2);
  const boot = src('boot.js');
  ok('it loads before the Coder, after the pieces it reads', boot.includes("'/js/code/attach.js'") && boot.indexOf("'/js/code/attach.js'") < boot.indexOf("'/js/app.js'"));
  const app = src('js', 'app.js');
  ok('chat does not take a file dropped or a picture pasted while HashCoder is open',
    /const files = document\.body\.classList\.contains\("coder-mode"\) \? \[\] :/.test(app) && /const items = document\.body\.classList\.contains\("coder-mode"\) \? \[\] :/.test(app));
}

console.log(`\n${pass} passed, ${fail} failed  (src/js/code/attach.js)`);
process.exit(fail ? 1 : 0);
