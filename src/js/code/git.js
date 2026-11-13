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
  // are the files added and committed, and only those files, by the narrow
  // native command that builds the two git lines itself and runs them with
  // the person's own git setup, so the commit is signed as theirs are
  // (src-tauri/src/commands/git_commit.rs). `add` and `commit` here are the
  // same lines as shown to the person.

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
      'It runs with your own git setup, as in your terminal, so it is signed as your other commits are; the repository\'s own hooks run with it, outside the app\'s sandbox.',
      ...warnings,
    ].join('\n');
    const all = [...files.map((f) => f.path), ...notRun];
    return {
      files, notRun, warnings, reason, title, body, paths: all,
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

  // ── Sending a branch to the code host, and bringing one back ──────────
  //
  // git_push sends the open branch to a remote the repository names, and
  // git_pull brings that remote's commits in when it can without a merge.
  // Before the question, the commits that would go out are read (outgoingOf)
  // and every line they add is looked at for a key; a key refuses the push,
  // naming the commit, file and line. The question shows where the code goes,
  // the branch, each commit by title and the files. The line itself is built
  // in Rust from a fixed table, with no way to force or delete
  // (src-tauri/src/commands/git_remote.rs).

  /** The git line that reads the commits not yet on a remote, with what each adds. */
  const outgoingLine = (remote) => ['log', '-p', '--no-ext-diff', '--no-textconv', '--format=%x00%h %s', 'HEAD', '--not', `--remotes=${remote}`];

  /** `[{ id, title, files, added: [{ file, line, text }] }]` from what outgoingLine printed, newest first. */
  function outgoingOf(text) {
    const out = [];
    for (const part of String(text || '').split('\u0000').slice(1)) {
      const lines = part.split('\n');
      const head = /^([0-9a-f]{4,40}) ?(.*)$/.exec(lines[0] || '');
      if (!head) continue;
      const c = { id: head[1], title: head[2].trim(), files: [], added: [] };
      let file = null, at = 0;
      for (const l of lines.slice(1)) {
        const plus = /^\+\+\+ (?:b\/)?(.+)$/.exec(l);
        if (plus) { file = plus[1] === '/dev/null' ? null : plus[1]; if (file && !c.files.includes(file)) c.files.push(file); continue; }
        const minus = /^--- a\/(.+)$/.exec(l);
        if (minus) { if (!c.files.includes(minus[1])) c.files.push(minus[1]); continue; }
        const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)/.exec(l);
        if (hunk) { at = Number(hunk[1]); continue; }
        if (l.startsWith('+') && file) { c.added.push({ file, line: at, text: l.slice(1) }); at++; continue; }
        if (!l.startsWith('-') && !l.startsWith('\\')) at++;
      }
      out.push(c);
    }
    return out;
  }

  /** The most commits and files a question lists by name. */
  const LISTED = 20;

  /**
   * What a git_push or git_pull call sends or brings, checked: `{ verb, remote,
   * branch, shown, reason }`, or `{ error }` with what to do instead. `deps`:
   * `repo` (js/code/repo.js), `outgoing` (outgoingOf, for a push),
   * `looksLikeKey(text)`.
   */
  function remotePlan(verb, call, deps = {}) {
    const a = call && typeof call === 'object' ? call : {};
    const repo = deps.repo && deps.repo.isRepo ? deps.repo : null;
    const tool = verb === 'push' ? 'git_push' : 'git_pull';
    const no = (why, fix) => ({ error: `${tool} was not run: ${why}. ${fix}` });
    const unknown = Object.keys(a).filter((k) => !['branch', 'remote', 'reason'].includes(k));
    if (unknown.length) return no(`it does not take ${unknown.join(', ')}`, `Call it as {} for the open branch, or as ${JSON.stringify({ branch: 'cart' })}.`);
    if (!repo) return no('this folder is not a git repository', 'Say so in your answer; a repository is the person\'s to make.');
    const branch = a.branch != null ? a.branch : repo.branch;
    if (!branchLike(branch)) return no(repo.detached && a.branch == null ? 'the repository is on no branch' : 'branch must be a plain branch name', `Call it as ${JSON.stringify({ branch: 'cart' })}.`);
    const remote = a.remote != null ? a.remote : (repo.upstream && repo.upstream.remote) || 'origin';
    if (typeof remote !== 'string' || !/^[A-Za-z0-9._-]{1,100}$/.test(remote) || remote.startsWith('-')) return no('remote must be the name of a remote, such as origin', 'Call it as {"remote": "origin"}.');
    const where = repo.remote ? `${repo.remote.host}/${repo.remote.owner}/${repo.remote.name}` : `the remote ${remote}`;
    const hooks = (repo.hooks || []).filter((h) => (verb === 'push' ? h === 'pre-push' : h === 'post-merge'));
    const shared = [`It uses your own git sign-in. Force is never used.`, ...(hooks.length ? [`This repository's own hooks will run: ${hooks.join(', ')}.`] : [])];
    if (verb === 'pull') {
      return { verb, remote, branch, shown: `git pull --ff-only ${remote} ${branch}`, reason: [`Brings the commits on ${remote}/${branch}, from ${where}, into ${branch}, only if that needs no merge.`, ...shared].join('\n') };
    }
    const outgoing = Array.isArray(deps.outgoing) ? deps.outgoing : [];
    if (!outgoing.length) return no(`every commit on ${branch} is already on ${remote}, so there is nothing to send`, 'Say so in your answer.');
    for (const c of outgoing) {
      const hit = typeof deps.looksLikeKey === 'function' ? c.added.find((x) => deps.looksLikeKey(x.text)) : null;
      if (hit) return no(`commit ${c.id} adds a line that looks like a key, in ${hit.file}, line ${hit.line}, and a key sent to the code host stays in every copy of it`, 'Tell the person: the commit has to be changed before it is sent, and that is theirs to do.');
    }
    const files = [...new Set(outgoing.flatMap((c) => c.files))];
    const more = (list, n) => (list.length > n ? [`and ${list.length - n} more`] : []);
    const main = /^(?:main|master)$/.test(branch) ? [`This sends to ${branch}, the branch most people take as the project's own.`] : [];
    return {
      verb, remote, branch,
      shown: `git push ${remote} HEAD:${branch}`,
      reason: [
        `This sends your code to ${where}, branch ${branch}.`,
        ...main,
        `${outgoing.length === 1 ? 'The commit' : `The ${outgoing.length} commits`} going out:`,
        ...outgoing.slice(0, LISTED).map((c) => `${c.id} ${c.title}`), ...more(outgoing, LISTED),
        `Files changed: ${files.slice(0, LISTED).join(', ')}${files.length > LISTED ? `, and ${files.length - LISTED} more` : ''}.`,
        ...shared,
      ].join('\n'),
    };
  }

  /** What a push or pull that did not go through says, from what git said. */
  function remoteFailure(verb, result) {
    const text = `${(result && result.stderr) || ''}\n${(result && result.stdout) || ''}`.trim();
    const tail = text.split('\n').filter(Boolean).slice(-6).join('\n');
    if (/non-fast-forward|fetch first|rejected/i.test(text) && verb === 'push') return `Nothing was sent: the remote has commits this branch does not. Call git_pull to bring them in, then git_push again; force is never used.`;
    if (/not possible to fast-forward|diverging|Not possible to fast-forward/i.test(text)) return 'Nothing was brought in: the branch and the remote have both moved on, and joining them needs a merge, which is the person\'s to make. Say so in your answer.';
    if (/Authentication failed|could not read Username|Permission denied \(publickey\)|terminal prompts disabled|403|401/i.test(text)) return 'Nothing was sent: the code host did not accept the sign-in. Ask the person to sign in to it once in their own terminal (a git push there), then try again.';
    return `Nothing was ${verb === 'push' ? 'sent' : 'brought in'}. What git said:\n${tail || '(nothing)'}\nRead it, and say in your answer what the person needs to do.`;
  }

  /**
   * A pull request's description drafted from the run's own record
   * (js/run-ledger.js from): what the newest request asked and which asks
   * were answered, the files changed, what ran and whether it passed, and
   * what was not checked. Written from what happened, never from the model's
   * account of it. '' with nothing to say.
   */
  function pullRequestBody(ledger) {
    const l = ledger && typeof ledger === 'object' ? ledger : {};
    const req = Array.isArray(l.requests) && l.requests.length ? l.requests[l.requests.length - 1] : null;
    const changed = Array.isArray(l.changed) ? l.changed : [];
    const ran = Array.isArray(l.ran) ? l.ran : [];
    if (!req && !changed.length) return '';
    const out = [];
    if (req) {
      out.push('## What was asked');
      if (req.asks && req.asks.length) for (const a of req.asks) out.push(`- ${a.text}${a.state === 'answered' ? '' : ' (not confirmed in the answer)'}`);
      else out.push(`- ${req.text}`);
    }
    if (changed.length) out.push('', '## What changed', ...changed.map((c) => `- ${c.path} (${c.how})`));
    out.push('', '## What was run');
    if (ran.length) out.push(...ran.map((r) => `- ${r.command}: ${r.passed ? 'passed' : 'failed'}`));
    else out.push('- Nothing was run.');
    if (!ran.some((r) => r.passed && r.afterLastChange)) out.push('', '## Not checked', '- No check passed after the last change.');
    return out.join('\n').trim();
  }

  /**
   * A commit title for a small model's changes, which the person commits
   * from the receipt and may edit first: the request's first sentence,
   * without a closing "and commit it", in the repository's style and length.
   */
  function draftTitle({ request = '', files = [], style = null } = {}) {
    let first = String(request || '').split(/(?<=[.!?])\s+|\n/)[0].trim().replace(/[.!?]+$/, '')
      .replace(/,?\s+(?:and|then)\s+(?:commit|push)\b.*$/i, '').replace(/^please\s+/i, '').trim();
    const names = (Array.isArray(files) ? files : []).map((f) => String(f).split(/[\\/]/).pop()).filter(Boolean);
    let t = first ? first.charAt(0).toUpperCase() + first.slice(1) : names.length ? `Change ${names.slice(0, 3).join(', ')}` : 'Change the project';
    if (style && style.prefix === 'word-colon') {
      const word = /\b(?:fix|correct|repair|broken|bug|wrong)\b/i.test(first) ? 'fix' : /\b(?:readme|docs?|documentation)\b/i.test(first) ? 'docs' : /\b(?:add|create|make|build|implement|new)\b/i.test(first) ? 'feat' : 'chore';
      t = `${word}: ${t.charAt(0).toLowerCase()}${t.slice(1)}`;
    }
    const most = style && style.titleMax ? Math.max(50, style.titleMax) : 72;
    if (t.length > most) t = t.slice(0, most).replace(/\s+\S*$/, '');
    return t;
  }

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

  /** Words a person uses when the work is about a project's environment settings or secrets (the env_names tool). */
  const ENV_ASK = /\.env\b|\bdotenv\b|\benv(?:ironment)?\s+(?:var(?:iable)?s?|files?|settings?)\b|\bsecrets?\b|\bcredentials?\b/i;
  /** Whether the person has asked about them anywhere in this conversation. */
  const askedEnv = (messages) => ENV_ASK.test(personsText(messages));

  /** Words a person uses when they ask for checks that run on the code host. */
  const CI_ASK = /\bCI\b|\bworkflows?\b|\bpipelines?\b|\bgithub actions?\b|\bcontinuous integration\b/i;
  /** Whether the person has asked for such checks anywhere in this conversation. */
  const askedCI = (messages) => CI_ASK.test(personsText(messages));

  /** git commands that change a repository or reach another one; the rest only read. */
  const GIT_WRITES = new Set(['init', 'commit', 'push', 'pull', 'fetch', 'remote', 'tag', 'merge', 'rebase', 'cherry-pick', 'revert', 'am', 'apply', 'clone', 'submodule', 'worktree', 'stash', 'switch', 'restore', 'reset', 'clean', 'rm', 'mv', 'add', 'gc', 'config']);
  /** Of the others, the forms that change something too: a new branch, a checkout that makes or moves one. */
  const writesBranch = (sub, rest) => (sub === 'branch' && rest.some((a) => !/^-(?:a|r|v|vv|l|-list|-show-current|-all|-remotes|-no-color|-contains|-merged|-no-merged)$/.test(a)))
    || (sub === 'checkout' && rest.length > 0);
  const base = (c) => String(c || '').split(/[\\/]/).pop().replace(/\.(?:exe|cmd|bat)$/i, '').toLowerCase();

  /**
   * Why a command was not run in a conversation where the person has not
   * asked for git work, or null: a git command that changes a repository or
   * reaches another, and the code host's own command. git's reading
   * commands (status, diff, log, show, blame) are left to run as before.
   */
  function unasked(command, args) {
    const name = base(command);
    const a = (Array.isArray(args) ? args : []).map(String);
    const say = (what) => `${what} was not run: the person has not asked for git work in this conversation. Do only what the request asks. If a commit, a branch or a repository would help, say so in one line of your answer and leave it to them.`;
    if (name === 'gh') return say(`gh ${a[0] || ''}`.trim());
    if (name !== 'git') return null;
    let i = 0;
    while (i < a.length && a[i].startsWith('-')) i += (a[i] === '-C' || a[i] === '-c') ? 2 : 1;
    const sub = a[i] || '';
    return GIT_WRITES.has(sub) || writesBranch(sub, a.slice(i + 1)) ? say(`git ${sub}`) : null;
  }

  /** Why a workflow file for the code host was not written in a conversation that did not ask for one, or null. */
  function unaskedFile(path) {
    return /(?:^|[\\/])\.github[\\/]workflows[\\/]/.test(String(path || '')) ? `write_file was not run: ${String(path).split(/[\\/]/).slice(-3).join('/')} is a workflow that runs on the code host, and the person has not asked for one. Do only what the request asks; if checks on the code host would help, say so in one line of your answer.` : null;
  }

  window.HCCodeGit = { LOG_MOST, LOG_FIRST, ARGS, argv, COMMIT_MOST, BIG_FILE, commitPlan, commitFailure, commitId, outgoingLine, outgoingOf, LISTED, remotePlan, remoteFailure, pullRequestBody, draftTitle, GIT_ASK, asked, CI_ASK, askedCI, ENV_ASK, askedEnv, GIT_WRITES, unasked, unaskedFile };
})();
