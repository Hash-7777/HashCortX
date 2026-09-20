// ==============================================================
// What the Forge works out a request to be, before it designs it
//
// Loads the REAL src/js/forge/subject.js and holds the property the module
// exists for: what a run designs comes from the request in front of it, so two
// different requests are not designed by identical instructions.
//
// The defect it replaces, kept here as a control: the prompt used to be sorted
// by three regular expressions into "anatomical", "organic_diffusion" or
// "parametric". The route never reached the model, one of the three was
// rewritten to another on the line after it was chosen, and the trace named an
// SDF kernel that does not exist. A skull and a doorknob were built by exactly
// the same instructions under different names.
//
// Run with: npm run check:forge-subject
// ==============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const sandbox = { window: {} };
vm.createContext(sandbox);
// fences.js first: readBrief reads a model's answer through the app's own
// fence reader, so a brief inside a code block is read the way the app reads it.
vm.runInContext(readFileSync(join(root, 'src', 'js', 'fences.js'), 'utf8'), sandbox, { filename: 'fences.js' });
vm.runInContext(readFileSync(join(root, 'src', 'js', 'forge', 'subject.js'), 'utf8'), sandbox, { filename: 'subject.js' });
vm.runInContext(readFileSync(join(root, 'src', 'js', 'forge', 'ask-subject.js'), 'utf8'), sandbox, { filename: 'ask-subject.js' });
const S = sandbox.window.HCForgeSubject;
const A = sandbox.window.HCForgeAskSubject;

const mode = readFileSync(join(root, 'src', 'modes', 'forge', 'mode.js'), 'utf8');
const asker = readFileSync(join(root, 'src', 'js', 'forge', 'ask-subject.js'), 'utf8');
const prepare = readFileSync(join(root, 'src', 'js', 'forge', 'prepare.js'), 'utf8');
const boot = readFileSync(join(root, 'src', 'boot.js'), 'utf8');

let pass = 0;
let fail = 0;
function ok(label, cond, detail = '') {
  if (cond) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}

const answer = (obj) => S.readBrief(JSON.stringify(obj));

