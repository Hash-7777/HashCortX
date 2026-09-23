// ==============================================================
// What a team is actually meant to hand back
//
// THE DEFECT THIS REPLACES. Every task was sorted by regular expression into
// one of eight buckets, and each bucket had a fixed list of outputs written
// into the source. So every code build — a portfolio, a shop, a game, a
// dashboard — was given exactly index.html, styles.css and app.js, and
// everything that was not a code build was given a work plan, some specialist
// notes and a final answer. A portfolio fits that shape, which is why it came
// out well. A shop does not: it needs its catalogue somewhere, its cart
// somewhere, and more room to pass a page between agents than a bio fits in.
// Worse, the quality bar for a build demanded a fully wired cart whatever the
// task was, so a team building a landing page was held to a cart it had no
// file to put, and a team building a shop was told to wire one with nowhere
// to put it either.
//
// WHAT HAPPENS INSTEAD. The deliverables are worked out from the task itself,
// every time, for any task. The team's own architect answers first — it has
// read the request — and this reads that answer, checks it and fills what is
// missing. When no model can be reached, derive() below works the list out
// from what the task asks for, which is not a lookup: it reads which pieces
// the request implies and gives each one somewhere to live, so a shop gets a
// catalogue and a cart, a game gets a loop, and a landing page gets neither.
//
// The bar is assembled the same way, from the pieces that are actually there.
// A team is never again told to wire a cart it was not asked for.
//
// Pure: text in, plain values out. No DOM, no storage, no network. The call
// that asks a model lives in the mode, beside the one in js/swarm/ask.js.
//
// Loaded before the Agent Swarm and published as window.HCSwarmDeliverables.
// Checked by scripts/checks/swarm-deliverables.mjs.
// ==============================================================

