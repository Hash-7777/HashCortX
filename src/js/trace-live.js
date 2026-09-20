// ==============================================================
// A trace line that keeps saying what is happening while it happens
//
// THE DEFECT THIS REPLACES. Every mode wrote a line like
//
//     Direct generation attempt 1 — openrouter:nvidia/nemotron-3-super-120b
//
// and then awaited the model. A big free model can sit in a shared queue for
// a minute or more before its first token, and for that whole minute the line
// said exactly what it said at the start. Nothing moved. There was no way to
// tell a model that was thinking from one that had died, a queue from a
// hang, or a run still going from a run that had quietly failed — so the only
// thing left to do was wait and wonder, and the app looked broken while it was
// working perfectly.
//
// WHAT IT SAYS, AND WHY EVERY WORD OF IT IS TRUE
// ----------------------------------------------
// This is not decoration, and it must never become decoration. Each phrase is
// tied to something that really happened:
//
//   "thinking"        the request is sent and not one byte has come back. For
//                     a reasoning model that is literally what it is doing.
//   "still thinking"  the same, long enough that somebody would start to
//                     wonder — so it says so rather than letting them wonder.
//   "queued"          the same again, on a free model big enough to sit in a
//                     shared queue. Named because it is the actual reason.
//   "writing"         bytes are arriving, and it counts them as they do.
//   "no answer yet"   close enough to the deadline that the next thing to
//                     happen is another model being tried. Says that too.
//
// Nothing here invents a stage a model is not at, and nothing here is a
// spinner pretending to be progress. If the count stops moving, that is the
// truth being shown.
//
// Pure of the DOM and of the clock: the caller passes a way to write a line,
// a clock and timers. Published as window.HCTraceLive.
// Checked by scripts/checks/trace-live.mjs.
// ==============================================================

(function () {
  'use strict';

  /** How often the line is rewritten while nothing else is happening. */
  const BEAT_MS = 1000;
  /** Before this, a pause is too short to be worth remarking on. */
  const SETTLING_MS = 8000;
  /** After this, somebody is wondering whether anything is happening at all. */
  const LONG_MS = 25000;
  /** The share of the deadline after which the next model is worth mentioning. */
  const NEARLY_OUT = 0.75;

  const seconds = (ms) => Math.floor(ms / 1000);

  /**
   * How a number of characters reads. Exact while it is small enough to watch
   * climb, rounded once it is not — a count flickering through six digits is
   * noise, not information.
   */
  function amount(chars) {
    if (chars < 1000) return `${chars} characters`;
    return `${(chars / 1000).toFixed(1)}k characters`;
  }

  /**
   * The words for one moment of one call.
   *
   * Separated from everything that moves — no clock, no timer, no element — so
   * every line this app shows while it waits can be read off in a test.
   */
  function phrase({ elapsedMs, chars, deadlineMs, queued }) {
    const s = seconds(elapsedMs);
    if (chars > 0) {
      return s >= SETTLING_MS / 1000
        ? `writing · ${amount(chars)} · ${s}s`
        : `writing · ${amount(chars)}`;
    }
    if (deadlineMs && elapsedMs >= deadlineMs * NEARLY_OUT) {
      const left = Math.max(0, seconds(deadlineMs - elapsedMs));
      return left > 0
        ? `no answer yet · ${s}s · trying another model in ${left}s`
        : `no answer yet · ${s}s · trying another model`;
    }
    if (elapsedMs >= LONG_MS) {
      return queued ? `queued on a shared free model · ${s}s` : `still thinking · ${s}s`;
    }
    if (elapsedMs >= SETTLING_MS) {
      return queued ? `queued · ${s}s` : `thinking · ${s}s`;
    }
    return 'thinking';
  }

  /**
   * Make one trace line live until whatever it describes has finished.
   *
   * deps:
   *   write(text)   put these words on the line — the mode knows how
   *   now()         the time in milliseconds
   *   setTimer/clearTimer
   *   deadlineMs    when the caller will give up on this model, if it will
   *   queued        whether this model is one that sits in a free queue
   *
   * The returned handle has `heard(chars)` for bytes arriving and `done()` for
   * the end. `done()` is what stops the timer, and every path out of a call
   * has to reach it — a line left live is a timer left running.
   */
  function create(deps) {
    const now = deps.now || (() => Date.now());
    const setTimer = deps.setTimer || ((fn, ms) => setInterval(fn, ms));
    const clearTimer = deps.clearTimer || ((id) => clearInterval(id));
    const startedAt = now();
    let chars = 0;
    let stopped = false;
    let timer = null;

    const paint = () => {
      if (stopped) return;
      deps.write(phrase({
        elapsedMs: now() - startedAt,
        chars,
        deadlineMs: deps.deadlineMs || 0,
        queued: !!deps.queued,
      }));
    };

    paint();
    timer = setTimer(paint, BEAT_MS);

    return {
      /** Bytes have arrived. `chars` is the total so far, not the increment. */
      heard(total) {
        if (stopped) return;
        const n = Number(total);
        if (Number.isFinite(n) && n > chars) chars = n;
        paint();
      },
      /** Finished, one way or another. Stops the line moving. */
      done() {
        if (stopped) return;
        stopped = true;
        if (timer !== null) { clearTimer(timer); timer = null; }
      },
      elapsedMs: () => now() - startedAt,
      chars: () => chars,
      stopped: () => stopped,
    };
  }

  /**
   * Put a live line on rows a mode has already drawn.
   *
   * Every trace in this app is the same shape — rows with a message span, and
   * a one-line summary above them — so the writing lives here rather than
   * being copied into each mode, which is how one of them ends up saying
   * something the others do not.
   *
   * `rows` is every copy of the line: the Systems trace draws two, one in the
   * panel and one in the drawer, and both have to move together.
   */
  function attach(rows, where, options = {}) {
    const list = (Array.isArray(rows) ? rows : [rows]).filter(Boolean);
    if (!list.length || !where || !where.selector) return { heard() {}, done() {} };
    const message = String(where.message || '');
    const cap = where.cap || 70;
    return create({
      write: (text) => {
        const line = message ? `${message} · ${text}` : text;
        for (const row of list) {
          const span = row.querySelector(where.selector);
          if (span) span.textContent = line;
        }
        const summary = typeof where.summary === 'function' ? where.summary() : where.summary;
        if (summary) summary.textContent = line.slice(0, cap);
      },
      ...options,
    });
  }

  /**
   * Whether a model is one that waits in a shared free queue.
   *
   * js/model-speed.js already works this out to decide what to ask first. The
   * same answer is what lets a waiting line say "queued" instead of leaving
   * somebody to wonder why a big free model is taking two minutes.
   */
  function queued(modelValue) {
    const S = window.HCModelSpeed;
    return !!S && typeof S.stateOf === 'function' && S.stateOf(modelValue) === 'likely-slow';
  }

  window.HCTraceLive = { create, attach, queued, phrase, amount, BEAT_MS, SETTLING_MS, LONG_MS, NEARLY_OUT };
})();
