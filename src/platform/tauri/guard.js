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
  // ordinary work.
  const BLOCKED_CMD_PATHS = [
    '.ssh/', '.ssh ', '.aws/', '.gnupg/', 'id_rsa', 'id_dsa', 'id_ecdsa', 'id_ed25519',
    'library/keychains', '.netrc', '.npmrc', '.pypirc', '.docker/config.json',
    '.kube/config', '.config/gh/', '.config/gcloud', 'com.hashcortx.app', '.hashcortx/',
  ];

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
      return BLOCKED_CMD_PATHS.some(m => lower.includes(m));
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

  // Returns true when coder mode panel is currently visible
  function isCdrActive() {
    const msgs = document.getElementById('cdrMessages');
    return !!(msgs && msgs.offsetParent !== null);
  }

  // Inline alert shown above the coder mode textarea
  function showInlineAlert(action, target, reason) {
    return new Promise((resolve) => {
      // Prefer the new v1.6 strip, fall back to legacy alert
      const strip   = document.getElementById('cdrPermStrip');
      const legacy  = document.getElementById('cdrPermAlert');
      const alert   = strip || legacy;
      const actEl   = document.getElementById(strip ? 'cdrPermAction2' : 'cdrPermAction');
      const tgtEl   = document.getElementById(strip ? 'cdrPermTarget2'   : 'cdrPermTarget');
      const rsnEl   = document.getElementById(strip ? 'cdrPermReason2'   : 'cdrPermReason');
      const onceBtn = document.getElementById(strip ? 'cdrPermOnce2'     : 'cdrPermOnce');
      const sessBtn = document.getElementById(strip ? 'cdrPermSession2'  : 'cdrPermSession');
      const denyBtn = document.getElementById(strip ? 'cdrPermDeny2'     : 'cdrPermDeny');
      if (!alert || !actEl || !onceBtn) { resolve('deny'); return; }

      actEl.textContent = action.toUpperCase();
      actEl.className   = 'cdr-perm-badge ' + action;
      // Truncate long paths from the left so filename is always visible
      tgtEl.textContent = target.length > 72 ? '…' + target.slice(-(72)) : target;
      rsnEl.textContent = reason || '';
      alert.classList.add('visible');

      // Scroll composer into view so alert is visible
      alert.scrollIntoView?.({ block: 'nearest' });

      function cleanup(choice) {
        alert.classList.remove('visible');
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

  // Modal fallback for non-coder-mode contexts
  function showModal(action, target, reason) {
    return new Promise((resolve) => {
      const dlg     = document.getElementById('hc-perm-dialog');
      const actEl   = document.getElementById('hc-perm-action');
      const tgtEl   = document.getElementById('hc-perm-target');
      const rsnEl   = document.getElementById('hc-perm-reason');
      const onceBtn = document.getElementById('hc-perm-once');
      const sessBtn = document.getElementById('hc-perm-session');
      const denyBtn = document.getElementById('hc-perm-deny');
      if (!dlg) { resolve('deny'); return; }

      actEl.textContent = action.toUpperCase();
      tgtEl.textContent = target;
      rsnEl.textContent = reason || '';
      dlg.classList.add('open');

      function cleanup(choice) {
        dlg.classList.remove('open');
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

  // Route to inline alert (coder mode) or modal (everything else).
  function showDialog(action, target, reason) {
    return isCdrActive()
      ? showInlineAlert(action, target, reason)
      : showModal(action, target, reason);
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

  // Returns true if target path is inside the current project root
  function isInProjectRoot(target) {
    if (!_projectRoot || !target) return false;
    const root = _projectRoot.replace(/\/+$/, '');
    const norm = target.replace(/\/+$/, '');
    return norm === root || norm.startsWith(root + '/');
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

  function hasSessionDirGrant(action, target) {
    const dirs = _sessionDirs.get(action);
    if (!dirs) return false;
    const norm = String(target || '').replace(/\/+$/, '');
    for (const dir of dirs) {
      if (norm === dir || norm.startsWith(dir + '/')) return true;
    }
    return false;
  }

  function addSessionDirGrant(action, target) {
    if (!_sessionDirs.has(action)) _sessionDirs.set(action, new Set());
    _sessionDirs.get(action).add(parentDir(target));
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
      // the user already chose this folder.
      if (AUTO_APPROVE_IN_ROOT.has(action) && isInProjectRoot(target)) {
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
