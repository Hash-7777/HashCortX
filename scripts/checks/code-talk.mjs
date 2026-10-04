// ==============================================================
// Small talk, and a model that reads its tools back — checks
//
// Loads the REAL src/js/code/talk.js and holds that a greeting or a thanks is
// told apart from a request (so it can be answered without the tools a small
// model would otherwise read first), that a request which merely begins with
// one is not mistaken for it, and that a model writing its tool definitions
// back as its reply is recognised and a genuine call or answer never is.
//
// Run with: npm run check:code-talk
// ==============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const src = (...p) => readFileSync(join(here, '..', '..', 'src', ...p), 'utf8');
const box = { window: {}, JSON, String, Array, Object, Set, RegExp };
vm.createContext(box);
vm.runInContext(src('js', 'code', 'talk.js'), box, { filename: 'talk.js' });
const T = box.window.HCCodeTalk;

let pass = 0, fail = 0;
const ok = (label, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`); }
};

console.log('What is small talk:');
{
  for (const t of ['hi', 'Hi!', 'hello', 'Hello there', 'hey', 'hiii', 'good morning', 'Good evening!', 'thanks', 'Thank you so much!', 'thx', 'ok', 'okay', 'cool', 'bye', 'how are you', 'how are you?', 'who are you?', 'what can you do?', 'can you help me', 'help', 'test', 'السلام عليكم', 'شكرا', 'مرحبا']) {
    ok(`"${t}"`, T.isSmallTalk(t));
  }
  for (const t of ['hi, make a website', 'hello can you fix index.html', 'thanks, now add a footer', 'what can you do with src/app.js', 'help me fix the bug', 'ok do it', 'make a basic html website for a jewelry store', 'explain this project', 'fix the bugs', 'hi\nmake a site', 'hi `x`', 'hello (world)', 'hi.html', 'what is 2+2', '']) {
    ok(`"${t.replace(/\n/g, ' ')}" is a request`, !T.isSmallTalk(t));
  }
  ok('a long message is not small talk however it begins', !T.isSmallTalk('hi ' + 'there '.repeat(20)));
  ok('nothing is not either', !T.isSmallTalk(null) && !T.isSmallTalk(undefined) && !T.isSmallTalk(5));
}

console.log('\nWhether the request in hand is only that:');
{
  const sys = { role: 'system', content: 'x' };
  ok('a conversation that ends with the person saying hi', T.onlySmallTalk([sys, { role: 'user', content: 'hi' }]));
  ok('...with a note the app added after it', T.onlySmallTalk([sys, { role: 'user', content: 'hi' }, { role: 'user', note: true, content: 'Note from HashCortX' }]));
  ok('a request after an earlier greeting is not', !T.onlySmallTalk([sys, { role: 'user', content: 'hi' }, { role: 'assistant', content: 'Hello.' }, { role: 'user', content: 'make a landing page' }]));
  ok('a thanks after work is small talk, since it is the last thing said', T.onlySmallTalk([sys, { role: 'user', content: 'fix it' }, { role: 'assistant', content: 'Done.' }, { role: 'user', content: 'thanks' }]));
  ok('a greeting already being worked on (a reply or a tool result after it) is not', !T.onlySmallTalk([sys, { role: 'user', content: 'hi' }, { role: 'assistant', content: '', tool_calls: [{}] }]) && !T.onlySmallTalk([sys, { role: 'user', content: 'hi' }, { role: 'tool', content: '{}' }]));
  ok('a greeting with a picture attached is not', !T.onlySmallTalk([sys, { role: 'user', content: 'hi', images: ['abc'] }]));
  ok('nothing said is not', !T.onlySmallTalk([]) && !T.onlySmallTalk(null) && !T.onlySmallTalk([sys]));
  ok('what it is told instead is one short instruction', T.SHORT_SYSTEM.length < 300 && /one or two short sentences/.test(T.SHORT_SYSTEM));
}

console.log('\nA model that writes its tools back:');
{
  const tools = [
    { type: 'function', function: { name: 'list_dir', description: 'List files.', parameters: { type: 'object', required: ['path'], properties: { path: { type: 'string' } } } } },
    { type: 'function', function: { name: 'read_file', description: 'Read a file.', parameters: { type: 'object', required: ['path'], properties: { path: { type: 'string' } } } } },
  ];
  const echoOne = '[{"type":"function","function":{"name":"list_dir","description":"List files and subdirectories in a folder. Returns names, types, and sizes. Start from the project root to explore structure.","parameters":{"type":"object","required":["path"],"properties":{"path":{"type":"string","description":"Absolute directory path"}}}}}]';
  ok('one definition written back', T.echoesTools(echoOne, tools));
  ok('all of them', T.echoesTools(JSON.stringify(tools), tools));
  ok('inside a code fence', T.echoesTools('```json\n' + JSON.stringify(tools) + '\n```', tools));
  ok('a single definition, not in a list', T.echoesTools(JSON.stringify(tools[0]), tools));
  ok('a listing cut off before it closed', T.echoesTools(JSON.stringify(tools).slice(0, -25), tools));
  ok('a real call is not that', !T.echoesTools('{"name":"list_dir","arguments":{"path":"."}}', tools) && !T.echoesTools('[{"type":"function","function":{"name":"list_dir","arguments":"{\\"path\\":\\".\\"}"}}]', tools));
  ok('an answer is not', !T.echoesTools('Hello! How can I help with your project today?', tools));
  ok('JSON that is not a tool of the ones sent is not', !T.echoesTools('[{"type":"function","function":{"name":"fly_away","parameters":{}}}]', tools));
  ok('an answer that names a tool in words is not', !T.echoesTools('I can use list_dir to list files, and read_file to read them, once you tell me what you want.', tools));
  ok('a plain list of file names is not', !T.echoesTools('["index.html","style.css"]', tools));
  ok('with no tools sent, nothing is an echo', !T.echoesTools(echoOne, []) && !T.echoesTools(echoOne, null));
  ok('nothing, or very little, is not', !T.echoesTools('', tools) && !T.echoesTools(null, tools) && !T.echoesTools('[]', tools));
}

console.log('\nWhere it is used:');
{
  const mode = src('modes', 'code', 'mode.js');
  const boot = src('boot.js');
  ok('a small or mid-sized model is sent a greeting without tools and with the short instruction', /HCCodeTalk\?\.onlySmallTalk\(messages\)/.test(mode) && /HCCodeTalk\.SHORT_SYSTEM/.test(mode) && /sharedState\.size === 'small' \|\| sharedState\.size === 'mid'/.test(mode));
  ok('a reply that is the tools written back is set aside, once, and asked again without them', /HCCodeTalk\?\.echoesTools\(finalText, tools\)/.test(mode) && /echoed = bare = true/.test(mode));
  ok('a greeting is not sent with the project\'s map or files either', /const context = window\.HCCodeTalk\?\.isSmallTalk\(task\) \? null : window\.HCCodeContext\?\.forRequest\(/.test(mode));
  ok('the module is loaded before the Coder', boot.indexOf("'/js/code/talk.js'") > 0 && boot.indexOf("'/js/code/talk.js'") < boot.indexOf("'/modes/boot.js'"));
  ok('it touches nothing but the text it is given', !/\bdocument\b|localStorage|fetch\(|invoke\(/.test(src('js', 'code', 'talk.js').replace(/\/\/.*$/gm, '')));
  ok('the check is part of npm run check', /npm run check:code-talk/.test(readFileSync(join(here, '..', '..', 'package.json'), 'utf8')));
}

console.log(`\n${pass} passed, ${fail} failed  (src/js/code/talk.js)`);
process.exit(fail ? 1 : 0);
