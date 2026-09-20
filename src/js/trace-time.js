// ==============================================================
// How long into a run a trace line was written
//
// Every trace in the app stamped its lines in seconds and nothing else, so a
// Swarm run twenty minutes in read [1160.0s] and had to be divided in the
// head. The stamp now reads like a stopwatch: seconds while a run is under a
// minute, then minutes and seconds, then hours, minutes and seconds.
//
//   42.5s      under a minute
//   19:20.0    under an hour
//   1:02:03.4  an hour or more
//
// Tenths are cut, not rounded, as a stopwatch does, so a run is never shown
// as having reached a minute before it has.
//
// WHERE THE ZERO IS. A stamp is only meaningful against the moment the work
// began. Every trace here used to keep its own start time in a variable set
// when its module loaded, and a mode that forgot to reset it stamped against
// the moment the app opened instead — so the first line of a run started
// after lunch read as hours in. `clock()` removes the way that happens: a
// clock that has not been started starts itself on its first stamp, so the
// worst a forgotten reset can do is begin the count at the run's first line,
// which is where it belongs anyway. A run calls reset() as it starts.
//
// Loaded before the modes and published as window.HCTraceTime.
// Checked by scripts/checks/trace-time.mjs.
// ==============================================================

(function () {
  'use strict';

  const pad2 = (n) => String(n).padStart(2, '0');

  /** Seconds as a stopwatch shows them. */
  function format(seconds) {
    const s = Number(seconds);
    // The small allowance keeps a value like 12.3, which is 122.999… tenths
    // in floating point, from reading a tenth short.
    const tenths = Number.isFinite(s) && s > 0 ? Math.floor(s * 10 + 1e-6) : 0;
    const tenth = tenths % 10;
    const whole = Math.floor(tenths / 10);
    const h = Math.floor(whole / 3600);
    const m = Math.floor(whole / 60) % 60;
    const sec = whole % 60;
    if (whole < 60) return `${whole}.${tenth}s`;
    if (h === 0) return `${m}:${pad2(sec)}.${tenth}`;
    return `${h}:${pad2(m)}:${pad2(sec)}.${tenth}`;
  }

  /** The stamp for a line written now, in a run that started at `startMs`. */
  function since(startMs, nowMs = Date.now()) {
    return format((Number(nowMs) - Number(startMs)) / 1000);
  }

  /**
   * A run's stopwatch.
   *
   * Zero is the first line stamped after the last reset. Nothing here reads
   * the moment the module loaded, so a stamp can never be a measure of how
   * long the app has been open.
   */
  function clock() {
    let startMs = null;
    return {
      /** Begin the count now, or at a moment already known. */
      start(ms = Date.now()) { startMs = Number(ms); return startMs; },
      /** Begin again: the next line stamped is this run's zero. */
      reset() { startMs = null; },
      /** The stamp for a line written now. The first one starts the clock. */
      stamp(nowMs = Date.now()) {
        return format(this.seconds(nowMs));
      },
      /**
       * How far into the run it is, in seconds. For a trace that keeps the
       * number with the line and formats it when drawn, so a reopened session
       * shows the times the run actually had.
       */
      seconds(nowMs = Date.now()) {
        if (startMs === null) startMs = Number(nowMs);
        return (Number(nowMs) - startMs) / 1000;
      },
      /** When the count began, or null while it has not. */
      startedAt() { return startMs; },
    };
  }

  window.HCTraceTime = { format, since, clock };
})();
