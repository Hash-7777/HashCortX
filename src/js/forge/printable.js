// ============================================================
// printable.js — whether the thing could actually be made
//
// A model can be closed, the right size and still unprintable: a wall thinner
// than a nozzle, a face that hangs out over nothing, a shape that arrives as
// three separate objects, a mesh so dense the slicer gives up. None of that is
// visible on screen, and all of it is arithmetic.
//
// Every finding here is measured from the geometry that exists and stated in
// millimetres, because that is the only unit in which any of it means anything.
// Nothing is refused: the report says what is true and how bad it is, and the
// person decides. A tool that quietly declines to export is worse than one that
// says "this wall is 0.6 mm and your nozzle is 0.4".
//
// The one thing it will not do is guess. It does not know the printer, so the
// limits are stated defaults a caller may replace, and every finding carries the
// number it was measured against rather than only a verdict.
//
// Pure: no THREE, no DOM, no network, no clock.
//
// Run the checks with: npm run check:forge-print
// ============================================================
(function () {
  "use strict";

  const num = (v, fallback = 0) => (Number.isFinite(Number(v)) ? Number(v) : fallback);

  // What a common desktop printer can actually make. Stated here so a caller
  // can replace them, and carried into every finding so the number a wall was
  // judged against is never hidden inside a verdict.
  const LIMITS = {
    // Below this a wall is thinner than a single extruded line and either does
    // not print or prints as something a finger breaks.
    minWallMm: 1.2,
    // Past this angle from vertical a downward face has nothing under it.
    maxOverhangDegrees: 45,
    // A slicer will open more than this, slowly, and then struggle.
    maxTriangles: 2_000_000,
    // A common bed. Only informative — plenty of printers are larger.
    bedMm: 250,
  };

  // How many surface points to probe for thickness. The march inward is the
  // expensive part, and a few thousand well-spread points find a thin wall as
  // reliably as every vertex would while costing a fraction.
  const THICKNESS_SAMPLES = 1500;

  // How much of the surface has to be that thin before it counts as a wall.
  //
  // The plain minimum is useless, and measuring it proves why: every model with
  // a sharp edge reported a thinnest wall of nothing, because marching inward
  // from a face right at a knife edge crosses almost no material. An edge is
  // not a wall. A wall is thin material with AREA — a fin, a shell, a web — so
  // the thickness reported is the one below which a hundredth of the surface
  // lies, and a lone sharp corner cannot reach it.
  const THIN_AREA_SHARE = 0.01;

  /**
   * How thick the material is under a point on the surface.
   *
   * Two walks, and the first one matters more than it looks. A vertex of the
   * extracted mesh is an approximation of where the surface is, not the surface
   * itself, so a point on a triangle can sit a fraction OUTSIDE the material.
   * Stepping straight in from there and asking "am I out yet" answers yes
   * immediately, and every model in the corpus reported the same impossibly
   * thin wall — the length of the first step, in every case, whatever the shape.
   *
   * So: walk in until the material is actually entered, and only then measure
   * across it. Because the field is a distance, each step can be as long as the
   * distance to the nearest surface without passing through it, which is what
   * makes crossing a thick body affordable.
   *
   * Returns null when the material is never entered or never left — on a
   * pinched edge, or a face whose normal points along a wall rather than across
   * it. That is a question with no answer here, not an answer of zero.
   */
  function thicknessAt(field, x, y, z, nx, ny, nz, limit) {
    const tiny = limit * 1e-4;
    // ── in, until the material is genuinely entered ──────────────────
    let travelled = 0;
    let px = x, py = y, pz = z;
    let entered = false;
    for (let i = 0; i < 16 && travelled < limit; i++) {
      const step = Math.max(tiny, Math.abs(field.evaluate(px, py, pz)));
      px -= nx * step; py -= ny * step; pz -= nz * step;
      travelled += step;
      if (field.evaluate(px, py, pz) < 0) { entered = true; break; }
    }
    if (!entered) return null;

    // ── across, until it is left again ───────────────────────────────
    let across = 0;
    for (let i = 0; i < 64 && across < limit; i++) {
      const d = field.evaluate(px, py, pz);
      if (d >= 0) return across;
      const step = Math.max(tiny, -d);
      px -= nx * step; py -= ny * step; pz -= nz * step;
      across += step;
    }
    return null;
  }

  /** The triangles of a mesh, as a walkable list with normals and areas. */
  function faces(mesh) {
    const pos = mesh?.positions;
    const idx = mesh?.indices;
    const out = [];
    if (!pos || !idx) return out;
    for (let t = 0; t + 2 < idx.length; t += 3) {
      const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
      const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
      const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
      const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
      const len = Math.hypot(cx, cy, cz);
      if (!(len > 0)) continue;
      out.push({
        n: [cx / len, cy / len, cz / len],
        area: len / 2,
        centre: [
          (pos[a] + pos[b] + pos[c]) / 3,
          (pos[a + 1] + pos[b + 1] + pos[c + 1]) / 3,
          (pos[a + 2] + pos[b + 2] + pos[c + 2]) / 3,
        ],
      });
    }
    return out;
  }

  /**
   * How many separate objects a mesh is, and how many sealed voids are in them.
   *
   * Walked over shared vertices. A model that looks like one thing and arrives
   * as three is a common and completely invisible failure: it slices, it
   * prints, and the pieces fall apart on the bed.
   *
   * NOT EVERY SEPARATE SURFACE IS A SEPARATE OBJECT. Hollow something and it
   * grows a second surface — the inside of the wall — which is one solid with
   * a void in it and not two pieces. Telling somebody their hollow box will
   * come off the bed in two parts is a false alarm about the feature they just
   * asked for.
   *
   * The two are told apart by which way each surface faces, measured as the
   * volume it encloses. A surface wrapping material encloses a positive
   * volume; a surface wrapping a void is inside out by comparison and encloses
   * a negative one. Nothing about the topology distinguishes them — a cavity is
   * as closed and as manifold as the shell around it.
   */
  function shells(mesh) {
    const idx = mesh?.indices;
    const count = mesh?.positions ? mesh.positions.length / 3 : 0;
    if (!idx || !count) return { pieces: 0, voids: 0 };
    const parent = new Int32Array(count);
    for (let i = 0; i < count; i++) parent[i] = i;
    const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
    const join = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb; };
    for (let t = 0; t + 2 < idx.length; t += 3) {
      join(idx[t], idx[t + 1]);
      join(idx[t + 1], idx[t + 2]);
    }
    const volumes = new Map();
    const at = (v) => [mesh.positions[v * 3], mesh.positions[v * 3 + 1], mesh.positions[v * 3 + 2]];
    for (let t = 0; t + 2 < idx.length; t += 3) {
      const root = find(idx[t]);
      const a = at(idx[t]);
      const b = at(idx[t + 1]);
      const c = at(idx[t + 2]);
      const v = (
        a[0] * (b[1] * c[2] - b[2] * c[1])
        - a[1] * (b[0] * c[2] - b[2] * c[0])
        + a[2] * (b[0] * c[1] - b[1] * c[0])
      ) / 6;
      volumes.set(root, (volumes.get(root) || 0) + v);
    }
    let pieces = 0;
    let voids = 0;
    for (const volume of volumes.values()) {
      if (volume < 0) voids++; else pieces++;
    }
    return { pieces, voids };
  }

  /**
   * Everything worth knowing before this is printed.
   *
   * `mmPerUnit` turns scene units into the only unit any of this means anything
   * in. Without it the measurements are still taken, and reported as unitless,
   * rather than quietly presented as millimetres they are not.
   */
  function assess(mesh, field, opts = {}) {
    const limits = { ...LIMITS, ...(opts.limits || {}) };
    const perUnit = num(opts.mmPerUnit, 0);
    const toMm = (v) => (perUnit > 0 ? v * perUnit : v);
    const findings = [];
    const facts = {
      triangles: 0,
      shells: 0,
      voids: 0,
      minWallMm: null,
      overhangShare: 0,
      sizeMm: [0, 0, 0],
      volumeMl: null,
      hasUnits: perUnit > 0,
    };

    const tris = faces(mesh);
    facts.triangles = tris.length;
    if (!tris.length) {
      findings.push({ code: "no-model", level: "stop", detail: "there is nothing to print" });
      return { ok: false, facts, findings, limits };
    }

    // ── is it one closed body ──────────────────────────────────────────
    const openEdges = num(mesh?.stats?.openEdges, 0);
    const foldedEdges = num(mesh?.stats?.foldedEdges, 0);
    if (openEdges > 0) {
      findings.push({ code: "open", level: "stop", detail: `${openEdges} edge(s) have nothing on the other side` });
    }
    if (foldedEdges > 0) {
      findings.push({ code: "folded", level: "warn", detail: `${foldedEdges} edge(s) are pinched, where a feature is thinner than the grid` });
    }
    const surfaces = shells(mesh);
    facts.shells = surfaces.pieces;
    facts.voids = surfaces.voids;
    if (facts.shells > 1) {
      findings.push({
        code: "loose-pieces", level: "warn",
        detail: `this is ${facts.shells} separate objects, which will come off the bed as ${facts.shells} pieces`,
      });
    }

    // ── size ───────────────────────────────────────────────────────────
    const pos = mesh.positions;
    const lo = [Infinity, Infinity, Infinity];
    const hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < pos.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        if (pos[i + k] < lo[k]) lo[k] = pos[i + k];
        if (pos[i + k] > hi[k]) hi[k] = pos[i + k];
      }
    }
    facts.sizeMm = [0, 1, 2].map((k) => toMm(hi[k] - lo[k]));
    if (perUnit > 0 && Math.max(...facts.sizeMm) > limits.bedMm) {
      findings.push({
        code: "large", level: "note",
        detail: `${Math.round(Math.max(...facts.sizeMm))} mm on its longest side, past a ${limits.bedMm} mm bed`,
      });
    }

    // ── how much of it hangs over nothing ──────────────────────────────
    //
    // Straight down is fine: it sits on the bed. It is the faces between there
    // and vertical that have nothing under them, and past 45 degrees from
    // vertical they need something built to hold them up.
    const cosLimit = Math.cos((limits.maxOverhangDegrees * Math.PI) / 180);
    let overhanging = 0;
    let total = 0;
    for (const f of tris) {
      total += f.area;
      if (f.n[1] < 0 && -f.n[1] < cosLimit) overhanging += f.area;
    }
    facts.overhangShare = total > 0 ? overhanging / total : 0;
    if (facts.overhangShare > 0.02) {
      findings.push({
        code: "overhangs", level: facts.overhangShare > 0.15 ? "warn" : "note",
        detail: `${Math.round(facts.overhangShare * 100)}% of the surface leans past ${limits.maxOverhangDegrees}° and will need support`,
      });
    }

    // ── the thinnest wall ──────────────────────────────────────────────
    if (field && typeof field.evaluate === "function") {
      const stride = Math.max(1, Math.floor(tris.length / THICKNESS_SAMPLES));
      const ceiling = Math.max(...[0, 1, 2].map((k) => hi[k] - lo[k]));
      const probes = [];
      let probedArea = 0;
      for (let i = 0; i < tris.length; i += stride) {
        const f = tris[i];
        const t = thicknessAt(field, f.centre[0], f.centre[1], f.centre[2], f.n[0], f.n[1], f.n[2], ceiling);
        if (t === null) continue;
        probes.push({ t, area: f.area, at: f.centre });
        probedArea += f.area;
      }
      if (probes.length) {
        probes.sort((a, b) => a.t - b.t);
        // Walk up from the thinnest until a hundredth of the probed surface is
        // behind us. That is the thinnest material there is enough of to call a
        // wall, rather than the thinnest single point, which is always an edge.
        const target = probedArea * THIN_AREA_SHARE;
        let seen = 0;
        let wall = probes[probes.length - 1];
        for (const probe of probes) {
          seen += probe.area;
          if (seen >= target) { wall = probe; break; }
        }
        facts.minWallMm = toMm(wall.t);
        facts.thinnestAt = wall.at;
        facts.thinnestPointMm = toMm(probes[0].t);
        if (perUnit > 0 && facts.minWallMm < limits.minWallMm) {
          findings.push({
            code: "thin-wall", level: "warn",
            detail: `material as thin as ${facts.minWallMm.toFixed(2)} mm, under the ${limits.minWallMm} mm a common nozzle can lay down`,
          });
        }
      }
    }

    // ── how heavy the file is ──────────────────────────────────────────
    if (tris.length > limits.maxTriangles) {
      findings.push({
        code: "dense", level: "warn",
        detail: `${tris.length.toLocaleString()} triangles is past what a slicer opens comfortably`,
      });
    }

    return {
      // Only when nothing would stop it. A warning is a thing to know about, a
      // stop is a thing that will not print.
      ok: !findings.some((f) => f.level === "stop"),
      facts,
      findings,
      limits,
    };
  }

  /**
   * The report as a person would say it.
   *
   * One line, because it is read at a glance before pressing export, and a
   * paragraph at that moment is a paragraph nobody reads.
   */
  function summarise(report) {
    if (!report) return "";
    const f = report.facts;
    const bits = [];
    if (f.hasUnits && f.sizeMm.some((v) => v > 0)) {
      bits.push(f.sizeMm.map((v) => (v < 10 ? v.toFixed(1) : Math.round(v))).join(" × ") + " mm");
    }
    bits.push(f.shells === 1 ? "one solid" : `${f.shells} separate pieces`);
    // Said, because a sealed void is a thing a person should know they have:
    // it cannot be drained, and a slicer will not fill it.
    if (f.voids > 0) bits.push(f.voids === 1 ? "hollow inside" : `${f.voids} sealed spaces inside`);
    if (f.minWallMm != null && f.hasUnits) bits.push(`${f.minWallMm.toFixed(1)} mm thinnest wall`);
    bits.push(f.overhangShare > 0.02
      ? `${Math.round(f.overhangShare * 100)}% needs support`
      : "no supports needed");
    return bits.join(" · ");
  }

  window.HCForgePrintable = {
    LIMITS,
    THICKNESS_SAMPLES,
    thicknessAt,
    shells,
    assess,
    summarise,
  };
})();
