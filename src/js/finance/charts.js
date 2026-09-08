// ==============================================================
// The pictures the Finance mode draws of a person's money
//
// A chart is read faster than the table beside it and trusted more, so a chart
// that is wrong is worse than no chart: nothing about it looks wrong. These
// take a chart description and return SVG, which means they can be handed data
// and asked what they drew.
//
// Pure: takes numbers and labels, returns markup. No DOM, no network.
//
// Loaded before the Finance mode and published as window.HCFinanceCharts.
// Checked by scripts/checks/finance-charts.mjs.
// ==============================================================

(function () {
  'use strict';

  const COLORS = ["#10b981","#6366f1","#f59e0b","#f43f5e","#06b6d4","#a78bfa","#fb923c","#34d399"];

  /**
   * A figure, or null when there is not one.
   *
   * Everything on a chart goes through here, because JavaScript reads several
   * kinds of "no value" as zero: `Number(null)`, `Number("")` and `Number([])`
   * are all 0. Leaning on Number alone put a point with no figure on the chart
   * at zero, which is a month of no spending that never happened.
   */
  function figure(v) {
    if (v === null || v === undefined || v === "" || typeof v === "boolean") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  function formatNum(v) {
    // A model writes null for a point it has no figure for, and this used to be
    // handed it directly: the call threw, the render stopped, and the whole
    // report went with it.
    const num = figure(v);
    if (num === null) return "–";
    v = num;
    const a = Math.abs(v);
    if (a >= 1e9) return (v / 1e9).toFixed(1) + "B";
    if (a >= 1e6) return (v / 1e6).toFixed(1) + "M";
    if (a >= 1e3) return (v / 1e3).toFixed(1) + "K";
    return v.toFixed(a < 1 ? 2 : 0);
  }

  function escHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  /**
   * The finite numbers in a set of datasets, for working out the axis.
   *
   * A value that is not a number would otherwise carry through every
   * calculation: one of them makes the range not-a-number, and every
   * coordinate on the chart follows it.
   */
  function finiteValues(datasets) {
    return (datasets || []).flatMap(d => (d.values || []).map(figure)).filter(v => v !== null);
  }

  function renderBarChart(c, svgId) {
    const W = 600, H = 300, padL = 56, padR = 20, padT = 28, padB = 52;
    const labels   = c.labels   || [];
    const datasets = c.datasets || [];
    const n        = labels.length;
    if (!n) return "";

    const allVals = finiteValues(datasets);
    const maxV    = Math.max(...allVals, 1);
    const minV    = Math.min(0, ...allVals);
    const range   = maxV - minV || 1;
    const plotW   = W - padL - padR;
    const plotH   = H - padT - padB;
    const groupW  = plotW / n;
    const barW    = Math.max(6, (groupW * 0.72) / datasets.length);
    const gapBetween = (groupW * 0.28) / (datasets.length + 1);

    /* grid + Y-axis labels */
    let gridLines = "", yLabels = "";
    for (let i = 0; i <= 4; i++) {
      const v = minV + (range * i / 4);
      const y = padT + plotH - (plotH * (v - minV) / range);
      gridLines += `<line x1="${padL}" y1="${y.toFixed(1)}" x2="${W - padR}" y2="${y.toFixed(1)}" stroke="rgba(100,116,139,.10)" stroke-width="1"/>`;
      yLabels   += `<text x="${padL - 6}" y="${(y + 4).toFixed(1)}" text-anchor="end" font-size="9.5" fill="#64748b">${formatNum(v)}</text>`;
    }
    const zeroY = padT + plotH - (plotH * (0 - minV) / range);
    gridLines += `<line x1="${padL}" y1="${zeroY.toFixed(1)}" x2="${W - padR}" y2="${zeroY.toFixed(1)}" stroke="rgba(100,116,139,.28)" stroke-width="1"/>`;

    /* bars + value labels on top */
    let bars = "", valLabels = "", legend = "";
    datasets.forEach((ds, di) => {
      const col = ds.color || COLORS[di % COLORS.length];
      (ds.values || []).forEach((raw, vi) => {
        // No figure means no bar. A bar of zero height still reads as a
        // measurement of nothing rather than the absence of one.
        const v = figure(raw);
        if (v === null) return;
        const x   = padL + vi * groupW + gapBetween * (di + 1) + di * barW;
        const bH  = Math.max(2, Math.abs(plotH * v / range));
        const y   = v >= 0 ? zeroY - bH : zeroY;
        const cx  = x + barW / 2;
        bars += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${bH.toFixed(1)}" rx="3" fill="${col}" opacity=".88"/>`;
        /* value label — show if bar is wide enough (skip tiny bars) */
        if (barW >= 14) {
          const lbl  = formatNum(v);
          const ly   = v >= 0 ? y - 5 : y + bH + 13;
          valLabels += `<text x="${cx.toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="middle" font-size="9" font-weight="700" fill="${col}">${escHtml(lbl)}</text>`;
        }
      });
      if (datasets.length > 1) {
        legend += `<g transform="translate(${padL + di * 130},${H - 12})">
          <rect x="0" y="-8" width="10" height="10" rx="2" fill="${col}"/>
          <text x="14" y="0" font-size="10" fill="#94a3b8">${escHtml(ds.label)}</text>
        </g>`;
      }
    });

    /* X-axis labels */
    let xLabels = "";
    labels.forEach((lbl, i) => {
      const x = padL + i * groupW + groupW / 2;
      /* truncate long labels */
      const short = lbl.length > 10 ? lbl.slice(0, 9) + "…" : lbl;
      xLabels += `<text x="${x.toFixed(1)}" y="${H - padB + 16}" text-anchor="middle" font-size="10" fill="#64748b">${escHtml(short)}</text>`;
    });

    return `<svg id="${svgId}" class="fin-chart-svg" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${W}" height="${H}" fill="#0b0f1c" rx="10"/>
      ${gridLines}${yLabels}${bars}${valLabels}${xLabels}${legend}
    </svg>`;
  }

  /* ── line chart ─────────────────────────────────────────────────── */
  function renderLineChart(c, svgId) {
    const W = 600, H = 300, padL = 56, padR = 20, padT = 32, padB = 52;
    const labels   = c.labels   || [];
    const datasets = c.datasets || [];
    const n        = labels.length;
    if (!n) return "";

    const allVals = finiteValues(datasets);
    const maxV    = Math.max(...allVals, 1);
    const minV    = Math.min(0, ...allVals);
    const range   = maxV - minV || 1;
    const plotW   = W - padL - padR;
    const plotH   = H - padT - padB;

    /* grid + Y-axis */
    let gridLines = "", yLabels = "";
    for (let i = 0; i <= 4; i++) {
      const v = minV + (range * i / 4);
      const y = padT + plotH - (plotH * (v - minV) / range);
      gridLines += `<line x1="${padL}" y1="${y.toFixed(1)}" x2="${W - padR}" y2="${y.toFixed(1)}" stroke="rgba(100,116,139,.10)" stroke-width="1"/>`;
      yLabels   += `<text x="${padL - 6}" y="${(y + 4).toFixed(1)}" text-anchor="end" font-size="9.5" fill="#64748b">${formatNum(v)}</text>`;
    }

    let paths = "", dots = "", dotLabels = "", legend = "", defs = "";
    datasets.forEach((ds, di) => {
      const col  = ds.color || COLORS[di % COLORS.length];
      const vals = ds.values || [];
      // A point with no figure is left out, not drawn at zero. Drawing it at
      // zero would show a month of nothing where the truth is that nothing was
      // recorded, and on a chart of somebody's money those read very
      // differently. The line closes over the gap; the x positions still come
      // from the original place in the series, so the months stay put.
      const pts = vals
        .map((v, i) => ({ v: figure(v), i }))
        .filter(p => p.v !== null)
        .map(({ v, i }) => ({
          v,
          x: padL + (i / (n - 1 || 1)) * plotW,
          y: padT + plotH - (plotH * (v - minV) / range),
        }));
      if (!pts.length) return;
      let d = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
      for (let i = 1; i < pts.length; i++) {
        const mx = ((pts[i - 1].x + pts[i].x) / 2).toFixed(1);
        d += ` C ${mx} ${pts[i-1].y.toFixed(1)}, ${mx} ${pts[i].y.toFixed(1)}, ${pts[i].x.toFixed(1)} ${pts[i].y.toFixed(1)}`;
      }
      const zeroY  = Math.min(padT + plotH, Math.max(padT, padT + plotH - (plotH * (0 - minV) / range)));
      const areaD  = d + ` L ${pts[pts.length-1].x.toFixed(1)} ${zeroY.toFixed(1)} L ${pts[0].x.toFixed(1)} ${zeroY.toFixed(1)} Z`;
      const gradId = `lg${di}${svgId.replace(/[^a-z0-9]/gi, "")}`;
      defs  += `<linearGradient id="${gradId}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${col}" stop-opacity=".20"/><stop offset="100%" stop-color="${col}" stop-opacity="0"/></linearGradient>`;
      paths += `<path d="${areaD}" fill="url(#${gradId})"/><path d="${d}" stroke="${col}" stroke-width="2.2" fill="none" stroke-linecap="round"/>`;

      /* dots + value labels — alternate above/below to reduce overlap */
      pts.forEach((pt, pi) => {
        dots += `<circle cx="${pt.x.toFixed(1)}" cy="${pt.y.toFixed(1)}" r="4" fill="${col}" stroke="#0b0f1c" stroke-width="1.5"/>`;
        const above = pi % 2 === 0;
        const ly    = above ? pt.y - 10 : pt.y + 18;
        const lbl   = formatNum(pt.v);
        /* pill background */
        const lblW  = lbl.length * 5.5 + 6;
        dotLabels  += `<rect x="${(pt.x - lblW / 2).toFixed(1)}" y="${(ly - 11).toFixed(1)}" width="${lblW.toFixed(1)}" height="13" rx="3" fill="#0b0f1c" opacity=".72"/>`;
        dotLabels  += `<text x="${pt.x.toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="middle" font-size="9" font-weight="700" fill="${col}">${escHtml(lbl)}</text>`;
      });

      if (datasets.length > 1) {
        legend += `<g transform="translate(${padL + di * 130},${H - 12})"><line x1="0" y1="-4" x2="14" y2="-4" stroke="${col}" stroke-width="2.2"/><text x="18" y="0" font-size="10" fill="#94a3b8">${escHtml(ds.label)}</text></g>`;
      }
    });

    let xLabels = "";
    labels.forEach((lbl, i) => {
      const x     = padL + (i / (n - 1 || 1)) * plotW;
      const short = lbl.length > 10 ? lbl.slice(0, 9) + "…" : lbl;
      xLabels += `<text x="${x.toFixed(1)}" y="${H - padB + 16}" text-anchor="middle" font-size="10" fill="#64748b">${escHtml(short)}</text>`;
    });

    return `<svg id="${svgId}" class="fin-chart-svg" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
      <defs>${defs}</defs>
      <rect width="${W}" height="${H}" fill="#0b0f1c" rx="10"/>
      ${gridLines}${yLabels}${paths}${dots}${dotLabels}${xLabels}${legend}
    </svg>`;
  }

  /* ── donut chart ────────────────────────────────────────────────── */
  function renderDonutChart(c, svgId) {
    const W = 620, H = 300;
    const cx = 148, cy = 150, r = 96, sw = 36;
    const labels = c.labels || [];
    // Each slice keeps hold of its own label.
    //
    // The values used to be filtered on their own and the labels read back by
    // position afterwards, so dropping one value shifted every label after it
    // onto the wrong slice. A category worth nothing — a refund month, a nil
    // line — was enough to put the wrong name on the biggest slice of a
    // spending chart, and the chart still looked perfectly reasonable.
    const slices = (c.datasets?.[0]?.values || [])
      .map((v, i) => ({ v: figure(v), label: labels[i] || "", idx: i }))
      .filter(s => s.v !== null && s.v > 0);
    if (!slices.length) return "";
    const vals = slices.map(s => s.v);

    /* If values look like percentages treat as display-only %.
       Criteria: sum within 1% of 100 AND at least half the values have decimal parts
       (real money amounts are almost never all between 0-100 AND sum to exactly 100). */
    const sum         = vals.reduce((a, b) => a + b, 0);
    const nearHundred = sum > 99 && sum < 101;
    const hasDecimals = vals.filter(v => v % 1 !== 0).length >= vals.length / 2;
    const looksLikePct = nearHundred && (hasDecimals || vals.every(v => v < 100));
    const total        = looksLikePct ? sum : (sum || 1);
    const circ         = 2 * Math.PI * r;

    /* Sort by value descending so largest segment starts at top */
    const sorted = slices.slice().sort((a, b) => b.v - a.v);

    let offset = 0, segments = "", legend = "";
    sorted.forEach(({ v, label, idx }, si) => {
      const col  = COLORS[idx % COLORS.length];
      const pct  = v / total;
      const dash = pct * circ;
      const gap  = circ - dash;
      const rot  = offset * 360 - 90;
      /* slightly separate segments with a tiny gap */
      const gapPx = Math.max(0.5, circ * 0.006);
      segments += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${col}" stroke-width="${sw}"
        stroke-dasharray="${Math.max(0, dash - gapPx).toFixed(2)} ${(gap + gapPx).toFixed(2)}"
        transform="rotate(${rot.toFixed(2)} ${cx} ${cy})" opacity=".92"/>`;
      offset += pct;

      /* legend row */
      const lx  = cx * 2 + 20;
      const ly  = 36 + si * 34;
      const amt = looksLikePct ? "" : ` · ${formatNum(v)}`;
      legend += `
        <rect x="${lx}" y="${ly - 10}" width="12" height="12" rx="3" fill="${col}"/>
        <text x="${lx + 18}" y="${ly}" font-size="11.5" fill="#e2e8f0">${escHtml(label)}</text>
        <text x="${W - 14}" y="${ly}" text-anchor="end" font-size="11.5" fill="${col}" font-weight="700">${(pct * 100).toFixed(1)}%${escHtml(amt)}</text>`;
    });

    /* center: show total amount (or % sum) */
    const centerTotal   = looksLikePct ? "100%" : formatNum(total);
    /* largest category label, truncated */
    const topLabel      = (sorted[0]?.label || "").slice(0, 10);
    const centerLabel   = `
      <text x="${cx}" y="${cy - 14}" text-anchor="middle" font-size="10.5" fill="#64748b" letter-spacing="0.5">TOTAL</text>
      <text x="${cx}" y="${cy + 12}" text-anchor="middle" font-size="22" fill="#f1f5f9" font-weight="800">${escHtml(centerTotal)}</text>
      <text x="${cx}" y="${cy + 30}" text-anchor="middle" font-size="9.5" fill="#64748b">${escHtml(topLabel)}</text>`;

    return `<svg id="${svgId}" class="fin-chart-svg" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${W}" height="${H}" fill="#0b0f1c" rx="10"/>
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="rgba(100,116,139,.10)" stroke-width="${sw}"/>
      ${segments}${centerLabel}${legend}
    </svg>`;
  }

  window.HCFinanceCharts = { renderBarChart, renderLineChart, renderDonutChart, formatNum, COLORS };
})();
