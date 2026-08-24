// ============================================================
// params.js — the numbers a shape is actually made of
//
// A part could be moved, turned and stretched, and that was all. Its own
// dimensions — the radius of a cylinder, the depth of a box, the tube of a
// ring — could only be changed by asking a model to design the whole thing
// again. Stretching is not the same edit: scaling a cylinder by 1.2 on x and z
// gives an oval prism, while changing its radius gives a wider cylinder, and
// only one of those is the part somebody meant.
//
// This file is the single description of what those numbers are: which ones
// each shape has, what to call them, what they mean, and what they are when a
// plan does not say.
//
// WHY THE DEFAULTS LIVE HERE AND NOWHERE ELSE. The panel has to show the value
// a part is actually built with. If the geometry falls back to one number and
// the panel shows another, the field reads as the truth and is not — a person
// types the number back in and the part changes shape for no reason they can
// see. So the geometry reads its fallbacks from this table too. There is one
// answer to "how wide is a box that did not say", and both sides ask it.
//
// A LENGTH IS IN SCENE UNITS HERE. It is shown in millimetres in the panel,
// through the same lens as a position, because a scene unit means nothing
// outside this window. A COUNT is how many sides a curve is drawn with, and is
// a plain whole number.
//
// Pure: no THREE, no DOM, no network, no clock.
//
// Run the checks with: npm run check:forge-params
// ============================================================
(function () {
  "use strict";

  const length = (key, label, fallback, extra = {}) => ({
    key, label, fallback, kind: "length", min: 0.001, max: 100, ...extra,
  });
  const count = (key, label, fallback, extra = {}) => ({
    key, label, fallback, kind: "count", min: 3, max: 256, step: 1, ...extra,
  });

  /**
   * Per shape, the numbers a person may change.
   *
   * `reads` names the other spellings a plan may have used for the same
   * number. A design writing `radius` on a cylinder means both ends of it, and
   * the geometry has always honoured that — so the panel has to read it the
   * same way or it would show the default beside a part built to something
   * else.
   */
  const FIELDS = {
    box: [
      length("width", "Width", 1),
      length("height", "Height", 1),
      length("depth", "Depth", 1),
    ],
    cylinder: [
      length("radiusTop", "Top radius", 0.35, { reads: ["radius"] }),
      length("radiusBottom", "Base radius", 0.35, { reads: ["radius"] }),
      length("height", "Height", 1),
      count("segments", "Sides", 48),
    ],
    capsule: [
      length("radius", "Radius", 0.12),
      length("length", "Straight length", 0.6, { reads: ["height"] }),
      count("radialSegments", "Sides", 32),
      count("capSegments", "Cap rings", 16, { min: 1 }),
    ],
    sphere: [
      length("radius", "Radius", 0.45),
      count("widthSegments", "Sides", 48),
      count("heightSegments", "Rings", 32),
    ],
    cone: [
      length("radius", "Base radius", 0.42),
      length("height", "Height", 1),
      count("segments", "Sides", 48),
    ],
    torus: [
      length("radius", "Ring radius", 0.5),
      length("tube", "Thickness", 0.08),
    ],
    lathe: [
      count("segments", "Sides", 64),
    ],
    extrude: [
      length("depth", "Depth", 0.18),
      length("bevelSize", "Bevel width", 0.025, { min: 0 }),
      length("bevelThickness", "Bevel depth", 0.025, { min: 0 }),
      count("bevelSegments", "Bevel rings", 2, { min: 1, max: 8 }),
    ],
    logo: [
      length("width", "Width", 2.1),
      length("height", "Height", 2.1),
    ],
    logo_img: [
      length("width", "Width", 2.1),
      length("height", "Height", 2.1),
    ],
    // A mesh is a list of vertices somebody else produced. There is no radius
    // to change, and offering one would be offering an edit that cannot happen.
    mesh: [],
  };

  const fieldsFor = (type) => FIELDS[String(type)] || [];

  const isEditable = (type) => fieldsFor(type).length > 0;

  function fieldOf(type, key) {
    return fieldsFor(type).find((f) => f.key === String(key)) || null;
  }

  /**
   * What a part is really built with for one of its numbers.
   *
   * The part's own value, then any older spelling of it that the geometry
   * honours, then the shape's default. Never undefined for a known field, so
   * the panel and the geometry cannot disagree.
   */
  function valueOf(node, key) {
    const type = node && node.type;
    const field = fieldOf(type, key);
    if (!field) return undefined;
    const params = (node && node.params && typeof node.params === "object") ? node.params : {};
    for (const name of [field.key, ...(field.reads || [])]) {
      const v = Number(params[name]);
      if (Number.isFinite(v)) return field.kind === "count" ? Math.round(v) : v;
    }
    return field.fallback;
  }

  /** Every number a shape has, as the panel wants to show them. */
  function valuesOf(node) {
    return fieldsFor(node && node.type).map((field) => ({ ...field, value: valueOf(node, field.key) }));
  }

  /** A number brought inside the limits its field allows. */
  function clamp(type, key, value) {
    const field = fieldOf(type, key);
    if (!field) return null;
    // An empty box is not the number zero, which is what `Number("")` says it
    // is. A field cleared in order to retype it would otherwise collapse the
    // part to its smallest allowed size between one keystroke and the next.
    if (String(value).trim() === "") return field.fallback;
    const n = Number(value);
    if (!Number.isFinite(n)) return field.fallback;
    const inside = Math.min(field.max, Math.max(field.min, n));
    return field.kind === "count" ? Math.round(inside) : inside;
  }

  /**
   * A new params object with one number changed.
   *
   * The older spellings are REMOVED when the field they stand in for is set.
   * A plan that wrote `radius` on a cylinder, edited to give the top a
   * different radius, would otherwise keep a `radius` the geometry no longer
   * reads and the panel no longer shows — a value that is in the file, is not
   * in the part, and reappears the moment anything rebuilds from it.
   */
  function withValue(node, key, value) {
    const field = fieldOf(node && node.type, key);
    const params = { ...((node && node.params) || {}) };
    if (!field) return params;
    const settled = clamp(node.type, key, value);
    for (const name of field.reads || []) {
      if (name in params) {
        // Keep what that spelling meant, on the fields it also stood for, so
        // changing the top radius does not silently change the bottom one.
        for (const other of fieldsFor(node.type)) {
          if (other.key === field.key) continue;
          if ((other.reads || []).includes(name) && !(other.key in params)) {
            params[other.key] = Number(params[name]);
          }
        }
        delete params[name];
      }
    }
    params[field.key] = settled;
    return params;
  }

  window.HCForgeParams = { FIELDS, fieldsFor, fieldOf, isEditable, valueOf, valuesOf, clamp, withValue };
})();
