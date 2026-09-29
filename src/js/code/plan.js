// ==============================================================
// The plan HashCoder keeps for a request with several parts
//
// A request with several parts was often finished in part: one of three
// edits made, a page without the stylesheet it asked for. A model that
// lists the steps first and marks each one as it goes has the list in
// front of it at every step, not only at the start of a conversation that
// grows longer with every step. So update_plan keeps a short checklist, and
// the app reads it back at the end of each request the model is sent while
// steps are open. The reading is never saved into the conversation, so the
// start of the next request is unchanged and can be reused. Finishing with
// steps still open sends the model back once (js/code/verify.js).
//
// Pure: takes records, returns records and strings.
//
// Loaded before the Coder mode and published as window.HCCodePlan.
// Checked by scripts/checks/code-plan.mjs.
// ==============================================================

(function () {
  'use strict';

  const STATUS = ['todo', 'doing', 'done'];
  const MAX_STEPS = 12;
  const MARK = { todo: '[ ]', doing: '[>]', done: '[x]' };

  /** A step's status as the model wrote it, in one of the three words. */
  function statusOf(x) {
    const s = String((x && x.status) || '').toLowerCase().replace(/[\s-]+/g, '_');
    if (STATUS.includes(s)) return s;
    if (x && x.done === true) return 'done';
    if (/^(completed?|finished|complete)$/.test(s)) return 'done';
    if (/^(in_progress|doing|working|started|active)$/.test(s)) return 'doing';
    return 'todo';
  }

  /**
   * A plan from update_plan's arguments: `{ steps: [{ step, status }] }`, or
   * `{ error }` saying what the call should have held. A step may also be
   * written as a plain sentence.
   */
  function fromCall(args) {
    const raw = args && Array.isArray(args.steps) ? args.steps : args && Array.isArray(args.items) ? args.items : null;
    const steps = (raw || []).slice(0, MAX_STEPS).map((x) => ({
      step: String(typeof x === 'string' ? x : (x && (x.step ?? x.title ?? x.text)) || '').replace(/\s+/g, ' ').trim().slice(0, 160),
      status: typeof x === 'string' ? 'todo' : statusOf(x),
    })).filter((x) => x.step);
    if (!steps.length) return { error: 'update_plan needs steps: a list of { step, status }, the status todo, doing or done.' };
    return { steps };
  }

  /** The steps not yet done. */
  const openSteps = (plan) => (plan && Array.isArray(plan.steps) ? plan.steps.filter((x) => x.status !== 'done') : []);

  /** What update_plan answers the model. */
  function answer(plan) {
    const left = openSteps(plan).length;
    return JSON.stringify({
      ok: true, steps: plan.steps.length, open: left,
      note: left ? 'Work through the open steps and call update_plan again as each one is done.'
        : 'Every step is done. Check the work against the request, then finish.',
    });
  }

  /**
   * The plan read back to the model at the end of a request, or '' when
   * there is none or every step is done.
   */
  function recite(plan) {
    if (!openSteps(plan).length) return '';
    return ['Note from HashCortX, not from the person: your plan for this request, as you last set it:',
      ...plan.steps.map((x) => `${MARK[x.status]} ${x.step}`)].join('\n');
  }

  /** A few words for the person beside the step: "3 steps, 1 done". */
  function stepLine(args) {
    const plan = fromCall(args);
    if (plan.error) return '';
    const done = plan.steps.length - openSteps(plan).length;
    return `${plan.steps.length} step${plan.steps.length === 1 ? '' : 's'}, ${done} done`;
  }

  window.HCCodePlan = { STATUS, MAX_STEPS, fromCall, openSteps, answer, recite, stepLine };
})();
