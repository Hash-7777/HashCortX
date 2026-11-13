// ==============================================================
// HashCoder's git tools: fixed calls, never a shell line
//
// A model that reaches git through the general command tool writes whatever
// line it likes, and the guard can only judge that line. These tools take
// a few named arguments and turn them into one program and its arguments
// from a fixed table. An argument the table does not know, or a value that
// is not plain, refuses the call with what to send instead. What comes out
// still goes through the permission guard as a command (shellRun), so it is
// asked about, or let through in Auto, by the same rules as one the model
// wrote itself; every line built here is one Auto lets through.
//
// A diff or a log is asked for without a repository's own programs for
// showing changes (--no-ext-diff, --no-textconv): what is read is git's own
// text, and no program the repository names is started for it.
//
// Pure: builds lists of strings.
// Published as window.HCCodeGit. Checked by scripts/checks/code-git.mjs.
// ==============================================================
(function () {
  'use strict';

  /** The most commits a log names. */
  const LOG_MOST = 50;
  /** How many a log names when not told. */
  const LOG_FIRST = 15;

  const plainPath = (p) => typeof p === 'string' && p.trim() && !/[\u0000-\u001f]/.test(p) && !p.trim().startsWith('-') && p.length <= 400;
  const branchLike = (b) => typeof b === 'string' && /^[A-Za-z0-9._\/-]{1,80}$/.test(b) && !b.includes('..') && !b.startsWith('-') && !b.startsWith('/') && !b.endsWith('/');

  /** The arguments each tool takes; what each one does is said in its definition (platform/tauri/hashcoder.js). */
  const ARGS = { git_status: [], git_diff: ['path', 'staged', 'base'], git_log: ['n', 'path'] };

  const refuse = (tool, why, call) => ({ error: `${tool} was not run: ${why}. Call it as ${JSON.stringify(call)}.` });

  /**
   * `{ command: 'git', args: [...] }` for a call of one of the tools, or
   * `{ error }` saying what was wrong and the call written right.
   */
  function argv(tool, given) {
    const takes = ARGS[tool];
    if (!takes) return { error: `${tool} is not a git tool here. Use git_status, git_diff or git_log.` };
    const a = given && typeof given === 'object' && !Array.isArray(given) ? given : {};
    const unknown = Object.keys(a).filter((k) => !takes.includes(k) && k !== 'reason');
    const example = { git_status: {}, git_diff: { path: 'src/cart.js' }, git_log: { n: 10 } }[tool];
    if (unknown.length) return refuse(tool, `it does not take ${unknown.join(', ')}; anything else git can do is shell_run's, and asked about there`, example);
    if (a.path != null && !plainPath(a.path)) return refuse(tool, 'path must be one plain file or folder name, not starting with "-"', { ...example, path: 'src/cart.js' });

    if (tool === 'git_status') return { command: 'git', args: ['status', '--porcelain=v1', '-b'] };
    if (tool === 'git_diff') {
      if (a.staged != null && typeof a.staged !== 'boolean') return refuse(tool, 'staged is true or false', { staged: true });
      if (a.base != null && !branchLike(a.base)) return refuse(tool, 'base must be a branch name, such as main', { base: 'main' });
      return { command: 'git', args: ['diff', '--no-ext-diff', '--no-textconv', ...(a.staged ? ['--staged'] : []), ...(a.base ? [`${a.base}...HEAD`] : []), ...(a.path != null ? ['--', a.path.trim()] : [])] };
    }
    const n = a.n == null ? LOG_FIRST : Number(a.n);
    if (!Number.isInteger(n) || n < 1 || n > LOG_MOST) return refuse(tool, `n is a whole number from 1 to ${LOG_MOST}`, { ...example, n: Math.min(LOG_MOST, Math.max(1, Math.round(Number(a.n)) || LOG_FIRST)) });
    return { command: 'git', args: ['log', `-n${n}`, '--format=%h %s', '--no-ext-diff', '--no-textconv', ...(a.path != null ? ['--', a.path.trim()] : [])] };
  }

  // ── A commit ──────────────────────────────────────────────────────────
  //
  // git_commit commits what this run changed, and nothing the person staged
  // or changed alone. Everything it checks, it checks from the run's own
  // record of each file (its text before the run first changed it, and
  // now), before anything runs: no git command is run to look, because a
  // repository's own settings can make git start a program, and nothing
  // should run before the person has seen the commit. Then the person is
  // asked, every time, with the whole commit in front of them; only on a yes
  // are the files added and committed, and only those files.

  /** The most files one commit names. */
  const COMMIT_MOST = 40;
  /** A file this size or more is said in the question. */
  const BIG_FILE = 5 * 1024 * 1024;
  const MARKER = /^(?:<{7}|={7}|>{7})(?: |$)/m;
  const WORD_COLON = /^[a-z]+(?:\([^)\s]{1,30}\))?!?: \S/;

  /**
   * What a git_commit call commits, checked: `{ files, notRun, warnings,
   * shown, reason, add, commit }`, or `{ error }` saying what was wrong and
   * what to send instead. `deps`: `changes` (path to `{ before, after,
   * unreadable }`, the run's own record), `repo` (js/code/repo.js), `diff`
   * (js/diff.js diffLines), `isSecret(path)`, `looksLikeKey(text)`.
   */
  function commitPlan(call, deps = {}) {
    const a = call && typeof call === 'object' ? call : {};
    const changes = deps.changes instanceof Map ? deps.changes : new Map();
    const repo = deps.repo && deps.repo.isRepo ? deps.repo : null;
    const no = (why, fix) => ({ error: `git_commit was not run: ${why}. ${fix}` });
    const unknown = Object.keys(a).filter((k) => !['title', 'body', 'paths', 'reason'].includes(k));
    if (unknown.length) return no(`it does not take ${unknown.join(', ')}`, 'Call it as {"title": "...", "body": "...", "paths": ["src/cart.js"]}, body and paths optional.');

    const title = typeof a.title === 'string' ? a.title.trim() : '';
    const most = repo && repo.style ? Math.max(50, repo.style.titleMax) : 100;
    if (!title) return no('title is missing', 'Call it as {"title": "Keep the basket total in pence"}, one line saying what the commit does.');
    if (/[\r\n]/.test(title)) return no('title is more than one line', 'Put the first line in title and the rest in body.');
    if (title.length > most) return no(`title is ${title.length} characters, and this repository's run up to ${most}`, 'Write it shorter, and put the detail in body.');
    if (repo && repo.style && repo.style.prefix === 'word-colon' && !WORD_COLON.test(title)) return no('this repository\'s titles start with a word and a colon, such as "fix: ..."', `Call it as ${JSON.stringify({ title: `fix: ${title.charAt(0).toLowerCase()}${title.slice(1)}`.slice(0, most) })}, with the word that fits.`);
    if (a.body != null && (typeof a.body !== 'string' || /\u0000/.test(a.body))) return no('body is not plain text', 'Give body as one string, or leave it out.');
    const body = typeof a.body === 'string' ? a.body.trim() : '';

    const ran = [...changes].filter(([, c]) => c && (c.before !== c.after || c.unreadable)).map(([path]) => path);
    let paths;
    if (a.paths == null) paths = ran;
    else if (!Array.isArray(a.paths) || !a.paths.every((p) => typeof p === 'string' && p.trim() && !p.trim().startsWith('-') && !/[\u0000-\u001f]/.test(p))) return no('paths must be a list of file names, none starting with "-"', 'Call it as {"title": "...", "paths": ["src/cart.js"]}, or leave paths out for every file this run changed.');
    else paths = [...new Set(a.paths.map((p) => p.trim()))];
    if (!paths.length) return no('this run has changed no file yet, so there is nothing of its own to commit', 'Make the change first, or name the files in paths if the person asked for them.');
    if (paths.length > COMMIT_MOST) return no(`it names ${paths.length} files, more than ${COMMIT_MOST}`, 'Commit them in parts, each a change that stands on its own.');

    const files = [], notRun = [], warnings = [];
    for (const path of paths) {
      if (typeof deps.isSecret === 'function' && deps.isSecret(path)) return no(`${path} is a file that usually holds keys, and is not committed`, 'Leave it out of paths; say in your answer that it was left out.');
      const c = changes.get(path);
      if (!c) { notRun.push(path); continue; }
      if (c.unreadable) { warnings.push(`${path} could not be read to check.`); files.push({ path, state: 'changed', plus: null, minus: null }); continue; }
      const now = typeof c.after === 'string' ? c.after : '';
      const state = c.before == null ? 'new' : c.after === '' && c.before !== '' ? 'deleted' : 'changed';
      if (state !== 'deleted' && MARKER.test(now)) return no(`${path} still holds a line git leaves where two changes met (<<<<<<<, ======= or >>>>>>>)`, 'Settle that part of the file first, then commit.');
      // A new file's every line is added; its text after the last line break is not one more.
      const rows = c.before == null ? now.replace(/\n$/, '').split('\n').filter((t, i, all) => all.length > 1 || t !== '').map((text, i) => ({ type: 'add', text, afterNo: i + 1 }))
        : typeof deps.diff === 'function' ? deps.diff(c.before, now) : [];
      const added = rows.filter((r) => r.type === 'add');
      const keyed = typeof deps.looksLikeKey === 'function' ? added.find((r) => deps.looksLikeKey(r.text)) : null;
      if (keyed) return no(`a line this run added to ${path}, line ${keyed.afterNo}, looks like a key, and a key in a commit is kept by every copy of the repository for good`, 'Take the value out of the file (read it from the environment, or keep it in a file the project ignores), then commit.');
      if (now.length >= BIG_FILE) warnings.push(`${path} is 5 MB or more.`);
      files.push({ path, state, plus: added.length, minus: rows.filter((r) => r.type === 'del').length });
    }

    const count = (f) => (f.state === 'deleted' ? 'deleted' : f.plus == null ? 'not read' : `${f.state === 'new' ? 'new, ' : ''}+${f.plus} -${f.minus}`);
    const reason = [
      repo && repo.branch ? `Commits on branch ${repo.branch}:` : 'Commits:',
      ...files.map((f) => `${f.path} (${count(f)})`),
      ...(notRun.length ? [`Not changed by this run, committed as they are now: ${notRun.join(', ')}`] : []),
      ...(repo && repo.hooks && repo.hooks.length ? [`This repository's own hooks will run: ${repo.hooks.join(', ')}.`] : []),
      'Each file is committed whole, as it is now, with any change in it this run did not make. Nothing else you have staged is in it.',
      ...warnings,
    ].join('\n');
    const all = [...files.map((f) => f.path), ...notRun];
    return {
      files, notRun, warnings, reason,
      shown: `git commit -- ${all.join(' ')}\n\n${title}${body ? `\n\n${body}` : ''}`,
      add: ['add', '--', ...all],
      commit: ['commit', '-m', title, ...(body ? ['-m', body] : []), '--', ...all],
    };
  }

  /** What a commit that did not go through says, from what git said: `{ kind, words }`. */
  function commitFailure(result) {
    const text = `${(result && result.stderr) || ''}\n${(result && result.stdout) || ''}`.trim();
    const tail = text.split('\n').filter(Boolean).slice(-6).join('\n');
    if (/failed to sign|gpg failed|signing failed|error: (?:gpg|ssh-keygen)|could not sign|incorrect passphrase/i.test(text)) return { kind: 'signing', words: 'The commit was not made: git could not sign it. This repository signs its commits, and the key was not unlocked here. Ask the person to unlock their signing key in a terminal and then ask again; the commit is never made unsigned instead.' };
    if (/nothing to commit|no changes added to commit/i.test(text)) return { kind: 'nothing', words: 'The commit was not made: git found nothing to commit in those files, so they are as the last commit has them.' };
    if (/hook/i.test(text)) return { kind: 'hook', words: `The commit was not made: this repository's own hook refused it. What it said:\n${tail}\nPut right what it names, then call git_commit again.` };
    return { kind: 'other', words: `The commit was not made. What git said:\n${tail || '(nothing)'}\nRead it, put right what it names, then call git_commit again.` };
  }

  /** The commit's short id from what git said as it made it, or null. */
  const commitId = (stdout) => { const m = /^\[[^\]\n]*?\s([0-9a-f]{7,40})\]/m.exec(String(stdout || '')); return m ? m[1] : null; };

  // ── Only when asked ───────────────────────────────────────────────────
  //
  // A request to make a page or fix a function is not a request to make a
  // repository, commit or push. The git tools are offered only to a
  // conversation in which the person has asked for git work, and a command
  // that changes a repository is refused in one where they have not
  // (platform/tauri/hashcoder.js): a step nobody asked for costs the person
  // time and tokens, and some of them cannot be taken back.

  /** Words a person uses when they ask for git work. */
  const GIT_ASK = /\bgit(?:hub)?\b|\bcommit(?:s|ted|ting)?\b|\bpush(?:ed|ing)?\s+(?:it|this|that|them|the\s+\w+|my\s+\w+|everything|changes)?\s*(?:to|up)\b|\bpull\s+requests?\b|\brebase\b|\bstash\b|\bcherry-pick\b|\brepo(?:s|sitory|sitories)?\b|\b(?:new|feature|git|this|another|separate|own|current)\s+branch\b|\bbranch(?:es)?\s+(?:called|named|off|from)\b|\bdiff\b|\bstaged\b|\bversion control\b/i;
  /** A pull request by its short name, in capitals only: "pr" is a word in other languages and code. */
  const PR = /\bPRs?\b/;

  /** The text of what the person sent, never the app's own notes or the pictures an agent opened. */
  const personsText = (messages) => (Array.isArray(messages) ? messages : []).filter((m) => m && m.role === 'user' && !m.note && !m.opened)
    .map((m) => (typeof m.content === 'string' ? m.content : Array.isArray(m.content) ? m.content.map((p) => (p && typeof p.text === 'string' ? p.text : '')).join(' ') : '')).join('\n');

  /** Whether the person has asked for git work anywhere in this conversation. */
  const asked = (messages) => { const t = personsText(messages); return GIT_ASK.test(t) || PR.test(t); };

  window.HCCodeGit = { LOG_MOST, LOG_FIRST, ARGS, argv, COMMIT_MOST, BIG_FILE, commitPlan, commitFailure, commitId, GIT_ASK, asked };
})();
