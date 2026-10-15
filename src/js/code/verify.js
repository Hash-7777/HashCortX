// ==============================================================
// Proof that a change works — what the agent ran, and when it is sent back
//
// An agent that changed code and then said "done" was believed on its word.
// Nothing tied finishing to having checked anything, so a change that broke
// the tests was reported as finished in the same words as one that passed
// them, and the person could not tell which they had.
//
// This keeps a record of proof and decides from it:
//
//   · The project's own checks are found once: the test, lint, type and
//     build commands its package.json, Python, Cargo, Go or Makefile set up
//     (projectChecks). The app never runs them itself.
//   · Every command the agent runs is sorted — test, lint, type check, build,
//     format, or none of those — and recorded with whether it passed, whether
//     it covered the whole project or part of it, and whether it ran after the
//     last change to a file (proofLog).
//   · When the agent tries to finish after changing code, and no test has
//     passed since that change, it is sent back once to run the project's own
//     test and say what passed; twice at most (stopCheck). A change only to
//     documents, pages or settings files does not send it back, nor does a
//     reply that ends by asking the person something, nor a project with no
//     test command to name.
//   · When the request asks for a change, no file changed in the run, and the
//     reply holds the code instead, the agent is sent back once to make the
//     change with the file tools (unmadeChange). On a model on this computer
//     under 15B a reply of words alone sends it back too, a question
//     included, unless the request says to leave the files alone: such a
//     model ends a run by explaining the fix, or by asking the person for
//     what a search would have found.
//   · When the agent tries to finish with steps of its own plan still open
//     (js/code/plan.js), it is sent back once to do them (planCheck).
//   · After a larger change by a large model, a second look with a clean
//     slate (js/code/review.js) may send it back once with what it found
//     (freshReviewNote).
//   · A model on this computer under 15B that changed files is sent back once
//     more, with the request quoted, to check each thing it asked for against
//     the files and do what is missing (reviewCheck). Such a model's usual
//     failure is not a wrong change but a finished half: one of three edits,
//     a page without the stylesheet it was asked for. The order, and the
//     switch in Settings the last two follow, are in sendBack.
//   · What the person is told at the end is worked out from the record, not
//     from the agent's own words (proofLine): which check passed after the
//     last change and how much of the project it covered, or that nothing was
//     checked.
//
// Pure: takes strings and records, returns strings and records. No DOM, no
// storage, no running of anything.
//
// Loaded before the Coder mode and published as window.HCCodeVerify.
// Checked by scripts/checks/code-verify.mjs.
// ==============================================================

