// ==============================================================
// A chat's title, written by its own model — checks
//
// Loads the real src/js/chat/context.js and src/js/chat/title.js and holds
// how a chat comes to be named by the model it talks to: asked once, after
// its first answer, with no tools, the conversation's start quoted as
// material; what comes back cleaned into a few plain words or refused; a
// title the person gave never replaced, even one given while the model was
// still writing; and a request that fails leaving the chat as it was.
// Also pins the chat's three places that use it in app.js.
//
// Run with: npm run check:chat-title
// ==============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const src = (...p) => readFileSync(join(here, '..', '..', 'src', ...p), 'utf8');

let pass = 0, fail = 0;
function ok(label, cond, detail = '') {
  if (cond === true) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}
const json = (x) => JSON.stringify(x);

const sandbox = { console, setTimeout, clearTimeout, AbortController };
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(src('js', 'chat', 'context.js'), sandbox, { filename: 'context.js' });
try { vm.runInContext(src('js', 'chat', 'title.js'), sandbox, { filename: 'title.js' }); } catch (e) { ok('title.js loads', false, String(e && e.message)); }
const T = sandbox.HCChatTitle || {};

const talk = (q, a) => [{ role: 'user', content: q }, { role: 'assistant', content: a }];

console.log('\nWhat the model is asked:');
{
  const r = T.request ? T.request(talk('What does larkfield-tea.example say about its teas?', 'It lists three teas and its opening days.')) : null;
  ok('a system rule and one message', Array.isArray(r) && r.length === 2 && r[0].role === 'system' && r[1].role === 'user', json(r));
  ok('the rule asks for a few plain words and nothing else', !!r && /two to five words/.test(r[0].content) && /nothing else/.test(r[0].content));
  ok('the person\'s words and the answer are both in it', !!r && /larkfield-tea\.example say about its teas/.test(r[1].content) && /three teas and its opening days/.test(r[1].content));
  ok('... quoted as material, not instructions', !!r && /not instructions/.test(r[1].content));
  const starter = T.request ? T.request(talk('Look this up before you answer.\n\n- Search first.\n\nMy question:\nhow tall is the old lighthouse', 'About forty metres.')) : null;
  ok('a starter prompt is left out: the person\'s own question is what is named', !!starter && /how tall is the old lighthouse/.test(starter[1].content) && !/Search first/.test(starter[1].content), json(starter));
  const long = T.request ? T.request(talk('x'.repeat(5000), 'y'.repeat(5000))) : null;
  ok('a long start is cut, so the request stays small', !!long && long[1].content.length < 2 * T.MATERIAL + 400, String(long && long[1].content.length));
  ok('nothing said yet: nothing to ask', T.request && T.request([]) === null && T.request(null) === null);
  ok('no answer yet: nothing to ask', T.request && T.request([{ role: 'user', content: 'hi' }, { role: 'assistant', content: '   ' }]) === null);
  ok('an answer before any question does not count', T.request && T.request([{ role: 'assistant', content: 'Welcome' }, { role: 'user', content: 'hi' }]) === null);
}

console.log('\nWhat comes back, made into a title:');
{
  const c = (t) => (T.clean ? T.clean(t) : undefined);
  ok('plain words are kept', c('Larkfield Tea Rooms menu') === 'Larkfield Tea Rooms menu');
  ok('quotation marks around it go', c('"Larkfield Tea Rooms menu"') === 'Larkfield Tea Rooms menu' && c('“Tide basics”') === 'Tide basics');
  ok('a "Title:" label goes', c('Title: Tea room hours') === 'Tea room hours');
  ok('markdown marks go', c('**Tea room hours**') === 'Tea room hours' && c('# Tea room hours') === 'Tea room hours');
  ok('a closing full stop goes', c('Tea room hours.') === 'Tea room hours');
  ok('thinking written before it goes', c('<think>The person asks about tides.</think>\nTide basics') === 'Tide basics');
  ok('... and thinking never closed leaves no title', c('<think>The person asks about') === '');
  ok('the first line is the title', c('Tide basics\n\nThis covers how tides work.') === 'Tide basics');
  ok('pictures typed as text go', c('Tea \u{1F375} menu') === 'Tea menu');
  ok('another language is kept as written', c('الشاي والقهوة') === 'الشاي والقهوة');
  ok('a sentence is not a title', c('This conversation is about the tea rooms and their opening days') === '');
  ok('more than six words is not a title, however short they are', c('Tea and cake at the old mill') === '' && c('Tea and cake at the mill') === 'Tea and cake at the mill');
  ok('too long to read in the list is not a title', c('Supercalifragilisticexpialidocious antidisestablishmentarianism') === '');
  ok('a refusal is not a title', c('Sorry, I cannot') === '' && c('I cannot do that') === '' && c('As an assistant') === '');
  ok('nothing is nothing', c('') === '' && c(null) === '' && c('   ') === '');
}

