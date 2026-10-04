// ==============================================================
// How much HashCoder may do without asking
//
// Three modes, chosen by the person, beside the box a request is written in:
//
//   Manual       every change asks: a file written or edited, one moved or
//                deleted, a command, a web page. Reading inside the project
//                is free, since an agent that cannot read cannot work. This
//                is the mode until the person has chosen another, so a first
//                use asks before it changes anything.
//   Accept edits inside the open project a file may be written or edited
//                without a question, because Undo can put it back; a
//                command, a deletion, a move out of the project and a web
//                page ask.
//   Auto         edits as above, and a short, fixed list of commands runs
//                without a question: reading and searching inside the
//                project, git's read-only commands, and the project's own
//                tests, linting and build. Anything else asks.
//
// WHAT AUTO IS AND IS NOT. It is not the model deciding that something looks
// safe: a model can be talked into anything by a page it has read, and a
// decision made by the thing being restrained is not a restraint. It is a list
// written down here, judged on the program and its arguments as they will be
// run. A command is a program and its arguments, never a shell line (pipes,
// redirects, `;`, `&&` and variables are not there), so there is no syntax to
// hide a second command in.
//
// What lets a command through in Auto, all of it at once:
//
//   • the program is one of those named below, and every argument is one it
//     takes: a flag it is known to have, a value for that flag, or a place;
//   • every place it names is inside the project, and where it really leads
//     (the guard asks the native side, which follows links) and not only how
//     it is spelled — a name that climbs with ".." or begins at a home folder
//     is never judged here, it asks;
//   • it is not a flag that runs another program or writes a file (`find
//     -exec`, `rg --pre`, `sort -o`, `git -c`), which are not on the list;
//   • for a project's own check, it is exactly what the project names for it,
//     nothing that defines how checks run was changed in this run, and it
//     runs with the network closed to it. A check runs the project's code,
//     which may be a test the agent wrote a moment ago; where the system can
//     close the network (macOS, in its sandbox) that code cannot send
//     anything anywhere, and where it cannot, a check asks as in any mode;
//   • for git, nothing under `.git` or in a file git reads settings from was
//     changed in this run.
//
// And Auto stops being automatic by itself when it should:
//
//   • after the agent has tried a protected place twice in one run, the rest
//     of that run asks about everything — somebody has probably told it to;
//   • after a long streak of commands that were not asked about, one asks, so
//     a run left alone is looked at now and then.
//
// None of this reaches the native side. The commands it lets through are
// refused there exactly as any command is, whatever the mode: the protected
// locations, the folder boundary, the sandbox on macOS and the removal of
// secrets from the environment all stay.
//
// Auto is not remembered across a restart: a standing choice to be asked less
// is made again each time the app opens, so it is never in force by
// forgetting.
//
// Pure: strings in, a verdict out. Published as window.HCCodePermissions.
// Checked by scripts/checks/permissions.mjs.
// ==============================================================

