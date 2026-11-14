// ==============================================================
// Picture-making checks
//
// Loads the REAL src/js/picture-make.js into a Node VM and checks what each
// provider is sent and how what it sends back is read. A wrong field here is
// not an error anywhere: a picture to change that is not sent is a provider
// drawing something else, and a picture read from the wrong field is an
// answer with no picture in it.
//
// Run with: npm run check:picture-make
// ==============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(readFileSync(join(root, 'src', 'js', 'picture-make.js'), 'utf8'), sandbox, { filename: 'picture-make.js' });
const M = sandbox.window.HCPictureMake;

let pass = 0;
let fail = 0;
function ok(label, cond, detail = '') {
  if (cond) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}

const PNG = 'iVBORw0KGgoAAAANSUhEUg';
const JPG = '/9j/4AAQSkZJRgABAQ';
const talk = (last) => [
  { role: 'system', content: 'You make pictures.' },
  { role: 'user', content: 'a lighthouse at dusk' },
  { role: 'assistant', content: 'Here it is.', images: ['data:image/png;base64,OLD'] },
  last,
];

console.log('\nThe request is the person\'s last message and the pictures on it:');
{
  const a = M.askOf(talk({ role: 'user', content: '  make it blue  ', images: [PNG] }));
  ok('its words, trimmed', a.prompt === 'make it blue');
  ok('its pictures, and not a picture an earlier answer made', a.pictures.length === 1 && a.pictures[0] === PNG);
  let threw = '';
  try { M.requestFor('openai', 'gpt-image-1', [{ role: 'user', content: '' }]); } catch (e) { threw = e.message; }
  ok('a request with no words and no picture is refused in words', /Say what picture to make/.test(threw));
  threw = '';
  try { M.requestFor('groq', 'x', talk({ role: 'user', content: 'x' })); } catch (e) { threw = e.message; }
  ok('a provider that makes no pictures here says so', /groq does not make pictures/.test(threw));
}

console.log('\nOpenAI: words to the address that makes pictures, a picture to the one that changes them:');
{
  const made = M.requestFor('openai', 'gpt-image-1', talk({ role: 'user', content: 'a red kite' }));
  ok('words alone go to the making address as JSON', made.url === 'https://api.openai.com/v1/images/generations' && made.json.model === 'gpt-image-1' && made.json.prompt === 'a red kite' && made.json.n === 1);
  ok('a GPT picture model is not asked for a format it refuses', !('response_format' in made.json));
  const older = M.requestFor('openai', 'dall-e-3', talk({ role: 'user', content: 'a red kite' }));
  ok('an older picture model is asked for the picture itself, not a link the app cannot fetch', older.json.response_format === 'b64_json');
  const one = M.requestFor('openai', 'gpt-image-1', talk({ role: 'user', content: 'make it blue', images: [PNG] }));
  ok('one picture to change goes to the changing address as a form', one.url === 'https://api.openai.com/v1/images/edits' && !one.json && Array.isArray(one.form));
  const fields = Object.fromEntries(one.form.filter(([, v]) => typeof v === 'string'));
  ok('...with the model and the words', fields.model === 'gpt-image-1' && fields.prompt === 'make it blue');
  const files = one.form.filter(([, v]) => typeof v !== 'string');
  ok('...and the picture as a file named for its type, under "image"', files.length === 1 && files[0][0] === 'image' && files[0][1].base64 === PNG && files[0][1].type === 'image/png' && /\.png$/.test(files[0][1].name));
  const two = M.requestFor('openai', 'gpt-image-1.5', talk({ role: 'user', content: 'put these together', images: [PNG, JPG] }));
  ok('two pictures go as two files under "image[]"', two.form.filter(([n]) => n === 'image[]').length === 2 && two.form.find(([n]) => n === 'image[]')[1].type === 'image/png' && two.form.filter(([n]) => n === 'image[]')[1][1].type === 'image/jpeg');
  const cant = M.requestFor('openai', 'dall-e-3', talk({ role: 'user', content: 'make it blue', images: [PNG] }));
  ok('a model that cannot change a picture makes one from the words, and says the picture was not sent', cant.url.endsWith('/generations') && /attached picture was not sent/.test(cant.note));
}

