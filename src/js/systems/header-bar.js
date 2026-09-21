// ==============================================================
// The ERP bar of controls fits the window, whatever the window does
//
// THE DEFECT. Nine controls sat in a row inside a header that cuts off
// whatever leaves it. On a full-width window the last two were already drawn
// past its edge and cut away — "Reset data" and "Back" simply were not there,
// and narrowing the window took more of them, with nothing on screen to say
// they existed or any way to reach them. A control that has been cut off is
// worse than one never offered: the app still believes it is there, so nothing
// stands in for it.
//
// WHAT HAPPENS INSTEAD. The room the bar really has is worked out, and what
// does not fit moves into a menu at the end of it. Which controls move is
// decided in js/toolbar-fit.js, where it is checked without a browser; the
// measuring is here, because only a browser can measure.
//
// THREE THINGS IT TOOK, none of them obvious:
//
//   · How much of the row the centre keeps is declared in the stylesheet as
//     `--sys-centre-min` and read from there. The first version guessed at it,
//     guessed low, and so worked out that the bar fitted while the browser was
//     drawing it past the end of the header.
//   · The mode is mounted before its panel has a size. A pass at that moment
//     measures every control as nothing wide, decides it all fits, and leaves
//     the bar as over-full as it was — and nothing resizes afterwards to
//     correct it. So a pass that measures nothing asks for another frame.
//   · The menu is placed against the window, not against the bar. Hanging
//     below the bar it was cut off by the same header, and a cut-off menu item
//     is not a menu item — clicking where it was drawn reached whatever was
//     underneath it instead. That was measured, not guessed: the point at its
//     centre answered with the toolbar below.
//
// The controls are moved, not copied, so each keeps its own handler, its own
// enabled state and its own place in the bar when it returns.
//
// Loaded after js/toolbar-fit.js, before the Systems mode, and published as
// window.HCSystemsHeaderBar. Checked by scripts/checks/systems-header-bar.mjs.
// ==============================================================

(function () {
  'use strict';

  // These three never move: what the run is doing, which model does it, and
  // the button that starts it. A bar without them has not been made to fit.
  const KEEP = new Set(['sysRunStatus', 'sysModelSelect', 'sysCreateBtn']);
  // How far below the bar the menu hangs.
  const DROP = 7;
  // Measured while a control is in the bar and on screen, and kept — so one
  // sitting in the menu is still fitted by its own width rather than by the
  // width the menu gives it.
  const widths = new Map();
  let wired = false;

  const $ = (id) => document.getElementById(id);
  const parts = () => ({
    bar: $('sysHeaderRight'),
    wrap: $('sysMoreWrap'),
    menu: $('sysMoreMenu'),
    btn: $('sysMoreBtn'),
    header: document.querySelector('#system-maker-wrap .sys-header'),
    left: document.querySelector('#system-maker-wrap .sys-header-left'),
  });

  function setOpen(open) {
    const { menu, btn, wrap } = parts();
    if (!menu) return;
    menu.hidden = !open;
    menu.setAttribute('aria-hidden', String(!open));
    if (btn) btn.setAttribute('aria-expanded', String(open));
    if (open && wrap) {
      const at = wrap.getBoundingClientRect();
      menu.style.top = `${Math.round(at.bottom + DROP)}px`;
      menu.style.right = `${Math.round(window.innerWidth - at.right)}px`;
    }
  }

  const isOpen = () => $('sysMoreMenu')?.hidden === false;

  /** The room the bar has, worked out the way the stylesheet lays the row out. */
  function roomFor(header, left) {
    const style = getComputedStyle(header);
    const gap = parseFloat(style.columnGap) || 12;
    const inner = header.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    const centreMin = parseFloat(style.getPropertyValue('--sys-centre-min')) || 0;
    const taken = (left ? left.getBoundingClientRect().width : 0) + gap + (centreMin ? centreMin + gap : 0);
    return { room: Math.max(0, Math.floor(inner - taken)), gap };
  }

  /** Put what fits in the bar and the rest in the menu. */
  function refit(tries = 12) {
    const { bar, wrap, menu, header, left } = parts();
    if (!bar || !wrap || !menu || !header || !window.HCToolbarFit) return;

    // Everything home first, so each control is measured where it belongs and
    // the widths do not depend on where the last pass happened to put it. An
    // open menu is emptied by that, so it closes rather than standing open
    // over nothing.
    if (menu.children.length) setOpen(false);
    for (const el of [...menu.children]) bar.insertBefore(el, wrap);

    const { room, gap } = roomFor(header, left);
    const items = [...bar.children].filter((el) => el !== wrap).map((el) => {
      const onScreen = !el.hidden && el.getBoundingClientRect().width > 0;
      if (onScreen) widths.set(el.id, Math.ceil(el.getBoundingClientRect().width));
      return { key: el.id, width: onScreen ? (widths.get(el.id) || 0) : 0, keep: KEEP.has(el.id) };
    });
    if (!items.some((it) => it.width > 0)) {
      if (tries > 0) requestAnimationFrame(() => refit(tries - 1));
      return;
    }

    const menuWidth = Math.ceil(wrap.getBoundingClientRect().width) || 38;
    const { hidden } = window.HCToolbarFit.fit(room, items, { gap, menuWidth });
    for (const key of hidden) {
      const el = $(key);
      if (el) menu.appendChild(el);
    }
    wrap.hidden = hidden.length === 0;
    // And the bar is held to that width, so a track sized to its own contents
    // cannot be handed more of the row than there is.
    bar.style.maxWidth = `${room}px`;
  }

  /** Wire the menu and start watching the header. Safe to call more than once. */
  function init() {
    if (wired) { refit(); return; }
    const { btn, menu, header } = parts();
    if (!btn || !menu || !header) return;
    wired = true;

    btn.addEventListener('click', (e) => { e.stopPropagation(); setOpen(!isOpen()); });
    // The controls in here are the same buttons, moved, so nothing repeats
    // what they do — this only closes the menu behind them.
    menu.addEventListener('click', (e) => { if (e.target.closest('button')) setOpen(false); });
    document.addEventListener('click', (e) => {
      if (isOpen() && !e.target.closest('#sysMoreWrap')) setOpen(false);
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && isOpen()) setOpen(false);
    });
    // A resize is the case that used to take controls away.
    if (typeof ResizeObserver === 'function') new ResizeObserver(() => refit()).observe(header);
    else window.addEventListener('resize', () => refit());
    refit();
  }

  window.HCSystemsHeaderBar = { init, refit, setOpen, KEEP, DROP };
})();
