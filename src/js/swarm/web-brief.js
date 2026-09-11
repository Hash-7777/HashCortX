// ==============================================================
// What every agent on a website task is told about the site
//
// Each agent on a web task was handed the same note: write index.html,
// styles.css and app.js, with Tailwind from its CDN. That note contradicted
// the team it was sent to. A team that had agreed on style.css and script.js
// got HTML linking one pair of names and a stylesheet saved under the other,
// and every agent — the one meant for the stylesheet, the one meant for the
// script — was told to write all three files. They did: each wrote its own
// index.html and ran out of room before reaching the file it was there for.
//
// What it says now:
//
//  - The site's files are the ones the team agreed, by their exact names.
//  - Each agent writes the files its own instructions give it and refers to
//    the rest by name. The agent that delivers the answer writes every file,
//    complete, and makes them agree, since it is the only one who sees them
//    all together.
//  - A bar for the result that a first draft does not clear by accident: real
//    content for the request rather than stand-ins, a visual identity chosen
//    for the subject, sections with depth, every control working, motion, and
//    a layout that holds from a phone to a wide screen.
//
// Pure: text in, text out. Loaded before the Agent Swarm and published as
// window.HCSwarmWebBrief. Checked by scripts/checks/swarm-web-brief.mjs.
// ==============================================================

(function () {
  'use strict';

  const WEB_TASK = /website|web ?site|webpage|web page|web app|landing page|frontend|front-end|html|tailwind|react|vue|svelte|portfolio|dashboard/i;
  const SITE_FILE = /\.(html?|css|m?js)$/i;
  const DEFAULT_FILES = ['index.html', 'styles.css', 'app.js'];
  const LANG = { html: 'html', htm: 'html', css: 'css', js: 'javascript', mjs: 'javascript' };
  const ORDER = { html: 0, htm: 0, css: 1, js: 2, mjs: 2 };
  const ext = (name) => String(name).toLowerCase().split('.').pop();

  /** Whether a task is about building something for the web. */
  const isWebTask = (task) => WEB_TASK.test(String(task || ''));

  /** The site's files the team agreed on, page first, then styles, then scripts. */
  function siteFilesOf(blueprint) {
    const names = ((blueprint && blueprint.artifactContracts) || [])
      .map((c) => String((c && c.name) || '').trim())
      .filter((n) => n && !/[\s/\\]/.test(n) && SITE_FILE.test(n));
    return [...new Set(names)].sort((a, b) => ORDER[ext(a)] - ORDER[ext(b)]);
  }

  /** The note an agent on a web task is given, or '' for any other task. */
  function brief({ task, siteFiles, isFinalOwner } = {}) {
    if (!isWebTask(task)) return '';
    const files = siteFiles && siteFiles.length ? siteFiles : DEFAULT_FILES;
    const list = files.join(', ');
    const fences = files.map((f) => `\`\`\`${LANG[ext(f)] || ''} ${f}\n...the whole file...\n\`\`\``).join('\n');
    const who = isFinalOwner
      ? `You deliver the finished site. Write EVERY one of these files, each complete: ${list}. You are the only agent who sees all of them together, so make them agree — every class, id, element and file name used in one exists in the others. Where an input is missing or broken, write that file yourself.`
      : `Write only the files your own instructions give you, each complete. Refer to the others by these names; do not write them.`;
    return `\n\nTHE SITE'S FILES: ${list}. These exact names replace any other file names in your instructions. ${who}
Put each file in one fenced block with its name after the language:
${fences}
Never split a file across blocks and never stop in the middle of one.

THE BAR FOR THE RESULT:
- Real content for this request. Headings, copy, names, projects, prices and numbers that fit it. Where the request leaves a detail open — a person's name, a company — invent a realistic one and keep it consistent. Never "John Doe", "Lorem ipsum", "Project One", "A brief description of…", "Your Name", or example.com.
- A visual identity chosen for the subject: two or three colours plus one accent (not a framework's default blue), a heading and a body font from Google Fonts, one spacing scale and one corner radius, all set once as CSS custom properties. Write plain CSS in the stylesheet; do not pull in a CSS framework unless the request asks for one.
- Sections with depth: a first screen that says what this is and what to do next, content with hierarchy (cards with details, tags and real links), and a footer. It holds from a 360 px phone to a wide screen with no sideways scrolling.
- Everything works. Every button, link, form and toggle does something real; navigation reaches sections that exist; a form checks its fields and shows what happened.
- Motion that helps: hover and focus states on everything that can be pressed, a light entrance or reveal on scroll, and a prefers-reduced-motion fallback.
- Images from remote HTTPS addresses with alt text, a fixed aspect ratio, object-fit, and an onerror fallback to an inline SVG or data URI. No local paths that are not among the files.
- The finished site is code only: no reports, plans or commentary around it.`;
  }

  window.HCSwarmWebBrief = { isWebTask, siteFilesOf, brief, DEFAULT_FILES };
})();
