// ==============================================================
// Asking before building something personal — checks
//
// Loads the REAL src/js/swarm/clarify.js and web-brief.js into a Node VM.
//
// The rule: a team never invents the person or business a task is about. It
// asks; what is answered is used as given; what is not is a marked placeholder.
//
// Run with: npm run check:swarm-clarify
// ==============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(readFileSync(join(root, 'src', 'js', 'fences.js'), 'utf8'), sandbox, { filename: 'fences.js' });
for (const f of ['clarify.js', 'web-brief.js']) vm.runInContext(readFileSync(join(root, 'src', 'js', 'swarm', f), 'utf8'), sandbox, { filename: f });
const C = sandbox.window.HCSwarmClarify;
const B = sandbox.window.HCSwarmWebBrief;

let pass = 0;
let fail = 0;
function ok(label, cond, detail = '') {
  if (cond) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}

console.log('What to ask is read from a model\'s answer, carefully:');
{
  const q = C.parseQuestions('{"questions":[{"id":"name","question":"What is your name?","hint":"Sara"},{"id":"proj","question":"Which projects should it show?"}]}');
  ok('questions come back in order with their hints', q.length === 2 && q[0].question === 'What is your name?' && q[0].hint === 'Sara' && q[1].hint === '');
  ok('an answer asking nothing is an empty list, not a failure', Array.isArray(C.parseQuestions('{"questions":[]}')) && C.parseQuestions('{"questions":[]}').length === 0);
  ok('a fenced answer with words around it is read', C.parseQuestions('Here you go:\n```json\n{"questions":[{"question":"Your email?"}]}\n```').length === 1);
  ok('a bare list of strings is read', C.parseQuestions('["What is your name?", "Where are you based?"]').length === 2);
  ok('an answer that is not JSON is unreadable, so the fallback is used', C.parseQuestions('I think you should ask for a name.') === null);
  ok('broken JSON is unreadable', C.parseQuestions('{"questions":[{"question":') === null);
  const many = JSON.stringify({ questions: Array.from({ length: 12 }, (_, i) => ({ question: `Question number ${i}?` })) });
  ok(`no more than ${C.MAX_QUESTIONS} are asked`, C.parseQuestions(many).length === C.MAX_QUESTIONS);
  ok('the same question twice is asked once', C.parseQuestions('{"questions":[{"question":"Your name?"},{"question":"your name?"}]}').length === 1);
  ok('an id is made safe for the page', /^[\w-]+$/.test(C.parseQuestions('{"questions":[{"id":"a b<c>","question":"Your name?"}]}')[0].id));
  const hostile = C.parseQuestions('{"questions":[{"question":"<img src=x onerror=alert(1)> name?"}]}');
  ok('question text is kept as text for the page to show as text', hostile[0].question.includes('<img'));
}

console.log('\nWhen no model can be asked, a plainly personal task is still asked about:');
{
  ok('a portfolio for a software developer is personal', C.looksPersonal('build a full functional portofolio website for a software developer to show his skills'));
  ok('a CV is personal', C.looksPersonal('write my CV'));
  ok('a site for my restaurant is personal', C.looksPersonal('a website for my restaurant'));
  ok('a market analysis is not', !C.looksPersonal('Research and write a market analysis of electric bikes'));
  ok('a personal task gets questions, the name first', C.fallbackQuestions('portfolio website')[0].id === 'name');
  ok('any other task gets none, so it starts at once', C.fallbackQuestions('summarise three offsite ideas').length === 0);
  ok('the decision call says what not to ask about', /Do not ask about what the team can decide well itself/.test(C.messages('x')[0].content));
}

console.log('\nWhat is answered is fact; what is not is a marked placeholder:');
{
  const task = 'build a portfolio website for a software developer';
  const out = C.taskWithAnswers(task, [
    { question: 'What name should it use?', answer: 'Mona Adel' },
    { question: 'Which projects should it show?', answer: 'Ledger API — github.com/mona/ledger' },
    { question: 'How should people contact you?', answer: '   ' },
  ]);
  ok('the task comes first, unchanged', out.startsWith(task));
  ok('answers are written in as given', out.includes('What name should it use? Mona Adel') && out.includes('github.com/mona/ledger'));
  ok('and marked as not to be added to', /do not add to them or invent others/.test(out));
  ok('a blank answer becomes a placeholder, never an invention', /Not given: How should people contact you\?/.test(out) && /square brackets/.test(out) && /Never invent such a fact/.test(out));
  ok('a blank answer to a question of taste is the team\'s to decide, not a placeholder', /choice of taste — colours, fonts, a logo, imagery/.test(out) && /make that choice yourself/.test(out));
  ok('a placeholder is never put where a browser reads it as code', /never put a placeholder inside code, a colour, a link or image address, or a data value/.test(out));
  ok('skipping everything still rules out inventing', /Never invent such a fact/.test(C.taskWithAnswers(task, [{ question: 'Your name?', answer: '' }])) && !/Details from the person/.test(C.taskWithAnswers(task, [{ question: 'Your name?', answer: '' }])));
  ok('with no questions the task is untouched', C.taskWithAnswers(task, []) === task);
  ok('the team is not asked about accounts it cannot connect to', /Do not ask about hosting, domain names, deployment, payment providers/.test(C.messages(task)[0].content));
}

