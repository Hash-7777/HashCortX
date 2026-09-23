// ==============================================================
// Which tool a request plainly needs — checks
//
// Loads the REAL src/js/chat/intent.js and holds that a request that plainly
// needs a tool is given it, that a request to write is given none, that
// ordinary text which only looks like one of those is not, and that anything
// unclear is left to the model.
//
// Run with: npm run check:intent
// ==============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const src = (...p) => readFileSync(join(here, '..', '..', 'src', ...p), 'utf8');
const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(src('js', 'chat', 'intent.js'), sandbox, { filename: 'intent.js' });
const I = sandbox.window.HCIntent;

let pass = 0;
let fail = 0;
function ok(label, cond) {
  if (cond) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}`); }
}
const ALL = ['web_search', 'fetch_url', 'current_datetime', 'calculate', 'execute_python', 'remember_fact', 'recall_facts'];
const tool = (text, names = ALL) => { const r = I.route(text, names); return r ? r.tool : null; };
const each = (label, list, want) => {
  const wrong = list.filter((t) => tool(t) !== want);
  ok(`${label}${wrong.length ? ` — got it wrong for: ${wrong.join(' | ')}` : ''}`, !wrong.length);
};

console.log('A request that plainly needs a tool gets it:');
{
  const r = I.route('Read https://example.com/post?id=3. and summarise it.', ALL);
  ok('a web address is read, and the address is the app\'s, not the model\'s', r.tool === 'fetch_url' && r.arguments.url === 'https://example.com/post?id=3');
  each('code to run, a file, a chart', ['Run Python to compute the 30th Fibonacci number.', 'Use Python to count the vowels in this sentence.', 'Make me an Excel file with the numbers 1 to 10.', 'Plot a sine wave and save it as a PNG.', 'Draw a bar chart of these sales.', 'Export this table as a CSV.'], 'execute_python');
  each('a search, or anything current', ['Search the web for the latest stable version of Python.', 'Look up the opening hours of the British Museum.', 'Can you search online for cheap flights to Rome?', 'Who won the most recent FIFA World Cup?', 'What is the current price of Bitcoin?', 'What is the weather in London right now?', 'Convert 150 US dollars to euros at the current rate.', "Summarise today's news.", 'What are the headlines this week?'], 'web_search');
  const time = I.route('What day of the week is it today?', ALL);
  ok('the date or the time, with nothing for the model to write', time.tool === 'current_datetime' && Object.keys(time.arguments).length === 0);
  each('... asked in other ways', ['What time is it in Tokyo?', "What's the date today?", 'what year is it'], 'current_datetime');
  ok('the place it is asked about is passed on, so the app works out the time there', I.route('What time is it in New York right now?', ['current_datetime']).arguments.place === 'New York' && I.route('What time is it in Tokyo?', ALL).arguments.place === 'Tokyo');
  ok('the time or date asked about "right now" is the clock, not a search', I.route("What's the date in New York right now?", ALL).tool === 'current_datetime' && I.route('What time is it right now?', ALL).tool === 'current_datetime');
  each('arithmetic', ["What's 17% of 2,340?", 'What is 2 to the power of 70? Use the calculator.', 'How many days are there between March 3 and July 19?', 'What is 1234 * 5678?', 'What is 100 / 8?', 'what is 45 minus 17', 'What is the square root of 1764?'], 'calculate');
  ok('the model writes the calculation, held to the tool\'s own arguments', !('arguments' in I.route('What is 1234 * 5678?', ALL)));
}

console.log('\nA request to write is given no tool:');
each('writing, explaining, planning', ['Write a haiku about autumn.', 'Write a short email declining a meeting politely.', 'Summarise the plot of Romeo and Juliet in two sentences.', 'Give me a three-step plan for learning Spanish.', 'Rewrite this more formally: hey, can u send the report', 'Explain what a mutex is in two sentences.', 'Please translate "good morning" into French.', 'Write a Python function that reverses a string.', 'Draft an email saying sales grew 20% this quarter... actually make it upbeat', 'Tell me a joke about cats.'], 'none');
ok('a request to write about something current still searches first', tool('Write a summary of the latest news about solar power.') === 'web_search');

console.log('\nWhat only looks like one of those is not:');
each('left to the model', ['What is the capital of Australia?', 'My name is Seif and I live in Cairo.', 'What do you remember about me?', 'Remember that my favourite colour is teal.', 'What happened in 2023-2024 in Egypt?', 'My screen is 1920x1080, is that good?', 'The meeting is on 3/4/2025 at 10.', 'Is Python a good first language?'], null);
ok('a number followed by an exclamation is not a factorial', tool('We launched in 2024!') === null);
ok('a tool the agent lacks is never chosen: the model decides instead', tool('What is 1234 * 5678?', ['web_search']) === null && tool('Read https://example.com', ['calculate']) === null);
ok('asked to search rather than read an address, it searches', tool('Search for pages that link to https://example.com today') === 'web_search');
ok('nothing to go on', I.route('', ALL) === null && I.route(null, ALL) === null);

console.log(`\n${pass} passed, ${fail} failed  (src/js/chat/intent.js)`);
process.exit(fail ? 1 : 0);
