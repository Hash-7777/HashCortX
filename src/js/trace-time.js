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

  window.HCTraceTime = { format, since };
})();
