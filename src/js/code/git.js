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

  window.HCCodeGit = { LOG_MOST, LOG_FIRST, ARGS, argv };
})();
