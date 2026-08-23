// ============================================================
// units.js — what a model is actually the size of
//
// Until now a Forge model was "about two of something". Nothing said what. The
// exported file inherited those somethings, so every print began by guessing a
// scale in the slicer, and that is the moment a person stops believing a tool.
//
// Two ideas, kept apart on purpose:
//
//   The WORKING SPAN is what the scene runs at. Every model is normalised so
//   its longest side is the same length in scene units, whatever it is in real
//   life. That is not cosmetic. Every tolerance in this pipeline is an absolute
//   number — how close two parts must be to count as touching, how far one is
//   seated into another, how small a part may be before it cannot be drawn —
//   and an absolute tolerance is only correct at one scale. Models were
//   arriving anywhere between 1.2 and 4.8 units across, so the same 0.06 gap
//   meant 1% of one model and 5% of another, and the assembler was quietly
//   stricter with big models than with small ones.
//
//   The SIZE IN MILLIMETRES is what the object is. It is carried beside the
//   geometry, never inside it, and it is applied at the two moments a real
//   measurement matters: when a number is shown to a person, and when a file is
//   written. So changing a model from 40 mm to 400 mm is instant and cannot
//   distort anything — no geometry moves, only the lens.
//
// The scene therefore looks the same as it always did, the camera frames the
// same way, and the tolerances finally mean one thing.
//
// Pure: no THREE, no DOM, no network, no clock.
//
// Run the checks with: npm run check:forge-units
// ============================================================
(function () {
  "use strict";

  const num = (v, fallback = 0) => (Number.isFinite(Number(v)) ? Number(v) : fallback);
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  // The longest side of every model, in scene units.
  //
  // Two, because that is the middle of the range models already arrived at —
  // measured across the corpus, 1.2 to 2.6 for everything except a plan that
  // had fallen apart. Picking the middle means the change is invisible: the
  // camera frames the same shot it always did. It also makes the pipeline's
  // constants read as plain proportions — the contact tolerance is 3% of a
  // model, the seating bite 1% — which is what they were always meant to be.
  const WORKING_SPAN = 2;

  // What a model is when nothing says otherwise. Something a person could hold
  // and print: an object palm-sized rather than a doll's house or a car. It is
  // a default and the panel says so, rather than presenting a guess as a fact.
  const DEFAULT_SIZE_MM = 100;

  // Below a millimetre nothing prints and no printer resolves it. Above two
  // metres it is not an object any more, and a size that large is nearly always
  // a decimal point rather than an intention. Both ends clamp rather than
  // refuse: the geometry is fine, only the number written beside it is wrong.
  const MIN_SIZE_MM = 1;
  const MAX_SIZE_MM = 2000;

  /**
   * The size a plan asks to be, in millimetres.
   *
   * Read from the plan rather than from the geometry, because the geometry has
   * been normalised and no longer remembers. Absent, unreadable or absurd, the
   * default is used and `stated` says which happened — so the panel can show a
   * real measurement differently from a value nobody chose.
   */
  function sizeMmOf(plan) {
    const raw = plan && typeof plan === "object"
      ? (plan.sizeMm ?? plan.size_mm ?? plan.size ?? null)
      : null;
    const asked = Number(raw);
    if (!Number.isFinite(asked) || asked <= 0) {
      return { mm: DEFAULT_SIZE_MM, stated: false, clamped: false };
    }
    const mm = clamp(asked, MIN_SIZE_MM, MAX_SIZE_MM);
    return { mm, stated: true, clamped: mm !== asked };
  }

  /**
   * Millimetres per scene unit, measured rather than assumed.
   *
   * The span is what the built geometry actually measures, not the working
   * span, because normalising works from each part's declared parameters — an
   * estimate that ignores rotation and cannot know what a mesh's vertices do.
   * Dividing by the intended span instead of the real one would put a small
   * error into every dimension the app ever showed or wrote.
   */
  function mmPerUnit(sizeMm, measuredSpan) {
    const span = num(measuredSpan, 0);
    const mm = num(sizeMm, DEFAULT_SIZE_MM);
    if (!(span > 1e-9) || !(mm > 0)) return 0;
    return mm / span;
  }

  const toMm = (units, perUnit) => num(units, 0) * num(perUnit, 0);
  const fromMm = (mm, perUnit) => (num(perUnit, 0) > 0 ? num(mm, 0) / num(perUnit, 0) : 0);

  /**
   * A length as a person would write it.
   *
   * Precision follows the size rather than being fixed: "0.85 mm" matters on a
   * wall and "150 mm" does not need to be 150.00. A fixed two places would make
   * every dimension on the screen longer to read for no gain.
   */
  function formatMm(mm, opts = {}) {
    const v = num(mm, 0);
    const a = Math.abs(v);
    const places = a < 1 ? 2 : a < 10 ? 1 : 0;
    const text = v.toFixed(places);
    // Trailing zeros after a decimal point read as false precision.
    const trimmed = places > 0 ? text.replace(/\.?0+$/, "") : text;
    return opts.bare ? trimmed : `${trimmed} mm`;
  }

  /** A bounding box as one line: width by height by depth, once. */
  function formatSize(size, perUnit) {
    const s = Array.isArray(size) ? size : [0, 0, 0];
    const [x, y, z] = s.map((v) => formatMm(toMm(v, perUnit), { bare: true }));
    return `${x} × ${y} × ${z} mm`;
  }

  /**
   * What to multiply the scene by when writing a file.
   *
   * Printing formats are read as millimetres, so they take the factor as it is.
   * The scene format is read as metres by everything that opens it, so a model
   * written at millimetre numbers would arrive a thousand times too big —
   * which is not an error anyone sees until the file is somewhere else.
   */
  function exportScale(kind, perUnit) {
    const p = num(perUnit, 0);
    if (!(p > 0)) return 1;
    return String(kind).toLowerCase() === "glb" ? p / 1000 : p;
  }

  window.HCForgeUnits = {
    WORKING_SPAN,
    DEFAULT_SIZE_MM,
    MIN_SIZE_MM,
    MAX_SIZE_MM,
    sizeMmOf,
    mmPerUnit,
    toMm,
    fromMm,
    formatMm,
    formatSize,
    exportScale,
  };
})();
