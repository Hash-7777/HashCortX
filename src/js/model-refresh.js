// ==============================================================
// Keeping the model lists current without anyone asking
//
// THE DEFECT THIS REPLACES. Every provider was asked what models it has
// exactly once, as the app started, and then never again for the rest of the
// session. Nothing else asked: only changing a key, changing the host, or
// pressing Reload models did. So an app opened a moment before the network
// came up, or while a provider was rate-limiting, spent the whole session on
// the list written into src/data/cloud-models.js — models chosen by hand,
// months ago, several of which no longer exist. The person saw a full menu,
// picked from it, and got a failure that read as the app being broken.
//
// An app left open for days had the same problem from the other end: a model
// retired yesterday was still on the menu, because nothing asked again.
//
// WHAT HAPPENS INSTEAD. The lists are asked for again on their own: on a
// timer while the app is open, when the window comes back to the front, and
// the moment the machine reports it is online again. A provider that failed
// is asked again sooner than one that answered.
//
// THIS IS NEARLY FREE, and that is by design rather than by luck. Asking again
// goes through js/cloud-catalogue.js, which keeps each provider's answer for
// the key it was asked with — so a provider that answered is not asked a
// second time, there is no request, and nothing is sent. Only a provider whose
// list did NOT arrive is really asked again, and that one waits out its own
// pause first. Coming back to the window a hundred times costs nothing.
//
// A pass is never allowed closer than MIN_GAP_MS to the one before it, so a
// window being dragged between screens, or a machine flapping on and off a
// network, cannot turn into a stream of requests.
//
// Pure of the DOM: what it listens to and what it calls are passed in, so
// scripts/checks/model-refresh.mjs runs the real schedule against a clock it
// controls. Published as window.HCModelRefresh.
// ==============================================================

(function () {
  'use strict';

  /** How often the lists are asked for again while the app is open. */
  const EVERY_MS = 30 * 60 * 1000;
  /** How soon after a pass where a provider failed the next one comes. */
  const RETRY_MS = 3 * 60 * 1000;
  /** The closest two passes may ever be, whatever asked for them. */
  const MIN_GAP_MS = 20 * 1000;

  /**
   * deps:
   *   refresh   () => Promise, asks every provider again (cached ones cost nothing)
   *   failed    () => whether the last pass left any provider without a list
   *   on        (event, handler) => void, how to listen — window or document
   *   now       () => the time in milliseconds
   *   setTimer  (fn, ms) => id
   *   clearTimer(id) => void
   */
  function create(deps) {
    const now = deps.now || (() => Date.now());
    const setTimer = deps.setTimer || ((fn, ms) => setTimeout(fn, ms));
    const clearTimer = deps.clearTimer || ((id) => clearTimeout(id));
    let lastAt = 0;
    let timer = null;
    let running = false;
    let stopped = false;

    /**
     * Ask again, unless a pass is already in flight or one finished moments
     * ago. `why` is only for the caller's own reporting.
     */
    async function pass(why) {
      if (stopped || running) return 'skipped';
      if (lastAt && now() - lastAt < MIN_GAP_MS) return 'too-soon';
      running = true;
      lastAt = now();
      try {
        await deps.refresh();
      } catch {
        // A provider that could not be reached is not an error here: the
        // catalogue records it, and the next pass asks again. There is nothing
        // to tell the person, because nothing they did failed.
      } finally {
        running = false;
        schedule();
      }
      return why || 'done';
    }

    /** The next pass, sooner when the last one left a provider without a list. */
    function schedule() {
      if (stopped) return;
      if (timer !== null) clearTimer(timer);
      const wait = deps.failed && deps.failed() ? RETRY_MS : EVERY_MS;
      timer = setTimer(() => { timer = null; pass('timer'); }, wait);
    }

    function start() {
      stopped = false;
      // Coming back to the window, and the machine saying it is online again,
      // are the two moments a stale list is most likely to be about to matter.
      deps.on('focus', () => pass('focus'));
      deps.on('online', () => pass('online'));
      deps.on('visibilitychange', () => pass('visible'));
      schedule();
    }

    function stop() {
      stopped = true;
      if (timer !== null) { clearTimer(timer); timer = null; }
    }

    return { start, stop, pass, schedule, lastAt: () => lastAt };
  }

  window.HCModelRefresh = { create, EVERY_MS, RETRY_MS, MIN_GAP_MS };
})();
