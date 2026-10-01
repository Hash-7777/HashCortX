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
  const NAMED_STEP = 'Sent back to find the files its answer names';
  const NAMED_SAYS = 'which the project does not have';
  /** The step a note from the app stands for. */
  const noteStep = (text) => {
    const t = String(text || '');
    return /no file in the project was changed/.test(t) ? MADE_STEP : t.includes(REVIEW_SAYS) ? REVIEW_STEP : t.includes(ASKS_SAYS) ? ASKS_STEP : t.includes(PLAN_SAYS) ? PLAN_STEP : t.includes(FRESH_SAYS) ? FRESH_STEP : t.includes(SITE_SAYS) ? SITE_STEP : t.includes(NAMED_SAYS) ? NAMED_STEP : PROVE_STEP;
  };

  /** The command line of a shell_run call, as the person would type it. */
  const line = (entry) => `\`${entry.command}\``;

  /**
   * A command line as the shell_run call that runs it, or '' when it needs a
   * shell to mean what it says. A model told only to run a command often
   * wrote it into its reply as text.
   */
  function callFor(commandLine) {
    const words = String(commandLine || '').trim().split(/\s+/).filter(Boolean);
    if (!words.length || /["'`|&;<>$*?(){}\\]/.test(commandLine)) return '';
    return ` with shell_run: command ${JSON.stringify(words[0])}, args ${JSON.stringify(words.slice(1))}`;
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
    return { kind: 'prove', step: PROVE_STEP, message };
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

  /** The newest request from the person: the last message from them that is not a note from the app. */
  function requestIn(messages) {
    const list = Array.isArray(messages) ? messages : [];
    for (let i = list.length - 1; i >= 0; i--) {
      const m = list[i];
      if (!m || m.role !== 'user' || typeof m.content !== 'string' || isAppNote(m.content)) continue;
      if (m.opened) continue;   // pictures the agent opened, added by the app
      return m.content;
    }
    return '';
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
    if (!CHANGE_WORDS.test(request)) return null;
    if (codeBlocks(reply)) {
      return {
        kind: 'make',
        step: MADE_STEP,
        message: `${APP_NOTE} your reply shows code, but no file in the project was changed. If the request was to change ` +
          'the project, make the change now with patch_file, or write_file for a new file, then say in a sentence or two what ' +
          'you changed. If it only asked a question, answer it and change nothing.',
      };
    }
    if (!wordsToo || KEEP_FILES.test(request)) return null;
    return {
      kind: 'make',
      step: MADE_STEP,
      message: `${APP_NOTE} no file in the project was changed, and the request asks for a change. Make it now with the ` +
        'tools: grep_code finds where a name or a piece of text is written, read_file shows a file, patch_file changes it, ' +
        'and shell_run runs the tests. Ask the person only for what the files and the tests cannot tell you. If it should ' +
        'not be changed, say why.',
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
        'Fix each one now, then finish. If one is not right, say why in your answer instead of changing anything for it.',
    };
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
   * mid-sized model a change asked for and not begun; then steps of its own
   * plan left open (`plan`); then, while proving is switched on (`prove`), a
   * change to code nothing proved, and a request of several asks (`asks`)
   * gone through ask by ask, or, on a small or mid-sized model on this
   * computer (`size`), the work checked against the request as a whole. `sent` counts,
   * by kind, how often this run was sent back; `shown` gives the request as
   * the person sees it, without the text of what they attached.
   */
  function sendBack(log, messages, reply, { checks = null, prove = true, size = 'full', sent = {}, shown = null, plan = null, asks = null } = {}) {
    if (!log || !String(reply || '').trim()) return null;
    const request = requestIn(messages);
    const local = size === 'small' || size === 'mid';
    const listed = Array.isArray(asks) && asks.length >= 3;   // a request of several asks is checked ask by ask, in place of as a whole
    return unmadeChange(log, messages, reply, sent.make || 0, 1, { wordsToo: local })
      || planCheck(plan, reply, sent.plan || 0)
      || (prove ? stopCheck(log, checks, reply, sent.prove || 0) : null)
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
    requestIn, codeBlocks, unmadeChange, planCheck, reviewCheck, asksCheck, freshReviewNote, siteNote, sendBack, noteStep, namedPaths, namedNote,
  };
})();
