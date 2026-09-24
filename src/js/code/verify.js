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
   * A record of one run: the files changed, and every check run with what it
   * showed. `edited(path)` after each change the agent makes; `ran(command,
   * args, result)` after each command, where `result` is what shell_run gave
   * back — a command that never started is not proof of anything and is not
   * recorded.
   */
  function proofLog() {
    let step = 0;
    let lastCodeEdit = -1;
    const changed = [];
    const checks = [];
    return {
      edited(path) {
        step++;
        if (path && !changed.includes(path)) changed.push(path);
        if (isCode(path)) lastCodeEdit = step;
      },
      ran(command, args, result) {
        step++;
        const kind = commandKind(command, args);
        if (!kind || !result || typeof result.code !== 'number') return null;
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

  /** The command line of a shell_run call, as the person would type it. */
  const line = (entry) => `\`${entry.command}\``;

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
      ? `${APP_NOTE} ${line(failed)} failed after your last change. Read the failure, fix the cause, and run it again. ` +
        'Then finish by saying which checks passed. If it cannot be made to pass, say what still fails and why.'
      : `${APP_NOTE} you changed ${files} and no test has run since. Run \`${test}\` now. If it fails, read the failure and fix it. ` +
        'Then finish by saying which checks passed. If it cannot run here, say so and why.';
    return { message };
  }

  /**
   * One line for the person saying what was proven after the last change, or
   * '' when no code was changed. Worked out from the record alone.
   */
  function proofLine(log) {
    if (!log || !log.codeChanged) return '';
    const after = log.since();
    const lastOf = (kind) => after.filter((c) => c.kind === kind).pop();
    const test = lastOf('test');
    if (test && test.pass) {
      return `Checked after the last change: ${line(test)} passed${test.scope === 'part' ? ', for part of the project' : ''}.`;
    }
    if (test) return `Not proven: ${line(test)} failed after the last change.`;
    const other = after.filter((c) => c.pass).pop();
    if (other) return `Not tested: ${line(other)} passed after the last change, but no test ran.`;
    return 'Not checked: no test ran after the last change.';
  }

  window.HCCodeVerify = {
    commandKind, commandScope, projectChecks, readProjectChecks, checksLine, proofLog, stopCheck, proofLine, isAppNote, APP_NOTE,
  };
})();
