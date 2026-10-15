// ==============================================================
// 3D Forge's runtime, read once, and the reflections its models pick up
//
// three.js and its three helpers load from disk. They came from a CDN, which
// meant 3D Forge did not work at all with the network off, and it broke the
// rule in docs/ARCHITECTURE.md that libraries ship with the app. They are
// read together rather than one after another, and the reading starts when
// the pointer first reaches the 3D Forge tab, so opening it does not wait
// for the files.
//
// The reflections are built from a small room scene, which compiles its own
// shaders and renders six faces. Nothing in the intro uses them — the mark
// and the floor are flat — so the mode makes them once its first frame is on
// screen, or at once when a model needs them.
//
// Frames are drawn on demand. The view used to be drawn sixty times a
// second, shadows and all, for as long as 3D Forge was open, whether or not
// anything on it moved. Now something that changes the view asks for a frame
// (onDemand's want), and drawing goes on only while the frame just drawn says
// something is still moving: the camera settling, a part fading in, the mark
// floating.
//
// Loaded before the modes and published as window.HCForgeRuntime.
// Checked by scripts/checks/forge.mjs.
// ==============================================================

(function () {
  'use strict';

  let loading = null;

  /** `[three, OrbitControls module, TransformControls module, RoomEnvironment module]`, read once; a failed read may be tried again. */
  function load() {
    loading = loading || Promise.all([
      import('/js/vendor/three/three.module.min.js'),
      import('/js/vendor/three/examples/OrbitControls.js'),
      import('/js/vendor/three/examples/TransformControls.js'),
      import('/js/vendor/three/examples/RoomEnvironment.js'),
    ]).catch((err) => { loading = null; throw err; });
    return loading;
  }

  /** The reflection map for `renderer`, from three's room scene. */
  function environment(THREE, renderer, RoomEnvironment) {
    const gen = new THREE.PMREMGenerator(renderer);
    try {
      gen.compileEquirectangularShader();
      return gen.fromScene(new RoomEnvironment(), 0.04).texture;
    } finally {
      gen.dispose();
    }
  }

  /**
   * A frame loop that runs only while it is owed frames. `step(now, last)`
   * draws one and returns true while something is still moving, which keeps
   * the loop going; `last` is true on the final frame it is owed. `ready()`
   * says whether drawing is possible now. `want(n)` asks for at least `n`
   * more frames, and starts the loop if it had stopped.
   */
  function onDemand({ step, ready, raf = (f) => requestAnimationFrame(f), cancel = (id) => cancelAnimationFrame(id) }) {
    // `id` is the frame asked for, -1 while one is being drawn, 0 when stopped.
    // A step can ask for frames itself (the camera reports its own change
    // while it is updated), and that must not start a second loop.
    let id = 0, owed = 0;
    const tick = (now) => {
      if (!ready()) { id = 0; owed = 0; return; }
      id = -1;
      const moving = !!step(now, owed <= 1);
      owed = moving ? Math.max(owed - 1, 1) : owed - 1;
      id = owed > 0 ? raf(tick) : 0;
    };
    return {
      want(n = 2) { owed = Math.max(owed, n); if (!id && ready()) id = raf(tick); },
      stop() { if (id > 0) cancel(id); id = 0; owed = 0; },
      get running() { return id !== 0; },
    };
  }

  // The first time the pointer is over the 3D Forge tab, start reading. One
  // listener, removed once it has fired.
  if (typeof document !== 'undefined') {
    const warm = (e) => {
      if (!e.target || typeof e.target.closest !== 'function' || !e.target.closest('#tabForge')) return;
      document.removeEventListener('pointerover', warm, true);
      load().catch(() => {});
    };
    document.addEventListener('pointerover', warm, true);
  }

  window.HCForgeRuntime = { load, environment, onDemand };
})();