(function () {
  'use strict';

  const MODES = [
    { id: 'ask', label: 'Manual', help: 'Asks before changing a file, running a command or reading a web page.' },
    { id: 'edits', label: 'Accept edits', help: 'Changes files in the project on its own, and asks before commands.' },
    { id: 'auto', label: 'Auto', help: 'Also runs commands that only read the project or run its own tests, and asks before anything else.' },
  ];
  const IDS = MODES.map((m) => m.id);
  const KEY = 'hc_coder_permission_mode';

  const defaultStore = () => { try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; } };

  /** The mode kept, Manual when none was ever chosen. Auto is never restored. */
  function readMode(store = defaultStore()) {
    try {
      const v = store ? String(store.getItem(KEY) || '') : '';
      return v === 'ask' || v === 'edits' ? v : 'ask';
    } catch { return 'ask'; }
  }

  /** Keep a choice. Auto is held for this session only and written nowhere. */
  function writeMode(mode, store = defaultStore()) {
    if (!IDS.includes(mode)) return false;
    try {
      if (!store) return mode !== 'auto';
      if (mode === 'auto') store.removeItem(KEY); else store.setItem(KEY, mode);
      return true;
    } catch { return false; }
  }

  /** The actions inside the open project that need no question in a mode. */
  const FREE = {
    ask: new Set(['read', 'list', 'search']),
    edits: new Set(['read', 'list', 'search', 'write', 'patch']),
    auto: new Set(['read', 'list', 'search', 'write', 'patch']),
  };
  const freeInProject = (mode, action) => (FREE[mode] || FREE.edits).has(action);

  // ── Paths, read as written ──────────────────────────────────────────────

  const slashes = (p) => String(p == null ? '' : p).replace(/\\/g, '/');
  const windowsRoot = (root) => /^[A-Za-z]:/.test(String(root)) || /\\/.test(String(root));
  const hasDotDot = (p) => slashes(p).split('/').includes('..');
  /** Written like a place rather than a word. */
  const placeLike = (t) => /[\\/]/.test(t) || t === '.' || t === '..' || t.startsWith('~') || /^[A-Za-z]:/.test(t);

  /**
   * `token` as a path inside `root` when it is spelled to be: written from
   * `cwd`, or in full under `root`, with no ".." and no home folder. null
   * for anything else, which asks. Where it really leads is for the native
   * side to say; this only refuses what is plainly outside.
   */
  function insideRoot(token, cwd, root) {
    const t = slashes(token);
    if (!t || t.startsWith('~') || hasDotDot(t)) return null;
    const base = slashes(root).replace(/\/+$/, '');
    const full = (/^(?:[A-Za-z]:)?\//.test(t) ? t : `${slashes(cwd || root).replace(/\/+$/, '')}/${t}`).replace(/\/(?:\.\/)+/g, '/').replace(/\/\.$/, '').replace(/\/{2,}/g, '/').replace(/\/+$/, '');
    const same = windowsRoot(root) ? (a, b) => a.toLowerCase() === b.toLowerCase() : (a, b) => a === b;
    const head = full.slice(0, base.length);
    return same(head, base) && (full.length === base.length || full[base.length] === '/') ? full : null;
  }

  // ── What may be run without asking ──────────────────────────────────────

  /**
   * A program that only reads: its flags, the ones that take a value, and
   * whether its first place is a pattern rather than a file. A flag not
   * written here is not allowed, which is the point: the list is of what is
   * known to be safe, not of what is known to be dangerous.
   */
  const NUM = /^\d+$/;
  const READERS = {
    ls: { short: /^-[aAlh1trRSFdspiGgoLnC]+$/ },
    pwd: { short: /^$/ },
    cat: { short: /^-[nbsAETv]+$/ },
    head: { short: /^-(?:\d+|[qv]+)$/, valued: new Set(['-n', '-c']), valueRe: NUM },
    tail: { short: /^-(?:\d+|[qv]+)$/, valued: new Set(['-n', '-c']), valueRe: NUM },
    wc: { short: /^-[lwcmL]+$/ },
    file: { short: /^-[bIL]+$/ },
    stat: { short: /^-[xLf]+$/ },
    du: { short: /^-[ashcxkmgd]+$/, valued: new Set(['-d']), valueRe: NUM },
    tree: { short: /^-[adfLghpsDiCnq]+$/, valued: new Set(['-L']), valueRe: NUM },
    which: { short: /^-a$/ },
    basename: { short: /^$/ },
    dirname: { short: /^$/ },
    realpath: { short: /^-[sq]+$/ },
    date: { short: /^-[uIRj]+$/ },
    sort: { short: /^-[bdfgiMnrRuV]+$/ },
    uniq: { short: /^-[cdiuD]+$/ },
    diff: { short: /^-[bBiqrwuy]+$/, valued: new Set(['-U', '-C']), valueRe: NUM },
    cmp: { short: /^-[ls]+$/ },
    grep: { short: /^-[rRnilLcvwxEFHhsoqIa]+$/, valued: new Set(['-m', '-A', '-B', '-C', '-e']), valueRe: /^[^\n]{1,200}$/, long: /^--(?:include|exclude|exclude-dir|max-count|color|no-color|line-number|recursive|ignore-case|files-with-matches|count|fixed-strings|extended-regexp|word-regexp|invert-match)(?:=[^\n]{0,200})?$/, patternFirst: true },
    rg: { short: /^-[nilLcvwFSsHhoqu.]+$/, valued: new Set(['-m', '-A', '-B', '-C', '-g', '-t', '-e']), valueRe: /^[^\n]{1,200}$/, long: /^--(?:files|hidden|no-ignore|line-number|ignore-case|smart-case|fixed-strings|word-regexp|files-with-matches|count|no-heading|color=never|glob=[^\n]{1,200}|type=[a-z0-9]+|max-count=\d+)$/, patternFirst: true },
  };
  READERS.egrep = READERS.grep;
  READERS.fgrep = READERS.grep;

  /** The expression words `find` may be given: none of them runs a program or writes. */
  const FIND_WORDS = new Set(['-name', '-iname', '-type', '-maxdepth', '-mindepth', '-path', '-ipath', '-not', '!', '-o', '-a', '-print', '-prune', '-size', '-mtime', '-newer', '(', ')']);
  const FIND_VALUED = new Set(['-name', '-iname', '-type', '-maxdepth', '-mindepth', '-path', '-ipath', '-size', '-mtime', '-newer']);

  /** git's commands that only read, with the flags each is given. */
  const GIT = {
    status: { flags: /^(?:-s|-b|-u|-uno|--short|--branch|--porcelain(?:=v[12])?|--untracked-files(?:=(?:no|normal|all))?|--ignored|--no-color)$/ },
    diff: { flags: /^(?:--stat|--numstat|--shortstat|--name-only|--name-status|--cached|--staged|--no-color|--check|-w|--ignore-all-space|-U\d+|--unified=\d+|--no-ext-diff|--no-textconv|--minimal|HEAD|HEAD~\d+|HEAD\^+)$/, revs: true },
    log: { flags: /^(?:--oneline|--stat|--name-only|--name-status|--graph|--decorate|--no-color|--all|-p|--patch|-n\d*|-\d+|--no-ext-diff|--no-textconv|--since=[^\n]{1,60}|--until=[^\n]{1,60}|--author=[^\n]{1,80}|--format=[^\n]{1,80}|--pretty=[^\n]{1,80}|HEAD|HEAD~\d+)$/, valued: new Set(['-n']), valueRe: NUM, revs: true },
    show: { flags: /^(?:--stat|--name-only|--name-status|--no-color|--no-ext-diff|--no-textconv|--format=[^\n]{1,80}|--pretty=[^\n]{1,80}|HEAD|HEAD~\d+|[0-9a-f]{7,40})$/, revs: true },
    branch: { flags: /^(?:-a|-r|-v|-vv|--list|--show-current|--no-color)$/ },
    'rev-parse': { flags: /^(?:--show-toplevel|--abbrev-ref|--short(?:=\d+)?|--is-inside-work-tree|HEAD)$/ },
    'ls-files': { flags: /^(?:-m|-o|-c|-s|--others|--modified|--cached|--exclude-standard|--deleted)$/ },
    blame: { flags: /^(?:-w|--no-color|-e|-s)$/, valued: new Set(['-L']), valueRe: /^\d+(?:,\d+)?$/ },
    describe: { flags: /^(?:--tags|--always|--abbrev=\d+|--dirty)$/ },
  };

  /**
   * Flags a test, lint or build command may be given beside what the project
   * names for it: ones that choose what to run or how much to say, never one
   * that loads code, reads another configuration or reaches another place.
   */
  const CHECK_FLAGS = /^(?:--|-v+|-q|-x|--verbose|--quiet|--silent|--bail|--coverage|--no-coverage|--runInBand|--watch=false|--watchAll=false|--ci|--no-color|--color=never|--noEmit|--check|--run)$/;
  const CHECK_VALUED = new Set(['-k', '-m', '-t', '-testNamePattern', '--testNamePattern', '--grep', '--filter']);

  /** Files that say how a check runs: changed in a run, the project's checks ask for the rest of it. */
  const CHECK_DEFINING = /(?:^|\/)(?:package\.json|Makefile|makefile|GNUmakefile|pyproject\.toml|setup\.py|setup\.cfg|tox\.ini|pytest\.ini|conftest\.py|Cargo\.toml|build\.rs|justfile|Rakefile|composer\.json|\.npmrc|\.yarnrc(?:\.yml)?|\.cargo\/config(?:\.toml)?|jest\.config\.[cm]?[jt]s|vitest\.config\.[cm]?[jt]s|\.mocharc\.[a-z]+)$/i;
  /** Files git reads settings from, and its own folder. */
  const GIT_DEFINING = /(?:^|\/)(?:\.git\/|\.gitattributes$|\.gitmodules$|\.gitconfig$)/;

  /** A file that holds secrets by what it is called: it asks, whatever reads it. */
  const SECRET_FILE = /(?:^|\/)(?:\.env(?:\.(?!example$|sample$|template$|dist$)[^/]*)?|[^/]*\.(?:pem|key|p12|pfx|keystore|kdbx)|id_(?:rsa|dsa|ecdsa|ed25519)[^/]*|\.netrc|\.pgpass|\.git-credentials|credentials(?:\.json)?|secrets?\.(?:json|ya?ml|toml))$/i;

  const SPLIT_LONG = (tok) => { const at = tok.indexOf('='); return at < 0 ? [tok, null] : [tok.slice(0, at), tok.slice(at + 1)]; };

  /**
   * A reading program's arguments: `{ ok, places }`. `places` are the words
   * that are files or folders, to be judged for where they lead.
   */
  function readerArgs(name, args) {
    const spec = READERS[name];
    const places = [];
    let positional = false;
    let patternPending = !!spec.patternFirst;
    for (let i = 0; i < args.length; i++) {
      const t = String(args[i]);
      // A lone dash is standard input, not a file.
      if (t === '-') return { ok: false, why: `${name} - reads from standard input` };
      if (positional || !t.startsWith('-')) {
        if (patternPending) { patternPending = false; continue; }
        places.push(t);
        continue;
      }
      if (t === '--') { positional = true; continue; }
      if (t.startsWith('--')) {
        if (!(spec.long && spec.long.test(t))) return { ok: false, why: `${name} ${SPLIT_LONG(t)[0]} is not a flag that is run without asking` };
        const [, value] = SPLIT_LONG(t);
        if (value != null && placeLike(value) && /^(?:include|exclude)/.test(SPLIT_LONG(t)[0].slice(2)) === false) places.push(value);
        continue;
      }
      if (spec.valued && spec.valued.has(t)) {
        const value = args[++i];
        if (value == null || !spec.valueRe.test(String(value))) return { ok: false, why: `${name} ${t} needs a plain value` };
        if (t === '-e') patternPending = false;
        else if (!NUM.test(String(value)) && placeLike(String(value))) places.push(String(value));
        continue;
      }
      if (!spec.short.test(t)) return { ok: false, why: `${name} ${t} is not a flag that is run without asking` };
    }
    return { ok: true, places };
  }

  function findArgs(args) {
    const places = [];
    let i = 0;
    while (i < args.length && !String(args[i]).startsWith('-') && args[i] !== '!' && args[i] !== '(') { places.push(String(args[i])); i++; }
    for (; i < args.length; i++) {
      const t = String(args[i]);
      if (!FIND_WORDS.has(t)) return { ok: false, why: `find ${t} is not run without asking` };
      if (FIND_VALUED.has(t)) { i++; if (i >= args.length || /[\n]/.test(String(args[i]))) return { ok: false, why: `find ${t} needs a value` }; if (t === '-newer') places.push(String(args[i])); }
    }
    return { ok: true, places };
  }

  function gitArgs(args, taintedGit) {
    if (taintedGit) return { ok: false, why: 'a file git reads its settings from was changed in this run' };
    const sub = String(args[0] || '');
    const spec = GIT[sub];
    if (!spec) return { ok: false, why: `git ${sub} is not run without asking` };
    const places = [];
    // A branch, tag or commit may be named where a command takes one.
    const revName = (t) => !!spec.revs && !placeLike(t) && /^[A-Za-z0-9._^~][A-Za-z0-9._^~-]{0,79}$/.test(t);
    let afterDashes = false;
    for (let i = 1; i < args.length; i++) {
      const t = String(args[i]);
      if (afterDashes) { places.push(t); continue; }
      if (t === '--') { afterDashes = true; continue; }
      if (spec.valued && spec.valued.has(t)) {
        const v = args[++i];
        if (v == null || !spec.valueRe.test(String(v))) return { ok: false, why: `git ${sub} ${t} needs a plain value` };
        continue;
      }
      if (spec.flags.test(t) || revName(t)) continue;
      // Anything else that is not a flag is a file or folder, judged by where it leads.
      if (!t.startsWith('-') && placeLike(t) && (sub === 'diff' || sub === 'log' || sub === 'show' || sub === 'blame' || sub === 'ls-files' || sub === 'status')) { places.push(t); continue; }
      if (!t.startsWith('-') && (sub === 'blame' || sub === 'ls-files' || sub === 'status')) { places.push(t); continue; }
      return { ok: false, why: `git ${sub} ${t} is not run without asking` };
    }
    return { ok: true, places };
  }

  /** A project's own check, and what may follow it. */
  function checkArgs(have, rest) {
    const places = [];
    for (let i = 0; i < rest.length; i++) {
      const t = String(rest[i]);
      if (CHECK_VALUED.has(t)) { const v = rest[++i]; if (v == null || !/^[^\n]{1,120}$/.test(String(v)) || String(v).startsWith('-')) return { ok: false, why: `${t} needs a plain value` }; continue; }
      if (t.startsWith('-')) { if (CHECK_FLAGS.test(t)) continue; return { ok: false, why: `${have} ${t} is not run without asking` }; }
      // A name or a file, never an assignment (`CC=x`) or anything a program could read as more.
      if (!/^[\w./@:+-]{1,200}$/.test(t)) return { ok: false, why: `${have} ${t} is not a plain name` };
      places.push(t);
    }
    return { ok: true, places };
  }

  /** A command as one line, the program and its arguments. */
  const lineOf = (command, args) => [command, ...(args || [])].join(' ').trim();

  /** The same check written the other way: `npm test` and `npm run test`. */
  function aliases(line) {
    const l = String(line || '').trim();
    const m = /^(npm|pnpm|yarn|bun)(?: run)?(?: (test|lint|typecheck|build|check))$/.exec(l);
    return m ? [`${m[1]} ${m[2]}`, `${m[1]} run ${m[2]}`, ...(m[2] === 'test' && m[1] === 'npm' ? ['npm t'] : [])] : [l];
  }

  /**
   * Whether a command may run without a question, and the places it names.
   *
   *   command, args, cwd   as the tool was given them
   *   root                 the open project
   *   checks               the project's own, `{ test, lint, typecheck, build }`
   *   tainted              `{ checks, git }`: what this run has changed
   *
   * Returns `{ auto, why, tier, places }`: `why` says in words what held it back,
   * and `places` are the full paths it names, for the guard to ask the native
   * side where they really lead.
   */
  function shellVerdict({ command, args = [], cwd, root, checks = {}, tainted = {} } = {}) {
    const no = (why) => ({ auto: false, why, places: [] });
    const name = String(command || '').trim();
    if (!root) return no('no project is open');
    if (!name || /\s/.test(name) || /[\\/]/.test(name)) return no('the program is named by a path or is not one word');
    if (!Array.isArray(args) || args.some((a) => typeof a !== 'string' || /[\u0000\n\r]/.test(a))) return no('an argument is not plain text');
    const where = cwd ? insideRoot(cwd, root, root) : slashes(root).replace(/\/+$/, '');
    if (!where) return no('it would run outside the project');

    let judged = null;
    let how = '';
    let tier = 'read';
    const line = lineOf(name, args);
    const mine = Object.values(checks || {}).filter(Boolean).map((c) => String(c).trim());

    // The project's own check: exactly what it names, then flags that only choose what to run.
    const own = mine.find((c) => aliases(c).some((a) => line === a || line.startsWith(`${a} `)));
    if (own) {
      if (tainted.checks) return no('a file that says how checks run was changed in this run');
      const used = aliases(own).find((a) => line === a || line.startsWith(`${a} `));
      judged = checkArgs(used, args.slice(used.split(' ').length - 1));
      how = 'a check the project names';
      tier = 'check';
    } else if (name === 'git') {
      judged = gitArgs(args, tainted.git);
      how = 'a git command that only reads';
    } else if (name === 'find') {
      judged = findArgs(args);
      how = 'a search by name';
    } else if (READERS[name]) {
      judged = readerArgs(name, args);
      how = 'a command that only reads';
    } else if ((name === 'node' && args[0] === '--check' && args.length === 2) || ((name === 'python3' || name === 'python') && args[0] === '-m' && args[1] === 'py_compile' && args.length === 3)) {
      judged = { ok: true, places: [args[args.length - 1]] };
      how = 'a syntax check';
    } else {
      return no(`${name} is not on the list of what runs without asking`);
    }
    if (!judged.ok) return no(judged.why);

    const places = [];
    for (const p of judged.places) {
      const inside = insideRoot(p, where, root);
      if (!inside) return no(`${p} is outside the project or climbs out of it`);
      if (SECRET_FILE.test(inside)) return no(`${p} is a file that holds secrets`);
      places.push(inside);
    }
    return { auto: true, why: how, tier, places };
  }

  // ── What one run has done ────────────────────────────────────────────────

  const BLOCKS_BEFORE_ASKING_ALL = 2;
  const STREAK_BEFORE_ASKING = 40;

  /**
   * One run's record. `wrote(path)` for each file the agent writes, edits or
   * moves, `blocked()` for each protected place it asked for, `ran()` for each
   * command let through without a question, `answered()` when the person
   * answers a question. `paused()` says Auto should ask about everything.
   */
  function createRun() {
    const s = { checks: false, git: false, blocks: 0, streak: 0 };
    return {
      wrote(path) {
        const p = slashes(path);
        if (CHECK_DEFINING.test(p)) s.checks = true;
        if (GIT_DEFINING.test(p)) s.git = true;
      },
      blocked() { s.blocks++; },
      ran() { s.streak++; },
      answered() { s.streak = 0; },
      get tainted() { return { checks: s.checks, git: s.git }; },
      /** Why Auto should ask now, or ''. */
      paused() {
        if (s.blocks >= BLOCKS_BEFORE_ASKING_ALL) return 'HashCoder has tried a protected place more than once in this run, so it asks about everything for the rest of it';
        if (s.streak >= STREAK_BEFORE_ASKING) return `${s.streak} commands have run without asking, so this one asks`;
        return '';
      },
      get state() { return { ...s }; },
    };
  }

  /**
   * Whether Auto runs a command with no question, `{ auto, why, paused }`:
   * the verdict on the program and its arguments, then where each place the
   * command names, and the folder it runs in, really leads. `inside(place)` is
   * the native side's answer (it follows links; this module only reads
   * spelling), `blocked(place)` whether the place is a protected one, and
   * `offline` whether a command can be run with the network closed. A
   * run that has been told to ask about everything (`run.paused()`) is not
   * asked for a verdict at all.
   */
  async function autoDecision({ command, args, cwd, root, checks, run, inside, blocked, offline = false } = {}) {
    const stop = run && run.paused();
    if (stop) return { auto: false, why: stop, paused: true, places: [] };
    const verdict = shellVerdict({ command, args, cwd, root, checks, tainted: run ? run.tainted : {} });
    if (!verdict.auto) return verdict;
    // A project's own check runs the project's code, which may be code the agent has just written, so it is run unasked only where the network can be closed to it.
    if (verdict.tier === 'check' && !offline) return { auto: false, why: 'this system cannot run a check with the network closed', places: [] };
    const where = cwd ? insideRoot(cwd, root, root) : slashes(root).replace(/\/+$/, '');
    for (const place of [where, ...verdict.places]) {
      let leads = false;
      try { leads = !!place && !(blocked && blocked(place)) && (await inside(place)) === true; } catch { leads = false; }
      if (!leads) return { auto: false, why: `${place} does not lead inside the project`, places: [] };
    }
    return verdict;
  }

  window.HCCodePermissions = {
    MODES, IDS, KEY, BLOCKS_BEFORE_ASKING_ALL, STREAK_BEFORE_ASKING,
    readMode, writeMode, freeInProject, insideRoot, shellVerdict, autoDecision, createRun, aliases,
    READER_NAMES: Object.keys(READERS), GIT_NAMES: Object.keys(GIT),
  };
})();
