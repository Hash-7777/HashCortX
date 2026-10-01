// ==============================================================
// Power — stop doing work nobody can see
//
// The app was measurably warm while sitting idle. Four causes, none of them
// producing anything a user could observe:
//
//   • The 3D Forge render loop re-scheduled itself unconditionally and was
//     never cancelled, so once Forge had been opened the app woke sixty times
//     a second for the rest of its life — even on the chat tab.
//   • The splash screen's clock kept ticking once a second forever, writing
//     into an element that is hidden the moment the app launches.
//   • The window-position poll made two Tauri IPC round trips every three
//     seconds whether or not the window had moved.
//   • 78 infinite CSS animations and 26 always-running SVG animations kept
//     running while the window was hidden behind another app or minimised.
//
// This module answers one question — is anyone looking? — and lets the rest of
// the app stop when the answer is no. Nothing is removed and nothing looks
// different: work resumes the instant the window is visible again.
//
// Two signals, deliberately treated differently:
//
//   hidden   the window is minimised, or on another Space. Nothing is visible,
//            so everything pauses.
//   blurred  another window has focus but this one may still be on screen,
//            side by side. Animations must keep running or the user watches
//            them freeze — only work they cannot perceive stops.
//
// There is a third state, and it exists for one kind of machine. Where every
// pixel is drawn by the processor, the decorations are not free: four drone
// rotors spinning better than once a second, continuously, cost real work for
// as long as the window is open, whether or not anybody is looking at it. So
// when the window is visible but not focused AND there is no hardware
// renderer, the decorations stop and nothing else does.
//
//   quiet    somebody else's window has focus, and this machine pays for
//            every frame. Named decorations pause. Anything that carries
//            meaning — a spinner, a progress bar, streaming text — is not in
//            that list and cannot be caught by it.
//
// That last point is the whole design. The obvious way to write this is to
// pause everything and exempt what matters, which puts every future spinner
// one forgotten class away from freezing in front of somebody. Naming the
// decorations instead means the failure mode is a decoration that keeps
// animating, which costs a little power and misleads nobody.
//
// A fourth case needs no particular machine. A window that is visible and in
// front can still be unattended: the launch screen waits for a click for as
// long as it is left, and a chat can sit open on a second screen all day.
// Left like that, the decorations alone keep the processor and the graphics
// chip working for as long as the window exists.
//
//   resting  nothing has touched the window, by pointer, key or touch, for a
//            minute. The same named decorations pause, and the first touch
//            of any kind starts them again.
//
// Resting uses the quiet state's own mechanism, so it can pause exactly what
// quiet can and nothing else.
//
// Checked by scripts/checks/power.mjs.
// ==============================================================

