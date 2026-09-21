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
//  - A bar for the result that a first draft does not clear by accident.
//  - What the app itself will check by code when the team is done
//    (js/swarm/project-check.js), named exactly, so an agent is aiming at the
//    test rather than guessing at it.
//
// WHERE THE BAR COMES FROM. It used to be written out here in full, in the
// language of a portfolio — projects, cards, tags — and appended to every web
// task. So a shop was held to a portfolio's bar and told nothing about a
// catalogue, while a landing page was told to wire a cart. What is true of
// every site stays here; what is true of THIS site comes from the run's own
// deliverables (js/swarm/deliverables.js) and is passed in.
//
// Pure: text in, text out. Loaded before the Agent Swarm and published as
// window.HCSwarmWebBrief. Checked by scripts/checks/swarm-web-brief.mjs.
// ==============================================================

(function () {
  'use strict';

  // What counts as building for the web.
  //
  // This used to name a website, a portfolio and a dashboard and stop there.
  // So "a portfolio website" got the whole discipline below — the exact file
  // names, each file written out whole, the bar — and "an online shop", "a
  // storefront with a cart" and "a snake game in the browser" got none of it,
  // because none of those words appear in a task that is plainly a web build.
  // Every agent then chose its own file names and its own idea of finished,
  // which is how the same team produced a good portfolio and a broken shop.
  const WEB_TASK = /website|web ?site|webpage|web page|web ?app|landing page|home ?page|one-?page|single-?page|front-?end|back-?end|html|css|tailwind|react|vue|svelte|next\.?js|portfolio|dashboard|storefront|online (?:shop|store)|e-?commerce|ecom\b|shop(?:ping)? (?:site|page|cart)|browser game|in the browser|playable|blog site|micro-?site/i;
  const SITE_FILE = /\.(html?|css|m?js)$/i;
  const DEFAULT_FILES = ['index.html', 'styles.css', 'app.js'];
  const LANG = { html: 'html', htm: 'html', css: 'css', js: 'javascript', mjs: 'javascript' };
  const ORDER = { html: 0, htm: 0, css: 1, js: 2, mjs: 2 };
  const ext = (name) => String(name).toLowerCase().split('.').pop();

  /** Whether a task is about building something for the web, by its words. */
  const isWebTask = (task) => WEB_TASK.test(String(task || ''));

  /**
   * Whether THIS run is building for the web.
   *
   * The run's own deliverables settle it when it has some: a plan that owes an
   * .html, a .css or a .js file is building for the web whatever the request
   * happened to call itself. The words are only the fallback, for a run whose
   * deliverables have not been worked out yet.
   */
  const isWebRun = (task, siteFiles) => (Array.isArray(siteFiles) && siteFiles.length > 0) || isWebTask(task);

  /** The site's files the team agreed on, page first, then styles, then scripts. */
  function siteFilesOf(blueprint) {
    const names = ((blueprint && blueprint.artifactContracts) || [])
      .map((c) => String((c && c.name) || '').trim())
      .filter((n) => n && !/[\s/\\]/.test(n) && SITE_FILE.test(n));
    return [...new Set(names)].sort((a, b) => ORDER[ext(a)] - ORDER[ext(b)]);
  }

  /** The note an agent on a web task is given, or '' for any other task. */
  function brief({ task, siteFiles, isFinalOwner, bar } = {}) {
    if (!isWebRun(task, siteFiles)) return '';
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
- Real content for this request. Headings, copy and numbers that fit it, using every detail the request gives exactly as given. Never invent facts about the real person or business the site is for — their name, contact details, employer, projects, clients, prices or achievements. Where one is needed and not given, write a clearly marked placeholder in square brackets, such as [Your name], and keep the rest of the copy real. Never "John Doe", "Lorem ipsum", "Project One", "A brief description of…", or example.com.
- A visual identity chosen for the subject: two or three colours plus one accent (not a framework's default blue), a heading and a body font from Google Fonts, one spacing scale and one corner radius, all set once as CSS custom properties. Write plain CSS in the stylesheet; do not pull in a CSS framework unless the request asks for one.
- A first screen that says what this is and what to do next, content with real hierarchy, and a footer. It holds from a 360 px phone to a wide screen with no sideways scrolling.
- Everything works. Every button, link, form and toggle does something real; navigation reaches sections that exist.
- Motion that helps: hover and focus states on everything that can be pressed, a light entrance or reveal on scroll, and a prefers-reduced-motion fallback.
- Images from remote HTTPS addresses with alt text, a fixed aspect ratio, object-fit, and an onerror fallback to an inline SVG or data URI. No local paths that are not among the files. Never via.placeholder.com, placehold.it, lorempixel.com, unsplash.it or placeimg.com: those services stopped answering, so every image made from them is a broken image.
- The finished site is code only: no reports, plans or commentary around it.

WHAT IS CHECKED BY CODE WHEN YOU ARE DONE, so aim at it rather than at a guess:
- Every src and href that is not a web address names one of the files above. A page linking to a page nobody wrote fails here.
- Every id a script looks for exists in the markup, and every class the markup uses has a rule somewhere. Two agents inventing two different sets of class names fails here.
- Stylesheets are CSS, not Sass. darken(), \$variables, @mixin and @include do nothing in a browser.
- No lorem ipsum, no John Doe, no example.com, no TODO, and no file that stops in the middle of a bracket.
Anything found is sent back to be put right, so writing it correctly the first time is the shorter road.${forThisSite(bar)}`;
  }

  /**
   * What this particular site has to do, from the run's deliverables.
   *
   * Nothing when the run has no bar of its own, so a team is never held to a
   * requirement that came from somewhere other than its own request.
   */
  function forThisSite(bar) {
    const lines = (Array.isArray(bar) ? bar : [])
      .map((b) => String(b || '').replace(/\s+/g, ' ').trim())
      .filter(Boolean);
    if (!lines.length) return '';
    return `\n\nAND FOR THIS SITE IN PARTICULAR:\n${lines.map((l) => `- ${l}`).join('\n')}`;
  }

  window.HCSwarmWebBrief = { isWebTask, isWebRun, siteFilesOf, brief, forThisSite, DEFAULT_FILES };
})();
