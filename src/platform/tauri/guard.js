// ==============================================================
// platform/tauri/guard.js — Phase 3 Permission Gatekeeper
//
// Every native action (file read/write, shell exec) must pass
// through HC.guard.request() before it is executed.
//
// Session memory:
//   allow-once    → approved for this call only
//   allow-session → approved until the app closes
//   deny          → remembered for the session
//
// Usage (from hashcoder.js or any agent):
//   const ok = await HC.guard.request('write', '/home/user/project/auth.js', 'Adding JWT check');
//   if (!ok) return; // user denied
//   await HC.invoke('fs_write_file', { path, content });
// ==============================================================

(function () {
  'use strict';

  // Session permission memory: "action::target" → "allow" | "deny"
  const _session = new Map();

  // Directories the user granted for the session, per action: action → Set(dir).
  // Without this, approving a read of one file re-asked for its sibling, and an
  // agent exploring a folder produced a dialog per file until the user gave up
  // and clicked through everything — which is worse than not asking at all.
  const _sessionDirs = new Map();

  // Project root — paths inside are auto-approved for read/list/search/write/patch
  let _projectRoot = null;

  // Hard-blocked paths (mirrors the Rust denylist for early JS rejection).
  // Rust re-checks independently and is the authority; this only saves a round
  // trip and gives the user a clearer message.
  const BLOCKED_PREFIXES = [
    '/System', '/usr/bin', '/usr/sbin', '/etc', '/bin', '/sbin',
    '/private/etc', '/Library/Keychains',
  ];
  const BLOCKED_SUBSTRINGS = [
    '.ssh', '.aws', '.gnupg', 'id_rsa', 'id_dsa', 'id_ecdsa', 'id_ed25519',
    'Keychains', '.netrc', '.npmrc', '.pypirc', '.docker/config.json',
    '.kube/config', '.config/gh/', '.config/gcloud',
    // HashCortX's own state: the plaintext API-key bundle and the audit trail.
    'com.hashcortx.app', '.hashcortx',
  ];
  // Words that are dangerous wherever they appear, matched as whole tokens.
  const BLOCKED_WORDS = ['sudo', 'su', 'shutdown', 'reboot', 'halt', 'poweroff', 'pkill', 'launchctl'];
  // Programs dangerous only as the program being run. Matched in leading
  // position only: substring-matching these is what made the old list refuse
  // `git add file` (it contains "dd "), `npm run format` and `cat departed.md`.
  const BLOCKED_TOOLS = ['dd', 'mkfs', 'fdisk', 'parted', 'format', 'newfs'];
  // Phrases that cannot occur innocently.
  const BLOCKED_PHRASES = [
    'diskutil erasedisk', 'chmod 777', 'chown root',
    // Pipe-to-shell: executing downloaded content directly in an interpreter.
    '| sh', '| bash', '| zsh', '| fish', '| python', '| node', '| perl', '| ruby',
    // Process substitution: bash <(curl ...) or sh <(curl ...)
    'bash <(', 'sh <(', 'zsh <(',
  ];
  // Secret locations a command must never name. Tighter than BLOCKED_SUBSTRINGS
  // on purpose — a command is mostly prose, and `grep -rn credentials src/` is
  // ordinary work. Each of these names one file, so a substring match is exact.
  const BLOCKED_CMD_PATHS = [
    'id_rsa', 'id_dsa', 'id_ecdsa', 'id_ed25519',
    'library/keychains', '.netrc', '.npmrc', '.pypirc', '.docker/config.json',
    '.kube/config', '.config/gh/', '.config/gcloud', 'com.hashcortx.app',
  ];
  // Directories that are a credential store in their own right. Matched as a
  // whole path token, because naming the directory takes everything in it and
  // there may be nothing after it to match on. Mirrors BLOCKED_COMMAND_DIR_MARKERS.
  const BLOCKED_CMD_DIRS = ['.ssh', '.aws', '.gnupg', '.hashcortx'];
  const ENDS_A_PATH_TOKEN = /[\s/\\"'`;&|(),:<>]/;

  // True when the command names a protected directory as a path, rather than
  // merely ending some longer name with those characters (`deploy.aws`).
  function namesProtectedDirectory(lower) {
    return BLOCKED_CMD_DIRS.some((marker) => {
      let from = 0;
      for (;;) {
        const start = lower.indexOf(marker, from);
        if (start === -1) return false;
        const end = start + marker.length;
        const before = start === 0 ? '' : lower[start - 1];
        const after = end >= lower.length ? '' : lower[end];
        if (!/[a-z0-9]/.test(before) && (after === '' || ENDS_A_PATH_TOKEN.test(after))) return true;
        from = end;
      }
    });
  }

  // Lowercase, give pipes and separators their own space, collapse whitespace —
  // so `rm  -rf` and `curl x|sh` normalise to the forms the lists match.
  function normalizeCommand(cmd) {
    return String(cmd || '')
      .toLowerCase()
      .replace(/[|;&]/g, ' $& ')
      .split(/\s+/)
      .filter(Boolean)
      .join(' ');
  }

  function isRmDestructive(normalized) {
    const tokens = normalized.split(' ');
    if (!tokens.includes('rm')) return false;
    let recursive = false, force = false;
    for (const t of tokens) {
      if (t === '--recursive') recursive = true;
      if (t === '--force') force = true;
      if (t.startsWith('-') && !t.startsWith('--')) {
        if (t.includes('r')) recursive = true;
        if (t.includes('f')) force = true;
      }
    }
    return recursive && force;
  }

  // The program each command segment invokes: start of line, and after | ; &.
  function leadingTools(normalized) {
    const tools = [];
    let expecting = true;
    for (const t of normalized.split(' ')) {
      if (t === '|' || t === ';' || t === '&') { expecting = true; continue; }
      if (expecting && t) { tools.push(t.split('/').pop()); expecting = false; }
    }
    return tools;
  }

  function isHardBlocked(action, target) {
    if (action === 'shell') {
      const lower = String(target || '').toLowerCase();
      const normalized = normalizeCommand(target);
      if (isRmDestructive(normalized)) return true;
      if (BLOCKED_PHRASES.some(p => normalized.includes(p))) return true;
      if (normalized.split(' ').some(t => BLOCKED_WORDS.includes(t))) return true;
      if (leadingTools(normalized).some(p =>
        BLOCKED_TOOLS.some(b => p === b || p.startsWith(b + '.') || p.startsWith(b + '_')))) return true;
      // A command must not reach for a key store either — the Rust side refuses
      // this too, and did not before, which made the path denylist meaningless
      // for anything a shell could reach.
      if (BLOCKED_CMD_PATHS.some(m => lower.includes(m))) return true;
      return namesProtectedDirectory(lower);
    }
    return (
      BLOCKED_PREFIXES.some(p => target.startsWith(p)) ||
      BLOCKED_SUBSTRINGS.some(s => target.includes(s))
    );
  }

  // Log the decision to the Rust audit log (best-effort)
  function auditLog(scope, action, target) {
    if (HC.isTauri) {
      HC.invoke('audit_log_append', { scope, action, target }).catch(() => {});
    }
  }

  /**
   * One bar, at the bottom, wherever the request came from.
   *
   * There were two of these: a strip inside Coder and a modal everywhere else,
   * chosen by whether Coder's message list happened to be visible. Two
   * renderers for one decision meant the same question looked like two
   * different things, and normal chat — where a model can also ask to read a
   * web page — got a window over the conversation it was interrupting.
   *
   * The bar does not close itself, cannot be dismissed by clicking away, and
   * has no default: nothing here resolves without the person choosing one of
   * the three. Escape is deliberately not bound. A permission prompt that can
   * be dismissed teaches people to dismiss it, and whichever way that dismissal
   * resolves is wrong — silently allowing is unsafe, silently denying trains
   * them to expect failure.
   */
  // The bar has two jobs and one body: it asks, and it reports what an answer
  // set going. A question always wins — an unanswered request is the only thing
  // that blocks — and the working state comes back when the question is gone.
  let _asking = false;
  let _busy = [];

  function paintBar() {
    const bar     = document.getElementById('hc-perm-bar');
    const titleEl = document.getElementById('hc-perm-title');
    const actEl   = document.getElementById('hc-perm-action');
    const tgtEl   = document.getElementById('hc-perm-target');
    const rsnEl   = document.getElementById('hc-perm-reason');
    if (!bar) return;
    if (_asking) return;                       // showDialog owns the fields
    const job = _busy[_busy.length - 1];
    if (!job) {
      bar.classList.remove('open', 'working');
      return;
    }
    bar.classList.add('open', 'working');
    if (titleEl) titleEl.textContent = 'Working —';
    if (actEl) { actEl.textContent = String(job.action || 'FETCH').toUpperCase(); actEl.className = 'hc-perm-badge ' + (job.action || 'fetch'); }
    if (tgtEl) { tgtEl.textContent = job.label; tgtEl.title = job.label; }
    if (rsnEl) rsnEl.textContent = 'You allowed this. It is running now.';
  }

  function showDialog(action, target, reason) {
    return new Promise((resolve) => {
      const bar     = document.getElementById('hc-perm-bar');
      const actEl   = document.getElementById('hc-perm-action');
      const tgtEl   = document.getElementById('hc-perm-target');
      const rsnEl   = document.getElementById('hc-perm-reason');
      const onceBtn = document.getElementById('hc-perm-once');
      const sessBtn = document.getElementById('hc-perm-session');
      const denyBtn = document.getElementById('hc-perm-deny');
      // No bar in the page is not permission. It is a refusal.
      if (!bar || !actEl || !onceBtn || !sessBtn || !denyBtn) { resolve('deny'); return; }

      // The bar may have been reporting a fetch a moment ago; it is asking now.
      // Without this the question kept the working headline and read as
      // "Working — FETCH …" with Allow and Deny underneath it.
      const titleEl = document.getElementById('hc-perm-title');
      if (titleEl) titleEl.textContent = 'Allow HashCortX to';
      actEl.textContent = String(action).toUpperCase();
      actEl.className   = 'hc-perm-badge ' + action;
      // Long paths lose their middle, not their end: the filename is the part
      // a person recognises.
      const shown = String(target || '');
      tgtEl.textContent = shown.length > 96 ? shown.slice(0, 34) + ' … ' + shown.slice(-58) : shown;
      tgtEl.title = shown;
      rsnEl.textContent = reason || '';
      _asking = true;
      bar.classList.remove('working');
      bar.classList.add('open');

      function cleanup(choice) {
        _asking = false;
        bar.classList.remove('open');
        // A fetch already running keeps the bar; otherwise it goes.
        paintBar();
        onceBtn.removeEventListener('click', onOnce);
        sessBtn.removeEventListener('click', onSession);
        denyBtn.removeEventListener('click', onDeny);
        resolve(choice);
      }
      const onOnce    = () => cleanup('allow-once');
      const onSession = () => cleanup('allow-session');
      const onDeny    = () => cleanup('deny');
      onceBtn.addEventListener('click', onOnce);
      sessBtn.addEventListener('click', onSession);
      denyBtn.addEventListener('click', onDeny);
    });
  }

  // One decision at a time.
  //
  // There is exactly one permission dialog in the DOM, and both renderers above
  // bind listeners to its buttons and read its fields. Two overlapping requests
  // would share it: the second would overwrite the first's text, and a single
  // click would resolve both — the user approving one action and unknowingly
  // approving another they never saw.
  //
  // This became reachable the moment the agent started running tools in
  // parallel. Requests that need a decision queue here and are answered in
  // turn, which is also the only honest way to ask.
  let _chain = Promise.resolve();
  function _enqueue(task) {
    const next = _chain.then(task, task);
    // The chain must never break on a rejection, or every later request hangs.
    _chain = next.then(() => {}, () => {});
    return next;
  }

  // Does the path, as written, name somewhere inside the project root?
  //
  // Separators are levelled first: a Windows path arrives with backslashes and
  // this compared only forward ones, so on Windows nothing was ever recognised
  // as being in the project and every single action raised a dialog.
  function spelledInsideProjectRoot(target) {
    if (!_projectRoot || !target) return false;
    const level = (s) => String(s).replace(/\\/g, '/').replace(/\/+$/, '');
    const root = level(_projectRoot);
    const norm = level(target);
    return norm === root || norm.startsWith(root + '/');
  }

  // Returns true if the path really leads inside the current project root.
  //
  // The spelling is only the first half of the question. A symlink inside the
  // project is written exactly like a path inside the project, so comparing the
  // two strings — which is all this used to do — auto-approved reading, writing,
  // listing and searching anywhere on the disk the link happened to lead, with
  // no dialog at all. The renderer cannot resolve a link, so Rust is asked.
  //
  // Anything that cannot be answered falls through to the dialog rather than
  // being allowed or refused outright: the guard's job here is to decide whether
  // the user needs to see this, and "ask" is the safe answer to a question with
  // no answer.
  async function isInProjectRoot(target) {
    if (!spelledInsideProjectRoot(target)) return false;
    if (!HC.isTauri) return true; // browser build: nothing here can resolve a link
    try {
      return (await HC.invoke('fs_path_inside_root', { root: _projectRoot, path: target })) === true;
    } catch {
      return false;
    }
  }

  // Read-only actions inside the project root need no dialog — the user chose
  // that folder, and asking per file would make the agent unusable.
  //
  // Outside it, a read is NOT free and is no longer auto-approved. "It only
  // reads" is a fair argument about the filesystem and a bad one about an
  // agent whose whole purpose is to send what it reads to a provider: a
  // prompt-injected model could read anything on disk and put it in its next
  // request, and the user would never see a prompt. Write, patch, delete and
  // shell were always gated; reads now join them.
  const AUTO_APPROVE_IN_ROOT = new Set(['read', 'list', 'search', 'write', 'patch']);

  // Directory of a path, for coarse session grants.
  function parentDir(target) {
    const norm = String(target || '').replace(/\/+$/, '');
    const cut = norm.lastIndexOf('/');
    return cut > 0 ? norm.slice(0, cut) : norm;
  }

  // Scheme and host, with no path, query or fragment:
  // `https://example.com/a/b?q=1` → `https://example.com`.
  function originOf(url) {
    const s = String(url || '');
    const scheme = s.indexOf('://');
    if (scheme === -1) return '';
    const hostAt = scheme + 3;
    let end = s.length;
    for (const ch of ['/', '?', '#']) {
      const at = s.indexOf(ch, hostAt);
      if (at !== -1 && at < end) end = at;
    }
    // A scheme with no host grants nothing.
    return end > hostAt ? s.slice(0, end) : '';
  }

  // How far a session grant reaches.
  //
  // A fetch target is a URL, not a path, and taking its "containing folder"
  // was wrong in a way that got worse the shorter the URL was: an address with
  // no path at all has its last `/` inside `https://`, so granting one bare
  // domain for the session cut the scope back to `https:/` — and every https
  // address on the internet then matched it, silently, for the rest of the
  // session. The one thing the fetch dialog exists to stop is an address the
  // model chose carrying out what it has just read.
  //
  // A host is also what the dialog appears to be asking about, so this is what
  // the user thinks they are granting.
  function grantScope(action, target) {
    return action === 'fetch' ? originOf(target) : parentDir(target);
  }

  function hasSessionDirGrant(action, target) {
    const dirs = _sessionDirs.get(action);
    if (!dirs) return false;
    // A granted host covers that host and nothing else. Matched whole, not by
    // prefix, so `https://example.com` cannot also cover
    // `https://example.com.elsewhere.test`.
    if (action === 'fetch') {
      const origin = originOf(target);
      return !!origin && dirs.has(origin);
    }
    const norm = String(target || '').replace(/\/+$/, '');
    for (const dir of dirs) {
      if (norm === dir || norm.startsWith(dir + '/')) return true;
    }
    return false;
  }

  function addSessionDirGrant(action, target) {
    const scope = grantScope(action, target);
    // Nothing to grant — an unparseable target stays exact, so the next one
    // asks again rather than being covered by a scope that means nothing.
    if (!scope) return;
    if (!_sessionDirs.has(action)) _sessionDirs.set(action, new Set());
    _sessionDirs.get(action).add(scope);
  }

  HC.guard = {
    // Set the current project root — all paths inside are auto-approved for safe actions
    setProjectRoot(path) {
      _projectRoot = path || null;
      // Pre-seed session so the agent never has to wait for a dialog within the project
      if (_projectRoot) {
        auditLog('allow-project-root', 'project', _projectRoot);
      }
    },

    clearProjectRoot() {
      _projectRoot = null;
    },

    // Request permission for an action. Returns true if approved.
    async request(action, target, reason = '') {
      // Hard-blocked — reject immediately, no dialog
      if (isHardBlocked(action, target)) {
        auditLog('deny-hard', action, target);
        HC.guard.notify(`Blocked: ${action} on protected path`, 'danger');
        return false;
      }

      // Auto-approve read/list/search/write/patch inside the open project root —
      // the user already chose this folder. "Inside" means where the path really
      // leads, not how it is spelled, so a link out of the project still asks.
      if (AUTO_APPROVE_IN_ROOT.has(action) && await isInProjectRoot(target)) {
        auditLog('allow-project-root', action, target);
        return true;
      }

      const key = `${action}::${target}`;

      // Everything from here can need the dialog, so it runs inside the queue —
      // and re-reads the session state on entry rather than before waiting.
      //
      // That re-read matters now the agent runs tools in parallel. Three reads
      // of the same folder arrive at once; all three would check for a grant,
      // find none, and queue a dialog. The user then answers "allow for
      // session" and is asked twice more for a folder they just granted.
      // Deciding on entry means a grant made while a request waited is honoured.
      return _enqueue(async () => {
        if (_session.has(key)) {
          const prev = _session.get(key);
          auditLog(prev, action, target);
          return prev === 'allow';
        }
        if (action !== 'shell' && hasSessionDirGrant(action, target)) {
          auditLog('allow-session-dir', action, target);
          return true;
        }

        const choice = await showDialog(action, target, reason);
        auditLog(choice, action, target);

        if (choice === 'allow-session') {
          _session.set(key, 'allow');
          // Grant the containing folder too, so the next file in it does not
          // re-ask. A shell command has no containing folder — it stays exact.
          if (action !== 'shell') addSessionDirGrant(action, target);
          return true;
        }
        if (choice === 'deny') {
          _session.set(key, 'deny');
          return false;
        }
        // allow-once — don't remember
        return true;
      });
    },

    /**
     * Say that something the user allowed is now happening.
     *
     * Approving a fetch releases the request, and the page is then actually
     * retrieved — which takes as long as it takes. Nothing said so, so the
     * pause after clicking Allow read as the app hanging on the click. The bar
     * stays up and says what it is doing instead.
     *
     * Returns a handle; call done() when the work finishes. Overlapping jobs
     * are counted, so two fetches do not leave the bar up after one returns.
     */
    busy(label, action = 'fetch') {
      const job = { label: String(label || ''), action };
      _busy.push(job);
      paintBar();
      let settled = false;
      return {
        done() {
          if (settled) return;
          settled = true;
          const at = _busy.indexOf(job);
          if (at !== -1) _busy.splice(at, 1);
          paintBar();
        },
      };
    },

    // Clear all session-remembered permissions (allow-session / deny).
    // Does NOT affect the project-root auto-approval — only manually granted decisions.
    clearSession() {
      let count = _session.size;
      for (const dirs of _sessionDirs.values()) count += dirs.size;
      _session.clear();
      _sessionDirs.clear();
      auditLog('session-reset', 'permissions', `${count} session permission(s) cleared`);
      HC.guard.notify(`Session permissions reset (${count} cleared)`, 'info');
    },

    // Show a small toast notification in the app chrome
    notify(message, type = 'info') {
      const banner = document.getElementById('hc-guard-banner');
      if (!banner) return;
      banner.textContent = message;
      banner.className   = `hc-guard-banner hc-guard-banner--${type} open`;
      clearTimeout(banner._t);
      banner._t = setTimeout(() => banner.classList.remove('open'), 3200);
    },
  };
})();
