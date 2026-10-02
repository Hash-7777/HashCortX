// ==============================================================
// The steps of a HashCoder run, as the reply shows them
//
// Every tool call and every file change is a step: a short line on a dashed
// rail while the run works, with a dot that fills when the step is done and
// turns red when it failed, and whatever the step returned folded under it.
// When the run ends each list folds to one line, "12 steps", that opens it
// again; the changes the run made are gathered under the answer, each with
// Keep and Undo, so folding never hides a question still waiting for the
// person. What the model says between steps sits between lists, where it
// said it.
//
// Steps are <details>, so opening one works from the keyboard as it is.
// stepsLine and changesTitle are pure; the rest draws into the panel.
//
// Loaded before the Coder mode and published as window.HCCodeSteps.
// Checked by scripts/checks/code-steps.mjs.
// ==============================================================

(function () {
  'use strict';

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /** The line a run's steps fold to when it ends: "12 steps", "3 steps · 1 failed". */
  function stepsLine(count, failed = 0) {
    const n = Math.max(0, Number(count) || 0), f = Math.max(0, Number(failed) || 0);
    return `${n} step${n === 1 ? '' : 's'}${f ? ` · ${f} failed` : ''}`;
  }

  /**
   * How many steps a list held: those still in it and the changes gathered out
   * of it below the answer. The run's own count (the one a stop says, "Stopped
   * after 26 steps") takes a change for a step, so the line does.
   */
  const stepsHeld = (listed, gathered = 0) => Math.max(0, Number(listed) || 0) + Math.max(0, Number(gathered) || 0);

  /** The heading over a run's changes. */
  const changesTitle = (count) => `${count === 1 ? '1 change' : `${count} changes`} — keep or undo`;

  /**
   * The list a step joins in a reply: the one the reply ends with, or a new
   * one, which folds and opens from its heading once the run has ended.
   */
  function listFor(contentEl) {
    const last = contentEl.lastElementChild;
    if (last && last.classList.contains('cdr-steps') && !last.classList.contains('done')) return last.querySelector('.cdr-steps-list');
    const group = document.createElement('div');
    group.className = 'cdr-steps';
    group.innerHTML = '<button type="button" class="cdr-steps-h" aria-expanded="true"></button><div class="cdr-steps-list"></div>';
    const head = group.querySelector('.cdr-steps-h');
    head.addEventListener('click', () => head.setAttribute('aria-expanded', String(group.classList.toggle('open'))));
    contentEl.appendChild(group);
    return group.querySelector('.cdr-steps-list');
  }

  /**
   * One step: verb, object and result, in the order the question comes in.
   * `status` is HTML the caller built (a time, or Keep and Undo); `flat`
   * puts the step straight into `contentEl` rather than into a run's list.
   */
  function add(contentEl, { verb, object, status, statusClass = '', open = false, flat = false } = {}) {
    if (!contentEl) return null;
    const el = document.createElement('details');
    el.className = 'cdr-step' + (statusClass ? ' ' + statusClass : '');
    el.open = open;
    el.innerHTML = `
        <summary class="cdr-step-head">
          <span class="cdr-step-verb">${esc(verb)}</span>
          <span class="cdr-step-object" title="${esc(object)}">${esc(object)}</span>
          <span class="cdr-step-result">${status || ''}</span>
        </summary>
        <div class="cdr-step-body"></div>`;
    (flat ? contentEl : listFor(contentEl)).appendChild(el);
    return el;
  }

  /** A reply whose run has ended: each list folded to its line, and the changes gathered under it. */
  function settle(contentEl) {
    if (!contentEl) return;
    const changed = [...contentEl.querySelectorAll('.cdr-steps-list > .cdr-step--change')];
    const gatheredFrom = new Map();
    changed.forEach((c) => gatheredFrom.set(c.parentElement, (gatheredFrom.get(c.parentElement) || 0) + 1));
    if (changed.length) {
      const box = document.createElement('div');
      box.className = 'cdr-changes';
      box.innerHTML = `<div class="cdr-changes-title">${esc(changesTitle(changed.length))}</div>`;
      changed.forEach((c) => box.appendChild(c));
      contentEl.appendChild(box);
    }
    contentEl.querySelectorAll('.cdr-steps:not(.done)').forEach((group) => {
      const steps = group.querySelectorAll('.cdr-steps-list > .cdr-step');
      if (!steps.length) { group.remove(); return; }
      group.classList.add('done');
      const head = group.querySelector('.cdr-steps-h');
      head.setAttribute('aria-expanded', 'false');
      head.textContent = stepsLine(stepsHeld(steps.length, gatheredFrom.get(group.querySelector('.cdr-steps-list'))), group.querySelectorAll('.cdr-steps-list > .cdr-step--err').length);
    });
  }

  window.HCCodeSteps = { stepsLine, stepsHeld, changesTitle, listFor, add, settle };
})();