(function () {
  'use strict';

  const listeners = new Set();
  let visible = !document.hidden;
  let focused = document.hasFocus();

  // Continuous motion that means nothing. Every entry is ornament: the drone
  // rotors, the crest pulse, the circuit backdrop. Nothing that reports
  // progress or state belongs here, and nothing here reports progress or
  // state. base.css pauses the same list under `.hc-power-quiet`, and
  // scripts/checks/power.mjs fails if the two ever disagree.
  const DECORATIVE = [
    // First because the stylesheet names it first, and the check compares order.
    '.intro-screen',
    '.drone-bg',
    '.drone-inline',
    '.brand-drone',
    '.crest-logo-img',
    '.pcb-traces',
    '.circuit-spot',
  ];

  // How long without a pointer, key or touch before the decorations rest. Long
  // enough that nobody reading a reply, thinking, or watching a model work
  // sees motion stop; short enough that a window left open does not draw for
  // hours.
  const REST_AFTER_MS = 60000;
  const ACTIVITY = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart'];
  let lastActive = Date.now();
  let resting = false;
  let restTimer = null;

  // Only where the processor is drawing. On a machine with a GPU the
  // unfocused case never happens, and a window you can see keeps its motion.
  const softwareRenderer = () => !!(window.HCHost && window.HCHost.software);

  /**
   * Visible, and either unattended, or unfocused on a machine paying for every
   * frame.
   */
  function isQuiet() {
    return visible && (resting || (!focused && softwareRenderer()));
  }

  /**
   * Rest once a minute has passed without activity. One timer at most is ever
   * pending, and none while resting or hidden, so an unattended window costs
   * no wake-ups at all.
   */
  function armRest() {
    if (restTimer || resting || !visible) return;
    restTimer = setTimeout(() => {
      restTimer = null;
      if (!visible || resting) return;
      if (Date.now() - lastActive >= REST_AFTER_MS) {
        resting = true;
        apply();
      } else {
        armRest();
      }
    }, Math.max(1000, REST_AFTER_MS - (Date.now() - lastActive)));
  }

  function noteActivity() {
    lastActive = Date.now();
    if (resting) {
      resting = false;
      apply();
    }
    armRest();
  }

  const reducedMotion = () =>
    !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  function state() {
    return { visible, focused, reducedMotion: reducedMotion(), quiet: isQuiet(), resting };
  }

  function apply() {
    const root = document.documentElement;
    // One class drives every CSS animation in the app. Pausing rather than
    // cancelling means an animation resumes mid-cycle instead of snapping.
    root.classList.toggle('hc-power-idle', !visible);
    // And one drives the decorations alone, for the third state above.
    root.classList.toggle('hc-power-quiet', isQuiet());

    // CSS cannot reach SMIL, and the drone rotors and pulse dots are SMIL.
    // Hidden pauses every one of them, because nothing is on screen to freeze.
    // Quiet pauses only the ones inside a decoration, for the same reason the
    // class names a list rather than exempting one.
    try {
      const quiet = isQuiet();
      const ornamental = quiet
        ? new Set(document.querySelectorAll(DECORATIVE.map((s) => `${s} svg`).join(', ')))
        : null;
      const svgs = document.getElementsByTagName('svg');
      for (let i = 0; i < svgs.length; i++) {
        const svg = svgs[i];
        if (typeof svg.pauseAnimations !== 'function') continue;
        if (!visible) { svg.pauseAnimations(); continue; }
        if (quiet && ornamental.has(svg)) svg.pauseAnimations();
        else svg.unpauseAnimations();
      }
    } catch { /* SMIL control is optional; never break the app over it */ }

    const snapshot = state();
    for (const fn of listeners) {
      try { fn(snapshot); } catch { /* one bad listener must not stop the rest */ }
    }
  }

  function onVisibility() {
    const next = !document.hidden;
    if (next === visible) return;
    visible = next;
    // Coming back is attention, and a window nobody can see needs no timer.
    resting = false;
    if (visible) lastActive = Date.now();
    else if (restTimer) { clearTimeout(restTimer); restTimer = null; }
    apply();
    armRest();
  }
  function onFocus() {
    if (focused) return;
    focused = true;
    apply();
  }
  function onBlur() {
    if (!focused) return;
    focused = false;
    apply();
  }

  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('focus', onFocus);
  window.addEventListener('blur', onBlur);
  // Passive and in the capture phase: noticing activity must never delay it,
  // and nothing in the page can stop the event before it is seen.
  for (const ev of ACTIVITY) window.addEventListener(ev, noteActivity, { passive: true, capture: true });

  window.HCPower = {
    /** Is the window on screen at all? */
    isVisible: () => visible,
    /** Does the window have keyboard focus? */
    isFocused: () => focused,
    /** Has the user asked the system for less motion? */
    prefersReducedMotion: reducedMotion,
    /** Current state, as passed to listeners. */
    state,
    /** Visible and unattended, or unfocused and drawing in software: decorations may rest. */
    isQuiet,
    /** Nothing has touched the window for a minute. */
    isResting: () => resting,
    REST_AFTER_MS,
    /** The decorations that state is allowed to stop. Nothing else. */
    DECORATIVE,
    /**
     * Subscribe. Called immediately with the current state so a caller never
     * has to duplicate the decision it is about to make anyway.
     * Returns an unsubscribe function.
     */
    onChange(fn) {
      if (typeof fn !== 'function') return () => {};
      listeners.add(fn);
      try { fn(state()); } catch {}
      return () => listeners.delete(fn);
    },
    /**
     * Should a continuous, decorative loop be running right now?
     *
     * Hidden means no. Reduced motion means no. Blurred on its own does not,
     * because a frozen animation in a window you can still see looks like a
     * hang — but blurred on a machine with no hardware renderer does, because
     * there the same animation is charged to the processor for as long as the
     * window stays open behind something else.
     *
     * The name is the contract: this answers for DECORATIVE loops. Anything
     * that reports progress asks `isVisible()` instead.
     */
    shouldAnimate() {
      return visible && !reducedMotion() && !isQuiet();
    },
  };

  apply();
  armRest();
})();