console.log('\nThe example is said once, and it is the app that says "for example":');
{
  // A model asked for an example writes "e.g. Sara Ahmed" as often as not.
  // The app puts "e.g." in front of what it is given, so the two together
  // read as "e.g. e.g. Sara Ahmed".
  const lead = [
    ['e.g. Sara Ahmed', 'Sara Ahmed'],
    ['eg. Sara Ahmed', 'Sara Ahmed'],
    ['E.G.  Sara Ahmed', 'Sara Ahmed'],
    ['e.g., Sara Ahmed', 'Sara Ahmed'],
    ['for example: Sara Ahmed', 'Sara Ahmed'],
    ['for instance, a bakery', 'a bakery'],
    ['such as Go, PostgreSQL', 'Go, PostgreSQL'],
    ['examples: A, B', 'A, B'],
    ['i.e. the founder', 'the founder'],
    ['like a bakery in Cairo', 'a bakery in Cairo'],
    ['e.g. e.g. Sara', 'Sara'],
    ['"Sara Ahmed"', 'Sara Ahmed'],
  ];
  for (const [given, want] of lead) ok(`"${given}" is offered as "${want}"`, C.exampleOf(given) === want, C.exampleOf(given));

  // And what only looks like one is left alone, which is the half that is
  // easy to get wrong: "eg" opens "egypt", "example" opens "example.com".
  const keep = ['egypt office', 'Eggplant Ltd', 'example.com/me', 'Sayed Ali', 'Likely buyers', 'Sara Ahmed', 'Ikea, Cairo'];
  for (const given of keep) ok(`"${given}" is left exactly as it is`, C.exampleOf(given) === given, C.exampleOf(given));

  ok('nothing at all is nothing, not the word undefined', C.exampleOf(undefined) === '' && C.exampleOf(null) === '' && C.exampleOf('') === '');
  ok('and a whole lead-in with nothing after it comes back empty', C.exampleOf('e.g.') === '' && C.exampleOf('for example:') === '');
}

console.log('\nThe example can be used, not only looked at:');
{
  // It used to be the field's placeholder and nothing else. A placeholder
  // cannot be selected, cannot be copied, and the right arrow does not take
  // it — which is what somebody tries first.
  const ask = readFileSync(join(root, 'src', 'js', 'swarm', 'ask.js'), 'utf8');
  const css = readFileSync(join(root, 'src', 'modes', 'agent-maker', 'mode.css'), 'utf8');
  ok('the app writes "for example" once, in front of the cleaned example', /input\.placeholder = `e\.g\. \$\{example\}`/.test(ask));
  ok('and it is cleaned by the one file that knows how', /window\.HCSwarmClarify\.exampleOf\(q\.hint\)/.test(ask));
  ok('the example is also put on the page as a control', /amk-ask-example-use/.test(ask) && /use\.textContent = example/.test(ask));
  ok('pressing it fills the field', /use\.addEventListener\("click", take\)/.test(ask));
  ok('the right arrow takes it too', /e\.key !== "ArrowRight" && e\.key !== "Tab"/.test(ask));
  ok('but only while the field is empty, so it never eats what was typed', /if \(input\.value\.trim\(\)\) return false;/.test(ask) && /if \(input\.value\.length\) return;/.test(ask));
  ok('and only on the arrow alone, so a shortcut still works', /e\.shiftKey \|\| e\.metaKey \|\| e\.ctrlKey \|\| e\.altKey/.test(ask));
  ok('taking it leaves the caret after it, ready to be changed', /setSelectionRange\(example\.length, example\.length\)/.test(ask));
  ok('the words the model wrote are put on the page as text, never as markup', !/innerHTML/.test(ask));
  ok('and the example can be selected and copied where it sits', /\.amk-ask-example-use \{[^}]*user-select: text/.test(css));
}

console.log('\nThe website rules no longer ask for an invented person:');
{
  const note = B.brief({ task: 'portfolio website', siteFiles: ['index.html'], isFinalOwner: true });
  ok('agents are not told to invent a name', !/invent a realistic one/.test(note));
  ok('they are told to use the details given exactly', /every detail the request gives exactly as given/.test(note));
  ok('and to mark what is missing', /\[Your name\]/.test(note) && /Never invent facts about the real person or business/.test(note));
}

console.log(`\n${pass} passed, ${fail} failed  (src/js/swarm/clarify.js)`);
process.exit(fail ? 1 : 0);
