// ==============================================================
// Reading the team's work the way a person would open it
//
// THE DEFECT THIS FIXES. The app took the agents at their word. Whatever came
// back was saved, previewed and called finished, and the first thing that ever
// looked at it properly was the person who asked for it. One real run handed
// back a shop whose header pointed at an image that was in the project and
// never went into the page, whose products all pointed at a placeholder
// service that no longer answers, whose stylesheet called a function that
// exists in Sass and not in CSS, and whose page linked to a cart page nobody
// had written — and the run reported that the task was done.
//
// Nothing here needs a model. These are the things a person notices in the
// first ten seconds and code can see in a millisecond, so the app sees them
// first: what the plan owed and nobody wrote, a file that points at a file
// that is not there, an id a script reaches for that the page does not have,
// a class the markup leans on that nothing styles, text left over from a
// template, a file that stops in the middle, and an address that is known not
// to answer.
//
// It reports. It changes nothing. What can be repaired safely is repaired
// where the page is built (js/swarm/site.js); what cannot is said plainly, so
// the team can be asked to put it right and the person is never told a broken
// result is a finished one.
//
// It is written for any kind of work, not for websites. A campaign, a plan or
// a report is checked for what it owes, for template text and for a file that
// stops mid-sentence; the markup checks simply find nothing to look at.
//
// Pure: files in, findings out. No DOM, no storage, no network.
//
// Loaded before the Agent Swarm and published as window.HCSwarmProjectCheck.
// Checked by scripts/checks/swarm-project-check.mjs.
// ==============================================================

