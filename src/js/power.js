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
// Checked by scripts/checks/power.mjs.
// ==============================================================

(function () {
  'use strict';

  const listeners = new Set();
  let visible = !document.hidden;
  let focused = document.hasFocus();

  const reducedMotion = () =>
    !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  function state() {
    return { visible, focused, reducedMotion: reducedMotion() };
  }

  function apply() {
    const root = document.documentElement;
    // One class drives every CSS animation in the app. Pausing rather than
    // cancelling means an animation resumes mid-cycle instead of snapping.
    root.classList.toggle('hc-power-idle', !visible);

    // CSS cannot reach SMIL, and the drone rotors and pulse dots are SMIL.
    try {
      const svgs = document.getElementsByTagName('svg');
      for (let i = 0; i < svgs.length; i++) {
        const svg = svgs[i];
        if (typeof svg.pauseAnimations !== 'function') continue;
        if (visible) svg.unpauseAnimations();
        else svg.pauseAnimations();
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
    apply();
  }
  function onFocus() {
    if (focused) return;
    focused = true;
    for (const fn of listeners) { try { fn(state()); } catch {} }
  }
  function onBlur() {
    if (!focused) return;
    focused = false;
    for (const fn of listeners) { try { fn(state()); } catch {} }
  }

  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('focus', onFocus);
  window.addEventListener('blur', onBlur);

  window.HCPower = {
    /** Is the window on screen at all? */
    isVisible: () => visible,
    /** Does the window have keyboard focus? */
    isFocused: () => focused,
    /** Has the user asked the system for less motion? */
    prefersReducedMotion: reducedMotion,
    /** Current state, as passed to listeners. */
    state,
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
     * Hidden means no. Reduced motion means no. Blurred does not, because a
     * frozen animation in a window you can still see looks like a hang.
     */
    shouldAnimate() {
      return visible && !reducedMotion();
    },
  };

  apply();
})();
