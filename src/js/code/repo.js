// ==============================================================
// The repository a project is, as HashCoder reads it at the start
//
// A model that is about to change a project should know it is a git
// repository, on which branch, where that branch is pushed and whether it is
// in step, how its commit titles are written, which of its own hooks run on a
// commit, and where its rules for contributors are. Without that it commits
// in a style the project does not use, or works on the wrong branch.
//
// All of it is read from git's own files (HEAD, config, refs, the HEAD log,
// the hooks folder) and from the project's folders, through quiet reads. No
// command is run: a repository's own settings can make git start a program,
// so asking git would run the project's code before anyone agreed to it.
// Which files are changed, and by how many commits a branch is ahead, need
// git itself; the model asks for those through the permission guard.
//
// A remote is kept by host, owner and name only; a sign-in written into its
// address is never kept. Of the commits, only how titles are written is
// taken, never who made them.
//
// Pure: everything is read through the functions given.
// Published as window.HCCodeRepo. Checked by scripts/checks/code-repo.mjs.
// ==============================================================
(function () {
  'use strict';

  /** What every size of model is told about a repository. */
  const RULE = 'This folder may already hold the person\'s own changes. Never undo or overwrite a change you did not make.';
  /** Files at the top of a project that hold its rules for contributors, beside its notes for coding agents. */
  const RULE_FILES = ['CONTRIBUTING.md', '.github/PULL_REQUEST_TEMPLATE.md'];
  /** Where a project's checks on the code host are kept. */
  const CI_FOLDER = '.github/workflows';
  /** The most names kept of each list. */
  const MOST = 12;

  const BRANCH = /^[A-Za-z0-9._\/-]{1,80}$/;
  const HASH = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;
  const PART = /^[A-Za-z0-9._-]{1,100}$/;

  const join = (root, ...parts) => [String(root).replace(/[\\/]+$/, ''), ...parts].join(/\\/.test(root) && !/\//.test(root) ? '\\' : '/');
  const branchName = (b) => (typeof b === 'string' && BRANCH.test(b) && !b.includes('..') && !b.startsWith('-') && !b.startsWith('/') ? b : null);

  /** git's config as { 'branch "cart"': { remote, merge }, ... }: section names as written, keys lower case. */
  function config(text) {
    const out = {};
    let at = null;
    for (const raw of String(text || '').split(/\r?\n/)) {
      const line = raw.replace(/[;#].*$/, '').trim();
      if (!line) continue;
      const head = /^\[\s*([A-Za-z0-9.-]+)(?:\s+"([^"]*)")?\s*\]$/.exec(line);
      if (head) { at = head[2] != null ? `${head[1].toLowerCase()} "${head[2]}"` : head[1].toLowerCase(); out[at] = out[at] || {}; continue; }
      const kv = /^([A-Za-z0-9-]+)\s*=\s*(.*)$/.exec(line);
      if (kv && at) out[at][kv[1].toLowerCase()] = kv[2].trim().replace(/^"(.*)"$/, '$1');
    }
    return out;
  }

  /** `{ host, owner, name }` of a remote's address, any sign-in in it dropped, or null. */
  function remoteOf(url) {
    const u = String(url || '').trim();
    let m = /^(?:https?|ssh|git):\/\/(?:[^@/]*@)?([^/:]+)(?::\d+)?\/(.+?)\/([^/]+?)(?:\.git)?\/?$/.exec(u)
      || /^(?:[^@/]+@)?([^/:]+):(?!\/)(.+?)\/([^/]+?)(?:\.git)?\/?$/.exec(u);
    if (!m) return null;
    const owner = m[2].split('/').filter(Boolean);
    if (!PART.test(m[1]) || !owner.length || !owner.every((o) => PART.test(o)) || !PART.test(m[3])) return null;
    return { host: m[1].toLowerCase(), owner: owner.join('/'), name: m[3] };
  }

  /** How a list of titles is written: `{ prefix: 'word-colon' | 'none', titleMax }`, or null without titles. */
  function styleOf(titles) {
    const list = (Array.isArray(titles) ? titles : []).filter((t) => typeof t === 'string' && t.trim());
    if (!list.length) return null;
    const colon = list.filter((t) => /^[a-z]+(?:\([^)\s]{1,30}\))?!?: \S/.test(t)).length;
    return { prefix: colon * 2 >= list.length ? 'word-colon' : 'none', titleMax: Math.max(...list.map((t) => t.length)) };
  }

  /**
   * The repository at `root`, read through `{ list(dir), read(path) }` (and
   * `whole(path)` for the HEAD log when given). A folder that is not one gives
   * `{ isRepo: false }`; a linked one (.git is a file pointing elsewhere)
   * `{ isRepo: true, linked: true }`. Anything that cannot be read is left out;
   * it never throws.
   */
  async function read(root, io) {
    const quiet = async (fn, ...a) => { try { return await fn(...a); } catch { return null; } };
    const listOf = async (dir) => { const e = await quiet(io.list, dir); const arr = typeof e === 'string' ? (() => { try { return JSON.parse(e); } catch { return []; } })() : e; return Array.isArray(arr) ? arr.filter((x) => x && x.name) : []; };
    const top = await listOf(root);
    const git = top.find((e) => e.name === '.git');
    if (!git) return { isRepo: false };
    if (!git.is_dir) return { isRepo: true, linked: true };
    const text = async (...parts) => { const t = await quiet(io.read, join(root, '.git', ...parts)); return typeof t === 'string' ? t : ''; };

    const out = { isRepo: true, branch: null, detached: false, commit: null, upstream: null, inStep: 'unknown', remote: null, hooks: [], ci: [], rules: [], style: null };
    const head = (await text('HEAD')).trim();
    const ref = /^ref:\s*refs\/heads\/(.+)$/.exec(head);
    if (ref) out.branch = branchName(ref[1].trim());
    else if (HASH.test(head)) { out.detached = true; out.commit = head.slice(0, 7); }

    const cfg = config(await text('config'));
    const tracked = out.branch && cfg[`branch "${out.branch}"`];
    const mergeTo = tracked && /^refs\/heads\/(.+)$/.exec(tracked.merge || '');
    if (tracked && PART.test(tracked.remote || '') && mergeTo && branchName(mergeTo[1])) out.upstream = { remote: tracked.remote, branch: mergeTo[1] };
    const remoteName = (out.upstream && out.upstream.remote) || (cfg['remote "origin"'] ? 'origin' : (Object.keys(cfg).find((k) => /^remote "/.test(k)) || '').slice(8, -1));
    if (remoteName && cfg[`remote "${remoteName}"`]) out.remote = remoteOf(cfg[`remote "${remoteName}"`].url);

    if (out.branch && out.upstream) {
      const packed = await text('packed-refs');
      const hashOf = async (name) => {
        const loose = (await text(...name.split('/'))).trim();
        if (HASH.test(loose)) return loose;
        const line = packed.split(/\r?\n/).find((l) => l.endsWith(` ${name}`));
        return line && HASH.test(line.split(' ')[0]) ? line.split(' ')[0] : null;
      };
      const mine = await hashOf(`refs/heads/${out.branch}`);
      const theirs = await hashOf(`refs/remotes/${out.upstream.remote}/${out.upstream.branch}`);
      if (mine && theirs) out.inStep = mine === theirs ? 'same' : 'differs';
    }

    out.hooks = (await listOf(join(root, '.git', 'hooks'))).filter((e) => !e.is_dir && !/\.sample$/.test(e.name) && PART.test(e.name)).map((e) => e.name).sort().slice(0, MOST);
    out.ci = (await listOf(join(root, ...CI_FOLDER.split('/')))).filter((e) => !e.is_dir && /\.ya?ml$/i.test(e.name) && PART.test(e.name)).map((e) => `${CI_FOLDER}/${e.name}`).sort().slice(0, MOST);
    const notes = (typeof window !== 'undefined' && window.HCCodeContext && window.HCCodeContext.NOTES_FILES) || [];
    const has = async (rel) => (rel.includes('/') ? (await listOf(join(root, ...rel.split('/').slice(0, -1)))).some((e) => e.name === rel.split('/').pop() && !e.is_dir) : top.some((e) => e.name === rel && !e.is_dir));
    for (const rel of [...notes, ...RULE_FILES]) if (await has(rel)) out.rules.push(rel);
    out.rules.sort();

    const C = typeof window !== 'undefined' && window.HCCodeContext;
    const log = io.whole ? await quiet(io.whole, join(root, '.git', 'logs', 'HEAD')) : null;
    if (C && C.recentCommits && typeof log === 'string') out.style = styleOf(C.recentCommits(log));
    return out;
  }

  /** What a model of this size is told of the repository, or '' for no repository. */
  function lines(p, size) {
    if (!p || !p.isRepo) return '';
    const where = p.linked ? 'This folder is a git repository (a linked one).' : p.branch ? `This folder is a git repository, on branch ${p.branch}.` : p.detached ? `This folder is a git repository, on no branch: at commit ${p.commit}.` : 'This folder is a git repository.';
    const out = [where];
    if (size !== 'small' && p.style) {
      out.push(p.style.prefix === 'word-colon'
        ? `Its commit titles start with a word and a colon, such as "fix: ...", and run up to ${p.style.titleMax} characters.`
        : `Its commit titles are plain sentences, up to ${p.style.titleMax} characters.`);
    }
    if (size !== 'small' && size !== 'mid') {
      if (p.upstream) out.push(`The branch is pushed to ${p.upstream.remote}/${p.upstream.branch}, and ${p.inStep === 'same' ? 'in step with it' : p.inStep === 'differs' ? 'not in step with it' : 'whether it is in step is not known'} by git's last record.`);
      if (p.remote) out.push(`Its remote: ${p.remote.host}/${p.remote.owner}/${p.remote.name}.`);
      if (p.hooks && p.hooks.length) out.push(`Its own hooks run on a commit or a push: ${p.hooks.join(', ')}.`);
      if (p.ci && p.ci.length) out.push(`Its checks on the code host: ${p.ci.join(', ')}.`);
      if (p.rules && p.rules.length) out.push(`Its rules for contributors and notes: ${p.rules.join(', ')}.`);
    }
    out.push(RULE);
    return out.join('\n');
  }

  window.HCCodeRepo = { RULE, RULE_FILES, CI_FOLDER, MOST, config, remoteOf, styleOf, read, lines };
})();
