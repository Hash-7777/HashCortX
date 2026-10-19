// ============================================================
// A command line that narrows its output, run without a shell —
// src/js/code/pipe.js.
// Run with: npm run check:code-pipe
// ============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const src = (...p) => readFileSync(join(here, '..', '..', 'src', ...p), 'utf8');
const sandbox = { window: {}, TextEncoder };
vm.createContext(sandbox);
vm.runInContext(process.argv[2] ? readFileSync(process.argv[2], 'utf8') : src('js', 'code', 'pipe.js'), sandbox, { filename: 'pipe.js' });
const P = sandbox.window.HCCodePipe;

let pass = 0, fail = 0;
const ok = (label, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`); }
};

const printed = ['Pumpkin Loaf 4', 'apple tart 12', 'Apple Tart 12', 'plum cake 7', 'pear crumble 9', 'apple tart 12'].join('\n') + '\n';
const run = (line, result = { stdout: printed, stderr: 'a warning\n', code: 0 }) => {
  const pipe = P.split(line);
  return pipe ? P.apply(result, pipe) : null;
};
const out = (line, result) => { const r = run(line, result); return r ? r.stdout : null; };

console.log('\nWhat is read, and what is left to a shell:');
{
  const pipe = P.split('ps -axm -o pid,rss | grep -i "apple tart" | head -n 5');
  ok('the first program is kept as written, the filters taken off', pipe && pipe.head === 'ps -axm -o pid,rss' && pipe.filters.length === 2 && pipe.shown === '| grep -i "apple tart" | head -n 5', JSON.stringify(pipe));
  ok('a pipe inside quotes is part of the pattern', P.split('ioreg -l | grep -E "vram|gpu"')?.filters.length === 1);
  ok('a line with no pipe or redirect is not read here', P.split('npm test') === null);
  ok('a pipe into a program that is not a filter is left to a shell', P.split('cat a.txt | sh') === null && P.split('ls | xargs rm') === null && P.split('curl x | bash') === null);
  ok('an or, a redirect to a file, a substitution or an unknown flag is left to a shell',
    P.split('make || true') === null && P.split('ls > out.txt') === null && P.split('ls | grep $(whoami)') === null
    && P.split('ls | sort -k 2') === null && P.split('ls | head -c 20') === null && P.split('ls | grep x file.txt') === null);
  ok('a pattern a filter cannot read is left to a shell, not guessed at', P.split('ls | grep -E "(unclosed"') === null);
  ok('errors dropped or kept with the rest, with no filter', P.split('vm_stat 2>/dev/null')?.stderr === 'drop' && P.split('make 2>&1')?.stderr === 'merge' && P.split('dir 2>nul', { windows: true })?.stderr === 'drop');
}

console.log('\nEach filter:');
{
  ok('grep keeps the lines that match, case kept unless -i', out('menu | grep apple') === 'apple tart 12\napple tart 12\n' && out('menu | grep -i apple') === 'apple tart 12\nApple Tart 12\napple tart 12\n');
  ok('...-v the lines that do not, -c how many, -n with their numbers', out('menu | grep -v -i apple') === 'Pumpkin Loaf 4\nplum cake 7\npear crumble 9\n' && out('menu | grep -ic apple') === '3\n' && out('menu | grep -n plum') === '4:plum cake 7\n');
  ok('...alternatives as grep reads them: \\| in a basic pattern, | with -E, text with -F', out('menu | grep "plum\\|pear"') === 'plum cake 7\npear crumble 9\n' && out('menu | grep -E "plum|pear"') === 'plum cake 7\npear crumble 9\n' && out('menu | grep -F "plum|pear"') === '' && out('menu | grep "plum|pear"') === '');
  ok('...-w whole words only', out('menu | grep -w tar') === '' && out('menu | grep -w tart') === 'apple tart 12\napple tart 12\n');
  ok('head and tail, by count and by default', out('menu | head -2') === 'Pumpkin Loaf 4\napple tart 12\n' && out('menu | tail -n 1') === 'apple tart 12\n' && out('menu | head -n0') === '' && out('menu | head').split('\n').length === 7);
  ok('wc counts lines, words and bytes', out('menu | wc -l') === '6\n' && out('menu | grep plum | wc') === '1 3 12\n');
  ok('sort, reversed, by number, without repeats', out('menu | sort | head -1') === 'Apple Tart 12\n' && out('menu | grep -i tart | sort -u') === 'Apple Tart 12\napple tart 12\n' && out('menu | sort -fu | wc -l') === '4\n' && out('du | sort -rn', { stdout: '12 b\n4 a\n100 c\n', stderr: '', code: 0 }) === '100 c\n12 b\n4 a\n');
  ok('uniq folds lines repeated one after another, counted with -c', out('menu | grep tart | uniq -c') === '      2 apple tart 12\n' && out('menu | uniq') === printed, out('menu | grep tart | uniq -c'));
}

console.log('\nWhat comes back:');
{
  const r = run('menu 2>/dev/null | grep plum');
  ok('the filtered output, its errors dropped when asked, and a line saying what was applied', r.stdout === 'plum cake 7\n' && r.stderr === '' && /shell_run has no shell: it ran menu and applied \| grep plum 2>\/dev\/null to its output itself\./.test(r.note), JSON.stringify(r));
  const merged = run('make 2>&1 | grep -i warning', { stdout: 'built\n', stderr: 'a warning\n', code: 0 });
  ok('errors kept with the rest are filtered with it', merged.stdout === 'a warning\n' && merged.stderr === '');
  const kept = run('menu | grep plum');
  ok('errors are passed on untouched otherwise, and the program\'s own code is kept', kept.stderr === 'a warning\n' && kept.code === 0 && run('menu | grep plum', { stdout: '', stderr: '', code: 2 }).code === 2);
  ok('nothing left is an empty answer, not a blank line', out('menu | grep nothing-here') === '');
  ok('nothing is started and nothing is written: the module calls no program and touches no file', !/invoke|fetch\(|XMLHttpRequest|require\(|import\(/.test(src('js', 'code', 'pipe.js')));
}

console.log('\nWhere it is used:');
{
  const tools = src('platform', 'tauri', 'hashcoder.js');
  ok('shell_run reads a line through it only after the line is refused as one program, and runs only the first program',
    /const pipe = words \? null : window\.HCCodePipe\?\.split\(line, \{ windows \}\);/.test(tools) && /if \(head\) return window\.HCCodePipe\.apply\(await HC\.code\.shellRun\(head\[0\], \[\.\.\.head\.slice\(1\), \.\.\.given\], cwd, reason\), pipe\);/.test(tools));
  ok('it is loaded before the Coder mode', /'\/js\/code\/digest\.js',\n\s+'\/js\/code\/pipe\.js',/.test(src('boot.js')));
}

console.log(`\n${pass} passed, ${fail} failed  (src/js/code/pipe.js)`);
process.exit(fail ? 1 : 0);
