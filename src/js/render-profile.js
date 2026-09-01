// ==============================================================
// Whether this machine draws with a GPU, decided before the first frame
//
// The app already has a cheap mode. `low-gpu` clamps the 7-megapixel circuit
// layer to the viewport and stops it animating, removes the full-window
// `mix-blend-mode: screen` spotlight, and clears every `backdrop-filter` in
// the app. It is switched on when the launch intro ends, and stays on — the
// comment in styles.css says exactly that.
//
// So the intro itself runs with all of it on: a 2966 × 2368 compositor layer
// drifting, a blend mode that makes the compositor re-mix the whole window
// every frame, a 24px blur behind the toolbar, four spinning rings, three
// orbits, seven sparks, and a 30ms counter repainting under the lot. On a
// machine with a GPU that is free and it is the point. On a machine drawing
// every pixel on the CPU it is two and a half seconds of the worst frames the
// app will ever produce, at the moment somebody is deciding what they think of
// it.
//
// This runs synchronously in <head>, before the stylesheets, so the class is
// already on <html> when the first frame is composed. Every rule in styles.css
// has both an `html.low-gpu` and a `body.low-gpu` form, so nothing else has to
// change for it to take effect this early.
//
// IMPORTANT — this only decides WHEN the cheap mode arrives, never WHETHER.
// main.js still switches it on unconditionally at the end of the intro, as it
// always has. Making that switch conditional on this probe would hand every
// machine with a working GPU the expensive mode for the whole session, which
// is the opposite of the intent and a change nobody asked for.
//
// `software` is published separately from the class for the same reason. After
// launch `low-gpu` is on for everybody, so the class cannot answer "can this
// machine draw?" — anything that needs that question answered has to read this
// flag instead.
//
// Checked by scripts/checks/render-profile.mjs.
// ==============================================================

(function () {
  'use strict';

  // Names a software rasterizer goes by. WARP is Direct3D's, SwiftShader is
  // Chromium's own, llvmpipe and softpipe are Mesa's, and "Microsoft Basic
  // Render Driver" is what Windows reports when it has fallen back to WARP —
  // which is what a machine with a driver too old for hardware compositing
  // ends up on, permanently, with no newer driver to install.
  const SOFTWARE = /swiftshader|llvmpipe|softpipe|basic render|\bwarp\b|software rasterizer|software renderer|generic renderer/i;

  /**
   * Is this a software renderer?
   *
   * Three answers collapsed into two, deliberately:
   *
   *   no context at all   → yes. This is not a guess. A machine that cannot
   *                         give out a WebGL context is not compositing in
   *                         hardware either.
   *   a name that matches → yes.
   *   anything else       → NO, including a name we could not read.
   *
   * That last one is the one worth being careful about. `WEBGL_debug_renderer_info`
   * can be withheld, and answering "unknown" with "assume the worst" would take
   * the intro's motion away from machines that can well afford it, to fix
   * nothing. An unreadable name means this probe stays out of the way and the
   * app behaves exactly as it did before.
   */
  function isSoftware(rendererName, hasContext) {
    if (!hasContext) return true;
    return SOFTWARE.test(String(rendererName || ''));
  }

  /** Ask the browser what it is drawing with. '' when it will not say. */
  function readRenderer(doc) {
    try {
      const canvas = doc.createElement('canvas');
      const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
      if (!gl) return { name: '', hasContext: false };
      const dbg = gl.getExtension('WEBGL_debug_renderer_info');
      const name = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) || '') : '';
      // Nothing else needs this context, and holding one open on a machine
      // that is already short of the resources to draw is the wrong trade.
      try { gl.getExtension('WEBGL_lose_context')?.loseContext(); } catch { /* optional */ }
      return { name, hasContext: true };
    } catch {
      // A probe that throws must not be read as a verdict. Say nothing.
      return { name: '', hasContext: true };
    }
  }

  const profile = { software: false, renderer: '', probed: false };

  try {
    const read = readRenderer(document);
    profile.renderer = read.name;
    profile.software = isSoftware(read.name, read.hasContext);
    profile.probed = true;
    if (profile.software) document.documentElement.classList.add('low-gpu');
  } catch {
    // Never let this stop the page loading. Not probing costs the old
    // behaviour and nothing more.
  }

  profile.isSoftware = isSoftware;
  profile.SOFTWARE = SOFTWARE;
  window.HCRenderProfile = profile;
})();
