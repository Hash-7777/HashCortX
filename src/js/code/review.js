// ==============================================================
// A second look at HashCoder's work, with a clean slate
//
// A model reviewing its own work in the conversation that produced it tends
// to approve it: it reads what it meant rather than what it wrote. A reviewer
// shown only the request, the changes and what was run to check them, with
// none of the conversation, finds what the first pass missed. So after a
// larger change by a large model, HashCoder asks the same model once more,
// as a reviewer, and when it finds problems the agent is sent back once with
// them (js/code/verify.js freshReviewNote). A small or mid-sized model on
// this computer checks its work against the request instead (verify.js
// reviewCheck), since a second call costs it minutes. What the reviewer is
// shown goes to the model the run already uses, and nothing else.
//
// Pure: takes strings and records, returns strings and records.
//
// Loaded before the Coder mode and published as window.HCCodeReview.
// Checked by scripts/checks/code-review.mjs.
// ==============================================================

(function () {
  'use strict';

  /** Changed lines below which a change to one file gets no second look. */
  const MIN_LINES = 30;
  /** Characters of changes the reviewer is shown, at most. */
  const MAX_SHOWN = 24000;
  /** Lines kept around each change. */
  const AROUND = 3;

  const INSTRUCTIONS = `You review a change a coding agent made to a project, with a clean slate: you are shown only what the person asked for, the changes, and what was run to check them.

Look for: something the request asks for that the changes do not do; a mistake that would make the code fail or behave wrongly; a change the request did not ask for; placeholder or unfinished code; a test or check changed so that it passes, rather than the code fixed.
Do not ask for changes of style, names or more tests unless the request wants them. Report only what you are sure of from what you are shown.

Answer in one of two ways and nothing else. Either the one line
LOOKS RIGHT
or
PROBLEMS:
- one line for each problem, naming the file and what is wrong`;

  /**
   * Keeps, for each file a run changed, what it held before the run and what
   * it holds now. `record` is the file's latest undo record (its content
   * before that change, and `after`).
   */
  function track(changes, path, record) {
    if (!changes || !path) return changes;
    const after = record && typeof record.after === 'string' ? record.after : null;
    const unreadable = !record || !!record.unrestorable;
    const had = changes.get(path);
    if (!had) changes.set(path, { before: record && record.existed ? record.content : null, after, unreadable });
    else { had.after = after; had.unreadable = had.unreadable || unreadable; }
    return changes;
  }

  /**
   * The changes as the reviewer reads them: for each file, its changed lines
   * marked + and - with a few around them, and how many lines changed in
   * all. `diffLines` is js/diff.js's.
   */
  function diffText(changes, diffLines, max = MAX_SHOWN) {
    const parts = [];
    let changed = 0;
    for (const [path, c] of changes || []) {
      if (c.unreadable) { parts.push(`--- ${path}\n(not shown: not a text file the app keeps a copy of)`); continue; }
      const rows = diffLines(c.before || '', c.after || '');
      const near = new Uint8Array(rows.length);
      rows.forEach((r, i) => {
        if (r.type === 'same') return;
        changed++;
        for (let k = Math.max(0, i - AROUND); k <= Math.min(rows.length - 1, i + AROUND); k++) near[k] = 1;
      });
      if (!near.some(Boolean)) continue;
      const head = c.before == null ? `--- ${path} (new)` : c.after === '' ? `--- ${path} (deleted)` : `--- ${path}`;
      const lines = [head];
      let gap = false;
      rows.forEach((r, i) => {
        if (!near[i]) { gap = true; return; }
        if (gap) { lines.push('…'); gap = false; }
        lines.push(`${r.type === 'add' ? '+' : r.type === 'del' ? '-' : ' '} ${r.text}`);
      });
      parts.push(lines.join('\n'));
    }
    let text = parts.join('\n\n');
    if (text.length > max) text = `${text.slice(0, max)}\n… (the rest of the changes are not shown)`;
    return { text, changed, files: (changes && changes.size) || 0 };
  }

  /**
   * Whether this run's work gets a second look: a model that is not small or
   * mid-sized (`size`), with proving switched on (`prove`), not yet sent back
   * by a review (`reviewed`), after changes to more than one file or of at
   * least MIN_LINES lines.
   */
  function worthReview({ size, prove = true, files = 0, changed = 0, reviewed = 0 } = {}) {
    return size === 'full' && prove !== false && !reviewed && (files > 1 || changed >= MIN_LINES);
  }

  /** What the reviewer is sent: the instructions, and the request, the proof and the changes. */
  function messages(request, proof, shown) {
    return [
      { role: 'system', content: INSTRUCTIONS },
      { role: 'user', content: `The request:\n${String(request || '').trim()}\n\nWhat was run after the changes: ${proof || 'nothing was run'}\n\nThe changes:\n${shown}` },
    ];
  }

  /**
   * What the reviewer said: `{ ok: true }`, or `{ ok: false, problems }`. An
   * answer that is empty, or not in either form, is not a finding, so a
   * reviewer that did not do the job never holds a run up.
   */
  function verdict(text) {
    const t = String(text || '').trim();
    const m = /(?:^|\n)\s*\**PROBLEMS:?\**\s*\n?([\s\S]*)$/i.exec(t);
    if (!m) return { ok: true };
    const problems = m[1].split('\n').map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim())
      .filter((l) => l && !/^(none|nothing|no problems?( found)?|n\/a)\.?$/i.test(l)).slice(0, 8);
    return problems.length ? { ok: false, problems } : { ok: true };
  }

  window.HCCodeReview = { MIN_LINES, MAX_SHOWN, INSTRUCTIONS, track, diffText, worthReview, messages, verdict };
})();