(function () {
  'use strict';

  const MAX_FINDINGS = 24;
  const MAX_NAMED = 6;
  const EMPTY_CHARS = 20;

  // Addresses that used to serve placeholder images and no longer answer. A
  // page full of these looks broken in exactly the way an unfinished page
  // looks broken, and nothing in the markup says why.
  const DEAD_HOSTS = [
    'via.placeholder.com', 'placeholder.com', 'placehold.it', 'lorempixel.com',
    'unsplash.it', 'placeimg.com', 'fillmurray.com', 'placecage.com', 'baconmockup.com',
  ];

  // Text that belongs to a template rather than to this request.
  const TEMPLATE_TEXT = [
    [/lorem ipsum/i, 'lorem ipsum'],
    [/\bjohn doe\b|\bjane doe\b/i, 'a made-up name'],
    [/\bproject (?:one|two|three)\b/i, 'Project One'],
    [/\bexample\.com\b/i, 'example.com'],
    [/\byour name here\b|\[your name\]/i, 'a name that was never filled in'],
    [/a brief description of/i, 'a description that was never written'],
    [/\bTODO\b|\bFIXME\b|\bcoming soon\b/i, 'work left for someone else'],
  ];

  // Sass, in a file the browser reads as CSS. The browser drops the whole
  // declaration, so the colour, the mixin or the variable simply does nothing.
  const SASS_IN_CSS = [
    [/\b(?:darken|lighten|saturate|desaturate|mix|rgba?\s*\(\s*\$)\s*\(/, 'a Sass colour function'],
    [/@(?:mixin|include|extend|use|forward)\b/, 'a Sass rule'],
    [/^\s*\$[\w-]+\s*:/m, 'a Sass variable'],
  ];

  const lower = (s) => String(s || '').toLowerCase();
  const baseName = (p) => lower(p).split(/[?#]/)[0].split('/').pop();
  const isHtml = (n) => /\.html?$/.test(n);
  const isCss = (n) => /\.css$/.test(n);
  const isJs = (n) => /\.m?js$/.test(n);
  const asMap = (files) => (files && typeof files.get === 'function' ? files : new Map(Object.entries(files || {})));

  /** A reference a page makes to something outside itself. */
  const REF = /(?:src|href)\s*=\s*["']([^"']+)["']/gi;
  const OUTSIDE = /^(?:https?:|data:|blob:|mailto:|tel:|javascript:|#|\/\/)/i;

  /** Whether the brackets in a file balance, which a file cut off does not. */
  function cutOff(code) {
    let depth = 0;
    let inString = null;
    const text = String(code);
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inString) {
        if (c === '\\') i++;
        else if (c === inString) inString = null;
        continue;
      }
      if (c === '"' || c === "'" || c === '`') { inString = c; continue; }
      if (c === '{') depth++;
      else if (c === '}') depth--;
    }
    return depth > 0;
  }

  /**
   * What is wrong with the work, in the order a person would meet it.
   *
   * `owed` is what the run's plan said the team would hand back, so a missing
   * deliverable is a finding whatever kind of work it was.
   */
  function inspect(filesIn, { owed } = {}) {
    const files = asMap(filesIn);
    const names = new Set([...files.keys()].map(lower));
    const out = [];
    const add = (level, file, what) => { if (out.length < MAX_FINDINGS) out.push({ level, file, what }); };

    // What the team said it would hand back.
    for (const name of owed || []) {
      const n = lower(name);
      if (!/\.\w{1,8}$/.test(n)) continue; // a deliverable that is not a file
      if (!names.has(n)) add('broken', n, `${n} was owed and is not here`);
    }

    for (const [rawName, file] of files) {
      const name = lower(rawName);
      const text = String((file && file.content) || '');

      if (text.trim().length < EMPTY_CHARS) { add('broken', name, `${name} is empty`); continue; }

      for (const [re, said] of TEMPLATE_TEXT) if (re.test(text)) { add('weak', name, `${name} still has ${said} in it`); break; }

      if ((isCss(name) || isJs(name)) && cutOff(text)) add('broken', name, `${name} stops in the middle — a bracket is never closed`);

      if (isCss(name)) for (const [re, said] of SASS_IN_CSS) if (re.test(text)) { add('broken', name, `${name} uses ${said}, which a browser reading CSS ignores`); break; }

      for (const host of DEAD_HOSTS) {
        if (text.includes(host)) { add('broken', name, `${name} loads images from ${host}, which no longer answers`); break; }
      }

      if (isHtml(name)) {
        const missing = new Set();
        for (const m of text.matchAll(REF)) {
          const ref = m[1].trim();
          if (!ref || OUTSIDE.test(ref)) continue;
          const base = baseName(ref);
          if (base && !names.has(base)) missing.add(base);
        }
        if (missing.size) add('broken', name, `${name} points at ${[...missing].slice(0, MAX_NAMED).join(', ')}, which ${missing.size === 1 ? 'is' : 'are'} not among the files`);
      }
    }

    // An id a script reaches for that no page has.
    const pages = [...files].filter(([n]) => isHtml(lower(n))).map(([, f]) => String(f.content || '')).join('\n');
    if (pages) {
      const ids = new Set([...pages.matchAll(/\bid\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1]));
      for (const [rawName, file] of files) {
        const name = lower(rawName);
        if (!isJs(name)) continue;
        const wanted = new Set();
        for (const m of String(file.content || '').matchAll(/getElementById\(\s*["']([^"']+)["']|querySelector(?:All)?\(\s*["']#([\w-]+)["']/gi)) {
          const id = m[1] || m[2];
          if (id && !ids.has(id)) wanted.add(id);
        }
        if (wanted.size) add('broken', name, `${name} looks for ${[...wanted].slice(0, MAX_NAMED).map((i) => `#${i}`).join(', ')}, which no page has`);
      }

      // A class the markup leans on that nothing styles.
      const styled = new Set();
      for (const [n, f] of files) {
        if (!isCss(lower(n))) continue;
        for (const m of String(f.content || '').matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) styled.add(m[1]);
      }
      for (const m of pages.matchAll(/<style[\s>][\s\S]*?<\/style>/gi)) for (const c of m[0].matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) styled.add(c[1]);
      if (styled.size) {
        const used = new Set();
        for (const m of pages.matchAll(/class\s*=\s*["']([^"']*)["']/gi)) for (const c of m[1].split(/\s+/)) if (c) used.add(c);
        const bare = [...used].filter((c) => !styled.has(c));
        if (bare.length) add('weak', 'styles', `nothing styles ${bare.slice(0, MAX_NAMED).join(', ')}${bare.length > MAX_NAMED ? ` and ${bare.length - MAX_NAMED} more` : ''}`);
      }
    }

    return out;
  }

  /** The findings as lines, worst first. */
  function linesOf(findings) {
    const list = Array.isArray(findings) ? findings : [];
    const broken = list.filter((f) => f.level === 'broken');
    const weak = list.filter((f) => f.level !== 'broken');
    return [...broken, ...weak].map((f) => f.what);
  }

  /** One sentence for the trace, or '' when there is nothing to say. */
  function summaryOf(findings) {
    const list = Array.isArray(findings) ? findings : [];
    if (!list.length) return '';
    const broken = list.filter((f) => f.level === 'broken').length;
    const weak = list.length - broken;
    const parts = [];
    if (broken) parts.push(`${broken} thing${broken === 1 ? '' : 's'} that will not work`);
    if (weak) parts.push(`${weak} that ${weak === 1 ? 'is' : 'are'} unfinished`);
    return parts.join(' and ');
  }

  /** What to ask the team to put right, or '' when nothing needs asking. */
  function repairNote(findings) {
    const lines = linesOf((Array.isArray(findings) ? findings : []).filter((f) => f.level === 'broken'));
    if (!lines.length) return '';
    return `\n\nTHESE WERE FOUND IN THE WORK AND MUST BE PUT RIGHT. Each one was read from the files themselves, not guessed at:\n${lines.map((l) => `- ${l}`).join('\n')}\nReturn the complete files you change, each in its own fenced block with its name, and change nothing else.`;
  }

  window.HCSwarmProjectCheck = { inspect, linesOf, summaryOf, repairNote, DEAD_HOSTS };
})();