(function () {
  'use strict';

  // ── What a command is ───────────────────────────────────────────────────

  const RUNNERS = new Set(['npm', 'pnpm', 'yarn', 'bun']);
  const SCRIPT_KIND = [
    [/^(test|tests|test:.+|spec|check:test)$/, 'test'],
    [/^(lint|lint:.+|eslint)$/, 'lint'],
    [/^(typecheck|type-check|types|tsc|check:types)$/, 'typecheck'],
    [/^(build|build:.+|compile)$/, 'build'],
    [/^(format|fmt|prettier)$/, 'format'],
  ];
  const TOOL_KIND = {
    jest: 'test', vitest: 'test', mocha: 'test', ava: 'test', pytest: 'test', 'py.test': 'test', tox: 'test', nox: 'test',
    eslint: 'lint', ruff: 'lint', flake8: 'lint', pylint: 'lint', clippy: 'lint', golint: 'lint', rubocop: 'lint',
    tsc: 'typecheck', mypy: 'typecheck', pyright: 'typecheck',
    prettier: 'format', black: 'format', gofmt: 'format', rustfmt: 'format',
    webpack: 'build', vite: 'build', rollup: 'build', esbuild: 'build',
  };

  const scriptKind = (name) => {
    const hit = SCRIPT_KIND.find(([rx]) => rx.test(String(name || '')));
    return hit ? hit[1] : null;
  };
  const base = (p) => String(p || '').split(/[\\/]/).pop().toLowerCase();

  /**
   * What kind of check a command is — 'test', 'lint', 'typecheck', 'build',
   * 'format' — or null for a command that checks nothing. `args` is the list
   * shell_run was given; a command written as one line is read the same.
   */
  function commandKind(command, args) {
    const words = [String(command || ''), ...(Array.isArray(args) ? args : [])]
      .join(' ').trim().split(/\s+/).filter(Boolean);
    if (!words.length) return null;
    const [first, ...rest] = words;
    const prog = base(first);
    if (RUNNERS.has(prog)) {
      const sub = rest[0] === 'run' || rest[0] === 'run-script' ? rest[1] : rest[0];
      if (sub === 't') return 'test';
      if (sub === 'exec' || sub === 'x') return commandKind(rest[1], rest.slice(2));
      return scriptKind(sub);
    }
    if (prog === 'npx' || prog === 'pnpx' || prog === 'bunx') return commandKind(rest[0], rest.slice(1));
    if (prog === 'node' || prog === 'deno' || prog === 'bun') {
      if (rest.includes('--test') || rest[0] === 'test') return 'test';
      if (rest.includes('--check') || rest.includes('-c')) return 'lint';
      const file = rest.find((w) => !w.startsWith('-'));
      return file && /(^|[\\/._-])(test|tests|spec)([\\/._-]|$)/i.test(file) ? 'test' : null;
    }
    if (/^python(\d(\.\d+)?)?$/.test(prog) || prog === 'py') {
      const m = rest.indexOf('-m');
      if (m >= 0) {
        const mod = rest[m + 1];
        if (mod === 'unittest' || mod === 'pytest') return 'test';
        if (mod === 'py_compile' || mod === 'compileall') return 'lint';
        return TOOL_KIND[mod] || null;
      }
      const file = rest.find((w) => !w.startsWith('-'));
      return file && /(^|[\\/._-])(test|tests)([\\/._-]|$)/i.test(file) ? 'test' : null;
    }
    if (prog === 'cargo' || prog === 'go') {
      const sub = rest[0];
      if (sub === 'test') return 'test';
      if (sub === 'clippy' || sub === 'vet') return 'lint';
      if (sub === 'build' || sub === 'check') return prog === 'cargo' && sub === 'check' ? 'typecheck' : 'build';
      if (sub === 'fmt') return 'format';
      return null;
    }
    if (prog === 'make' || prog === 'just') {
      const target = rest.find((w) => !w.startsWith('-'));
      if (!target) return prog === 'make' ? 'build' : null;
      return scriptKind(target) || (/^check$/.test(target) ? 'test' : null);
    }
    return TOOL_KIND[prog] || null;
  }

  /**
   * Whether a command ran the whole of a kind of check or part of it: named
   * files, a filter, a single test. `npm test` is whole; `npm test -- -t name`
   * and `node --test test/one.test.js` are part.
   */
  function commandScope(command, args) {
    const words = [String(command || ''), ...(Array.isArray(args) ? args : [])]
      .join(' ').trim().split(/\s+/).filter(Boolean);
    const rest = words.slice(1);
    if (rest.some((w) => /^(-t|-k|--grep|--filter|--testNamePattern|--test-name-pattern|-run|--match)$/.test(w) || /^--(grep|filter|testNamePattern|test-name-pattern)=/.test(w))) return 'part';
    const prog = base(words[0]);
    const sub = RUNNERS.has(prog) ? (rest[0] === 'run' ? 2 : 1) : 0;
    const operands = rest.slice(sub).filter((w) => w !== '--' && !w.startsWith('-') && w !== 'test' && w !== '-m' && !/^(unittest|pytest)$/.test(w));
    if (prog === 'go' || prog === 'cargo') return operands.some((w) => w !== './...' && w !== 'test') ? 'part' : 'whole';
    return operands.some((w) => /[\\/.]/.test(w) || /test/i.test(w)) ? 'part' : 'whole';
  }

  // ── The project's own checks ────────────────────────────────────────────

  const NO_TEST = /no test specified/i;

  /**
   * The commands a project sets up for checking itself, from the files at
   * its root: `{ test, lint, typecheck, build }`, each a command line or
   * absent. `files` is the list of names at the root; the texts are those
   * files' contents where they exist.
   */
  function projectChecks({ files = [], packageJson = '', makefile = '', pyproject = '', requirements = '' } = {}) {
    const names = new Set(files.map((f) => String(f)));
    const out = {};
    if (packageJson) {
      let pkg = null;
      try { pkg = JSON.parse(packageJson); } catch { /* unreadable: say nothing */ }
      const scripts = (pkg && pkg.scripts && typeof pkg.scripts === 'object') ? pkg.scripts : {};
      const runner = names.has('pnpm-lock.yaml') ? 'pnpm' : names.has('yarn.lock') ? 'yarn' : names.has('bun.lockb') || names.has('bun.lock') ? 'bun' : 'npm';
      const run = (s) => (s === 'test' ? `${runner} test` : `${runner} run ${s}`);
      if (typeof scripts.test === 'string' && scripts.test.trim() && !NO_TEST.test(scripts.test)) out.test = run('test');
      for (const [kind, candidates] of [['lint', ['lint']], ['typecheck', ['typecheck', 'type-check', 'types', 'tsc']], ['build', ['build']]]) {
        const s = candidates.find((c) => typeof scripts[c] === 'string' && scripts[c].trim());
        if (s) out[kind] = run(s);
      }
    }
    const py = [...names].some((n) => /\.py$/.test(n)) || names.has('pyproject.toml') || names.has('setup.py') || names.has('requirements.txt');
    if (py && !out.test && (names.has('tests') || names.has('test') || [...names].some((n) => /^test_.*\.py$|_test\.py$/.test(n)))) {
      const usesPytest = /\bpytest\b/.test(pyproject) || /\bpytest\b/.test(requirements) || names.has('pytest.ini') || names.has('conftest.py');
      out.test = usesPytest ? 'python3 -m pytest' : 'python3 -m unittest';
    }
    if (names.has('Cargo.toml')) { out.test = out.test || 'cargo test'; out.build = out.build || 'cargo build'; }
    if (names.has('go.mod')) { out.test = out.test || 'go test ./...'; out.build = out.build || 'go build ./...'; }
    if (makefile) {
      for (const kind of ['test', 'lint', 'build']) {
        if (!out[kind] && new RegExp(`^${kind}\\s*:`, 'm').test(makefile)) out[kind] = `make ${kind}`;
      }
    }
    return out;
  }

  /**
   * The project's own checks, read from its root through the two functions
   * given: `list(dir)` answering with its entries, `read(path)` with a file's
   * text. Anything that cannot be read is left out, never guessed at.
   */
  async function readProjectChecks(root, { list, read }) {
    const sep = /\\/.test(root) && !/\//.test(root) ? '\\' : '/';
    const at = (name) => String(root).replace(/[\\/]+$/, '') + sep + name;
    let entries = [];
    try { entries = await list(root); } catch { return {}; }
    if (typeof entries === 'string') { try { entries = JSON.parse(entries); } catch { entries = []; } }
    const files = (Array.isArray(entries) ? entries : []).map((e) => (e && typeof e === 'object' ? e.name : e)).filter(Boolean);
    const text = async (name) => {
      if (!files.includes(name)) return '';
      try { const t = await read(at(name)); return typeof t === 'string' ? t : ''; } catch { return ''; }
    };
    return projectChecks({
      files,
      packageJson: await text('package.json'),
      makefile: await text('Makefile'),
      pyproject: await text('pyproject.toml'),
      requirements: await text('requirements.txt'),
    });
  }

  /** One line for the agent's instructions naming the project's checks, or ''. */
  function checksLine(checks) {
    const parts = ['test', 'lint', 'typecheck', 'build'].filter((k) => checks && checks[k])
      .map((k) => `${k === 'typecheck' ? 'type check' : k}: \`${checks[k]}\``);
    return parts.length ? `Project checks (${parts.join(', ')}). After changing code, run the test and say what passed.` : '';
  }

  // ── The record of proof ────────────────────────────────────────────────

  const CODE_FILE = /\.(m?[jt]sx?|cjs|cts|mts|py|rs|go|java|kt|kts|swift|rb|php|cs|c|cc|cpp|cxx|h|hpp|m|mm|scala|dart|lua|ex|exs|vue|svelte)$/i;
  const isCode = (path) => CODE_FILE.test(String(path || ''));

  /**
   * Whether a command's result says nothing was run: the program is not
   * there, or the project has no script by that name. Such a command proved
   * nothing either way, and reading it as a failed test sent the agent back to
   * fix a failure its change never caused.
   */
  // The shell's own words for a program that is not there begin a line; the
  // same words inside a test's output are the test's business.
  const NOT_THERE = /^(?:[\w./-]+: )?(?:line \d+: )?(?:[\w./-]+: )?command not found\b|^(?:zsh|bash|sh): command not found: |is not recognized as an internal or external command/im;
  const neverRan = (result) => result.code === 127 || result.code === 9009   // 9009: Windows' cmd found no such program
    || /\bMissing script\b|\berror Command "[^"]+" not found\b/i.test(`${result.stderr || ''}\n${result.stdout || ''}`)
    || NOT_THERE.test(String(result.stderr || ''));

  /**
   * A record of one run: the files changed, and every check run with what it
   * showed. `edited(path)` after each change the agent makes; `ran(command,
   * args, result)` after each command, where `result` is what shell_run gave
   * back — a command that never started, or found no program or script to
   * run, is not proof of anything and is not recorded.
   */
  function proofLog() {
    let step = 0;
    let lastCodeEdit = -1;
    let lastEdit = -1;
    let lastExample = -1;
    let site = null;
    const changed = [];
    const checks = [];
    return {
      edited(path) {
        step++;
        lastEdit = step;
        if (path && !changed.includes(path)) changed.push(path);
        if (isCode(path)) lastCodeEdit = step;
      },
      /** The site check read the site the run changed (js/code/site.js), and found this many things to fix. */
      siteRead(found) {
        step++;
        site = { found: Math.max(0, Number(found) || 0), step };
      },
      /** The last reading of the site, when no file changed after it, or null. */
      siteAfter() { return site && site.step > lastEdit ? { ...site } : null; },
      ran(command, args, result) {
        step++;
        const kind = commandKind(command, args);
        if (!kind || !result || typeof result.code !== 'number' || neverRan(result)) return null;
        const entry = {
          kind,
          command: [command, ...(Array.isArray(args) ? args : [])].join(' ').trim(),
          scope: commandScope(command, args),
          pass: result.code === 0 && !result.timedOut && !result.stopped,
          step,
        };
        checks.push(entry);
        return entry;
      },
      get changed() { return changed.slice(); },
      get checks() { return checks.slice(); },
      /** Whether code was changed in this run at all. */
      get codeChanged() { return lastCodeEdit >= 0; },
      /** The request's examples were run; a change to code after it makes them worth running again (`examplesStale`). */
      exampled() { step++; lastExample = step; },
      get examplesStale() { return lastExample >= 0 && lastCodeEdit > lastExample; },
      /** Checks run after the last change to code, newest last. */
      since() { return checks.filter((c) => c.step > lastCodeEdit); },
    };
  }

  /** How a note from the app to the agent begins, so it is never shown as the person's. */
  const APP_NOTE = 'Note from HashCortX, not from the person:';
  const isAppNote = (text) => String(text || '').startsWith(APP_NOTE);

  // What the person is shown for each note, when a saved conversation is drawn again.
  const MADE_STEP = 'Sent back to make the change in the files';
  const PROVE_STEP = 'Sent back to run the tests before finishing';
  const REVIEW_STEP = 'Sent back to check the work against the request';
  const REVIEW_SAYS = 'check your work against the request';
  const PLAN_STEP = 'Sent back to finish the steps of its plan';
  const PLAN_SAYS = 'your plan still has open steps';
  const FRESH_STEP = 'Sent back with what a second look found';
  const FRESH_SAYS = 'a second look at your changes, with a clean slate, found';
  const ASKS_STEP = 'Sent back to go through each ask of the request';
  const ASKS_SAYS = 'go through the request ask by ask';
  const SITE_STEP = 'Sent back with what the site check found';
  const SITE_SAYS = 'the site you changed was read the way a browser reads it';
  const UNDONE_STEP = 'Sent back to do what it said was not done';
  const UNDONE_SAYS = 'your answer says part of the work is not done';
  const NAMED_STEP = 'Sent back to find the files its answer names';
  const NAMED_SAYS = 'which the project does not have';
  const FACTS_STEP = 'Sent back to confirm the details it wrote';
  const FACTS_SAYS = 'were read for details a visitor would take as fact';
  /** The step when the app ran the test itself, for a small model that had not. */
  const RAN_STEP = 'Ran the tests itself, as the change had not been tested';
  /** The step a note from the app stands for. */
  const noteStep = (text) => {
    const t = String(text || '');
    return /no file in the project was changed/.test(t) ? MADE_STEP : t.includes(REVIEW_SAYS) ? REVIEW_STEP : t.includes(ASKS_SAYS) ? ASKS_STEP : t.includes(PLAN_SAYS) ? PLAN_STEP : t.includes(FRESH_SAYS) ? FRESH_STEP : t.includes(SITE_SAYS) ? SITE_STEP : t.includes(NAMED_SAYS) ? NAMED_STEP : t.includes(CLAIM_SAYS) ? CLAIM_STEP : t.includes(SAID_SAYS) ? SAID_STEP : t.includes(PASSED_SAYS) ? PASSED_STEP : t.includes(AHEAD_SAYS) ? AHEAD_STEP : t.includes(CUT_SAYS) ? CUT_STEP : t.includes(FACTS_SAYS) ? FACTS_STEP : window.HCCodeKeep && t.includes(window.HCCodeKeep.GONE_SAYS) ? window.HCCodeKeep.GONE_STEP : t.includes(UNDONE_SAYS) ? UNDONE_STEP : t.includes('is still written here') ? RENAME_STEP : t.includes('the request shows how this is used') ? EXAMPLE_STEP : PROVE_STEP;
  };

  /** The command line of a shell_run call, as the person would type it. */
  const line = (entry) => `\`${entry.command}\``;

  /**
   * A command line as the shell_run call that runs it, or '' when it needs a
   * shell to mean what it says. A model told only to run a command often
   * wrote it into its reply as text.
   */
  function callFor(commandLine) {
    const run = runOf(commandLine);
    return run ? ` with shell_run: command ${JSON.stringify(run.command)}, args ${JSON.stringify(run.args)}` : '';
  }

  /** A command line as shell_run's arguments, `{ command, args }`, or null when it needs a shell to mean what it says. */
  function runOf(commandLine) {
    const words = String(commandLine || '').trim().split(/\s+/).filter(Boolean);
    if (!words.length || /["'`|&;<>$*?(){}\\]/.test(commandLine)) return null;
    return { command: words[0], args: words.slice(1) };
  }

  /**
   * What sends the agent back before it finishes, or null when nothing does.
   *
   * `checks` is what projectChecks found; `sentBack` how many times this run
   * has already been sent back. Returns `{ message }`, the note to give the
   * agent — marked as coming from the app, so it is never read as the
   * person's words.
   */
  function stopCheck(log, checks, reply, sentBack = 0, limit = 2) {
    if (!log || !log.codeChanged || sentBack >= limit) return null;
    if (/\?\s*$/.test(String(reply || '').trim())) return null;   // asking the person something
    const test = checks && checks.test;
    const after = log.since();
    const passed = after.filter((c) => c.pass && c.kind === 'test');
    if (passed.length) return null;
    const failed = after.filter((c) => !c.pass && c.kind === 'test').pop();
    if (!test && !failed) return null;
    const files = log.changed.filter(isCode).map((p) => String(p).split(/[\\/]/).pop()).slice(0, 4).join(', ');
    const message = failed
      ? `${APP_NOTE} ${line(failed)} failed after your last change. Read the failure, change the code to fix the cause, and run it again${callFor(failed.command)}; make the fix, do not describe it. ` +
        'Then finish by saying which checks passed. If it cannot be made to pass, say what still fails and why.'
      : `${APP_NOTE} you changed ${files} and no test has run since. Run \`${test}\` now${callFor(test)}. If it fails, read the failure and fix it. ` +
        'Then finish by saying which checks passed. If it cannot run here, say so and why.';
    // The test as a call the app can make itself: a small model told to run it
    // said it had passed, and never ran it; HashCoder runs it for one.
    const run = failed ? null : runOf(test);
    return { kind: 'prove', step: PROVE_STEP, message, ...(run ? { run } : {}) };
  }

  // ── A name the request changes, still there ────────────────────────────
  //
  // Asked to rename something everywhere, or to change one word to another,
  // a model changes some places and says it changed them all, or says it was
  // already done. When the request names what is to change and what into, the
  // project is read before the run finishes, and every place the old one is
  // still written is sent back, by file and line.

  const QUOTE = `["'\u2018\u2019\u201c\u201d\`]`;
  const RENAME = /\brename\s+(?:the\s+)?(?:function|method|variable|class|constant|field|property|component)?\s*([`'"]?)([A-Za-z_$][\w$]*)\1\s+(?:to|into|as)\s+[`'"]?([A-Za-z_$][\w$]*)[`'"]?/i;
  /** A name written as code: quoted, or with a capital inside it, an underscore or a digit. Not a word like "it". */
  const codeName = (quoted, name) => !!quoted || /[a-z][A-Z]|[_$\d]/.test(name);
  const CHANGE = new RegExp(`\\b(?:change|replace|rename|turn)\\b[^.\\n]{0,60}?(?:from\\s+)?${QUOTE}([^"'\u2018\u2019\u201c\u201d\`\\n]{1,40})${QUOTE}\\s+(?:to|with|into)\\s+${QUOTE}([^"'\u2018\u2019\u201c\u201d\`\\n]{1,40})${QUOTE}`, 'i');
  const PLACE = /\bin\s+[`'"]?((?:[\w.-]+\/)*[\w.-]+\.\w{1,5})[`'"]?/i;

  /** What a request changes and into what, and the one file it is in when it names one: `{ from, to, file }`, or null. */
  function renameOf(request) {
    const t = String(request || '');
    const r = RENAME.exec(t);
    const m = r && codeName(r[1], r[2]) ? [r[0], r[2], r[3]] : CHANGE.exec(t);
    if (!m || m[1] === m[2]) return null;
    const everywhere = /\beverywhere\b|\bin (?:this|the) (?:project|code)\b|\ball\b/i.test(t);
    const place = PLACE.exec(t);
    return { from: m[1], to: m[2], file: !everywhere && place ? place[1] : '' };
  }

  /** The files of a project as the model is shown it, from its "=== path ===" sections (js/code/context.js wholeProject). */
  function filesOfWhole(whole) {
    const out = [];
    const parts = String(whole || '').split(/^=== ([^=\n]+?) ===$/m);
    for (let i = 1; i + 1 < parts.length; i += 2) if (!/^not text/.test(parts[i])) out.push({ path: parts[i].trim(), text: parts[i + 1].replace(/^\n/, '') });
    return out;
  }

  /** Where the old name is still written: `[{ path, lines }]`, a word on its own, only in the named file when there is one. */
  function leftovers(rename, files) {
    if (!rename) return [];
    const word = new RegExp(`(^|[^\\w$])${rename.from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w$])`);
    const named = rename.file ? String(rename.file).replace(/^\.\//, '') : '';
    return (files || []).filter((f) => !named || f.path === named || f.path.endsWith(`/${named}`))
      .map((f) => ({ path: f.path, lines: String(f.text).split('\n').map((l, n) => (word.test(l) ? n + 1 : 0)).filter(Boolean) }))
      .filter((f) => f.lines.length);
  }

  const RENAME_STEP = 'Sent back: the old name is still written';

  /** The note sending a run back to the places the old name is still written, or null. */
  function renameNote(rename, left) {
    if (!rename || !left || !left.length) return null;
    const where = left.slice(0, 8).map((f) => `- ${f.path}: line${f.lines.length === 1 ? '' : 's'} ${f.lines.slice(0, 12).join(', ')}`).join('\n');
    return {
      kind: 'rename', step: RENAME_STEP,
      message: `${APP_NOTE} the request changes ${JSON.stringify(rename.from)} to ${JSON.stringify(rename.to)}, and ${JSON.stringify(rename.from)} is still written here:\n${where}\nChange each of these to ${JSON.stringify(rename.to)}, a comment that names it included, keeping everything else in those files as it is, then finish.`,
    };
  }

  // ── The example the request gives, run ─────────────────────────────────
  //
  // A request often says how the change will be used: "used as node
  // bin/count.js --lines notes.txt". When the run changed the script such a
  // command runs, that command is run once before the run finishes, so the
  // model sees what it really prints rather than what it expects. A request
  // that shows the old use and the new one gives two, and each is run. A
  // change to code after they ran has them run once more (the proof log's
  // examplesStale): a small model shown its function was not exported fixed
  // that, and finished on the word of examples it had never seen pass.

  const EXAMPLE = /(?:^|[\s`'"(])(node|python3?|deno|bun)\s+((?:\.\/)?(?:[\w.-]+\/)*[\w.-]*\w\.(?:m?js|cjs|ts|py))(?![\w.])/g;

  /** The arguments after a command in prose: flags and file-like words, up to the end of the sentence or clause. */
  function argsAfter(rest) {
    const out = [];
    for (const raw of String(rest).split(/[ \t]+/)) {
      if (!raw) continue;
      const end = /[.,;:`'")]$/.test(raw);
      const word = raw.replace(/[.,;:`'")]+$/, '');
      if (!/^--?[\w-]+(?:=[\w./-]+)?$/.test(word) && !/^[\w-]*[./][\w./-]*\w$/.test(word)) break;
      out.push(word);
      if (end) break;
    }
    return out;
  }

  /** The example commands in the request that run a file the run changed (`changed`, paths from the project's folder), each once and three at most: `[{ command, args }]`. */
  function examplesOf(request, changed) {
    const done = new Set((changed || []).map((p) => String(p).replace(/^\.\//, '')));
    const text = String(request || '');
    const out = [];
    const seen = new Set();
    for (const m of text.matchAll(EXAMPLE)) {
      const file = m[2].replace(/^\.\//, '');
      if (!done.has(file)) continue;
      const run = { command: m[1], args: [file, ...argsAfter(text.slice(m.index + m[0].length))] };
      const key = [run.command, ...run.args].join(' ');
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(run);
      if (out.length === 3) break;
    }
    const call = out.length < 3 && callsOf(request, changed);   // and the function it gives examples for, called on them
    if (call) out.push(call);
    return out;
  }

  // A request for a function often gives its examples in words: "slugify(text)
  // ... "Node.js 24 is out" gives "node-js-24-is-out"". A small model added
  // the function, left it out of the file's exports, and said it was exported
  // and handled the examples; nothing had called it. When the request names
  // a function and gives what it returns for some input, and the run changed
  // the JavaScript or Python file it is in, the function is called on each
  // input and what it returns is put beside what the request says. The code
  // that calls it is fixed; the file, the name and the examples reach it as
  // arguments, never as code.

  const SIGNATURE = /\b([A-Za-z_$][\w$]*)\(\s*((?:[A-Za-z_$][\w$]*)(?:\s*=\s*[^,()]{1,20})?(?:\s*,\s*[A-Za-z_$][\w$]*(?:\s*=\s*[^,()]{1,20})?)*)?\s*\)/g;
  const NOT_A_NAME = new Set(['if', 'for', 'while', 'switch', 'return', 'function', 'print', 'console', 'require', 'import', 'e', 'i', 'eg']);
  const LIT = String.raw`"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|\u201c[^\u201d\n]*\u201d|\[[^\[\]\n]{0,80}\]|-?\d+(?:\.\d+)?|true|false|null|True|False|None`;
  const GIVES = String.raw`\s*(?:gives|returns|becomes|turns into|should (?:give|return|be)|is|equals|===?|->|\u2192|=>)\s*`;
  const SOURCE = /(?:^|[\s`'"(])((?:\.\/)?(?:[\w.-]+\/)*[\w.-]*\w\.(?:m?js|cjs|py))(?![\w.])/g;
  const MOST_EXAMPLES = 4;

  /** A literal as written in a request, as the value it stands for, or undefined. */
  function valueOf(lit) {
    const t = String(lit).trim();
    if (/^\u201c/.test(t)) return t.slice(1, -1);
    if (/^'/.test(t)) return t.slice(1, -1).replace(/\\(.)/g, '$1');
    const word = { True: true, False: false, None: null }[t];
    if (word !== undefined) return word;
    try { return JSON.parse(t); } catch { return undefined; }
  }

  // Calls the function on each example; the file, its name and the examples are its arguments.
  const CALL_JS = "const [file, name, given] = process.argv.slice(1); const show = (v) => v === undefined ? 'undefined' : JSON.stringify(v); import(require('url').pathToFileURL(require('path').resolve(file)).href).then((m) => { const f = typeof m[name] === 'function' ? m[name] : m.default && typeof m.default[name] === 'function' ? m.default[name] : null; if (!f) { console.log(name + ' is not exported from ' + file); process.exitCode = 1; return; } for (const [args, want] of JSON.parse(given)) { let got; try { got = show(f(...args)); } catch (e) { got = 'an error: ' + e.message; } const same = got === show(want); if (!same) process.exitCode = 1; console.log(name + '(' + args.map(show).join(', ') + ') gives ' + got + (same ? '' : ', and the request says ' + show(want))); } }, (e) => { console.log(file + ' could not be loaded: ' + e.message); process.exitCode = 1; });";
  const CALL_PY = "import sys, os, json, importlib.util as u\nfile, name, given = sys.argv[1:4]\nsys.path.insert(0, os.path.dirname(os.path.abspath(file)))\nspec = u.spec_from_file_location(os.path.splitext(os.path.basename(file))[0], file)\nm = u.module_from_spec(spec)\nspec.loader.exec_module(m)\nf = getattr(m, name, None)\nif not callable(f):\n    print(name + ' is not in ' + file)\n    sys.exit(1)\nbad = 0\nfor args, want in json.loads(given):\n    try:\n        got = f(*args)\n        same = got == want\n        shown = repr(got)\n    except Exception as e:\n        same, shown = False, 'an error: ' + str(e)\n    bad += not same\n    print(name + '(' + ', '.join(map(repr, args)) + ') gives ' + shown + ('' if same else ', and the request says ' + repr(want)))\nsys.exit(1 if bad else 0)";

  /** The run that calls the function a request gives examples for, in a file the run changed, or null: `{ command, args }`. */
  function callsOf(request, changed) {
    const text = String(request || '');
    const done = (changed || []).map((p) => String(p).replace(/^\.\//, ''));
    let fn = null;
    for (const m of text.matchAll(SIGNATURE)) if (!NOT_A_NAME.has(m[1]) && !/\.\w*$/.test(text.slice(Math.max(0, m.index - 1), m.index))) { fn = { name: m[1], params: m[2] ? m[2].split(',').length : 0 }; break; }
    if (!fn) return null;
    const named = [...text.matchAll(SOURCE)].map((m) => m[1].replace(/^\.\//, ''));
    const code = done.filter((p) => /\.(?:m?js|cjs|py)$/.test(p));
    const file = named.length ? named.find((p) => done.includes(p)) || '' : code.length === 1 ? code[0] : '';   // the file it names, or the one the run changed
    if (!file) return null;
    const pairs = [];
    const called = new RegExp(String.raw`\b${fn.name}\(\s*((?:${LIT})(?:\s*,\s*(?:${LIT}))*)\s*\)${GIVES}(${LIT})`, 'g');
    for (const m of text.matchAll(called)) {
      const args = [...m[1].matchAll(new RegExp(LIT, 'g'))].map((a) => valueOf(a[0]));
      pairs.push([args, valueOf(m[2])]);
    }
    if (!pairs.length && fn.params === 1) {
      for (const m of text.matchAll(new RegExp(String.raw`(?:^|[\s:,;(])(${LIT})\s*(?:gives|returns|becomes|turns into|should (?:give|return|become)|->|\u2192|=>)\s*(${LIT})`, 'g'))) pairs.push([[valueOf(m[1])], valueOf(m[2])]);
    }
    const kept = pairs.filter(([args, want]) => want !== undefined && args.every((a) => a !== undefined)).slice(0, MOST_EXAMPLES);
    if (!kept.length) return null;
    const py = /\.py$/.test(file);
    return { command: py ? 'python3' : 'node', args: [py ? '-c' : '-e', py ? CALL_PY : CALL_JS, file, fn.name, JSON.stringify(kept)] };
  }

  /** The first of them, or null. */
  function exampleOf(request, changed) {
    return examplesOf(request, changed)[0] || null;
  }

  const EXAMPLE_STEP = 'Ran the example the request gives';

  /** The run sent back to try the examples, one or several: run by the app, `runs` in order and `run` the first. */
  function exampleNote(given) {
    const runs = (Array.isArray(given) ? given : [given]).filter(Boolean);
    if (!runs.length) return null;
    const calls = (r) => r.args[0] === '-e' || r.args[0] === '-c';
    const how = runs.map((r) => (calls(r) ? `${r.args[3]} on the request's examples` : `\`${[r.command, ...r.args].join(' ')}\`${callFor([r.command, ...r.args].join(' '))}`)).join(', and ');
    return { kind: 'example', step: EXAMPLE_STEP, run: runs[0], runs, message: `${APP_NOTE} the request shows how this is used. Run ${how}, read what ${runs.length > 1 ? 'each prints' : 'it prints'}, and fix the code if it is not what the request asks for. Then finish.` };
  }

  // ── A change written into the reply instead of made ─────────────────────
  //
  // Asked to change the code, a model sometimes writes the new code into its
  // answer and stops, and nothing in the project changes; a small local model
  // does it often. When the request asks for a change, no file was changed in
  // the run, and the reply holds a block of code that is not something to
  // type into a terminal, the agent is sent back once to make the change with
  // the file tools, or to answer without changing anything if the request was
  // only a question. `wordsToo` sends back a reply without code as well, once,
  // a question to the person included, unless the request says to leave the
  // files alone: every question such a model was seen to ask here was for
  // something the files or the tests would have told it, and one it still
  // needs to ask, it asks again.

  const CHANGE_WORDS = /\b(fix|add|change|implement|create|write|update|rename|refactor|remove|delete|build|make|replace|move|convert|edit|modify|correct|extend|handle|support)\b/i;
  // A request that says to leave the files alone: a question with "do not change any files", "just answer".
  const KEEP_FILES = /\b(?:do not|don't|dont|never|without)\s+(?:change|changing|edit|editing|modify|modifying|touch|touching)\s+(?:any|anything|a file|files|the files|the code)\b|\bjust answer\b|\bonly answer\b/i;
  const TERMINAL_BLOCKS = new Set(['bash', 'sh', 'zsh', 'fish', 'shell', 'console', 'terminal', 'powershell', 'ps1', 'pwsh', 'cmd', 'bat', 'text', 'txt', 'plaintext', 'output', 'log']);

  /**
   * The newest request from the person: the last message from them that is
   * not a note from the app, with what they added while the run worked
   * (js/queue.js) after it, so the run is held to all of it.
   */
  function requestIn(messages) {
    const list = Array.isArray(messages) ? messages : [];
    const added = [];
    for (let i = list.length - 1; i >= 0; i--) {
      const m = list[i];
      if (!m || m.role !== 'user' || typeof m.content !== 'string' || isAppNote(m.content)) continue;
      if (m.opened) continue;   // pictures the agent opened, added by the app
      if (m.added) { added.unshift(m.content); continue; }
      return [m.content, ...added].join('\n\n');
    }
    return added.join('\n\n');
  }

  /**
   * How many blocks of code of three lines or more a reply holds, leaving out
   * commands for a terminal and their output. Blocks are read by js/fences.js.
   */
  function codeBlocks(reply) {
    const F = window.HCFences;
    if (!F || !F.splitFences) return 0;
    return F.splitFences(String(reply || '')).filter((p) => p.type === 'code'
      && !TERMINAL_BLOCKS.has(String(p.lang || '').toLowerCase())
      && String(p.code || '').split('\n').filter((l) => l.trim()).length >= 3).length;
  }

  /**
   * What sends the agent back when it wrote a change into its reply instead
   * of making it, or null. Once at most: `sentBack` is how many times this
   * run has already been sent back for it.
   */
  function unmadeChange(log, messages, reply, sentBack = 0, limit = 1, { wordsToo = false } = {}) {
    if (!log || log.changed.length || sentBack >= limit) return null;
    if (/\?\s*$/.test(String(reply || '').trim()) && !wordsToo) return null;   // asking the person something
    const request = requestIn(messages);
    if (!CHANGE_WORDS.test(request) || KEEP_FILES.test(request)) return null;   // "do not change any files" names a change and asks for none
    if (codeBlocks(reply)) {
      return {
        kind: 'make',
        step: MADE_STEP,
        message: `${APP_NOTE} your reply shows code, but no file in the project was changed. If the request was to change ` +
          'the project, make the change now with patch_file, or write_file for a new file, then say in a sentence or two what ' +
          'you changed. If it only asked a question, answer it and change nothing.',
      };
    }
    if (!wordsToo) return null;
    return {
      kind: 'make',
      step: MADE_STEP,
      message: `${APP_NOTE} no file in the project was changed, and the request asks for a change. Make it now with the ` +
        'tools: grep_code finds where a name or a piece of text is written, read_file shows a file, patch_file changes it, ' +
        'and shell_run runs the tests. Ask the person only for what the files and the tests cannot tell you. If it should ' +
        'not be changed, say why.',
    };
  }

  // ── Said not done ─────────────────────────────────────────────────────
  //
  // Sent back to go through a request's asks, and again with what the site
  // check found, a small model answered "Not done: styles.css has not been
  // created yet" both times, and finished there. A model on this computer
  // whose answer to a request for a change says part of it is not done is
  // sent back once to do it now, or to say why it cannot be done.

  const NOT_DONE = /\bnot (?:yet )?(?:been )?(?:done|created|made|added|written|fixed|implemented|changed|updated)\b|\b(?:has|have|was|were|is|are) not (?:yet )?(?:been )?(?:done|created|made|added|written|fixed|implemented)\b/i;

  /** The note for an answer that says part of the work is not done, or null. */
  function undoneCheck(messages, reply, sentBack = 0, limit = 1) {
    if (sentBack >= limit || !NOT_DONE.test(String(reply || ''))) return null;
    const request = requestIn(messages);
    if (!CHANGE_WORDS.test(request) || KEEP_FILES.test(request)) return null;
    return {
      kind: 'undone',
      step: UNDONE_STEP,
      message: `${APP_NOTE} ${UNDONE_SAYS}. Do it now with the tools: write_file for a file that is not there yet, patch_file ` +
        'for a change to one that is. Then finish. If it cannot be done here, say why.',
    };
  }

  // ── Asked or said, instead of done ────────────────────────────────────
  //
  // Asked to fix a failing test, a small model on this computer ran it, read
  // the code, set out the fix in three steps and finished with "Do you want
  // me to proceed with these steps?". Another, shown that its file did not
  // load, finished with "I will fix the export statement and run the test
  // again", and did neither. When the request asks for a change and an
  // answer from a small or mid-sized model on this computer ends by asking
  // leave to go on, or by saying what it will do next, it is sent back to do
  // it, twice at most: the request is the leave.

  const ASKS_LEAVE = /\b(?:do you want me to|would you like me to|want me to|shall I|should I|may I|can I|is it (?:ok|okay|alright) (?:if I|to)|let me know if (?:you(?:'d)? (?:like|want) me to|I should))\b[^?\n]*\?\s*$/i;
  const SAYS_NEXT = /(?:^|[.!:\n]\s*)(?:(?:now|next|then|so),?\s+)?(?:I will|I'll|I am going to|I'm going to|let me|let's)\s+(?:now\s+|then\s+|first\s+)?(?:fix|update|change|add|run|edit|correct|make|apply|modify|implement|write|create|remove|rewrite|replace|try|re-?run|export|move|rename)\b[^.!?\n]*[.!]?\s*$/i;
  const AHEAD_STEP = 'Sent back to do what it asked leave for, or said it would do';
  const AHEAD_SAYS = 'the request already asks for this';

  /** The note for an answer that asks leave to go on, or says what it will do, instead of doing it; or null. */
  function aheadCheck(messages, reply, sentBack = 0, limit = 2) {
    const text = String(reply || '').trim();
    if (sentBack >= limit || !(ASKS_LEAVE.test(text) || SAYS_NEXT.test(text))) return null;
    const request = requestIn(messages);
    if (!CHANGE_WORDS.test(request) || KEEP_FILES.test(request)) return null;
    return {
      kind: 'ahead',
      step: AHEAD_STEP,
      message: `${APP_NOTE} ${AHEAD_SAYS}, so do not ask leave and do not say what you will do: do it now with the tools, one step at a time, ` +
        'and only what the request asks. Then say what you did and what the last check printed.',
    };
  }

  // ── The work checked against the request ────────────────────────────────

  const REQUEST_QUOTED = 1200;   // characters of the request quoted back

  /**
   * What sends the agent back to check its work against the request before
   * it finishes, or null. Once at most, and only after it changed a file:
   * `reviewed` is how many times this run has been sent back for it. The
   * request is quoted, since on a long run it is far back in the
   * conversation, and a model that holds less loses it first.
   */
  function reviewCheck(log, request, reply, reviewed = 0, limit = 1) {
    if (!log || !log.changed.length || reviewed >= limit) return null;
    if (/\?\s*$/.test(String(reply || '').trim())) return null;   // asking the person something
    const asked = String(request || '').trim();
    if (!asked) return null;
    const quoted = asked.length > REQUEST_QUOTED ? asked.slice(0, REQUEST_QUOTED) + '…' : asked;
    return {
      kind: 'review',
      step: REVIEW_STEP,
      message: `${APP_NOTE} before you finish, ${REVIEW_SAYS}. The request was:\n\n${quoted}\n\n` +
        'Go through each thing it asks for and make sure the files now do it; read a file again if you are not sure. Put back anything you removed that it did not ask to remove. ' +
        'If something is missing or wrong, fix it now. If everything is done, change nothing more and finish with what ' +
        'you changed and what passed.',
    };
  }

  /**
   * What sends the agent back once to go through a request of several asks
   * (js/code/asks.js) one by one, or null: only after it changed a file, and
   * never for a reply that asks the person something. It is told to do what
   * is missing and then say, for each ask, done or not done and why.
   */
  function asksCheck(log, asks, reply, sentBack = 0, limit = 1) {
    const list = Array.isArray(asks) ? asks : [];
    if (!log || !log.changed.length || list.length < 3 || sentBack >= limit) return null;
    if (/\?\s*$/.test(String(reply || '').trim())) return null;   // asking the person something
    return {
      kind: 'asks',
      step: ASKS_STEP,
      message: `${APP_NOTE} before you finish, ${ASKS_SAYS}:\n${list.map((a, i) => `${i + 1}. ${a}`).join('\n')}\n` +
        'For each one not done yet, do it now with the tools, and put back anything you removed that no ask asked to remove. Then finish with one short line per ask: done, or not done and why.',
    };
  }

  /**
   * When the agent tries to finish with steps of its own plan still open
   * (js/code/plan.js), the note sending it back once to do them, mark them
   * done, or say why one cannot be done; otherwise null. A reply that ends
   * by asking the person something is not sent back.
   */
  function planCheck(plan, reply, sentBack = 0, limit = 1) {
    const open = plan && Array.isArray(plan.steps) ? plan.steps.filter((x) => x && x.status !== 'done') : [];
    if (!open.length || sentBack >= limit || /\?\s*$/.test(String(reply || '').trim())) return null;
    return {
      kind: 'plan',
      step: PLAN_STEP,
      message: `${APP_NOTE} ${PLAN_SAYS}: ${open.map((x) => `"${x.step}"`).join('; ')}. Do them now. If one is already done, ` +
        'mark it done with update_plan; if one cannot be done, say why in your answer.',
    };
  }

  /**
   * The note sending the agent back once with what a second look at its
   * changes found (js/code/review.js): each problem, to fix where it is right
   * or to answer where it is not.
   */
  function freshReviewNote(problems) {
    return {
      kind: 'fresh',
      step: FRESH_STEP,
      message: `${APP_NOTE} ${FRESH_SAYS}:\n${(problems || []).map((p) => `- ${p}`).join('\n')}\n` +
        'Fix each one that is right, then finish. If one is wrong, say why in your answer instead of changing anything for it.',
    };
  }

  /**
   * The note sending the agent back once with what the check of a site it
   * changed found will not work, or falls short of the standard a site is
   * held to (js/code/site.js): each finding, to fix, or to answer where it
   * is not right.
   */
  function siteNote(findings) {
    return {
      kind: 'site',
      step: SITE_STEP,
      message: `${APP_NOTE} ${SITE_SAYS}, and these will not work, or let the page down:\n${(findings || []).map((f) => `- ${f}`).join('\n')}\n` +
        'Fix each one now with the smallest change that meets it, keeping the design the request asked for: do not take out a section, a feature or a look to make a line go away. Then finish. If one is not right, say why in your answer instead of changing anything for it.',
    };
  }

  /**
   * The note sending the agent back once with the details its files state as
   * fact that nothing it was given or read says, and the lines of square
   * brackets that would show on a page (js/code/facts.js): each to confirm,
   * take out, or say is a guess.
   */
  function factsNote(found, root) {
    if (!found || !found.total) return null;
    const F = window.HCCodeFacts;
    const where = (i) => `${i.shown} (${F && F.KIND[i.kind] ? F.KIND[i.kind] : 'detail'}, in ${F ? F.nameIn(i.path, root) : i.path})`;
    const told = found.unsourced.length ? `\nNothing you were told or read says these, and a visitor would take each as fact:\n${found.unsourced.slice(0, 8).map((i) => `- ${where(i)}`).join('\n')}` : '';
    const open = found.placeholders.length ? `\nThese show on the page as unfinished text, where a visitor would read them:\n${found.placeholders.slice(0, 8).map((i) => `- ${i.shown} (in ${F ? F.nameIn(i.path, root) : i.path})`).join('\n')}` : '';
    return {
      kind: 'facts',
      step: FACTS_STEP,
      message: `${APP_NOTE} the files you changed ${FACTS_SAYS}.${told}${open}\n` +
        'For each detail: if the person gave it in this conversation, or a page you opened says it, find that and keep it exactly as written there. What the app remembers about the person is not a source for a page. If not, look for it with web_search or fetch_url. ' +
        'If you cannot find it, take it out of the page: a guess must never stand as a fact, and square brackets must never be left on a page. ' +
        'Never fill a gap with today\'s date, the current year or a number you worked out: rewrite the sentence so it needs no such detail. ' +
        'Spell the name as the sources spell it. Then finish, and say in your answer which details you could not confirm.',
    };
  }

  // ── A search the answer says it made, when none ran ───────────────────
  //
  // A small model with no way to search wrote that it had searched the
  // internet and found a business's site and its social accounts, and gave
  // their phone number and address "according to" them. No search had run.
  // An answer that says it searched, browsed or read a site, in a run where
  // no search or page read happened since the request, is sent back once;
  // if it still says so, the person is told under the answer.

  const CLAIM = [
    /\b(?:I|we)(?:'ve|\s+have)?\s+(?:just\s+|also\s+)?(?:searched|googled|browsed|looked\s+(?:it\s+|them\s+|this\s+)?up|checked\s+(?:online|their\s+(?:website|site|social\s+media)|the\s+(?:web|internet|website))|found\s+(?:it\s+|them\s+)?(?:online|on\s+the\s+(?:web|internet)))\b/i,
    /\baccording\s+to\s+(?:the|their|its|his|her)\s+(?:website|official\s+(?:site|page)|social\s+media(?:\s+profiles?)?|online\s+(?:listing|profile)s?|google\s+(?:listing|profile))\b/i,
    /\b(?:a|my)\s+(?:web\s+|online\s+|quick\s+)?search\s+(?:shows?|showed|found|finds|returned|revealed)\b/i,
  ];
  const WEB_TOOLS = new Set(['web_search', 'fetch_url']);
  const CLAIM_STEP = 'Sent back: it said it searched, and nothing was searched';
  const CLAIM_SAYS = 'no web search and no page read ran';

  /** Whether `reply` says it searched or read a site, outside its code blocks. */
  function claimsSearch(reply) {
    const F = window.HCFences;
    const prose = F && F.splitFences ? F.splitFences(String(reply || '')).filter((p) => p.type !== 'code').map((p) => p.text).join('\n') : String(reply || '');
    return CLAIM.some((re) => re.test(prose));
  }

  /** Whether a web search or page read ran since the person's latest request. */
  function searchedSince(messages) {
    const list = Array.isArray(messages) ? messages : [];
    let at = list.length - 1;
    while (at >= 0 && !(list[at] && list[at].role === 'user' && !list[at].note && !list[at].added)) at--;
    return list.slice(Math.max(0, at)).some((m) => m && m.role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.some((c) => WEB_TOOLS.has(c && (c.name || (c.function && c.function.name)))));
  }

  /** The note sending an answer back for a search it says it made and did not, or null. */
  function claimNote(reply, messages, sentBack = 0) {
    if (sentBack || !claimsSearch(reply) || searchedSince(messages)) return null;
    return {
      kind: 'claim',
      step: CLAIM_STEP,
      message: `${APP_NOTE} your answer says you searched or read a site, and in this run ${CLAIM_SAYS}. Nothing may be said to come from a search that did not happen. ` +
        'Take out what you said a search or a site gave, and every detail that came from it, from the answer and from the files. If you can search, search now; if not, say plainly that you could not look it up.',
    };
  }

  /** What the person is told under an answer that still says it searched, or ''. */
  function claimLine(reply, messages) {
    return claimsSearch(reply) && !searchedSince(messages) ? `No web search or page read ran in this run: what the answer says one found does not come from one.` : '';
  }

  // ── A change the answer says it made, when none was made ─────────────
  //
  // Asked to use what a search found, a model answered "Here is the updated
  // HTML, CSS and JavaScript" with the files in its reply, and changed none
  // of them; the request had no word asking for a change, so nothing sent it
  // back. Another said it had updated a page after a patch whose replace was
  // its search. An answer that says files were changed, in a run that changed
  // none, or that names a file as changed when this run did not change it,
  // is sent back once; if it still says so, the person is told under the
  // answer which files this run did not change. Only the record decides:
  // what the run wrote, never what the answer says.

  const VERBS = 'updated|changed|modified|edited|created|fixed|removed|deleted|replaced|rewritten|rewrote|refactored|renamed|moved|implemented|wrote|written|applied|added|completed|made the (?:changes?|edits?|fixes?)';
  const SAID_CHANGE = [
    new RegExp(`\\b(?:I|we)(?:'ve|\\s+have|\\s+just|\\s+now|\\s+also|\\s+successfully)*\\s+(?:${VERBS})\\b`, 'i'),
    /\b(?:has|have|was|were)\s+(?:now\s+)?(?:been\s+)?(?:updated|changed|modified|edited|created|fixed|rewritten|replaced|applied)\b/i,
    /\bhere (?:is|are) the (?:updated|modified|changed|new|fixed|revised) (?:files?|code|html|css|javascript|version|page)\b/i,
    /^\s*(?:[-*]\s+|\d+\.\s+)?(?:\*\*)?(?:Updated|Changed|Modified|Edited|Created|Fixed|Rewrote|Replaced|Renamed)\b/im,
  ];
  /** A file named as what a change verb changed: "updated index.html", "style.css has been rewritten". */
  const FILE = '`?((?:[\\w@-][\\w@.-]*/)*[\\w@-][\\w@.-]*\\.[A-Za-z][A-Za-z0-9]{0,5})`?';
  const LIST = `${FILE}(?:\\*\\*)?(?:\\s*(?:,|and|&|\\+)\\s*(?:the\\s+)?(?:\\*\\*)?${FILE}(?:\\*\\*)?)*`;
  const FILE_CHANGED = [
    new RegExp(`\\b(?:updated|changed|modified|edited|created|fixed|rewrote|rewritten|replaced)\\s+(?:the\\s+)?(?:files?\\s+)?(?:\\*\\*)?(${LIST})`, 'gi'),
    new RegExp(`${FILE}(?:\\*\\*)?\\s+(?:has|was)\\s+(?:now\\s+)?(?:been\\s+)?(?:updated|changed|modified|edited|created|fixed|rewritten|replaced)\\b`, 'gi'),
  ];
  const SAID_STEP = 'Sent back: it said files were changed that were not';
  const SAID_SAYS = 'and this run did not change';

  /** What `reply` says in words, outside its code blocks. */
  const proseOf = (reply) => { const F = window.HCFences; return F && F.splitFences ? F.splitFences(String(reply || '')).filter((p) => p.type !== 'code').map((p) => p.text).join('\n') : String(reply || ''); };
  const baseOf = (p) => String(p || '').split(/[\\/]/).pop().toLowerCase();

  /**
   * What an answer says was changed and this run did not change: `{ none,
   * files }`, `none` when it says something was changed and the run changed
   * nothing, `files` the files it names as changed that the run did not.
   */
  function saidChanged(reply, log) {
    const prose = proseOf(reply);
    const changed = new Set((log && log.changed ? log.changed : []).map(baseOf));
    const none = !changed.size && SAID_CHANGE.some((re) => re.test(prose));
    const files = [];
    for (const re of FILE_CHANGED) {
      for (const m of prose.matchAll(re)) {
        for (const one of m[1].match(new RegExp(FILE, 'g')) || []) {
          const name = one.replace(/`/g, '').replace(/[.,;:]+$/, '');
          if (/^https?:|^www\./i.test(name) || /\.(?:com|org|net|io|dev|app)$/i.test(name)) continue;   // an address, not a file
          if (!changed.has(baseOf(name)) && !files.includes(name)) files.push(name);
        }
      }
    }
    return { none, files: files.slice(0, 6) };
  }

  /** The note sending an answer back for changes it says it made and did not, or null. */
  function saidNote(reply, log, sentBack = 0) {
    if (sentBack || !log) return null;
    const said = saidChanged(reply, log);
    if (!said.none && !said.files.length) return null;
    const what = said.files.length ? said.files.join(', ') : 'any file';
    return {
      kind: 'said',
      step: SAID_STEP,
      message: `${APP_NOTE} your answer says ${said.files.length ? `${what} ${said.files.length === 1 ? 'was' : 'were'}` : 'files were'} changed, ${SAID_SAYS} ${what}. ` +
        'A change is made only by a tool call that succeeds. Make the change now with the tools; if it cannot be made, or the files are already as they should be, say that instead. ' +
        'If you meant work from an earlier request, say so. Never say a file was changed when it was not.',
    };
  }

  /** What the person is told under an answer that still says so, or ''. */
  function saidLine(reply, log) {
    if (!log) return '';
    const said = saidChanged(reply, log);
    if (said.files.length) return `Not changed in this run: ${said.files.join(', ')}.`;
    return said.none ? 'No file was changed in this run.' : '';
  }

  // ── Tests the answer says pass, when none passed ──────────────────────
  //
  // Asked to fix a failing test, a small model on this computer read the test
  // file and answered "The tests are already passing", having run nothing.
  // Another, its last run of the tests failing on a "}" its own edit left,
  // finished with "The tests now pass" and a test run's output that no
  // command had printed. An answer that says the tests pass, or shows a run
  // of them passing, where no test passed after the run's last change, is
  // sent back once: with the run that failed, or, when no test ran, with the
  // project's test, which the app runs for the model. Only the record decides.

  const SAID_PASS = [
    /\b(?:tests?|checks?|specs?)\s+(?:(?:now|all|already|also|should|will)\s+)*(?:pass(?:es|ed)?|succeed(?:s|ed)?)\b|\b(?:tests?|checks?|specs?)\s+(?:are|is|were)\s+(?:(?:now|all|already)\s+)*(?:passing|green|successful)\b/i,
    /\b(?:all|every)\s+(?:the\s+)?(?:tests?|checks?)\s+(?:have\s+|has\s+)?(?:now\s+)?passed\b/i,
    /\b(?:tests?|checks?)\s+(?:has|have|was|were)\s+(?:now\s+)?(?:been\s+)?(?:run|ran|re-?run|executed)\b[^.\n]{0,20}?\b(?:it|they|all|everything)\s+(?:now\s+)?pass(?:es|ed)?\b/i,
  ];
  /** Words before "the tests pass" that make it something to do, not something done: "run it to make sure the tests pass". */
  const TO_DO = /\b(?:make sure|ensure|check(?: that)?|verify(?: that)?|confirm\b(?: that)?|see (?:if|whether)|so that|until|whether|if)\s+(?:(?:all|the|your|its)\s+)*$/i;
  /** A run of tests passing, as a block of output shows it: node's "pass 3 … fail 0", "3 passed", unittest's "Ran 3 tests … OK". */
  const SHOWN_PASS = /\bpass\s+[1-9]\d*\b[\s\S]{0,160}?\bfail\s+0\b|\b[1-9]\d* passed\b(?![^\n]*\b[1-9]\d* failed)|^Ran [1-9]\d* tests?\b[^\n]*\n+\s*OK\b/m;
  const PASSED_STEP = 'Sent back: it said the tests pass, and none passed';
  const PASSED_SAYS = 'and no test passed after the last change in this run';

  /** Whether `reply` says the tests pass, in words or with output it shows. */
  function claimsPassed(reply) {
    const F = window.HCFences;
    const parts = F && F.splitFences ? F.splitFences(String(reply || '')) : [{ type: 'text', text: String(reply || '') }];
    const prose = parts.filter((p) => p.type !== 'code').map((p) => p.text).join('\n');
    const said = SAID_PASS.some((re) => { const m = re.exec(prose); return !!m && !TO_DO.test(prose.slice(Math.max(0, m.index - 40), m.index)); });
    return said || parts.some((p) => p.type === 'code' && SHOWN_PASS.test(String(p.code || '')));
  }

  /** What the record says of an answer claiming the tests pass: null when it does not claim it or a test passed, else `{ failed }`, the last test run that failed, or null when none ran. */
  function passedClaim(reply, log) {
    if (!log || !claimsPassed(reply)) return null;
    const after = log.since();
    if (after.some((c) => c.pass && c.kind === 'test')) return null;
    return { failed: after.filter((c) => !c.pass && c.kind === 'test').pop() || null };
  }

  /** The note sending back an answer that says the tests pass when none passed, or null; with the project's test as a call to make when none ran. */
  function passedNote(reply, log, checks, sentBack = 0) {
    if (sentBack) return null;
    const said = passedClaim(reply, log);
    if (!said) return null;
    const test = checks && checks.test;
    const run = !said.failed && test ? runOf(test) : null;
    const message = said.failed
      ? `${APP_NOTE} your answer says the tests pass, ${PASSED_SAYS}: ${line(said.failed)} failed, and its output is above. Never write a result, or output, that no command printed. ` +
        `Read the failure, fix the cause, and run it again${callFor(said.failed.command)}. If it cannot be made to pass, say what still fails.`
      : `${APP_NOTE} your answer says the tests pass, ${PASSED_SAYS}: no test ran. Never say a test passed without running it. ` +
        (test ? `Run \`${test}\`${callFor(test)}, read what it prints, and fix the code if it fails.` : 'Run the tests with shell_run, read what they print, and fix the code if they fail; if they cannot run here, say so.');
    return { kind: 'passed', step: PASSED_STEP, message, ...(run ? { run } : {}) };
  }

  /** What the person is told under an answer that still says the tests pass, or '': the line about the last run says the rest. */
  function passedLine(reply, log) {
    const said = passedClaim(reply, log);
    if (!said) return '';
    if (said.failed) return SHOWN_PASS.test(String(reply || '')) ? 'The test output in the answer was not printed by any command in this run.' : '';
    return log.codeChanged ? '' : 'No test ran in this run: the answer\'s word that the tests pass is not from a run.';
  }

  // ── A step that ran on ─────────────────────────────────────────────────
  //
  // Told its fix had not made the test pass, a 7B model on this computer
  // wrote on for five and a half minutes, nearly three thousand words of it,
  // and none of it reached the screen: a reply is bounded only by the room
  // left in the model's window, and a small model repeating itself fills it.
  // A step of a smaller model on this computer is held to STEP_MOST tokens,
  // which a change made a part at a time never needs. A step stopped there is
  // not kept or run; the model is told why, and how to go on in parts, twice
  // at most. Light mode, where a small model writes whole files, is not held.

  const STEP_MOST = 4096;
  const CUT_STEP = 'Stopped a step that ran on, and asked for a smaller one';
  const CUT_SAYS = 'without finishing, and was stopped';

  /** The note for a step stopped at `most` tokens. */
  function cutNote(most = STEP_MOST) {
    return `${APP_NOTE} your last reply ran past ${most.toLocaleString('en-US')} tokens ${CUT_SAYS}; nothing in it was kept or run. ` +
      'Do one small step at a time: patch_file with a short search and its replacement; for a long new file, write_file with its first part, ' +
      'then write_file with append true for each part after it. Do not repeat yourself.';
  }

  // ── Files an answer names that are not there ──────────────────────────
  //
  // Asked where something is, a small model searched once, found nothing,
  // and answered with a file and a rate it made up. A file an answer names
  // by its place in the project, where the project has none, is sent back
  // once, to be found before it is named. Only a path with a folder in it
  // counts, a bare name being anywhere in the project; code blocks, where a
  // path is read from its own file, addresses, paths starting "./" or "../",
  // paths outside the project and files the run changed are left out.

  const NAMED = /(?:^|[\s`'"(\[*])((?:\/?[\w@-][\w@.-]*\/)+[\w@.-]*\.[A-Za-z][A-Za-z0-9]{0,5})(?=[\s`'")\],.:;!?*]|$)/g;
  /** No more than this many are looked for. */
  const MOST_NAMED = 5;

  /** The files `reply` names by their place in the project at `root`, written out from it. */
  function namedPaths(reply, root, touched = []) {
    const base = String(root || '').replace(/[\\/]+$/, '');
    if (!base) return [];
    const F = window.HCFences;
    const prose = F && F.splitFences ? F.splitFences(String(reply || '')).filter((p) => p.type !== 'code').map((p) => p.text).join('\n') : String(reply || '');
    const text = prose.replace(/[a-z][a-z0-9+.-]*:\/\/\S+/gi, ' ');
    const slash = (p) => String(p).replace(/\\/g, '/');
    const changed = new Set((touched || []).map(slash));
    const out = [];
    for (const m of text.matchAll(NAMED)) {
      const said = m[1];
      if (said.split('/').includes('..')) continue;
      const full = said.startsWith('/') ? said : `${base}/${said}`;
      if (!slash(full).startsWith(`${slash(base)}/`) || changed.has(slash(full)) || out.includes(full)) continue;
      out.push(full);
      if (out.length === MOST_NAMED) break;
    }
    return out;
  }

  /** The note for files an answer names that the project does not have, or null for none. */
  function namedNote(missing, root) {
    if (!Array.isArray(missing) || !missing.length) return null;
    const base = String(root || '').replace(/[\\/]+$/, '');
    const shown = missing.map((p) => (base && p.startsWith(`${base}/`) ? p.slice(base.length + 1) : p));
    return {
      kind: 'named',
      step: NAMED_STEP,
      message: `${APP_NOTE} your answer names ${shown.join(', ')}, ${NAMED_SAYS}. Nothing in an answer may be made up: find the right file with grep_code or list_dir, read it, and answer from what it says. If it cannot be found, say so.`,
    };
  }

  /**
   * What sends the agent back when it tries to finish, or null, in this
   * order: a change written into the reply and not made, or on a small or
   * mid-sized model a change asked for and not begun; then, on such a model,
   * an answer asking leave to go on or saying what it will do; then, on one
   * with proving switched on, an answer saying part of the work is not done;
   * then steps of its own
   * plan left open (`plan`); then, while proving is switched on (`prove`), a
   * change to code nothing proved, and a request of several asks (`asks`)
   * gone through ask by ask, or, on a small or mid-sized model on this
   * computer (`size`), the work checked against the request as a whole. An
   * empty answer from a model on this computer is checked too. `sent` counts,
   * by kind, how often this run was sent back; `shown` gives the request as
   * the person sees it, without the text of what they attached.
   */
  function sendBack(log, messages, reply, { checks = null, prove = true, size = 'full', sent = {}, shown = null, plan = null, asks = null, light = false } = {}) {
    const request = requestIn(messages);
    const local = size === 'small' || size === 'mid';
    // An empty answer from a model on this computer is checked like any other: a small model ended runs with its change untested that way.
    if (!log || (!String(reply || '').trim() && !local)) return null;
    const listed = Array.isArray(asks) && asks.length >= 3;   // a request of several asks is checked ask by ask, in place of as a whole
    return unmadeChange(log, messages, reply, sent.make || 0, 1, { wordsToo: local })
      || (local ? aheadCheck(messages, reply, sent.ahead || 0) : null)
      || (prove && local ? undoneCheck(messages, reply, sent.undone || 0) : null)
      || planCheck(plan, reply, sent.plan || 0)
      || (prove ? stopCheck(log, checks, reply, sent.prove || 0, light ? 3 : 2) : null)   // a model in light mode is given one more round to fix a failing test
      || (prove && listed ? asksCheck(log, asks, reply, sent.asks || 0) : null)
      || (prove && local && !listed ? reviewCheck(log, shown ? shown(request) : request, reply, sent.review || 0) : null);
  }

  /**
   * One line for the person saying what was proven after the last change, or
   * '' when no code was changed and no site was read. Worked out from the
   * record alone.
   */
  function proofLine(log) {
    if (!log) return '';
    // A site read after the last change is said, and so is what that reading cannot tell.
    const site = typeof log.siteAfter === 'function' ? log.siteAfter() : null;
    const seen = site ? `${site.found ? `Read as a browser would: ${site.found} thing${site.found === 1 ? '' : 's'} still found to fix.` : 'Read as a browser would: nothing found to fix.'} Not seen on screen.` : '';
    const and = (sentence) => (seen ? `${sentence} ${seen}` : sentence);
    if (!log.codeChanged) return seen;
    const after = log.since();
    const lastOf = (kind) => after.filter((c) => c.kind === kind).pop();
    const test = lastOf('test');
    if (test && test.pass) {
      return and(`Checked after the last change: ${line(test)} passed${test.scope === 'part' ? ', for part of the project' : ''}.`);
    }
    if (test) return and(`Not proven: ${line(test)} failed after the last change.`);
    const other = after.filter((c) => c.pass).pop();
    if (other) return and(`Not tested: ${line(other)} passed after the last change, but no test ran.`);
    return seen || 'Not checked: no test ran after the last change.';
  }

  window.HCCodeVerify = {
    commandKind, commandScope, projectChecks, readProjectChecks, checksLine, proofLog, stopCheck, proofLine, isAppNote, APP_NOTE,
    exampleOf, examplesOf, callsOf, exampleNote, EXAMPLE_STEP, renameOf, filesOfWhole, leftovers, renameNote, RENAME_STEP, requestIn, codeBlocks, unmadeChange, planCheck, reviewCheck, asksCheck, freshReviewNote, siteNote, factsNote, sendBack, noteStep, runOf, RAN_STEP, namedPaths, namedNote, undoneCheck, claimsSearch, searchedSince, claimNote, claimLine, saidChanged, saidNote, saidLine, SAID_STEP,
    aheadCheck, AHEAD_STEP, claimsPassed, passedClaim, passedNote, passedLine, PASSED_STEP, STEP_MOST, cutNote, CUT_STEP,
  };
})();