console.log('\nAsked once, after the first answer, and never over the person\'s own title:');
{
  const run = async ({ chat, messages = talk('Tell me about Larkfield Tea Rooms', 'It is a tea room open six days a week.'), reply = 'Larkfield Tea Rooms', id = chat ? chat.id : 'c1', model = 'cloud:openai:gpt-4o', during = null, throws = false }) => {
    const list = chat ? [chat] : [];
    const seen = { asks: [], saved: 0, shown: [] };
    const done = await T.after({ id, messages, model, list: () => list,
      ask: async (req) => { seen.asks.push(req); if (during) during(); if (throws) throw new Error('refused'); return { content: reply }; },
      save: () => { seen.saved++; }, show: (i, t) => seen.shown.push([i, t]) });
    return { done, seen };
  };
  const a = { id: 'c1', title: 'Tell me about Larkfield Tea…' };
  const one = await run({ chat: a });
  ok('the model is asked once and its title is taken', one.done === true && one.seen.asks.length === 1 && a.title === 'Larkfield Tea Rooms', json({ done: one.done, title: a.title }));
  ok('... marked as the model\'s, saved, and shown', a.titleBy === 'model' && one.seen.saved === 1 && json(one.seen.shown) === json([['c1', 'Larkfield Tea Rooms']]));
  const req = one.seen.asks[0] || {};
  ok('... on the chat\'s own model, with no tools, a low temperature and a way to stop it', req.modelValue === 'cloud:openai:gpt-4o' && Array.isArray(req.tools) && req.tools.length === 0 && req.temperature === 0.3 && !!req.signal && typeof req.signal.aborted === 'boolean', json(req));
  const again = await run({ chat: { id: 'c1', title: 'x' }, reply: 'Something else' });
  ok('a chat is asked about once', again.seen.asks.length === 0 && again.done === false);
  const named = { id: 'c2', title: 'My tea notes', titleBy: 'person' };
  const kept = await run({ chat: named });
  ok('a title the person gave is never replaced, and the model is not asked', kept.seen.asks.length === 0 && named.title === 'My tea notes');
  const racing = { id: 'c3', title: 'Tell me about…' };
  const raced = await run({ chat: racing, during: () => { racing.title = 'Mine'; racing.titleBy = 'person'; } });
  ok('... nor one given while the model was writing', raced.done === false && racing.title === 'Mine' && raced.seen.saved === 0);
  const failing = { id: 'c4', title: 'Tell me about…' };
  const failed = await run({ chat: failing, throws: true });
  ok('a request that fails leaves the chat as it was, quietly', failed.done === false && failing.title === 'Tell me about…' && !failing.titleBy && failed.seen.saved === 0);
  const junk = { id: 'c5', title: 'Tell me about…' };
  const junked = await run({ chat: junk, reply: 'This conversation is about the tea rooms and their opening days' });
  ok('an answer that is not a title leaves it as it was', junked.done === false && junk.title === 'Tell me about…' && !junk.titleBy);
  const early = { id: 'c6', title: 'Hi' };
  const waiting = await run({ chat: early, messages: [{ role: 'user', content: 'Hi' }] });
  ok('no answer yet: not asked, and asked once there is one', waiting.seen.asks.length === 0);
  const later = await run({ chat: early });
  ok('... which is the next turn', later.seen.asks.length === 1 && early.title === 'Larkfield Tea Rooms');
  const gone = await run({ chat: null, id: 'c7' });
  ok('a chat that is gone is not asked about', gone.seen.asks.length === 0 && gone.done === false);
  const none = await run({ chat: { id: 'c8', title: 'x' }, model: '' });
  ok('no model: not asked', none.seen.asks.length === 0);
}

console.log('\nWhere the chat uses it (app.js):');
{
  const app = src('js', 'app.js');
  ok('after a reply, the chat\'s model is asked for its title', /HCChatTitle\?\.after\(\{ id: current\.id, messages: state\.messages, model: modelEl\.value, ask: runModelTurn, list: activeChatList,/.test(app));
  ok('a title renamed in the header is the person\'s, when it changed', /if \(newTitle !== prev\) chat\.titleBy = "person"; chat\.title = newTitle;/.test(app));
  ok('... and one renamed in the list', /if \(c\) \{ if \(newTitle !== c\.title\) c\.titleBy = "person"; c\.title = newTitle; saveActiveChatList\(\); \}/.test(app));
  const boot = src('boot.js');
  ok('title.js is loaded after context.js and before app.js', boot.indexOf('/js/chat/context.js') >= 0 && boot.indexOf('/js/chat/context.js') < boot.indexOf('/js/chat/title.js') && boot.indexOf('/js/chat/title.js') < boot.indexOf('/js/app.js'));
}

console.log(`\n${pass} passed, ${fail} failed  (src/js/chat/title.js)`);
process.exit(fail ? 1 : 0);
