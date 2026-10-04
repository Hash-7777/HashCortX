// ==============================================================
// HashCortx — Intro screen controller
// Adapted from Hash_UI 5.0 intro JS — same logic, green theme,
// HashCortx branding. Uses EXACT same IDs as Hash_UI so the
// copied modals.css CSS works without any changes.
// ==============================================================
(function () {
  'use strict';

  // ── Persistent toolbar actions ───────────────────────────────
  (function initToolbarActions() {
    const reloadBtn = document.getElementById('hcReloadAppBtn');
    if (!reloadBtn) return;
    reloadBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      reloadBtn.classList.add('is-reloading');
      reloadBtn.disabled = true;
      window.location.reload();
    });
  })();

  // ── Window position & size: behave like an ordinary window ───────────────
  // Opens where it was left, at the size it was left, maximized if it was
  // maximized, and never somewhere a person cannot reach. Falls back to
  // tauri.conf.json (centered) on first launch.
  //
  // Every number here is in PHYSICAL pixels, the unit the window commands
  // speak, and every check is made against the monitors' WORK AREAS: the screen
  // minus the taskbar.
  //
  //   · The size is capped at the work area counting the title bar and the
  //     frame, which sit outside the inner size, so the whole window fits.
  //   · A saved position is used only when its title bar would be on a screen
  //     that exists (a monitor can be unplugged, and a minimized window is
  //     reported at an off-screen position); otherwise the window is centered.
  //   · Maximized is remembered, and the position and size are saved when the
  //     window moves or is resized.
  //
  // The first window a person ever sees is a little smaller than their screen
  // rather than the whole of it: an ordinary window, not a maximized one that
  // happens to have a title bar.
  (async function initWindowState() {
    if (!window.__TAURI_INTERNALS__) return;
    const invoke = window.__TAURI_INTERNALS__.invoke;
    if (!invoke) return;

    const STATE_KEY = 'hc_win_state';
    // Older builds kept the position and the size under these two keys.
    const LEGACY_POS = 'hc_win_pos';
    const LEGACY_SIZE = 'hc_win_size';

    const readJson = (key) => {
      try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : null;
      } catch (_) {
        return null;
      }
    };
    const finite = (value) => Number.isFinite(Number(value));
    const call = async (command, args) => {
      try { return await invoke(command, args); } catch (_) { return null; }
    };
    const showWindow = () => call('plugin:window|show');

    // Where the window goes, as numbers: no calls, no storage, no page. The
    // check runs this very function against real displays
    // (scripts/checks/host-profile.mjs), so it must stay self-contained.
    //
    //   saved  { x, y, width, height, maximized }, any part may be missing:
    //          x and y the outer position, width and height the inner size
    //   now    { width, height }, the inner size the window has now
    //   pad    { w, h }, the frame around the content: outer minus inner
    //   areas  every monitor's work area, { x, y, w, h }
    //   here   the work area the window is on now
    //   scale  that display's scale factor
    //
    // Returns { x, y, width, height, maximized } for set_position and set_size,
    // or null when there is nothing to measure against.
    const planWindow = ({ saved, now, pad, areas, here, scale }) => {
      const MIN_LOGICAL = { w: 960, h: 640 };   // tauri.conf.json minWidth, minHeight
      const REACH_W = 160;                      // pixels of title bar that must be on a screen
      const REACH_H = 48;                       // and the height of the strip that must be
      const FIRST_MARGIN = { x: 24, y: 16 };    // desktop left showing on a first launch
      const clamp = (value, low, high) => Math.min(Math.max(value, low), Math.max(low, high));
      const reachable = (x, y, w, h, area) => {
        const bar = Math.min(REACH_H, h);
        const across = Math.min(x + w, area.x + area.w) - Math.max(x, area.x);
        return across >= Math.min(REACH_W, w) && y >= area.y && y + bar <= area.y + area.h;
      };

      if (!here || !now || !(now.width > 0) || !(now.height > 0)) return null;
      const p = pad || { w: 0, h: 0 };
      const choseSize = !!(saved && saved.width > 0 && saved.height > 0);
      const chosePlace = !!(saved && Number.isFinite(saved.x) && Number.isFinite(saved.y));
      let outerW = (choseSize ? saved.width : now.width) + p.w;
      let outerH = (choseSize ? saved.height : now.height) + p.h;

      // The screen the window will live on: the one its saved position is
      // reachable on, else the one it opened on.
      let area = here;
      let place = null;
      if (chosePlace) {
        const home = (areas || []).find((a) => reachable(saved.x, saved.y, outerW, outerH, a));
        if (home) { area = home; place = { x: saved.x, y: saved.y }; }
      }

      // A first launch leaves some desktop showing; a size someone chose is theirs.
      const margin = choseSize ? { x: 0, y: 0 } : FIRST_MARGIN;
      const minW = Math.round(MIN_LOGICAL.w * (scale || 1)) + p.w;
      const minH = Math.round(MIN_LOGICAL.h * (scale || 1)) + p.h;
      outerW = Math.min(area.w, Math.max(Math.min(minW, area.w), Math.min(outerW, area.w - 2 * margin.x)));
      outerH = Math.min(area.h, Math.max(Math.min(minH, area.h), Math.min(outerH, area.h - 2 * margin.y)));

      const x = place ? clamp(place.x, area.x, area.x + area.w - outerW) : Math.round(area.x + (area.w - outerW) / 2);
      const y = place ? clamp(place.y, area.y, area.y + area.h - outerH) : Math.round(area.y + (area.h - outerH) / 2);
      return {
        x, y,
        width: Math.max(1, outerW - p.w),
        height: Math.max(1, outerH - p.h),
        maximized: !!(saved && saved.maximized),
      };
    };

    // What was saved, if anything usable: { x, y, width, height, maximized }.
    const loadSaved = () => {
      const state = readJson(STATE_KEY);
      const pos = state || readJson(LEGACY_POS);
      const size = state || readJson(LEGACY_SIZE);
      const out = {};
      if (pos && finite(pos.x) && finite(pos.y)) { out.x = Math.round(Number(pos.x)); out.y = Math.round(Number(pos.y)); }
      if (size && finite(size.width) && finite(size.height) && Number(size.width) > 0 && Number(size.height) > 0) {
        out.width = Math.round(Number(size.width));
        out.height = Math.round(Number(size.height));
      }
      out.maximized = !!(state && state.maximized);
      return (out.x !== undefined || out.width !== undefined || out.maximized) ? out : null;
    };

    const areaOf = (monitor) => {
      const a = monitor && monitor.workArea;
      if (!a || !a.position || !a.size || !(a.size.width > 0) || !(a.size.height > 0)) return null;
      return { x: a.position.x, y: a.position.y, w: a.size.width, h: a.size.height };
    };
    // Every work area there is, and the one the window is on now.
    const measureScreens = async () => {
      const list = await call('plugin:window|available_monitors');
      const areas = (Array.isArray(list) ? list : []).map(areaOf).filter(Boolean);
      let here = areaOf(await call('plugin:window|current_monitor')) || areas[0] || null;
      if (!here) {
        // No monitor answer: the page's own idea of the screen is the primary one.
        const ratio = window.devicePixelRatio || 1;
        const w = Math.floor((window.screen?.availWidth || 0) * ratio);
        const h = Math.floor((window.screen?.availHeight || 0) * ratio);
        if (w > 0 && h > 0) {
          here = { x: Math.round((window.screen?.availLeft || 0) * ratio), y: Math.round((window.screen?.availTop || 0) * ratio), w, h };
          areas.push(here);
        }
      }
      return { areas, here };
    };
    // The title bar and frame around the content: outer minus inner.
    const framePad = async () => {
      const outer = await call('plugin:window|outer_size');
      const inner = await call('plugin:window|inner_size');
      const innerOk = inner && finite(inner.width) && finite(inner.height) ? inner : null;
      if (outer && innerOk && outer.width >= innerOk.width && outer.height >= innerOk.height) {
        return { w: outer.width - innerOk.width, h: outer.height - innerOk.height, inner: innerOk };
      }
      return { w: 0, h: 0, inner: innerOk };
    };

    // The position and size of the window as it is, worth keeping. Null while
    // the answer would be wrong: minimized, or not yet drawn.
    let lastNormal = null;
    const measure = async () => {
      if (await call('plugin:window|is_minimized')) return null;
      const maximized = !!(await call('plugin:window|is_maximized'));
      if (maximized) return { maximized: true };
      const pos = await call('plugin:window|outer_position');
      const size = await call('plugin:window|inner_size');
      if (!pos || !size || !(size.width >= 200) || !(size.height >= 150)) return null;
      // Windows parks a minimized window at -32000, -32000.
      if (pos.x <= -30000 || pos.y <= -30000) return null;
      return { x: pos.x, y: pos.y, width: size.width, height: size.height, maximized: false };
    };
    const save = async () => {
      try {
        const now = await measure();
        if (!now) return;
        if (!now.maximized) lastNormal = now;
        // While maximized, the place that comes back on un-maximizing is the
        // last ordinary one, which is not what the window reports now.
        const keep = now.maximized ? (lastNormal || {}) : now;
        localStorage.setItem(STATE_KEY, JSON.stringify({ ...keep, maximized: !!now.maximized }));
        localStorage.removeItem(LEGACY_POS);
        localStorage.removeItem(LEGACY_SIZE);
      } catch (_) {}
    };
    let saveTimer = null;
    const saveSoon = () => {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(save, 400);
    };

    try {
      const { areas, here } = await measureScreens();
      const pad = await framePad();
      const scale = Number(await call('plugin:window|scale_factor')) || 1;
      const plan = planWindow({ saved: loadSaved(), now: pad.inner, pad, areas, here, scale });

      if (plan) {
        // Size before position, so the frame is placed once. A size that
        // already matches is not set again: that is a needless frame.
        if (plan.width !== pad.inner.width || plan.height !== pad.inner.height) {
          await call('plugin:window|set_size', { value: { Physical: { width: plan.width, height: plan.height } } });
        }
        await call('plugin:window|set_position', { value: { Physical: { x: plan.x, y: plan.y } } });
        lastNormal = { x: plan.x, y: plan.y, width: plan.width, height: plan.height, maximized: false };
        // Maximized comes after the ordinary bounds, which are what the window
        // returns to when it is un-maximized.
        if (plan.maximized) await call('plugin:window|maximize');
      } else {
        // Nothing to measure against: leave what tauri.conf.json made, centered.
        await call('plugin:window|center');
      }

      // Keep it from here on. Moving and resizing say so; a short wait folds a
      // drag into one write. If the events are not available the old, slower
      // check stands in for them.
      const listen = window.__TAURI__ && window.__TAURI__.event && window.__TAURI__.event.listen;
      let listening = false;
      if (typeof listen === 'function') {
        try {
          await Promise.all([listen('tauri://move', saveSoon), listen('tauri://resize', saveSoon)]);
          listening = true;
        } catch (_) {}
      }
      if (!listening) setInterval(() => { if (!document.hidden) saveSoon(); }, 3000);
      document.addEventListener('visibilitychange', () => { if (document.hidden) save(); });
      saveSoon();
    } catch (_) {
    } finally {
      await showWindow();
    }
  })();

  // ── Circuit traces ──────────────────────────────────────────
  (function buildCircuits() {
    const root = document.getElementById('intro-circuits');
    if (!root) return;
    const w = window.innerWidth, h = window.innerHeight;
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    svg.setAttribute('preserveAspectRatio', 'xMidYMid slice');
    const traces = [];
    for (let i = 0; i < 24; i++) {
      let cx = Math.random() * w, cy = Math.random() * h;
      let d = `M ${cx.toFixed(0)} ${cy.toFixed(0)}`;
      for (let s = 0; s < 3 + Math.floor(Math.random() * 3); s++) {
        if (Math.random() > 0.5) { cx += (Math.random() - 0.5) * 320; d += ` H ${cx.toFixed(0)}`; }
        else { cy += (Math.random() - 0.5) * 320; d += ` V ${cy.toFixed(0)}`; }
      }
      const p = document.createElementNS(ns, 'path');
      p.setAttribute('d', d); p.setAttribute('class', 'circuit-line');
      svg.appendChild(p);
      traces.push({ d, dur: 4 + Math.random() * 6, delay: Math.random() * 4 });
    }
    traces.slice(0, 8).forEach(t => {
      const c = document.createElementNS(ns, 'circle');
      c.setAttribute('r', '2'); c.setAttribute('class', 'circuit-pulse');
      const am = document.createElementNS(ns, 'animateMotion');
      am.setAttribute('dur', `${t.dur}s`); am.setAttribute('begin', `${t.delay}s`);
      am.setAttribute('repeatCount', 'indefinite'); am.setAttribute('path', t.d);
      const op = document.createElementNS(ns, 'animate');
      op.setAttribute('attributeName', 'opacity'); op.setAttribute('values', '0;1;1;0');
      op.setAttribute('dur', `${t.dur}s`); op.setAttribute('begin', `${t.delay}s`);
      op.setAttribute('repeatCount', 'indefinite');
      c.appendChild(am); c.appendChild(op); svg.appendChild(c);
    });
    root.appendChild(svg);
  })();

  // ── Tick marks (60 ticks, every 6°) ────────────────────────
  (function buildTicks() {
    const t = document.getElementById('intro-ticks');
    if (!t) return;
    for (let i = 0; i < 60; i++) {
      const tick = document.createElement('div');
      tick.className = 'tick';
      const angle = (i / 60) * 360;
      const radius = 49;
      const rad = (angle - 90) * Math.PI / 180;
      tick.style.cssText = `
        position:absolute; width:1px;
        height:${i % 5 === 0 ? '12px' : '6px'};
        background:${i % 5 === 0 ? 'var(--gold-bright)' : 'var(--gold)'};
        opacity:${i % 5 === 0 ? '0.7' : '0.35'};
        left:${50 + radius * Math.cos(rad)}%;
        top:${50 + radius * Math.sin(rad)}%;
        transform:translate(-50%,-50%) rotate(${angle}deg);
        transform-origin:center;
      `;
      t.appendChild(tick);
    }
  })();

  // ── Boot counter ────────────────────────────────────────────
  (function bootCount() {
    const el = document.getElementById('intro-boot-pct');
    if (!el) return;
    let v = 0;
    const timer = setInterval(() => {
      v += Math.random() * 4 + 1;
      if (v >= 100) { v = 100; clearInterval(timer); }
      el.textContent = String(Math.floor(v)).padStart(3, '0') + '%';
    }, 30);
  })();

  // ── Live timestamp ──────────────────────────────────────────
  (function ts() {
    const el = document.getElementById('intro-timestamp');
    if (!el) return;
    const DAYS   = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    function tick() {
      const d = new Date(), z = n => String(n).padStart(2,'0');
      let h = d.getHours();
      const suffix = h >= 12 ? 'PM' : 'AM';
      h = h % 12 || 12;
      el.textContent = `${h}:${z(d.getMinutes())}:${z(d.getSeconds())} ${suffix} · ${DAYS[d.getDay()]} · ${MONTHS[d.getMonth()]} ${d.getDate()} · ${d.getFullYear()}`;
    }
    tick();
    // This clock lives on the splash screen. It used to tick once a second for
    // the entire life of the app, writing into an element that is hidden the
    // moment the app launches — a repaint per second for an audience of
    // nobody. It now stops as soon as its own element leaves the screen, and
    // while the window is hidden.
    const clock = setInterval(() => {
      if (document.hidden) return;
      if (!el.isConnected || !el.offsetParent) { clearInterval(clock); return; }
      tick();
    }, 1000);
  })();

  // Declared here so sonarDots and introReadiness can safely reference it
  // before the launchApp block below — avoids Temporal Dead Zone crash.
  let exited = false;

  // ── Sonar dots ──────────────────────────────────────────────
  (function sonarDots() {
    const container = document.getElementById('intro-sonar');
    if (!container) return;
    const PING_DUR = 7000, OFFSETS = [0, 2300, 4600];
    const style = document.createElement('style');
    style.textContent = `@keyframes dot-appear{0%{opacity:0;transform:translate(-50%,-50%) scale(.3)}10%{opacity:1;transform:translate(-50%,-50%) scale(1.4)}25%{opacity:.9;transform:translate(-50%,-50%) scale(1)}80%{opacity:.7}100%{opacity:0;transform:translate(-50%,-50%) scale(.6)}}`;
    document.head.appendChild(style);
    function spawnDot() {
      if (exited) return;
      const angle = Math.random() * 2 * Math.PI;
      const r = 12 + Math.random() * 32;
      const x = 50 + r * Math.cos(angle), y = 50 + r * Math.sin(angle);
      const ringIdx = Math.floor(Math.random() * 3);
      const sonarStart = 36.8, sonarEnd = 82.8;
      const clampedR = Math.min(Math.max(r, sonarStart), sonarEnd);
      const t2 = ((clampedR - sonarStart) / (sonarEnd - sonarStart)) * PING_DUR;
      const now = performance.now();
      let waitMs = (OFFSETS[ringIdx] + t2 - (now % PING_DUR) + PING_DUR) % PING_DUR;
      if (waitMs < 80) waitMs += PING_DUR;
      setTimeout(() => {
        const dot = document.createElement('div');
        dot.style.cssText = `position:absolute;left:${x}%;top:${y}%;width:5px;height:5px;transform:translate(-50%,-50%);border-radius:50%;background:#22d3ee;box-shadow:0 0 8px 3px rgba(34,211,238,.8);opacity:0;animation:dot-appear 3.2s ease-out forwards;`;
        container.appendChild(dot);
        setTimeout(() => dot.remove(), 3400);
      }, waitMs);
    }
    setTimeout(spawnDot, 3200); setTimeout(spawnDot, 5100);
    (function schedule() { setTimeout(() => { if (!exited) { spawnDot(); schedule(); } }, 1800 + Math.random() * 3200); })();
  })();

  // ── Intro readiness: local-only, no startup network ping ─────────
  (function introReadiness() {
    const badgeText = document.getElementById('intro-badge-text');
    const badge     = document.getElementById('intro-badge');
    const loadingBar= document.getElementById('intro-loading-bar');
    const loadingFill = document.getElementById('intro-loading-fill');
    const statOllama= document.getElementById('intro-stat-ollama');
    const txtOllama = document.getElementById('intro-txt-ollama');
    const statDrone = document.getElementById('intro-stat-drone');
    const txtDrone  = document.getElementById('intro-txt-drone');
    const statAgents= document.getElementById('intro-stat-agents');
    const txtAgents = document.getElementById('intro-txt-agents');
    const statWarm  = document.getElementById('intro-stat-warm');
    const txtWarm   = document.getElementById('intro-txt-warm');

    const setOk = (el, txt) => { if (!el) return; el.className='ok'; el.textContent=txt; };
    const setGold = (el, txt) => { if (!el) return; el.className='gold'; el.textContent=txt; };
    const progressTimers = [];
    const setProgress = (pct) => {
      const value = Math.max(0, Math.min(100, pct));
      if (loadingFill) loadingFill.style.width = `${value}%`;
      if (loadingBar) loadingBar.setAttribute('aria-valuenow', String(Math.round(value)));
    };
    const queueProgress = (pct, delay) => {
      progressTimers.push(setTimeout(() => setProgress(pct), delay));
    };
    const markReady = () => {
      if (exited) return;
      progressTimers.forEach(clearTimeout);
      if (badge) {
        badge.classList.remove('offline', 'initializing');
        badge.classList.add('ready');
      }
      if (badgeText) badgeText.textContent = 'Ready';
      setProgress(100);
      setTimeout(() => {
        if (!exited && loadingBar) loadingBar.classList.add('done');
      }, 360);
      setOk(statOllama, '[ ok ]');
      if (txtOllama) txtOllama.textContent = 'model routing · ready';
      setOk(statDrone, '[ ok ]');
      if (txtDrone) txtDrone.textContent = 'interface core · ready';
      setOk(statAgents, '[ ok ]');
      if (txtAgents) txtAgents.textContent = 'agents · runtime ready';
      setOk(statWarm, '[ ok ]');
      if (txtWarm) txtWarm.textContent = 'HashCortx ready · awaiting operator';
    };

    setGold(statOllama, '[ • ]');
    if (txtOllama) txtOllama.textContent = 'model routing · initializing';
    setGold(statDrone, '[ • ]');
    if (txtDrone) txtDrone.textContent = 'interface core · initializing';
    setGold(statAgents, '[ • ]');
    if (txtAgents) txtAgents.textContent = 'agents · preparing runtime';
    setGold(statWarm, '[ • ]');
    if (txtWarm) txtWarm.textContent = 'warming HashCortx…';

    if (loadingBar) loadingBar.classList.remove('done');
    setProgress(0);
    queueProgress(18, 80);
    queueProgress(42, 360);
    queueProgress(67, 720);
    queueProgress(88, 1080);
    queueProgress(96, 1320);
    setTimeout(markReady, 1650);
  })();

  // ── Launch: exit intro → reveal app ────────────────────────
  const MIN_WAIT = 2500;
  const loadTime = Date.now();

  function launchApp() {
    if (exited) return;
    if (Date.now() - loadTime < MIN_WAIT) return;
    exited = true;

    const screen = document.getElementById('intro-screen');
    const mainEl = document.getElementById('mainApp');
    const stage  = document.getElementById('intro-stage');

    requestAnimationFrame(() => {
      document.body.classList.add('transitioning', 'intro-exiting');
      // Apply low-gpu NOW — before mainApp becomes visible — so its background
      // animations (pcb-traces, drones, circuit-spots) are already frozen when
      // the cross-fade begins. Without this they'd run for ~980ms.
      //
      // Unconditional, and it stays that way. src/js/host-profile.js may
      // already have put this class on <html> before the first frame, but only
      // when it found a software renderer; that probe answers WHEN the cheap
      // mode starts, not whether. Making this line conditional on it would
      // hand every machine with a working GPU the expensive mode for the rest
      // of the session, which is not what either piece is for.
      document.body.classList.add('low-gpu');
      // Fade the entire intro-screen (stage + rings + drones + sparks all together).
      // Previously only .stage faded, leaving background elements visible through it.
      if (screen) {
        screen.style.transition = 'opacity 0.9s ease-out';
        screen.style.opacity = '0';
      }
      // Reveal mainApp at opacity 0 so it's ready to cross-fade in underneath.
      if (mainEl) {
        mainEl.style.opacity = '0';
        mainEl.style.visibility = '';
        mainEl.style.pointerEvents = 'none';
      }
    });

    // Begin fading mainApp in after a short lead, so the cross-fade overlaps.
    setTimeout(() => {
      if (mainEl) {
        mainEl.style.transition = 'opacity 0.7s ease-out';
        mainEl.style.opacity = '1';
        mainEl.style.pointerEvents = '';
      }
    }, 250);

    // After the intro fade completes, take it out of the document.
    //
    // It used to be hidden instead, and hidden is not gone. `visibility:
    // hidden` stops an element being painted and changes nothing else: it
    // keeps its box, it keeps its compositor layers, and every animation on it
    // keeps running. So the launch screen went on animating for the entire
    // life of the app — four rings, three drone orbits, the logo float, the
    // glow, the sonar dots and sixteen SMIL animations — behind the window a
    // person was actually using. Eight of the nine CSS animations still
    // running after launch belonged to a screen nobody could see.
    //
    // The splash clock was caught by the same thing. It stops itself when
    // `!el.isConnected || !el.offsetParent`, which reads as "when my element
    // has left the screen" and means nothing of the sort while the element is
    // merely invisible: `offsetParent` is only null for `display: none`. It
    // ticked once a second, forever, writing a timestamp into an element with
    // no audience. Removing the screen is what makes that guard true.
    //
    // Nothing shows the intro again — this is a launch screen, and boot.js
    // already removes it outright on the failure path.
    setTimeout(() => {
      if (screen) screen.remove();
      document.body.classList.remove('transitioning', 'intro-exiting');
      setTimeout(() => document.getElementById('input')?.focus(), 100);
    }, 980);
  }

  // ── Dismiss listeners ──────────────────────────────────────
  // Primary: click anywhere on the intro screen (the parent div
  // has no data-tauri-drag-region so click events fire normally).
  // Fallback: mouseup on the stage in case a previous drag ate the click.
  // Keyboard: Enter or Space also dismiss.
  const screen = document.getElementById('intro-screen');
  const stage  = document.getElementById('intro-stage');

  if (screen) screen.addEventListener('click', launchApp);
  if (stage)  stage.addEventListener('mouseup', function onUp(e) {
    // only fire if it was a quick tap (not a window drag)
    if (e.button === 0) launchApp();
  });

  window.addEventListener('keydown', function handleKey(e) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      launchApp();
      window.removeEventListener('keydown', handleKey);
    }
  });

  // ── Desktop-app guards: block right-click + image drag ─────
  // Inputs/textareas keep their native context menu so users can
  // still cut/copy/paste while typing. Chat messages and code blocks
  // also keep it so users can copy responses.
  document.addEventListener('contextmenu', (e) => {
    const t = e.target;
    if (!t) { e.preventDefault(); return; }
    const ok = t.closest('input, textarea, [contenteditable="true"], .messages .msg .bubble, pre, code, .selectable, #messages, .cdr-messages, .void-chat-msgs, .fin-chat-messages, #sysAgentLog, .amk-ws-message, #sbxLog');
    if (!ok) e.preventDefault();
  });

  document.addEventListener('dragstart', (e) => {
    const tag = e.target?.tagName;
    if (tag === 'IMG' || tag === 'SVG' || tag === 'CANVAS' || tag === 'VIDEO') {
      e.preventDefault();
    }
  });

})();
