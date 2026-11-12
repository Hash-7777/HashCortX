// ==============================================================
// A message sent while HashCoder works: what it is
//
// A message the person sends while a run works is read at the run's next
// step (js/queue.js takeNow). It can mean three things, and they want
// handling three ways: a correction to the work in hand ("no, not that
// file"), which should be read before anything else and send the step in
// work back to be done again; more for the work in hand ("also keep the old
// export"), read at the next step as today; or a new request that has
// nothing to do with the work in hand ("then write a README"), which should
// wait until the run ends rather than pull it off course.
//
// kindOf(text, facts) makes the first guess, with no model:
//
//   · correct: it says stop, wait, no, not that, undo, revert, don't,
//     do not, as a clause of its own, or instead or wrong anywhere;
//   · after: it asks for something (js/code/asks.js, the same test a
//     request's asks are found with) and shares no word with what the run is
//     working on: the request, the steps of the model's plan, or the files it
//     changed;
//   · add: anything else.
//
// The person's own choice always wins over this guess (the chooser on the
// queued message); the guess only decides what is chosen to begin with.
// Without the asks module nothing is ever taken as for after: a message is
// never held back on a guess that cannot be made.
//
// Pure. Loaded after js/code/asks.js, before the Coder mode, and published as
// window.HCCodeAdded. Checked by scripts/checks/code-added.mjs.
// ==============================================================

(function () {
  'use strict';

  /** The three ways a message sent while it works can be taken. */
  const KINDS = ['correct', 'add', 'after'];
  /** Each, in plain words. */
  const SAYS = {
    correct: 'A correction to the work in hand: read first, and the step in work is done again',
    add: 'More for the work in hand: read at its next step',
    after: 'A new request: held until this work ends, then sent',
  };

  /** Words that turn a message into a correction, as a clause of their own; and two that do anywhere. */
  const CORRECTS = /(?:^|[.!?;,:\n—–-]\s*)(?:(?:but|and|so|oh)\s+)?(?:stop|wait|no|not that|undo|revert|don't|dont|do not)\b/i;
  const ANYWHERE = /\b(?:instead|wrong)\b/i;

  /** A word too common to tie a message to the work. */
  const COMMON = new Set(('also then that this with from into onto your have will just make sure keep what when where which while would could should there their them they these those about after again more most much some such than very please thanks thank need want like good well work it\'s does done doing want wants whole same each every other another first last next later afterwards').split(' '));

  /** The words a text is written with that can tie it to a run: four letters or more, an identifier whole and in its parts. */
  function wordsOf(text) {
    const out = new Set();
    for (const m of String(text == null ? '' : text).matchAll(/[A-Za-z_][A-Za-z0-9_]*/g)) {
      const word = m[0];
      const parts = [word, ...word.split(/_+|(?<=[a-z0-9])(?=[A-Z])/)];
      for (const p of parts) {
        const w = p.toLowerCase();
        if (w.length >= 4 && !COMMON.has(w)) out.add(w);
      }
    }
    return out;
  }

  /** What a run is working on, as words: its request, its plan's steps, and the files it changed (their names and folders). */
  function runWords(facts) {
    const f = facts && typeof facts === 'object' ? facts : {};
    const files = (Array.isArray(f.changed) ? f.changed : []).map((p) => String(p).split(/[\\/]/).slice(-3).join(' ').replace(/\.[A-Za-z0-9]+$/, ''));
    return wordsOf([f.request || '', ...(Array.isArray(f.plan) ? f.plan : []), ...files].join('\n'));
  }

  /** "Then", "afterwards", "later": words that put a request after the work, not a request themselves. */
  const LEADING = /^\s*(?:(?:and\s+)?then|afterwards|after that|later|next|once you are done|when you are done)[\s,:]*/i;

  /** How a message sent while a run works is taken to begin with: 'correct', 'after' or 'add'. */
  function kindOf(text, facts) {
    const t = String(text == null ? '' : text).trim();
    if (!t) return 'add';
    if (CORRECTS.test(t) || ANYWHERE.test(t)) return 'correct';
    const A = typeof window !== 'undefined' && window.HCCodeAsks;
    if (!A || typeof A.isAsk !== 'function') return 'add';
    const asks = A.isAsk(t.replace(LEADING, '')) || A.isAsk(t);
    if (!asks) return 'add';
    const mine = wordsOf(t), theirs = runWords(facts);
    for (const w of mine) if (theirs.has(w)) return 'add';
    return 'after';
  }

  /**
   * The step of the model's plan a correction is about, open again: the step
   * in work, or with none in work the last one done, set back to todo.
   * `{ plan, step }` with a new plan; the plan given is not changed. No plan,
   * no step.
   */
  function reopen(plan) {
    const steps = plan && Array.isArray(plan.steps) ? plan.steps : [];
    let at = steps.findIndex((s) => s && s.status === 'doing');
    if (at < 0) for (let i = steps.length - 1; i >= 0; i--) if (steps[i] && steps[i].status === 'done') { at = i; break; }
    if (at < 0) return { plan: plan || null, step: null };
    return { plan: Object.assign({}, plan, { steps: steps.map((s, i) => (i === at ? Object.assign({}, s, { status: 'todo' }) : s)) }), step: steps[at].step };
  }

  /** The app's note after a correction: what it is about, and to check the work against it before going on. */
  function correctionNote(step) {
    return `Note from HashCortX, not from the person: the person's message above corrects the work in hand${step ? `, on the step of your plan "${step}", which is open again` : ''}. Check what you have done against it before you go on, and change what does not hold.`;
  }

  window.HCCodeAdded = { KINDS, SAYS, kindOf, reopen, correctionNote };
})();