(function () {
  'use strict';

  const MAX_ITEMS = 14;
  const MAX_BAR = 16;

  // True of every result, whoever worked the deliverables out. A model asked
  // for a task's own bar answers about that task and has no reason to repeat
  // these, so they are put back rather than relied on.
  const ALWAYS = [
    'the result answers the request that was actually made, and nothing in it is left for someone else to finish',
    'no placeholder text, no lorem ipsum, and no invented facts about a real person or business',
  ];

  const clean = (v, max) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max);

  // ── What kind of work the task is ─────────────────────────────────
  //
  // Not a bucket that decides the outputs — only a word for what the work is
  // doing, which shapes how the pieces below are read. The outputs come from
  // the pieces, not from this.
  const ASKS = /^\s*(what|why|how|when|where|who|which|whose|explain|describe|compare|summari[sz]e|is|are|does|do|did|can|should)\b/i;
  const FIXES = /\b(fix|debug|broken|failing|crash(es|ing)?|bug|regression|stack trace|error|does ?n[o']t work|not working|repair|patch)\b/i;
  const ANALYSES = /\b(analy[sz]e|analysis|research|study|survey|market|competitors?|benchmark|evaluate|assessment|feasibility|due diligence|findings|data set|dataset|csv|spreadsheet|metrics|forecast)\b/i;
  const WRITES = /\b(campaigns?|strateg(?:y|ies)|plans?|proposals?|pitch(?:es)?|briefs?|copy|content|articles?|blogs?|essays?|reports?|newsletters?|email sequences?|scripts?|white ?papers?|case stud(?:y|ies)|press releases?|social (?:media )?posts?|ad(?:vert)?s?|slogans?|brand(?:ing)?|positioning|poems?|stor(?:y|ies)|songs?|letters?|speech(?:es)?|bios?)\b/i;
  const BUILDS = /\b(build|make|create|code|develop|implement|program|write)\b[\s\S]{0,40}\b(app|application|site|website|web ?page|landing|dashboard|game|tool|script|api|service|bot|extension|plugin|widget|calculator|clone)\b|\b(website|web ?app|landing page|front-?end|back-?end|html|css|javascript|react|vue|svelte|game|dashboard|storefront|online (?:shop|store))\b/i;

  /**
   * What the work is doing. One word, used to shape the pieces, not to pick
   * them.
   *
   * Whether a request asks for something to be built is decided in
   * js/swarm/task-kind.js, which has the careful version of that reading — a
   * question about HTML is not a website, and "a to-do app in React" is. Asking
   * it rather than keeping a second copy here is the point: two readings of
   * the same question drift, and the one that is wrong is the one nobody is
   * looking at. BUILDS below is only for when that file is not loaded, as in a
   * check that loads this one on its own.
   */
  function kindOf(task) {
    const t = requestOf(task);
    if (FIXES.test(t)) return 'fix';
    const TK = typeof window !== 'undefined' && window.HCSwarmTaskKind;
    if (TK && typeof TK.isCodeBuildTask === 'function') {
      if (TK.isCodeBuildTask(t)) return 'build';
    } else if (BUILDS.test(t)) return 'build';
    if (ANALYSES.test(t)) return 'analysis';
    if (WRITES.test(t)) return 'writing';
    if (ASKS.test(t)) return 'answer';
    return 'general';
  }

  // ── The pieces a request implies ──────────────────────────────────
  //
  // Each entry is a thing a request can ask for, what it needs somewhere to
  // live, and what it means for the result to be done well. A piece is only
  // ever added when the request asks for it, and its part of the bar comes
  // with it — which is what stops a landing page being marked against a cart.
  // What a business is called is not what a page does. "A landing page for a
  // coffee shop" presents a business; it was given a product catalogue, and a
  // team with nothing to put in one handed back an empty skeleton. "Shop" or
  // "store" alone means selling only when the request is not a page that
  // presents; words about selling mean it whatever the page.
  const SELLS = /\b(online (?:shops?|stores?)|web ?shops?|storefronts?|e-?commerce|ecom|products?|catalogues?|catalogs?|menus?|listings?|inventory|items for sale|for sale|sell(?:s|ing)?|buy(?:ing)?|marketplaces?|galler(?:y|ies) of|collections? of|price lists?)\b/i;
  const SHOP_WORD = /\b(shops?|stores?)\b/i;
  const PRESENTS = /\b(landing pages?|home ?pages?|one-?page|single-?page|portfolios?|brochure|about (?:us|page))\b/i;

  const PIECES = [
    {
      id: 'catalogue',
      when: { test: (t) => SELLS.test(t) || (SHOP_WORD.test(t) && !PRESENTS.test(t)) },
      files: [{ name: 'catalogue.js', format: 'the items as data — one array, each with an id, name, price, image and description' }],
      bar: [
        'the catalogue is data in its own file, and the page is built from it rather than each item being written into the markup by hand',
        'every item has a name, a price, an image and enough description to tell it from the others',
        'a listing that can be filtered, sorted or searched does so from the data, and says when nothing matches',
      ],
    },
    {
      id: 'cart',
      when: /\b(carts?|baskets?|checkouts?|add to (?:cart|basket|bag)|shopping bags?|order (?:forms?|summary))\b/i,
      files: [{ name: 'cart.js', format: 'the cart: add, remove, change quantity, totals, and keeping it between visits' }],
      bar: [
        'the cart adds, removes, changes quantity, and keeps its count and total right everywhere they are shown',
        'the cart survives a reload, and shows an empty state before anything is in it',
        'every cart control is wired — nothing is a button that looks right and does nothing',
      ],
    },
    {
      id: 'server',
      when: /\b(auth|logins?|sign ?ups?|sign ?ins?|accounts?|admin|databases?|db|persist|orders?|payments?|stripe|checkouts?|bookings?|reservations?|cms|apis?|back-?end|servers?|multi-?user)\b/i,
      files: [{ name: 'server.js', format: 'the server: its routes, what it stores, and how the page talks to it' }],
      bar: [
        'the server owns what must outlive one browser, and the page never pretends to do it alone',
        'each route states what it takes and what it returns, and refuses what it should refuse',
      ],
    },
    {
      id: 'game',
      when: /\b(games?|playable|players?|scores?|leaderboards?|levels?|enemies|puzzles?|arcade|platformer|shooters?|snake|tetris|pong)\b/i,
      files: [{ name: 'game.js', format: 'the game: its loop, state, input and rules' }],
      bar: [
        'the game runs a real loop, is playable start to finish, and can be lost or won',
        'input works by keyboard and by pointer where that makes sense, and the game can be paused and restarted',
        'the score and any progress are shown while playing, not only at the end',
      ],
    },
    {
      id: 'charts',
      when: /\b(dashboards?|charts?|graphs?|analytics|visuali[sz]|kpis?|metrics|report(?:ing)? screens?|statistics)\b/i,
      files: [{ name: 'charts.js', format: 'the figures and how each one is drawn' }],
      bar: [
        'every figure drawn comes from the data in the page, and no chart is a picture of numbers that are not there',
        'each chart says what it measures and over what period, and reads correctly when there is no data yet',
      ],
    },
    {
      id: 'posts',
      when: /\b(blogs?|posts?|articles?|news|journals?|changelogs?|updates? pages?|recipes?)\b/i,
      files: [{ name: 'posts.js', format: 'the entries as data — title, date, summary and body' }],
      bar: ['the entries are data in their own file, each with a title, a date and real body text, and the page is built from them'],
    },
    {
      id: 'form',
      when: /\b(contact forms?|sign ?up forms?|forms?|subscribe|newsletters?|bookings?|enquir(?:y|ies)|inquir(?:y|ies)|quote requests?)\b/i,
      files: [],
      bar: [
        'every form checks its fields, says what is wrong next to the field that is wrong, and says what happened when it is sent',
      ],
    },
    {
      id: 'auth_ui',
      when: /\b(logins?|sign ?ins?|sign ?ups?|register|account pages?|profile pages?|dashboards? for users)\b/i,
      files: [],
      bar: ['the signed-in and signed-out states are both built, and one is not a screen that cannot be reached'],
    },
  ];

  // Pages a request names by their own name. A request that names sections is
  // asking for them; a single-page request is not turned into five files.
  const PAGE_WORDS = /\b(about|contact|pricing|faq|blog|shop|products?|services?|team|careers|checkout|cart|login|dashboard|gallery|portfolio)\s+page\b/ig;
  const MULTI_PAGE = /\b(multi-?page|several pages|pages for|separate pages|site map|navigation between pages)\b/i;
  const SINGLE_PAGE = /\b(one-?page|single-?page|landing page|one page)\b/i;

  /**
   * The pieces this request asks for.
   *
   * Only for work that builds something. A piece says where a thing lives and
   * what it must do when built; asked about a bug fix or a market analysis it
   * would hold the work to requirements for software nobody is writing — the
   * mention of a login in "fix the login bug" is not a request for one.
   */
  /**
   * What was actually asked for: the request and the answers given to the
   * questions before the run, without the questions left unanswered.
   *
   * Those are appended to a task as "Not given: …" (js/swarm/clarify.js), and
   * they are the team's questions, not the person's wishes. Read as the
   * request, a skipped "Which payment provider would you like?" asked for a
   * payment server on a site nobody wanted one on.
   */
  const requestOf = (task) => String(task || '').replace(/\n\nNot given:[\s\S]*$/, '');

  function piecesOf(task, kind) {
    const t = requestOf(task);
    if ((kind || kindOf(t)) !== 'build') return [];
    return PIECES.filter((p) => p.when.test(t));
  }

  /** Extra pages the request names, beyond the first. */
  function extraPagesOf(task) {
    const t = requestOf(task);
    if (SINGLE_PAGE.test(t)) return [];
    const named = new Set();
    let m;
    PAGE_WORDS.lastIndex = 0;
    while ((m = PAGE_WORDS.exec(t)) !== null) named.add(m[1].toLowerCase().replace(/s$/, ''));
    if (!named.size && MULTI_PAGE.test(t)) return [];
    return [...named].slice(0, 5).map((n) => `${n}.html`);
  }

  // ── The fallback, worked out from the task ────────────────────────

  /**
   * The deliverables for a task, worked out here.
   *
   * Used when no model could be asked. It is not a lookup: what comes back
   * depends on what the request asks for, so two builds do not get the same
   * list unless they ask for the same things.
   */
  function derive(task) {
    const kind = kindOf(task);
    const pieces = piecesOf(task, kind);
    const items = [];
    const bar = [...ALWAYS];

    if (kind === 'build') {
      items.push({ name: 'plan.md', owner: 'planner', required: true, format: 'what is being built, the pieces, and who writes which file' });
      items.push({ name: 'index.html', owner: 'coder', required: true, format: 'the complete page' });
      for (const page of extraPagesOf(task)) {
        items.push({ name: page, owner: 'coder', required: true, format: 'the complete page' });
      }
      items.push({ name: 'styles.css', owner: 'coder', required: true, format: 'the complete stylesheet' });
      items.push({ name: 'app.js', owner: 'coder', required: true, format: 'the complete script that wires the page' });
      for (const p of pieces) {
        for (const f of p.files) items.push({ name: f.name, owner: 'coder', required: true, format: f.format });
      }
      bar.push(
        'every file the page names exists and is written out whole, and every name matches between them',
        'it holds from a narrow phone to a wide screen with nothing running off the side',
        'everything that can be pressed does something, and shows that it can be pressed',
      );
    } else if (kind === 'fix') {
      items.push(
        { name: 'reproduction.md', owner: 'analyst', required: true, format: 'the smallest way to see the fault happen' },
        { name: 'cause.md', owner: 'analyst', required: true, format: 'the one thing that is wrong, and why it produces what is seen' },
        { name: 'fix', owner: 'coder', required: true, format: 'the corrected code, whole, as fenced files' },
        { name: 'proof.md', owner: 'validator', required: true, format: 'what was run, and what it showed before and after' },
      );
      bar.push(
        'the cause is one identified thing, not a list of what it might be',
        'the fix changes what causes the fault and not what is near it',
        'there is something that would have failed before the fix and passes after it',
      );
    } else if (kind === 'analysis') {
      items.push(
        { name: 'questions.md', owner: 'planner', required: true, format: 'the questions the work must answer, and what would count as an answer' },
        { name: 'findings.md', owner: 'analyst', required: true, format: 'what was found, each point with what it rests on' },
        { name: 'answer.md', owner: 'supervisor', required: true, format: 'the answer, with what follows from it' },
      );
      bar.push(
        'every figure and claim says where it came from, and a guess is labelled a guess',
        'what would change the conclusion is stated, and so is what is not known',
      );
    } else if (kind === 'writing') {
      items.push(
        { name: 'brief.md', owner: 'planner', required: true, format: 'who it is for, what it must do, and the voice' },
        { name: 'draft.md', owner: 'writer', required: true, format: 'the piece itself, finished, not an outline' },
        { name: 'final.md', owner: 'supervisor', required: true, format: 'the version to use' },
      );
      bar.push(
        'it is the finished piece, not a description of the piece or a plan to write it',
        'it is written for the audience the request names, in one voice throughout',
      );
    } else {
      items.push(
        { name: 'plan.md', owner: 'planner', required: true, format: 'how the work is split, and what each part owes' },
        { name: 'work', owner: 'specialist', required: true, format: 'each part, done' },
        { name: 'answer.md', owner: 'supervisor', required: true, format: 'the one answer the person asked for' },
      );
    }

    for (const p of pieces) bar.push(...p.bar);
    return withoutUnasked(normalise({ kind, items, bar, pieces: pieces.map((p) => p.id) }, task), task);
  }

  /**
   * What a short piece or a plain question owes: the answer itself, and no
   * file. A small model asked named a file for a product description, and the
   * check that followed found the file missing and had it "repaired" over
   * the good answer.
   */
  function forSmall(task) {
    return normalise({ kind: 'answer', items: [{ name: 'the answer', owner: 'writer', required: true, format: 'the finished piece or answer, ready to use' }], bar: [...ALWAYS], pieces: [] }, task);
  }

  // ── Reading a model's answer ──────────────────────────────────────

  const SYSTEM = `You decide what a team of AI agents must hand back for a task, before they start.
List the concrete deliverables THIS task needs — the actual files, documents or artefacts that together are the finished work. Derive them from the request. Do not use a standard set.
Rules:
- Name each deliverable the way it would be saved, with an extension where it is a file.
- Anything the request implies needs somewhere to live. A shop's items belong in their own data file; a cart's behaviour in its own file; a game's loop in its own file. Do not put everything in one script.
- Only list what this request asks for. Never add a cart, a login, a database or a page the request did not ask for.
- A website whose request asks for nothing a server does is files a browser opens: no server script, no .env, no package.json, no README. Never list an image file (.png, .jpg, .ico): the team writes text, and a picture written as text is not a picture.
- List the work itself, not a plan to do the work. A campaign means the positioning, the copy for each channel, the calendar and how it is measured — not "a campaign plan" as one document. An analysis means the segments, the figures and the recommendation. Break the result into the parts it really has.
- "bar" is what it means for THIS result to be done well: statements that could be checked by looking at the result. Only include a statement that applies to this task.
- Give the last deliverable to the agent that finishes, and make it the thing the person actually receives.
- For a website that would show photographs, "photos" is up to 3 short searches for real photographs of its subject, two to four plain words each, such as "diamond engagement ring". Name the thing pictured, never a person's or a business's name. Otherwise leave it empty.
Return only JSON, no markdown:
{"kind":"build|fix|analysis|writing|answer|general","items":[{"name":"file.ext","owner":"planner|coder|analyst|writer|validator|supervisor|specialist","required":true,"format":"what this deliverable is"}],"bar":["a checkable statement about this result"],"photos":["a short search"]}`;

  /** The call that asks for a task's deliverables. */
  function messages(task) {
    return [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: `Task: ${requestOf(task).trim()}` },
    ];
  }

  // What a site that runs in the browser alone never has: a server and what
  // goes with one, and pictures an agent would have to write out as text.
  const SERVER_SIDE = /^(?:server|backend|api)\.(?:m?js|ts|py)$|^\.env|^package(?:-lock)?\.json$|\.sql$|^readme(?:\.md)?$|^config\.json$/i;
  const BINARY_IMAGE = /\.(?:png|jpe?g|gif|webp|avif|ico|bmp)$/i;

  // A format the request names is kept. Anything else a task that is not a
  // build owes is a part of its one answer, not a file of its own: a small
  // model planned four office files for a social media plan, and a team that
  // wrote the plan as one document was then found to owe four missing files
  // and sent to write them again. A build's documents are written as Markdown,
  // which every model writes well; an office file or a PDF takes a Python run.
  const ASKED_FORMAT = {
    docx: /\b(word|docx|\.doc)\b/i, xlsx: /\b(excel|xlsx|spreadsheets?|workbook)\b/i, pptx: /\b(powerpoint|pptx|slides?|slide deck|deck)\b/i,
    pdf: /\bpdf\b/i, csv: /\b(csv|spreadsheets?|excel)\b/i, md: /\b(markdown|md|readme)\b/i, txt: /\b(txt|text files?)\b/i,
  };
  const DOCUMENT = /\.(docx|xlsx|pptx|pdf|csv|md|txt)$/i;

  /** "launch_plan.md" as the part of an answer it names: "Launch plan". */
  function partOf(name) {
    const t = String(name).replace(/\.\w+$/, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
    return t.charAt(0).toUpperCase() + t.slice(1);
  }

  /**
   * A plan without what the request never needed: image files at all, since
   * an agent answers in text and a picture written as text is not one;
   * document files in formats it did not ask for; and, for a build, server
   * files when it asks for nothing a server does.
   */
  function withoutUnasked(plan, task) {
    if (!plan) return plan;
    const asked = requestOf(task);
    const seen = new Set();
    // No task owes a picture file: an agent answers in text. A small model
    // planned photos.jpg for a social media plan.
    plan.items = (plan.items || []).filter((i) => !BINARY_IMAGE.test(String(i && i.name || ''))).map((i) => {
      const ext = ((DOCUMENT.exec(String(i && i.name || '')) || [])[1] || '').toLowerCase();
      if (!ext || ASKED_FORMAT[ext].test(asked)) return i;
      if (plan.kind !== 'build') return { ...i, name: partOf(i.name) };
      return ext === 'md' || ext === 'txt' ? i : { ...i, name: i.name.replace(/\.\w+$/, '.md') };
    }).filter((i) => { const k = String(i.name).toLowerCase(); return seen.has(k) ? false : seen.add(k); });
    if (plan.kind !== 'build') return plan;
    const server = piecesOf(task, 'build').some((p) => p.id === 'server');
    plan.items = plan.items.filter((i) => server || !SERVER_SIDE.test(i.name));
    return plan;
  }

  const OWNERS = new Set(['planner', 'coder', 'analyst', 'writer', 'validator', 'supervisor', 'specialist', 'researcher', 'critic', 'custom']);
  const KINDS = new Set(['build', 'fix', 'analysis', 'writing', 'answer', 'general']);

  /**
   * A model's answer as a plan, or null when it could not be read at all —
   * which is different from a readable answer that is empty.
   */
  function readPlan(text) {
    const raw = String(text || '');
    const fenced = window.HCFences ? window.HCFences.jsonBlock(raw) : null;
    const body = fenced != null ? fenced : raw;
    const start = body.search(/[[{]/);
    if (start < 0) return null;
    const end = body.lastIndexOf(body[start] === '{' ? '}' : ']');
    let parsed = null;
    try { parsed = JSON.parse(body.slice(start, end + 1)); } catch { parsed = null; }
    if (parsed === null || typeof parsed !== 'object') return null;
    const items = Array.isArray(parsed) ? parsed : (Array.isArray(parsed.items) ? parsed.items : null);
    if (!items) return null;
    return { kind: clean(parsed.kind, 20), items, bar: Array.isArray(parsed.bar) ? parsed.bar : [], photos: Array.isArray(parsed.photos) ? parsed.photos.slice(0, 3).map((q) => clean(q, 40)) : [] };
  }

  /**
   * A plan with everything in it checked and in range, whatever it came from.
   *
   * A model that answers well is kept; one that answers thinly is topped up
   * from what the task itself asks for, so a run is never left with fewer
   * places to put things than the request needs.
   */
  function normalise(plan, task) {
    const kind = KINDS.has(plan && plan.kind) ? plan.kind : kindOf(task);
    const seen = new Set();
    const items = [];
    for (const raw of (plan && plan.items) || []) {
      const name = clean(typeof raw === 'string' ? raw : raw && raw.name, 60).replace(/[\\/]/g, '');
      if (!name || seen.has(name.toLowerCase())) continue;
      seen.add(name.toLowerCase());
      const owner = clean(raw && raw.owner, 20).toLowerCase();
      items.push({
        name,
        owner: OWNERS.has(owner) ? owner : ownerFor(name, kind),
        required: raw && raw.required === false ? false : true,
        format: clean(raw && raw.format, 200) || 'the finished piece',
      });
      if (items.length === MAX_ITEMS) break;
    }
    const bar = [];
    const seenBar = new Set();
    for (const raw of (plan && plan.bar) || []) {
      const line = clean(raw, 240);
      const key = line.toLowerCase();
      if (line.length < 8 || seenBar.has(key)) continue;
      seenBar.add(key);
      bar.push(line);
      if (bar.length === MAX_BAR) break;
    }
    return { kind, items, bar, pieces: (plan && plan.pieces) || piecesOf(task, kind).map((p) => p.id), photos: Array.isArray(plan && plan.photos) ? plan.photos : [] };
  }

  /** Who a deliverable belongs to, when nothing said. */
  function ownerFor(name, kind) {
    if (/\.(html?|css|m?js|jsx|ts|tsx|py|rb|go|rs|java|php|sql|json)$/i.test(name)) return 'coder';
    if (/^(plan|brief|questions|spec)\b/i.test(name)) return 'planner';
    if (/^(final|answer|result)\b/i.test(name)) return 'supervisor';
    if (/^(proof|validation|test)\b/i.test(name)) return 'validator';
    return kind === 'analysis' ? 'analyst' : 'specialist';
  }

  /**
   * A plan from a model, checked, with anything the task plainly needs and
   * the answer left out added back.
   */
  function merge(fromModel, task) {
    const derived = derive(task);
    if (!fromModel) return derived;
    const plan = withoutUnasked(normalise(fromModel, task), task);
    if (!plan.items.length) return derived;
    // What holds for every result holds for this one too.
    for (const line of ALWAYS) {
      if (!plan.bar.some((b) => b.toLowerCase() === line.toLowerCase())) plan.bar.unshift(line);
    }
    // A piece the request asks for that the answer gave nowhere to live gets
    // its place back — the point of the pieces is that they are not optional
    // when the request names them.
    const have = new Set(plan.items.map((i) => i.name.toLowerCase()));
    for (const p of piecesOf(task, plan.kind)) {
      for (const f of p.files) {
        if (!have.has(f.name.toLowerCase()) && plan.items.length < MAX_ITEMS) {
          plan.items.push({ name: f.name, owner: 'coder', required: true, format: f.format });
          have.add(f.name.toLowerCase());
        }
      }
      for (const line of p.bar) {
        if (plan.bar.length < MAX_BAR && !plan.bar.some((b) => b.toLowerCase() === line.toLowerCase())) plan.bar.push(line);
      }
    }
    return plan;
  }

  // ── What the plan asks of the run ─────────────────────────────────

  /** The files among the deliverables, in the order a page needs them. */
  const ORDER = { html: 0, htm: 0, css: 1, js: 2, mjs: 2, json: 3 };
  const ext = (n) => String(n).toLowerCase().split('.').pop();
  function filesOf(plan) {
    return (plan.items || [])
      .map((i) => i.name)
      .filter((n) => /\.(html?|css|m?js|json)$/i.test(n))
      .sort((a, b) => (ORDER[ext(a)] ?? 9) - (ORDER[ext(b)] ?? 9));
  }

  /**
   * How much room the run needs, from the size of what it is making.
   *
   * A fixed six thousand characters per dependency was the reason a shop
   * came apart: the page alone is longer than that, so the agent that had to
   * put the files together received them cut in half and wrote its own from
   * memory. Room now follows the work.
   *
   * There is a ceiling on the whole request as well. A per-dependency limit
   * multiplied by the number of agents is not a limit, and a validator handed
   * every answer whole was refused by every provider for being too large — so
   * the run finished with nothing checked and nothing polished.
   */
  function budgetsFor(plan) {
    const files = filesOf(plan);
    const code = plan.kind === 'build' || files.length > 0;
    const perDependency = code
      ? Math.min(24000, 6000 + files.length * 2500)
      : Math.min(12000, 4000 + (plan.items || []).length * 800);
    return {
      maxContextCharsPerDependency: perDependency,
      maxContextCharsTotal: code ? Math.min(90000, 30000 + files.length * 6000) : 36000,
      maxIntermediateWords: code ? 1400 : 900,
      maxToolRounds: 8,
      finalOutputOwnerOnly: true,
      allowToolUseByDefault: plan.kind !== 'build',
    };
  }

  /** The deliverables as the contracts the rest of the Swarm already speaks. */
  function contractsOf(plan) {
    return (plan.items || []).map((i) => ({
      name: i.name, ownerRole: i.owner, required: i.required !== false, format: i.format,
    }));
  }

  // ── Who writes what ──────────────────────────────────────────────
  //
  // THE DEFECT THIS REPLACES. Every agent was handed the same list — "Required
  // artifacts: index.html, styles.css, app.js" — and none was told which of
  // them was its own. So each one wrote what it thought the list meant, and
  // the agent meant for the stylesheet spent its answer on a page it was not
  // there to write and ran out of room before reaching the stylesheet. The
  // deliverables have carried an owner all along; nothing was using it.

  /** The words a role is known by, so an agent's own role finds its work. */
  const ROLE_WORDS = {
    planner: /plan|architect|spec|brief|lead|strateg/i,
    coder: /cod|develop|engineer|build|front|back|implement|programm/i,
    analyst: /analy|research|data|insight|market/i,
    writer: /writ|copy|content|author|edit/i,
    validator: /valid|test|qa|check|verif/i,
    critic: /critic|review|challenge/i,
    supervisor: /supervis|synthes|polish|final|deliver|assembl|aggregat|boss|lead/i,
    researcher: /research|source|invest|find/i,
    specialist: /special|expert/i,
  };

  /** Whether an agent answers to a deliverable's owner. */
  function agentMatches(agent, owner) {
    const role = String((agent && agent.role) || '').toLowerCase();
    if (role === owner) return true;
    const words = ROLE_WORDS[owner];
    return !!words && words.test(`${(agent && agent.name) || ''} ${role}`);
  }

  // What a deliverable is about, so it reaches the agent built for it. A
  // stylesheet belongs with whoever does the look of the thing, not with
  // whoever happens to be the next coder in the list.
  const AFFINITY = [
    { when: /\.html?$/i, words: /front|ui|page|markup|html|web|design|layout/i },
    { when: /\.css$/i, words: /front|ui|design|style|visual|css|layout/i },
    { when: /^(server|api|backend|db|database)\b|\.sql$/i, words: /back|server|api|infra|database|endpoint/i },
    { when: /^(catalogue|catalog|posts|data|products)\b/i, words: /data|content|catalog|product|back|research/i },
    { when: /^(cart|game|charts|app|script)\b|\.m?js$/i, words: /front|script|logic|interact|engineer|develop|behaviour|behavior/i },
  ];

  // A deliverable that IS the finished thing, rather than a part of it.
  const FINAL_NAME = /^(final|answer|result|campaign|bundle|deliverable)\b|^final[_-]/i;

  /** How well an agent suits a deliverable. Higher is better. */
  function fitScore(agent, item) {
    let score = 0;
    if (agentMatches(agent, item.owner)) score += 2;
    const who = `${(agent && agent.name) || ''} ${(agent && agent.role) || ''}`;
    for (const a of AFFINITY) {
      if (a.when.test(item.name) && a.words.test(who)) { score += 3; break; }
    }
    return score;
  }

  /**
   * Which agent writes which deliverable.
   *
   * Every deliverable gets exactly one agent, so two never write the same file
   * and none is left for whoever happens to feel responsible. An agent is
   * picked for how well it suits the piece — the stylesheet goes to whoever
   * does the look of it, the server to whoever does servers — and where
   * several suit it equally the one carrying least takes it, so two coders
   * split the work rather than one writing everything.
   *
   * The deliverer is kept back for the deliverable that IS the finished thing,
   * when the plan names one; it is not given an ordinary piece as well, since
   * it already has to make every piece agree. A plan naming no such thing
   * leaves it free, which is the case for a site, where the agent that
   * delivers writes all the files out together at the end anyway.
   */
  function assign(plan, agents, delivererId) {
    const list = Array.isArray(agents) ? agents.filter(Boolean) : [];
    const items = (plan && plan.items) || [];
    const byAgent = new Map(list.map((a) => [a.id, []]));
    if (!list.length) return byAgent;
    const deliverer = list.find((a) => a.id === delivererId) || list[list.length - 1];
    let finalAt = items.findIndex((i) => FINAL_NAME.test(i.name));
    if (finalAt < 0) finalAt = items.findIndex((i) => i.owner === 'supervisor');

    items.forEach((item, i) => {
      if (i === finalAt) { byAgent.get(deliverer.id).push(item); return; }
      const others = list.filter((a) => a.id !== deliverer.id);
      const pool = others.length ? others : list;
      let best = null;
      let bestScore = -1;
      for (const a of pool) {
        const score = fitScore(a, item);
        const load = byAgent.get(a.id).length;
        if (score > bestScore || (score === bestScore && best && load < byAgent.get(best.id).length)) {
          best = a; bestScore = score;
        }
      }
      byAgent.get((best || deliverer).id).push(item);
    });
    return byAgent;
  }

  /**
   * What one agent is told about who writes what.
   *
   * Its own work by name, then everyone else's by name so it can refer to
   * them rather than writing them again.
   *
   * The agent that delivers is told something different on purpose. It is the
   * only one that sees every piece together, so it is not told to keep off
   * the others' work — it is told it receives all of it and produces what the
   * person actually gets. Saying "do not write them" to that agent would
   * contradict the site rules in js/swarm/web-brief.js, which ask it for every
   * file, complete, and that contradiction is exactly the kind that makes an
   * agent pick one instruction and drop the other.
   */
  function ownershipNote(plan, agents, delivererId, agentId) {
    const byAgent = assign(plan, agents, delivererId);
    const mine = byAgent.get(agentId) || [];
    const list = Array.isArray(agents) ? agents : [];
    const nameOf = (id) => (list.find((a) => a.id === id) || {}).name || 'another agent';
    const others = [];
    for (const [id, items] of byAgent) {
      if (id === agentId) continue;
      for (const item of items) others.push(`${item.name} (${nameOf(id)})`);
    }
    if (!mine.length && !others.length) return '';

    const parts = [];
    if (agentId === delivererId) {
      if (mine.length) parts.push(`WHAT YOU PRODUCE:\n${mine.map((i) => `- ${i.name} — ${i.format}`).join('\n')}`);
      if (others.length) parts.push(`WHAT REACHES YOU: ${others.join(', ')}.`);
      parts.push('You deliver what the person receives, and you are the only one who sees every piece together — so make them agree: every name, reference and figure used in one must exist in the others. Where a piece you were given is missing, cut short or wrong, put it right yourself rather than passing the fault on.');
    } else {
      parts.push(mine.length
        ? `WHAT YOU WRITE, and nothing else:\n${mine.map((i) => `- ${i.name} — ${i.format}`).join('\n')}`
        : 'None of the deliverables is yours to write. Do the work your own instructions give you and hand it on.');
      if (others.length) {
        parts.push(`WRITTEN BY OTHERS: ${others.join(', ')}. Refer to these by name and rely on them. Do not write them, and do not repeat their contents back.`);
      }
    }
    return `\n\nWHO WRITES WHAT:\n${parts.join('\n\n')}`;
  }

  /** One line naming what this run owes, for the trace. */
  function summaryOf(plan) {
    const n = (plan.items || []).length;
    return `${n} deliverable${n === 1 ? '' : 's'}` + (plan.pieces && plan.pieces.length ? ` · ${plan.pieces.join(', ')}` : '');
  }

  window.HCSwarmDeliverables = {
    forSmall,
    MAX_ITEMS, MAX_BAR, PIECES, ALWAYS,
    kindOf, piecesOf, requestOf, withoutUnasked, extraPagesOf, derive, messages, readPlan, normalise, merge,
    filesOf, budgetsFor, contractsOf, summaryOf, agentMatches, fitScore, assign, ownershipNote,
  };
})();
