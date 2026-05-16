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

  // ── Window position & size: remember last state, center on first launch ──
  // Saves position + size to localStorage every 3 s; restores on next launch.
  // Falls back to tauri.conf.json "center: true" on first launch.
  (async function initWindowState() {
    if (!window.__TAURI_INTERNALS__) return;
    const invoke = window.__TAURI_INTERNALS__.invoke;
    if (!invoke) return;

    const readSavedWindowValue = (key) => {
      try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : null;
      } catch (_) {
        return null;
      }
    };
    const finite = (value) => Number.isFinite(Number(value));
    const showWindow = async () => {
      try { await invoke('plugin:window|show'); } catch (_) {}
    };

    try {
      // Restore size before position so the OS does not visibly re-place the frame.
      const savedSize = readSavedWindowValue('hc_win_size');
      if (savedSize && finite(savedSize.width) && finite(savedSize.height)) {
        try {
          await invoke('plugin:window|set_size', {
            value: {
              Physical: {
                width: Math.round(Number(savedSize.width)),
                height: Math.round(Number(savedSize.height))
              }
            }
          });
        } catch (_) {}
      }

      // Restore saved position, or center once after the restored size is known.
      const savedPos = readSavedWindowValue('hc_win_pos');
      if (savedPos && finite(savedPos.x) && finite(savedPos.y)) {
        try {
          await invoke('plugin:window|set_position', {
            value: {
              Physical: {
                x: Math.round(Number(savedPos.x)),
                y: Math.round(Number(savedPos.y))
              }
            }
          });
        } catch (_) {
          try { await invoke('plugin:window|center'); } catch (_2) {}
        }
      } else {
        try { await invoke('plugin:window|center'); } catch (_) {}
      }

      // Save position + size every 3 s (only when changed)
      let lastX, lastY, lastW, lastH;
      setInterval(async () => {
        try {
          const pos = await invoke('plugin:window|outer_position');
          if (pos && (pos.x !== lastX || pos.y !== lastY)) {
            lastX = pos.x; lastY = pos.y;
            localStorage.setItem('hc_win_pos', JSON.stringify({ x: pos.x, y: pos.y }));
          }
        } catch (_) {}
        try {
          const size = await invoke('plugin:window|inner_size');
          if (size && (size.width !== lastW || size.height !== lastH)) {
            lastW = size.width; lastH = size.height;
            localStorage.setItem('hc_win_size', JSON.stringify({ width: size.width, height: size.height }));
          }
        } catch (_) {}
      }, 3000);
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
    tick(); setInterval(tick, 1000);
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

    // After the intro fade completes, remove it from the render tree.
    setTimeout(() => {
      if (screen) { screen.style.visibility = 'hidden'; screen.style.pointerEvents = 'none'; }
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
    const ok = t.closest('input, textarea, [contenteditable="true"], .messages .msg .bubble, pre, code, .selectable');
    if (!ok) e.preventDefault();
  });

  document.addEventListener('dragstart', (e) => {
    const tag = e.target?.tagName;
    if (tag === 'IMG' || tag === 'SVG' || tag === 'CANVAS' || tag === 'VIDEO') {
      e.preventDefault();
    }
  });

})();