console.log('\nOpenRouter: one address, the pictures beside the words:');
{
  const r = M.requestFor('openrouter', 'google/gemini-2.5-flash-image', talk({ role: 'user', content: 'make it blue', images: [JPG] }));
  ok('its own picture address, with the model and the words', r.url === 'https://openrouter.ai/api/v1/images' && r.json.model === 'google/gemini-2.5-flash-image' && r.json.prompt === 'make it blue');
  ok('the picture to work from as a data address of its own type', r.json.input_references?.length === 1 && r.json.input_references[0].type === 'image_url' && r.json.input_references[0].image_url?.url?.startsWith('data:image/jpeg;base64,'));
  ok('no pictures, no references', !('input_references' in M.requestFor('openrouter', 'm/x', talk({ role: 'user', content: 'a kite' })).json));
  ok('a picture with no words still asks for a picture', M.requestFor('openrouter', 'm/x', talk({ role: 'user', content: '', images: [PNG] })).json.prompt.length > 0);
}

console.log('\nGemini: the conversation, with the person\'s pictures in it:');
{
  const r = M.requestFor('gemini', 'gemini-3.1-flash-image-preview', talk({ role: 'user', content: 'make it blue', images: [PNG] }));
  ok('the model\'s own address, the key nowhere in it', r.url === 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image-preview:generateContent' && !/key=/.test(r.url));
  ok('it is asked for words and pictures', r.json.generationConfig.responseModalities.join() === 'TEXT,IMAGE');
  ok('the instructions go apart from the conversation', r.json.systemInstruction.parts[0].text === 'You make pictures.' && r.json.contents.every((c) => c.role !== 'system'));
  const last = r.json.contents[r.json.contents.length - 1];
  ok('the person\'s picture goes beside their words, with its type', last.role === 'user' && last.parts[0]?.text === 'make it blue' && last.parts[1]?.inlineData?.data === PNG && last.parts[1]?.inlineData?.mimeType === 'image/png');
  ok('an earlier answer is the model\'s, in words', r.json.contents[1].role === 'model' && r.json.contents[1].parts.length === 1 && r.json.contents[1].parts[0].text === 'Here it is.');
}

console.log('\nWhat comes back is read the way each provider sends it:');
{
  const g = M.answerOf('gemini', { candidates: [{ content: { parts: [{ text: 'A blue lighthouse.' }, { inlineData: { mimeType: 'image/png', data: 'AAA' } }, { inline_data: { mime_type: 'image/jpeg', data: 'BBB' } }] } }] });
  ok('Gemini: its words and each picture, whichever spelling it uses', g.text === 'A blue lighthouse.' && g.images.join() === 'data:image/png;base64,AAA,data:image/jpeg;base64,BBB');
  const o = M.answerOf('openai', { data: [{ b64_json: PNG, revised_prompt: 'a red kite over a beach' }] });
  ok('OpenAI: the picture from b64_json, typed by its own bytes', o.images[0] === `data:image/png;base64,${PNG}`);
  ok('...and the words it drew from, said as such', o.text === 'Made from: a red kite over a beach');
  const r = M.answerOf('openrouter', { data: [{ b64_json: 'CCC', media_type: 'image/webp' }] });
  ok('OpenRouter: the type it names', r.images[0] === 'data:image/webp;base64,CCC' && r.text === '');
  ok('a link is not taken for a picture', M.answerOf('openai', { data: [{ url: 'https://example.com/p.png' }] }).images.length === 0);
  ok('nothing back is no pictures, not an error', M.answerOf('openai', null).images.length === 0 && M.answerOf('gemini', {}).images.length === 0);
}

console.log('\nThe app sends what this builds:');
{
  const app = readFileSync(join(root, 'src', 'js', 'app.js'), 'utf8');
  const boot = readFileSync(join(root, 'src', 'boot.js'), 'utf8');
  ok('the module loads before app.js', boot.indexOf("'/js/picture-make.js'") > -1 && boot.indexOf("'/js/picture-make.js'") < boot.indexOf("'/js/app.js'"));
  ok('picture making asks the module what to send, and reads the answer through it', /HCPictureMake\.requestFor\(provider, modelId, messages\)/.test(app) && /HCPictureMake\.answerOf\(provider, await res\.json\(\)\)/.test(app));
  ok('it is called with the provider of the model chosen', /generateCloudImage\(provider, modelId, messages, ctrl\.signal\)/.test(app));
  ok('a form field holding words is added with no file name, which the browser refuses beside words', /typeof v === "string" \? body\.append\(name, v\) : body\.append\(name, new Blob\(/.test(app));
  ok('a form goes without a JSON type, so the browser names its own', /if \(req\.form\) \{[^\n]*\n\s*delete headers\["Content-Type"\];/.test(app));
  ok('Google\'s key goes in its own header', /provider === "gemini" \? \{ "x-goog-api-key": key \}/.test(app));
  ok('what was left out is said beside the answer', /\[text, req\.note\]\.filter\(Boolean\)/.test(app));
}

console.log('\nA picture model is offered only where a picture can be made:');
{
  const read = (...p) => readFileSync(join(root, 'src', ...p), 'utf8');
  const app = read('js', 'app.js');
  ok('the main menu marks each picture model, in both places it builds an option', (app.match(/opt\.dataset\.cloudOption = "1"; if \(m\.imageGen\) opt\.dataset\.pictures = "1";/g) || []).length === 2);
  ok('a chat agent leaves a picture model to make the picture', /else if \(activeAgent && !isImageGenModel\(modelEl\.value\)\) \{/.test(app));
  ok('Compare does not offer one', /if \(opt\.dataset\.separator === "1" \|\| opt\.dataset\.pictures\) opt\.remove\(\);/.test(app));
  ok('HashCoder does not', /const gone = \(opt\) => [^\n]*\|\| opt\.dataset\.pictures === '1';/.test(read('modes', 'code', 'mode.js')));
  ok('the Sandbox does not', /o\.value && !o\.disabled && !o\.dataset\.pictures &&/.test(read('modes', 'sandbox', 'mode.js')));
  ok('Finance does not', /if \(!val \|\| opt\.disabled \|\| opt\.dataset\.pictures\) return;/.test(read('modes', 'finance', 'mode.js')));
  ok('the ERP does not', /return Array\.from\(src\.options\)\.filter\(o => !o\.dataset\.pictures\)/.test(read('modes', 'systems', 'mode.js')));
  const swarm = read('modes', 'agent-maker', 'mode.js');
  ok('the Agent Swarm does not, in its list, its team picker or its lead\'s menu', /\.filter\(o => o\.value && !o\.disabled && !o\.dataset\.pictures\)/.test(swarm)
    && /notCooling\(Array\.from\(document\.getElementById\("model"\)\?\.options \|\| \[\]\)\.filter\(o => !o\.dataset\.pictures\)/.test(swarm)
    && /godDst\.querySelectorAll\("option\[data-pictures\]"\)\.forEach\(o => o\.remove\(\)\)/.test(swarm));
  const forge = read('modes', 'forge', 'mode.js');
  ok('3D Forge does not, in any of the four places it reads the menu', /sourceOptions\.filter\(\(opt\) => !opt\.dataset\.pictures\)/.test(forge)
    && (forge.match(/getElementById\("model"\)\?\.options \|\| \[\]\)\.filter\(\(o\) => !o\.dataset\.pictures\)/g) || []).length === 3);
}

console.log(`\n${pass} passed, ${fail} failed  (src/js/picture-make.js)`);
process.exit(fail ? 1 : 0);
