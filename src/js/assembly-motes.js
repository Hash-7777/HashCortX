// ==============================================================
// The motes that gather to build a part
//
// When a part appears, a cloud of small points converges on it. That moment is
// the only thing in Forge that shows a model being *made* rather than simply
// appearing, so it is worth it being deliberate.
//
// What it used to do: scatter points at random over a sphere nine units across
// — most of it behind the camera and none of it near the part — then fly them
// in on random curves over one and a half to three and a half seconds, at full
// brightness the whole way, while the part itself faded in over three quarters
// of a second. So the points had no visible relationship to the part they
// belonged to, they were still drifting long after it had finished, and what a
// person saw was a field of dots hanging in the scene.
//
// What it does now, and why each rule is here:
//
//   · Motes start on a shell around the part they are building, sized to it.
//     Belonging to a part is the whole point; starting somewhere across the
//     scene reads as weather.
//   · They spiral rather than travel straight — the angle sweeps while the
//     radius closes — which is what makes a gathering look drawn in rather
//     than thrown.
//   · The radius closes slowly and then quickly. Hanging first and arriving
//     fast is what gives it its snap; a linear approach looks like drifting.
//   · They fade up as they set off, and out as they arrive, so a mote merges
//     into the part rather than winking out beside it.
//   · Every mote lands within the part's own reveal, so the part solidifies as
//     the last of them arrives. Two clocks that disagree is what made the old
//     one look like it was still loading.
//
// Positions are relative to the part, so the caller adds its own coordinates
// and this stays pure — the same seed gives the same gathering every time,
// which is what makes it checkable.
//
// Run the checks with: npm run check:assembly-motes
// ==============================================================
(function () {
  "use strict";

  const TAU = Math.PI * 2;

  /** A small deterministic generator, so a gathering can be replayed exactly. */
  function rng(seed) {
    let a = (seed >>> 0) || 1;
    return function next() {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
  /** Slow, then fast. The shape that makes an arrival feel like an arrival. */
  const easeInQuad = (t) => t * t;
  /** Fast, then slow — for the parts of the motion that should settle. */
  const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

  /**
   * Lay out one gathering.
   *
   * `total` is the whole window the part has to build in. Every mote's delay
   * plus its flight fits inside it, so nothing is still travelling once the
   * part is solid.
   */
  function planMotes(opts = {}) {
    const count = Math.max(0, Math.floor(Number(opts.count) || 0));
    const radius = Number(opts.radius) > 0 ? Number(opts.radius) : 1;
    const total = Number(opts.total) > 0 ? Number(opts.total) : 760;
    const turns = Number.isFinite(opts.turns) ? opts.turns : 1.35;
    const rise = Number.isFinite(opts.rise) ? opts.rise : radius * 0.55;
    const next = rng(Number(opts.seed) || 1);

    const motes = [];
    for (let i = 0; i < count; i++) {
      // Spread the starting angles evenly and then disturb them, so the shell
      // reads as a cloud rather than as a wheel of evenly spaced spokes.
      const angle = (i / Math.max(1, count)) * TAU + (next() - 0.5) * 0.9;
      const spread = 0.75 + next() * 0.5;
      // A share of the window to set off in, leaving room to still land inside it.
      const delay = next() * total * 0.35;
      motes.push({
        angle,
        radius: radius * spread,
        // Above and below in equal measure, so a part is gathered to, not rained on.
        y: (next() - 0.5) * 2 * rise,
        turns: turns * (0.82 + next() * 0.36),
        delay,
        life: total - delay,
        size: 0.7 + next() * 0.6,
      });
    }
    return motes;
  }

  /**
   * Where a mote is, and how it looks, at `t` from 0 to 1 of its own flight.
   *
   * Returns a position relative to the part, an opacity and a scale factor.
   * At t = 1 it is exactly on the part with nothing left to see, which is what
   * makes the arrival read as merging rather than as disappearing.
   */
  function moteAt(mote, t) {
    const p = clamp01(Number(t) || 0);
    const closing = easeInQuad(p);
    const r = mote.radius * (1 - closing);
    const angle = mote.angle + mote.turns * TAU * easeOutCubic(p);
    // Height settles sooner than the radius, so a mote comes level with the
    // part and then in, rather than dropping onto it at the last moment.
    const y = mote.y * (1 - easeOutCubic(p));

    // Up over the first fifth, down over the last third; the flat middle is
    // where it reads as a solid point travelling.
    const fadeIn = p < 0.2 ? p / 0.2 : 1;
    const fadeOut = p > 0.67 ? 1 - (p - 0.67) / 0.33 : 1;

    return {
      x: Math.cos(angle) * r,
      y,
      z: Math.sin(angle) * r,
      opacity: clamp01(fadeIn * fadeOut),
      // Slightly larger on the way in, gone at the end.
      scale: mote.size * (0.6 + 0.4 * (1 - closing)) * clamp01(fadeIn * fadeOut),
    };
  }

  window.HCAssemblyMotes = { planMotes, moteAt, rng };
})();
