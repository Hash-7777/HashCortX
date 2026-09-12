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
      `--sys-app-text:${dark ? "#e5e7eb" : "#0f172a"}`,
      `--sys-app-sub:${dark ? "#94a3b8" : "#475569"}`,
      `--sys-app-muted:${dark ? "#64748b" : "#94a3b8"}`,
      `--sys-nav-bg:${navBg}`,
      `--sys-nav-text:#f1f5f9`,
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

  window.HCSystemsTheme = { themeVars, safeHex, shadeHex, hexToRgb, DOMAIN_BG, FONTS, DESIGN, FIT, designOf, varyFrom, fontStack, DASHBOARDS, dashboardFor };
})();
