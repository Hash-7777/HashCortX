// ==============================================================
// The colours a generated business system is drawn in
//
// A system's theme — its primary and accent, light or dark, and corner radius
// — turned into the CSS variables its screens read, over a background tone
// chosen for its kind of business.
//
// And its design beyond colour: typeface, density and surface, alongside the
// shell it is laid out in. Every generated system used to share one typeface,
// one spacing and one card style, whatever it was for, so two systems told
// apart only by their colours looked like one; density was even stored and
// never applied. A new system's design now differs from the one before it on
// at least two of those four, and the colours stay those of its industry.
//
// Pure: a spec in, a style string out. No DOM, no storage.
//
// Loaded after js/systems/domain.js, before the Systems mode, and published as
// window.HCSystemsTheme. Checked by scripts/checks/systems-theme.mjs.
// ==============================================================

(function () {
  'use strict';

  function shadeHex(hex, factor) {
    const h = String(hex || "#000000").replace(/^#/, "");
    if (h.length < 6) return hex;
    const n = parseInt(h.slice(0, 6), 16);
    const r = Math.round(Math.max(0, Math.min(255, ((n >> 16) & 0xff) * (1 - factor))));
    const g = Math.round(Math.max(0, Math.min(255, ((n >> 8)  & 0xff) * (1 - factor))));
    const b = Math.round(Math.max(0, Math.min(255, ((n)       & 0xff) * (1 - factor))));
    return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
  }

  /**
   * A colour a spec asked for, as #rrggbb, or the fallback.
   *
   * A spec is a model's answer, and its colours are written into a style
   * attribute, so anything that is not a plain hex colour is not used.
   */
  function safeHex(value, fallback) {
    const v = String(value == null ? "" : value).trim();
    if (/^#[0-9a-f]{6}$/i.test(v)) return v;
    if (/^#[0-9a-f]{3}$/i.test(v)) return "#" + v.slice(1).split("").map((c) => c + c).join("");
    return fallback;
  }

  function hexToRgb(hex) {
    const n = parseInt(String(hex || "#000000").replace(/^#/, "").slice(0, 6), 16);
    return `${(n >> 16) & 0xff},${(n >> 8) & 0xff},${n & 0xff}`;
  }

  // Domain-specific background tones (completely independent of the AI-chosen primary)
  const DOMAIN_BG = {
    restaurant:    { light: { app:"#fffbeb", card:"#ffffff", border:"rgba(120,53,15,.11)"  }, dark: { app:"#100900", card:"#1c1100", border:"rgba(245,158,11,.14)"  } },
    hotel:         { light: { app:"#f8f8f4", card:"#ffffff", border:"rgba(12,30,61,.09)"   }, dark: { app:"#030a18", card:"#06132b", border:"rgba(59,130,246,.12)"  } },
    healthcare:    { light: { app:"#f0fdfa", card:"#ffffff", border:"rgba(13,79,79,.1)"    }, dark: { app:"#011414", card:"#031f1f", border:"rgba(20,184,166,.13)"  } },
    education:     { light: { app:"#f5f3ff", card:"#ffffff", border:"rgba(79,70,229,.1)"   }, dark: { app:"#07061a", card:"#0e0c2a", border:"rgba(129,140,248,.12)" } },
    fitness:       { light: { app:"#faf5ff", card:"#ffffff", border:"rgba(124,58,237,.1)"  }, dark: { app:"#0a0117", card:"#130525", border:"rgba(167,139,250,.15)" } },
    realestate:    { light: { app:"#f0fdf4", card:"#ffffff", border:"rgba(4,120,87,.1)"    }, dark: { app:"#001509", card:"#002814", border:"rgba(16,185,129,.12)"  } },
    retail:        { light: { app:"#fff7f8", card:"#ffffff", border:"rgba(219,39,119,.1)"  }, dark: { app:"#120005", card:"#1e000a", border:"rgba(244,114,182,.14)" } },
    logistics:     { light: { app:"#f1f5f9", card:"#ffffff", border:"rgba(30,41,59,.1)"    }, dark: { app:"#020810", card:"#060f1c", border:"rgba(56,189,248,.13)"  } },
    manufacturing: { light: { app:"#f1f5f9", card:"#ffffff", border:"rgba(30,58,95,.1)"    }, dark: { app:"#030910", card:"#08141e", border:"rgba(96,165,250,.11)"  } },
    hr:            { light: { app:"#faf5ff", card:"#ffffff", border:"rgba(124,58,237,.1)"  }, dark: { app:"#0d0320", card:"#180738", border:"rgba(196,181,253,.12)" } },
    legal:         { light: { app:"#faf8f4", card:"#fffdf9", border:"rgba(28,25,23,.09)"   }, dark: { app:"#0c0900", card:"#1a1500", border:"rgba(217,119,6,.12)"   } },
    jewelry:       { light: { app:"#fefce8", card:"#fffdf0", border:"rgba(161,120,10,.13)" }, dark: { app:"#0d0900", card:"#1a1400", border:"rgba(212,175,55,.18)"  } },
    saas:          { light: { app:"#f8fafc", card:"#ffffff", border:"rgba(15,23,42,.09)"   }, dark: { app:"#04050a", card:"#090c14", border:"rgba(148,163,184,.1)"  } },
    generic:       { light: { app:"#f8fafc", card:"#ffffff", border:"rgba(15,23,42,.1)"    }, dark: { app:"#060b14", card:"#0d1526", border:"rgba(99,102,241,.12)"  } },
  };

  /** The surfaces a system draws on, so what is drawn on them can be measured. */
  function surfacesOf(spec) {
    const dark = spec?.theme?.mode === "dark";
    const domain = spec?.domain || (window.HCSystemsDomain ? window.HCSystemsDomain.detectDomain(spec?.description || "") : "generic");
    const dbg = (DOMAIN_BG[domain] || DOMAIN_BG.generic)[dark ? "dark" : "light"];
    // A flat card is see-through: what shows is the page's own tone with a
    // faint wash over it, which is darker than the card colour on its own.
    const C = window.HCSystemsContrast;
    const flat = C ? C.mix(dbg.app, dark ? "#ffffff" : "#0f172a", dark ? 0.04 : 0.025) : dbg.app;
    return { card: dbg.card, app: dbg.app, flat, border: dbg.border, dark };
  }

  /**
   * One of the per-module colours, in the shades it can be READ in.
   *
   * A module's own colour is written straight into a style in a dozen places —
   * a card's initials, a figure on a tile, a label on a filled nav button. On
   * a light system that is an amber on white at about two to one, and white on
   * that same amber at about the same. The colour still fills what it filled;
   * what changes is the shade a word is drawn in on top of it.
   */
  function shadesOf(colour, spec) {
    const C = window.HCSystemsContrast;
    const { card, app, flat, dark } = surfacesOf(spec);
    const fill = safeHex(colour, "#6366f1");
    if (!C) return { fill, wash: fill, onWash: fill, onCard: fill, onFill: "#ffffff" };
    const wash = C.mix(fill, card, dark ? 0.86 : 0.88);
    // A word "on the card" may be on a solid card or a flat one, so it is held
    // against every ground a card can show.
    const grounds = [card, app, flat];
    const onGround = (c, floor) => grounds.reduce((x, g) => C.readableOn(x, g, floor), c);
    return {
      fill,                                          // a block of it, with no words on it
      wash,                                          // a wash of it behind words
      onWash: C.readableOn(fill, wash),              // a word on that wash
      onCard: onGround(fill),                        // a word on the card itself
      onFill: C.readableOn(C.pickOn(fill), fill),    // a word on the block
      line: onGround(fill, C.LARGE),                 // an edge or a mark, not a word
    };
  }

  function themeVars(spec) {
    const dark = spec.theme.mode === "dark";
    const primary = safeHex(spec.theme.primary, "#2563eb");
    const accent  = safeHex(spec.theme.accent, "#10b981");
    const radius  = Number(spec.theme.radius || 10);
    const domain  = spec.domain || window.HCSystemsDomain.detectDomain(spec.description || "");
    const dbg     = (DOMAIN_BG[domain] || DOMAIN_BG.generic)[dark ? "dark" : "light"];
    const navBg      = dark ? shadeHex(primary, 0.38) : primary;
    const primaryRgb = hexToRgb(primary);
    const accentRgb  = hexToRgb(accent);

    // Every colour a word is drawn in is measured against what it is drawn on
    // — js/systems/contrast.js — and moved only as far as it has to go to be
    // readable. Nothing here was measured before: the quiet labels were about
    // two and a half to one on white, the status pills were coloured for a
    // dark background and drawn on a light one, and the heading bar put white
    // on whatever colour the industry happened to have.
    const C = window.HCSystemsContrast;
    const ink = (colour, on, floor) => (C ? C.readableOn(colour, on, floor) : colour);
    // A tint is written as the colour it really ends up, over the card it sits
    // on, so that what is drawn on it can be measured rather than guessed.
    const tint = (colour, amount) => (C ? C.mix(colour, dbg.card, amount) : dbg.card);
    const card = dbg.card;
    const STATUS = {
      ok:   dark ? "#34d399" : "#10b981",
      warn: dark ? "#fbbf24" : "#f59e0b",
      bad:  dark ? "#f87171" : "#ef4444",
      idle: dark ? "#94a3b8" : "#64748b",
    };
    const washOf = (colour) => tint(colour, dark ? 0.86 : 0.88);
    const statusVars = Object.entries(STATUS).flatMap(([name, colour]) => {
      const bg = washOf(colour);
      return [
        `--sys-${name}-bg:${bg}`,
        `--sys-${name}:${ink(colour, bg, C ? C.TEXT : 4.5)}`,
        `--sys-${name}-line:${ink(colour, bg, C ? C.LARGE : 3)}`,
      ];
    });
    // The quiet greys are drawn on the card AND on every wash the system uses
    // — a pill, a count beside a heading. Measured against the card alone they
    // are readable there and just short of it on a wash, which is where they
    // are hardest to read and most often sit. So each is held against every
    // surface in turn, and ends up the shade that works on all of them.
    const { app: appBg, flat } = surfacesOf(spec);
    const surfaces = [card, appBg, flat, washOf(primary), washOf(accent), ...Object.values(STATUS).map(washOf)];
    const onEvery = (colour) => surfaces.reduce((c, on) => ink(c, on), colour);
    const navText = C ? C.readableOn(C.pickOn(navBg), navBg, C.TEXT) : "#f1f5f9";
    // A step away from the words on the heading bar, not towards them.
    const navStep = (amount) => (C ? C.mix(navBg, C.luminance(navText) > 0.5 ? "#000000" : "#ffffff", amount) : navBg);

    return [
      `--sys-primary:${primary}`,
      `--sys-accent:${accent}`,
      `--sys-primary-rgb:${primaryRgb}`,
      `--sys-accent-rgb:${accentRgb}`,
      `--sys-primary-fade:rgba(${primaryRgb},${dark ? ".18" : ".10"})`,
      `--sys-accent-fade:rgba(${accentRgb},${dark ? ".18" : ".10"})`,
      `--sys-card-bg:${dbg.card}`,
      `--sys-app-bg:${dbg.app}`,
      `--sys-surface:${dark ? "rgba(255,255,255,.04)" : "rgba(15,23,42,.025)"}`,
      `--sys-app-text:${ink(dark ? "#e5e7eb" : "#0f172a", card)}`,
      `--sys-app-sub:${onEvery(dark ? "#94a3b8" : "#475569")}`,
      // A date, a field name, a count, the second line of a card. These are
      // quiet, not decorative, so they are held to the floor for reading text
      // rather than to the one for a border.
      `--sys-app-muted:${onEvery(dark ? "#64748b" : "#94a3b8")}`,
      `--sys-nav-bg:${navBg}`,
      // Not white whatever the industry's colour turns out to be: the better
      // of light and dark on that colour, then moved until it can be read.
      `--sys-nav-text:${navText}`,
      `--sys-nav-sub:${C ? C.readableOn(C.pickOn(navBg), navBg, C.LARGE) : "#e2e8f0"}`,
      // The module you are on, and the one under the pointer. A wash of white
      // over the heading colour used to mark both, which lightens the ground
      // under light words — so the one module you most need to read was the
      // hardest to. They now go the other way from the words on them, which
      // is both readable and the deeper-looking of the two.
      `--sys-nav-active-bg:${navStep(0.22)}`,
      `--sys-nav-hover-bg:${navStep(0.12)}`,
      // The industry's own colour, where a word is drawn in it — on the card
      // and on every wash, since a link sits on a selected row as often as on
      // a plain one.
      `--sys-primary-ink:${onEvery(primary)}`,
      // And where a word is drawn in it ON a wash of it — which is what a
      // state the app has no name for gets, and there are more of those than
      // there are named ones: "Low stock", "Out of stock", "Coming soon". The
      // wash is written as the colour it really ends up, so what sits on it
      // can be measured instead of assumed.
      `--sys-primary-tint:${tint(primary, dark ? 0.86 : 0.88)}`,
      `--sys-primary-on-tint:${ink(primary, tint(primary, dark ? 0.86 : 0.88))}`,
      `--sys-accent-tint:${tint(accent, dark ? 0.86 : 0.88)}`,
      `--sys-accent-on-tint:${ink(accent, tint(accent, dark ? 0.86 : 0.88))}`,
      ...statusVars,
      `--sys-border:${dbg.border}`,
      `--sys-radius:${radius}px`,
      `--sys-radius-sm:${Math.max(4, radius - 4)}px`,
      `--sys-radius-lg:${Math.min(20, radius + 6)}px`,
      // The generated app's controls read the app's own --sans; inside it,
      // that is the system's typeface.
      `--sans:${fontStack(spec.theme.font)}`,
    ].join(";");
  }
  // Typefaces already on the machine — nothing is fetched. Names are in single
  // quotes because the variables are written into a double-quoted style attribute.
  const FONTS = {
    sans: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
    serif: "'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, serif",
    rounded: "ui-rounded, 'SF Pro Rounded', 'Arial Rounded MT Bold', 'Segoe UI', sans-serif",
    humanist: "Seravek, 'Gill Sans Nova', 'Gill Sans', Ubuntu, Calibri, sans-serif",
    mono: "ui-monospace, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace",
  };
  const DESIGN = {
    shell: ['sidebar', 'top', 'dock', 'cards-nav', 'command'],
    font: Object.keys(FONTS),
    density: ['compact', 'comfortable', 'spacious'],
    surface: ['flat', 'outlined', 'elevated'],
  };

  /** A system's design, read from its spec: shell, typeface, density and surface. */
  function designOf(spec) {
    if (!spec) return null;
    return {
      shell: spec.layout && spec.layout.shell,
      font: spec.theme && spec.theme.font,
      density: spec.theme && spec.theme.density,
      surface: spec.theme && spec.theme.surface,
    };
  }

  /**
   * The choices that suit a kind of business, for when the app picks: a
   * restaurant is not set in a terminal's typeface, nor a dispatch desk spaced
   * like a boutique. A kind not listed may take any.
   */
  const FIT = {
    restaurant: { shell: ['cards-nav', 'top', 'sidebar'], font: ['serif', 'rounded', 'humanist'] },
    hotel: { shell: ['cards-nav', 'sidebar', 'command'], font: ['serif', 'humanist', 'sans'], density: ['comfortable', 'spacious'] },
    healthcare: { shell: ['command', 'sidebar', 'dock'], font: ['sans', 'humanist', 'rounded'] },
    education: { shell: ['top', 'sidebar', 'cards-nav'], font: ['rounded', 'humanist', 'sans'] },
    fitness: { shell: ['cards-nav', 'dock', 'command'], font: ['rounded', 'sans'], density: ['comfortable', 'spacious'] },
    realestate: { shell: ['sidebar', 'cards-nav', 'top'], font: ['serif', 'sans', 'humanist'] },
    retail: { shell: ['cards-nav', 'top', 'sidebar'], font: ['rounded', 'humanist', 'serif'], density: ['comfortable', 'spacious'] },
    logistics: { shell: ['dock', 'sidebar', 'command'], font: ['mono', 'sans'], density: ['compact', 'comfortable'] },
    manufacturing: { shell: ['dock', 'command', 'sidebar'], font: ['mono', 'sans'], density: ['compact', 'comfortable'] },
    hr: { shell: ['command', 'sidebar', 'top'], font: ['humanist', 'sans', 'rounded'] },
    legal: { shell: ['command', 'sidebar'], font: ['serif', 'sans'] },
    jewelry: { shell: ['cards-nav', 'sidebar', 'top'], font: ['serif', 'humanist'], density: ['comfortable', 'spacious'] },
    saas: { shell: ['top', 'sidebar', 'command'], font: ['sans', 'mono'], density: ['compact', 'comfortable'] },
  };
  function suited(domain, key, list) {
    const fit = (FIT[domain] || {})[key];
    const both = fit ? list.filter((v) => fit.includes(v)) : list;
    return both.length ? both : list;
  }

  const sameCount = (a, b) => Object.keys(DESIGN).filter((k) => a[k] === b[k]).length;

  /**
   * A design that differs from the one before on at least two of its four
   * choices. Any choice missing or unknown is picked; then, while three or
   * more match the last system's, the matching ones are changed in turn —
   * typeface first, shell last, since a model's choice of shell is the one
   * most worth keeping. `pick(list)` chooses; the mode passes a random one.
   */
  function varyFrom(previous, design, pick, domain = '') {
    const out = { ...design };
    for (const k of Object.keys(DESIGN)) if (!DESIGN[k].includes(out[k])) out[k] = pick(suited(domain, k, DESIGN[k]));
    if (!previous) return out;
    for (const k of ['font', 'surface', 'density', 'shell']) {
      if (sameCount(previous, out) <= 2) break;
      if (out[k] === previous[k]) out[k] = pick(suited(domain, k, DESIGN[k].filter((v) => v !== previous[k])));
    }
    return out;
  }

  /**
   * How a system's opening dashboard is laid out: the table beside its charts
   * ("operational"), its records by stage ("pipeline", which needs a stage
   * field), or one headline figure over the months ("focus"). Unset, it is
   * whichever of these the last system did not use and this one can show.
   */
  const DASHBOARDS = ['operational', 'pipeline', 'focus'];
  function dashboardFor(chosen, previous, canPipeline, pick) {
    const can = DASHBOARDS.filter((d) => d !== 'pipeline' || canPipeline);
    if (can.includes(chosen)) return chosen;
    const fresh = can.filter((d) => d !== previous);
    return pick(fresh.length ? fresh : can);
  }

  /** The typeface stack for a design's font. */
  const fontStack = (font) => FONTS[font] || FONTS.sans;

  window.HCSystemsTheme = { themeVars, surfacesOf, shadesOf, safeHex, shadeHex, hexToRgb, DOMAIN_BG, FONTS, DESIGN, FIT, designOf, varyFrom, fontStack, DASHBOARDS, dashboardFor };
})();