console.log('The classifier and the routes it invented are gone:');
ok('no prompt classifier', !/classifyForgePrompt/.test(mode));
ok('nothing is called anatomical', !/["']anatomical["']/.test(mode));
ok('no diffusion route that could never be taken', !/organic_diffusion/.test(mode));
ok('no SDF kernel is announced', !/SDF Kernel/.test(mode));
ok('nothing reports having been smoothed', !/sdf smoothed/.test(mode));
// The real property, rather than a word search: there is no table anywhere
// mapping a kind of thing to a design. Whatever it is asked about, what the
// words alone settle is the same four answers and never a parts list.
const SPREAD = ['a human skull', 'an oak tree', 'a hex bolt', 'a wedding ring', 'a model dragon', 'a park bench', 'a violin'];
ok('nothing is looked up by what kind of thing it is',
  SPREAD.every((q) => S.derive(q).parts.length === 0 && S.derive(q).subject === '' && S.derive(q).lies === null));
ok('and every one of them still gets a brief', SPREAD.every((q) => S.merge(null, q).from === 'words'));

console.log('\nA model is asked what the thing is, and its answer is read:');
const bike = answer({
  subject: 'a road bicycle', make: 'a frame of tubes with two wheels',
  parts: [{ name: 'frame', shape: 'extrude', note: 'the silhouette' }, { name: 'wheel', shape: 'torus' }],
  lies: 'x', sizeMm: 1700, objects: 1, hollow: false, symmetry: 'z',
  repeats: ['32 spokes about z'], cuts: [],
});
ok('a well-formed answer is read', bike !== null);
const bikeBrief = S.merge(bike, 'a road bicycle');
ok('it comes back from the model', bikeBrief.from === 'model');
ok('its parts survive', bikeBrief.parts.map((p) => p.name).join(',') === 'frame,wheel');
ok('a shape it named is kept', bikeBrief.parts[0].shape === 'extrude');
ok('the axis it lies along is kept', bikeBrief.lies === 'x');
ok('its real size is kept', bikeBrief.sizeMm === 1700);
ok('its mirror plane is kept', bikeBrief.symmetry === 'z');
ok('what repeats is kept', bikeBrief.repeats[0] === '32 spokes about z');
ok('an answer that is not JSON is not read', S.readBrief('I think it is a bicycle.') === null);
ok('an answer inside a code block still is', S.readBrief('```json\n{"subject":"a mug","parts":[{"name":"body"}]}\n```') !== null);

console.log('\nNothing a model sends is trusted:');
const junk = S.normalise({
  subject: 'x'.repeat(500), parts: Array.from({ length: 80 }, (_, i) => ({ name: `p${i}`, shape: 'wormhole' })),
  lies: 'diagonal', sizeMm: 99999999, objects: 4000, symmetry: 'w',
  repeats: Array.from({ length: 40 }, (_, i) => `r${i}`), cuts: ['ok'], hollow: 'yes please',
});
ok('a subject cannot run away with the prompt', junk.subject.length <= 60);
ok('the parts list is capped', junk.parts.length === S.MAX_PARTS);
ok('a shape the app cannot build is dropped', junk.parts[0].shape === '');
ok('an axis that is not an axis is dropped', junk.lies === null);
ok('a size beyond reach is brought back', junk.sizeMm === S.MAX_SIZE_MM);
ok('a thousand objects are not built', junk.objects === S.MAX_OBJECTS);
ok('a mirror plane that is not a plane is dropped', junk.symmetry === null);
ok('the notes are capped', junk.repeats.length === S.MAX_NOTES);
ok('hollow is only ever true or false', junk.hollow === false);
ok('parts with no name are dropped', S.normalise({ parts: [{ shape: 'box' }, { name: 'a' }] }).parts.length === 1);
ok('the same part twice is one part', S.normalise({ parts: [{ name: 'Body' }, { name: 'body' }] }).parts.length === 1);
ok('a part written as plain text still counts', S.normalise({ parts: ['handle'] }).parts[0].name === 'handle');

console.log('\nWhen no model answers, the words are read and nothing is invented:');
const words = S.merge(null, 'a 120mm hollow mug with a bore through the handle');
ok('it says where it came from', words.from === 'words');
ok('a measurement written in the request is taken', words.sizeMm === 120);
ok('a thing that must be hollow is known to be', words.hollow === true);
ok('the cut the request names is carried', words.cuts.length === 1);
ok('no parts list is guessed', words.parts.length === 0);
ok('no axis is guessed', words.lies === null);
ok('no mirror plane is guessed', words.symmetry === null);
ok('centimetres are read', S.sizeFromPrompt('a 12 cm bracket') === 120);
ok('inches are read', S.sizeFromPrompt('a 2 inch knob') === 50.8);
ok('metres are read', S.sizeFromPrompt('a 1.5 m post') === 1500);
ok('the largest measurement is the longest side', S.sizeFromPrompt('a 200mm shelf with 4mm holes') === 200);
ok('a request with no measurement states no size', S.sizeFromPrompt('a desk lamp') === 0);

console.log('\nHow many separate things were asked for is read, not assumed:');
ok('a bicycle is one thing', S.objectsFromPrompt('a road bicycle') === 0);
ok('a pair is several', S.objectsFromPrompt('a pair of dice') === 2);
ok('a set is several', S.objectsFromPrompt('a chess set of pieces') === 2);
ok('a number word is counted', S.objectsFromPrompt('three stacked bowls') === 3);
ok('a digit before a plural is counted', S.objectsFromPrompt('6 candles') === 6);
ok('a digit before a unit is not a count', S.objectsFromPrompt('a bracket 5 inches long') === 0);
ok('a count beyond reach is brought back', S.objectsFromPrompt('a collection') <= S.MAX_OBJECTS);
ok('a model saying one cannot overrule words saying several',
  S.merge(answer({ subject: 'dice', parts: [{ name: 'die' }], objects: 1 }), 'a pair of dice').objects === 2);
ok('a measurement the person typed beats one the model chose',
  S.merge(answer({ subject: 'mug', parts: [{ name: 'body' }], sizeMm: 95 }), 'a 200mm mug').sizeMm === 200);

console.log('\nThe design call is told what to build, and told it is not a limit:');
const lines = S.briefLines(bikeBrief);
ok('the subject reaches it', /a road bicycle/.test(lines));
ok('the parts reach it', /frame — extrude/.test(lines));
ok('the axis reaches it', /along X/.test(lines));
ok('the size reaches it', /1700 mm/.test(lines));
ok('the mirror plane reaches it, named as the field the app reads', /"mirror": "z"/.test(lines));
ok('what repeats reaches it, with the field that makes it', /"repeat"/.test(lines));
ok('a hollow thing is told to cut, not to model a skin',
  /op": "subtract/.test(S.briefLines(S.merge(null, 'a hollow vase'))) );
ok('the brief says it is a reading, not a limit', /not a limit on it/.test(lines));
ok('and that a missing part should still be built', /build it/.test(lines));
ok('a brief that settled nothing says nothing at all', S.briefLines(S.merge(null, 'a thing')) === '');
ok('and a brief that is not a brief says nothing', S.briefLines(null) === '');

console.log('\nTwo different requests are not designed by the same instructions:');
const mug = S.briefLines(S.merge(answer({ subject: 'a mug', parts: [{ name: 'body', shape: 'lathe' }], lies: 'y', sizeMm: 95, hollow: true }), 'a mug'));
ok('a mug and a bicycle read differently', mug !== lines && mug.length > 0);

console.log('\nOne object or several is answered per request, not fixed:');
ok('one thing keeps the old rule', /One object, nothing floating beside it/.test(S.subjectRule(1)));
ok('several things are allowed to stand apart', /stand apart/.test(S.subjectRule(3)));
ok('and the count is named', /3 separate things/.test(S.subjectRule(3)));
ok('nothing settled falls back to one object', /One object/.test(S.subjectRule(0)));
ok('the design call takes the rule from the brief', /subjectRule\(brief\?\.objects\)/.test(mode));
ok('the fixed one-object line is no longer written into the prompt',
  (mode.match(/One object, nothing floating beside it/g) || []).length === 0);

console.log('\nAnd the run that keeps one subject is told the same count:');
ok('preparePlan takes a subject count', /function preparePlan\(plan, opts = \{\}\)/.test(prepare) && /opts\.subjects/.test(prepare));
ok('keepOneSubject honours it', /function keepOneSubject\(parts, prompt, subjects = 0\)/.test(prepare));
ok('two or more and nothing is removed', /Number\(subjects\) >= 2 \|\| allowsSeveralSubjects/.test(prepare));
ok('the word list can still only grant permission', /allowsSeveralSubjects\(prompt\)/.test(prepare));
ok('the run passes the count through', /subjectsOf\(activeForgeBrief\)/.test(mode));
ok('and so does Improve', (mode.match(/subjectsOf\(activeForgeBrief\)/g) || []).length >= 2);

console.log('\nAsking never costs a run:');
ok('one model gets a deadline', /callWithin\(DEADLINE_MS/.test(asker));
ok('and the deadline is half a minute or less', A.DEADLINE_MS > 0 && A.DEADLINE_MS <= 30000);
ok('at most three models are asked', /i < TRIES/.test(asker) && A.TRIES <= 3);
ok('a run that cannot reach one still gets a brief', /S\.merge\(answered, prompt\)/.test(asker));
ok('an aborted run stops asking', /signal\.aborted\) break/.test(asker));
ok('a model that cannot be read is treated as a failure', /its answer could not be read/.test(asker));
ok('the trace says when the brief came from the words instead', /Read what this is from the request/.test(asker));
ok('the mode only calls it', !/callWithin/.test(mode.slice(mode.indexOf('function askForSubjectBrief'), mode.indexOf('function askForSubjectBrief') + 900)));

console.log('\nBoth files are loaded, in an order that works:');
const at = (name) => boot.indexOf(name);
ok('subject.js is loaded', at('/js/forge/subject.js') > 0);
ok('ask-subject.js is loaded', at('/js/forge/ask-subject.js') > 0);
ok('the reading is loaded before the asking', at('/js/forge/subject.js') < at('/js/forge/ask-subject.js'));

console.log(`\n${pass} passed, ${fail} failed  (src/js/forge/subject.js)`);
process.exit(fail ? 1 : 0);
