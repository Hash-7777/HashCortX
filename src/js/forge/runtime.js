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

  window.HCForgeRuntime = { load, environment };
})();
