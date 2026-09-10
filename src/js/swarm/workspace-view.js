// ==============================================================
// What the Swarm Workspace shows, worked out without a page
//
// The Workspace draws a kept run (src/js/swarm/runs.js) as a conversation and
// a set of files. Deciding who each turn is from, what its status reads as,
// the order the file tabs come in, how long ago something happened and what
// changed in a file between two versions is kept here, apart from the
// drawing, so it can be checked on its own. Line differences come from
// src/js/diff.js, the same diff the Coder shows.
//
// Pure: takes a run, returns plain values. No DOM, no storage, no network.
//
// Loaded before the Agent Swarm and published as window.HCSwarmWorkspaceView.
// Checked by scripts/checks/swarm-workspace.mjs.
// ==============================================================

(function () {
  'use strict';

  const STATUS_LABEL = { ok: '', error: 'Failed', skipped: 'Did not run' };

  /** Who a turn is from, and how it reads. */
  function turnView(run, turn) {
    const who = String(turn?.who || '');
    const base = { who, text: String(turn?.text ?? ''), status: turn?.status || 'ok', statusLabel: STATUS_LABEL[turn?.status] || '' };
    if (who === 'you') return { ...base, kind: 'you', name: 'You', icon: '', role: '' };
    if (who === 'team') return { ...base, kind: 'team', name: 'Team result', icon: '', role: 'result' };
    const agent = (run?.agents || []).find((a) => a.id === who);
    return { ...base, kind: 'agent', name: agent?.name || who || 'Agent', icon: agent?.icon || '', role: agent?.role || '' };
  }

  /** Every turn of a run, ready to draw. */
  function turnsView(run) {
    return (run?.turns || []).map((t) => turnView(run, t));
  }

  /**
   * The order file tabs come in: the page first, then other pages, styles,
   * scripts, and the rest by name — the order a person reads a site in.
   */
  function fileOrder(names) {
    const rank = (n) => (n === 'index.html' ? 0 : /\.html?$/.test(n) ? 1 : /\.css$/.test(n) ? 2 : /\.(m?js|jsx|ts|tsx)$/.test(n) ? 3 : 4);
    return [...(names || [])].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  }

  /** Whether a run has a page that can be previewed. */
  function hasPage(files) {
    return Object.entries(files || {}).some(([name, f]) => /\.html?$/i.test(name) || f?.lang === 'html');
  }

  /** "just now", "5 min ago", "3 h ago", "2 days ago", or the date. */
  function timeAgo(then, now) {
    const s = Math.max(0, Math.round((now - then) / 1000));
    if (s < 45) return 'just now';
    const m = Math.round(s / 60);
    if (m < 60) return `${m} min ago`;
    const h = Math.round(m / 60);
    if (h < 24) return `${h} h ago`;
    const d = Math.round(h / 24);
    if (d < 7) return `${d} day${d === 1 ? '' : 's'} ago`;
    return new Date(then).toISOString().slice(0, 10);
  }

  /** How a run is named in the list of past runs. */
  function runLabel(run, now) {
    const task = String(run?.task || '').replace(/\s+/g, ' ').trim();
    const short = task.length > 48 ? task.slice(0, 47) + '…' : task || 'Untitled run';
    return `${short} · ${timeAgo(run?.startedAt || 0, now)}`;
  }

  /** How a version is named in the version picker. */
  function versionLabel(run, version) {
    const by = version?.by === 'team' ? 'the team' : (run?.agents || []).find((a) => a.id === version?.by)?.name || version?.by || '';
    const n = (version?.changed || []).length;
    return `v${version?.rev} · ${by}${n ? ` · ${n} file${n === 1 ? '' : 's'}` : ''}`;
  }

  /** Whether a turn is long enough to start folded. */
  function startsFolded(text) {
    const t = String(text || '');
    return t.length > 1400 || t.split('\n').length > 24;
  }

  /** The versions the one on screen can be compared with: every other, newest first. */
  function compareChoices(run, rev) {
    return (run?.versions || []).filter((v) => v.rev !== rev).slice().reverse()
      .map((v) => ({ rev: v.rev, label: `Compare with ${versionLabel(run, v)}` }));
  }

  /**
   * What changed in one file from one version to another: the lines, with
   * long unchanged stretches folded, and how many were added and removed. A
   * file a version does not have compares as empty, so all of it reads as new.
   */
  function fileChanges(beforeFile, afterFile) {
    const D = window.HCDiff;
    const rows = D.diffLines(beforeFile ? beforeFile.content : '', afterFile ? afterFile.content : '');
    const { added, removed } = D.countChanges(rows);
    return { rows: D.collapseUnchanged(rows, 3), added, removed, missingBefore: !beforeFile, missingAfter: !afterFile };
  }

  window.HCSwarmWorkspaceView = {
    turnView, turnsView, fileOrder, hasPage, timeAgo, runLabel, versionLabel, startsFolded, compareChoices, fileChanges,
  };
})();
