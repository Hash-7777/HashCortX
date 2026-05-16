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

  // Project root — paths inside are auto-approved for read/list/search/write/patch
  let _projectRoot = null;

  // Hard-blocked paths (mirrors the Rust denylist for early JS rejection)
  const BLOCKED_PREFIXES = [
    '/System', '/usr/bin', '/usr/sbin', '/etc', '/bin', '/sbin',
    '/private/etc', '/Library/Keychains',
  ];
  const BLOCKED_SUBSTRINGS = ['.ssh', '.aws', '.gnupg', 'id_rsa', 'id_ed25519', 'Keychains'];
  const BLOCKED_COMMANDS   = ['sudo', 'rm -rf', 'rm -fr', 'rm -r ', 'dd ', 'mkfs', 'format ', 'shutdown', 'reboot'];
  // Pipe-to-shell: executing downloaded content directly in an interpreter.
  const BLOCKED_PIPE_SHELL = ['| sh', '| bash', '| zsh', '| fish', '| python', '| node', '| perl', '| ruby'];
  // Process substitution: bash <(curl ...) or sh <(curl ...)
  const BLOCKED_PROC_SUB   = ['bash <(', 'sh <(', 'zsh <('];

  function isPipeToShell(cmd) {
    return BLOCKED_PIPE_SHELL.some(p => cmd.includes(p)) ||
           BLOCKED_PROC_SUB.some(p => cmd.includes(p));
  }

  function isRmDestructive(cmd) {
    // Catch `rm` with recursive (-r/-R/--recursive) AND force (-f/--force) in any order/form.
    if (!/(?:^|\s)rm(?:\s|$)/.test(cmd)) return false;
    const hasRecursive = /(?:\s|^)-[a-zA-Z]*[rR][a-zA-Z]*|\s--recursive/.test(cmd);
    const hasForce     = /(?:\s|^)-[a-zA-Z]*f[a-zA-Z]*|\s--force/.test(cmd);
    return hasRecursive && hasForce;
  }

  function isHardBlocked(action, target) {
    if (action === 'shell') {
      const lower = target.toLowerCase();
      if (isRmDestructive(lower)) return true;
      if (isPipeToShell(lower))   return true;
      return BLOCKED_COMMANDS.some(b => lower.includes(b));
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

  // Route to inline alert (coder mode) or modal (everything else)
  function showDialog(action, target, reason) {
    return isCdrActive()
      ? showInlineAlert(action, target, reason)
      : showModal(action, target, reason);
  }

  // Returns true if target path is inside the current project root
  function isInProjectRoot(target) {
    if (!_projectRoot || !target) return false;
    const root = _projectRoot.replace(/\/+$/, '');
    const norm = target.replace(/\/+$/, '');
    return norm === root || norm.startsWith(root + '/');
  }

  // Read-only actions are safe anywhere (no data modified, no dialog needed)
  const AUTO_APPROVE_READS   = new Set(['read', 'list', 'search']);
  // Write/patch/delete/shell still require approval outside the project root
  const AUTO_APPROVE_IN_ROOT = new Set(['read', 'list', 'search', 'write', 'patch']);

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

      // Read-only actions (list, read, search) are always auto-approved — no data is modified
      if (AUTO_APPROVE_READS.has(action)) {
        auditLog('allow-read', action, target);
        return true;
      }

      // Auto-approve write/patch inside the open project root — user already chose this folder
      if (AUTO_APPROVE_IN_ROOT.has(action) && isInProjectRoot(target)) {
        auditLog('allow-project-root', action, target);
        return true;
      }

      // Session memory — already decided
      const key = `${action}::${target}`;
      if (_session.has(key)) {
        const prev = _session.get(key);
        auditLog(prev, action, target);
        return prev === 'allow';
      }

      // Show dialog
      const choice = await showDialog(action, target, reason);
      auditLog(choice, action, target);

      if (choice === 'allow-session') {
        _session.set(key, 'allow');
        return true;
      }
      if (choice === 'deny') {
        _session.set(key, 'deny');
        return false;
      }
      // allow-once — don't remember
      return true;
    },

    // Clear all session-remembered permissions (allow-session / deny).
    // Does NOT affect the project-root auto-approval — only manually granted decisions.
    clearSession() {
      const count = _session.size;
      _session.clear();
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
