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

  const clean = (v, max) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max);

  // ── What kind of work the task is ─────────────────────────────────
  //
  // Not a bucket that decides the outputs — only a word for what the work is
  // doing, which shapes how the pieces below are read. The outputs come from
  // the pieces, not from this.
  const ASKS = /^\s*(what|why|how|when|where|who|which|whose|explain|describe|compare|summari[sz]e|is|are|does|do|did|can|should)\b/i;
  const FIXES = /\b(fix|debug|broken|failing|crash(es|ing)?|bug|regression|stack trace|error|does ?n[o']t work|not working|repair|patch)\b/i;
  const ANALYSES = /\b(analy[sz]e|analysis|research|study|survey|market|competitors?|benchmark|evaluate|assessment|feasibility|due diligence|findings|data set|dataset|csv|spreadsheet|metrics|forecast)\b/i;
  const WRITES = /\b(campaign|strategy|plan|proposal|pitch|brief|copy|content|article|blog|essay|report|newsletter|email sequence|script|white ?paper|case study|press release|social (?:media )?posts?|ad(?:vert)?s?|slogan|brand(?:ing)?|positioning)\b/i;
  const BUILDS = /\b(build|make|create|code|develop|implement|program|write)\b[\s\S]{0,40}\b(app|application|site|website|web ?page|landing|dashboard|game|tool|script|api|service|bot|extension|plugin|widget|calculator|clone)\b|\b(website|web ?app|landing page|front-?end|back-?end|html|css|javascript|react|vue|svelte|game|dashboard|storefront|online (?:shop|store))\b/i;

  /** What the work is doing. One word, used to shape the pieces, not to pick them. */
  function kindOf(task) {
    const t = String(task || '');
    if (FIXES.test(t)) return 'fix';
    if (BUILDS.test(t)) return 'build';
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
  const PIECES = [
    {
      id: 'catalogue',
      when: /\b(shop|store|storefront|e-?commerce|ecom|products?|catalogue|catalog|menu|listings?|inventory|items for sale|marketplace|gallery of|collection of|price list)\b/i,
      files: [{ name: 'catalogue.js', format: 'the items as data — one array, each with an id, name, price, image and description' }],
      bar: [
        'the catalogue is data in its own file, and the page is built from it rather than each item being written into the markup by hand',
        'every item has a name, a price, an image and enough description to tell it from the others',
        'a listing that can be filtered, sorted or searched does so from the data, and says when nothing matches',
      ],
    },
    {
      id: 'cart',
      when: /\b(cart|basket|checkout|add to (?:cart|basket|bag)|shopping bag|order (?:form|summary))\b/i,
      files: [{ name: 'cart.js', format: 'the cart: add, remove, change quantity, totals, and keeping it between visits' }],
      bar: [
        'the cart adds, removes, changes quantity, and keeps its count and total right everywhere they are shown',
        'the cart survives a reload, and shows an empty state before anything is in it',
        'every cart control is wired — nothing is a button that looks right and does nothing',
      ],
    },
    {
      id: 'server',
      when: /\b(auth|login|sign ?up|sign ?in|account|admin|database|db|persist|orders?|payment|stripe|checkout|booking|reservation|cms|api|back-?end|server|multi-?user)\b/i,
      files: [{ name: 'server.js', format: 'the server: its routes, what it stores, and how the page talks to it' }],
      bar: [
        'the server owns what must outlive one browser, and the page never pretends to do it alone',
        'each route states what it takes and what it returns, and refuses what it should refuse',
      ],
    },
    {
      id: 'game',
      when: /\b(game|playable|player|score|leaderboard|level|enemies|puzzle|arcade|platformer|shooter|snake|tetris|pong)\b/i,
      files: [{ name: 'game.js', format: 'the game: its loop, state, input and rules' }],
      bar: [
        'the game runs a real loop, is playable start to finish, and can be lost or won',
        'input works by keyboard and by pointer where that makes sense, and the game can be paused and restarted',
        'the score and any progress are shown while playing, not only at the end',
      ],
    },
    {
      id: 'charts',
      when: /\b(dashboard|charts?|graphs?|analytics|visuali[sz]|kpis?|metrics|report(?:ing)? screen|statistics)\b/i,
      files: [{ name: 'charts.js', format: 'the figures and how each one is drawn' }],
      bar: [
        'every figure drawn comes from the data in the page, and no chart is a picture of numbers that are not there',
        'each chart says what it measures and over what period, and reads correctly when there is no data yet',
      ],
    },
    {
      id: 'posts',
      when: /\b(blog|posts?|articles?|news|journal|changelog|updates? page|recipes?)\b/i,
      files: [{ name: 'posts.js', format: 'the entries as data — title, date, summary and body' }],
      bar: ['the entries are data in their own file, each with a title, a date and real body text, and the page is built from them'],
    },
    {
      id: 'form',
      when: /\b(contact form|sign ?up form|form|subscribe|newsletter|booking|enquiry|inquiry|quote request)\b/i,
      files: [],
      bar: [
        'every form checks its fields, says what is wrong next to the field that is wrong, and says what happened when it is sent',
      ],
    },
    {
      id: 'auth_ui',
      when: /\b(login|sign ?in|sign ?up|register|account page|profile page|dashboard for users)\b/i,
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
  function piecesOf(task, kind) {
    const t = String(task || '');
    if ((kind || kindOf(t)) !== 'build') return [];
    return PIECES.filter((p) => p.when.test(t));
  }

  /** Extra pages the request names, beyond the first. */
  function extraPagesOf(task) {
    const t = String(task || '');
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
    const bar = [
      'the result answers the request that was actually made, and nothing in it is left for someone else to finish',
      'no placeholder text, no lorem ipsum, and no invented facts about a real person or business',
    ];

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
    return normalise({ kind, items, bar, pieces: pieces.map((p) => p.id) }, task);
  }

  // ── Reading a model's answer ──────────────────────────────────────

  const SYSTEM = `You decide what a team of AI agents must hand back for a task, before they start.
List the concrete deliverables THIS task needs — the actual files, documents or artefacts that together are the finished work. Derive them from the request. Do not use a standard set.
Rules:
- Name each deliverable the way it would be saved, with an extension where it is a file.
- Anything the request implies needs somewhere to live. A shop's items belong in their own data file; a cart's behaviour in its own file; a game's loop in its own file. Do not put everything in one script.
- Only list what this request asks for. Never add a cart, a login, a database or a page the request did not ask for.
- "bar" is what it means for THIS result to be done well: statements that could be checked by looking at the result. Only include a statement that applies to this task.
- Give the last deliverable to the agent that finishes, and make it the thing the person actually receives.
Return only JSON, no markdown:
{"kind":"build|fix|analysis|writing|answer|general","items":[{"name":"file.ext","owner":"planner|coder|analyst|writer|validator|supervisor|specialist","required":true,"format":"what this deliverable is"}],"bar":["a checkable statement about this result"]}`;

  /** The call that asks for a task's deliverables. */
  function messages(task) {
    return [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: `Task: ${String(task || '').trim()}` },
    ];
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
    return { kind: clean(parsed.kind, 20), items, bar: Array.isArray(parsed.bar) ? parsed.bar : [] };
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
    return { kind, items, bar, pieces: (plan && plan.pieces) || piecesOf(task, kind).map((p) => p.id) };
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
    const plan = normalise(fromModel, task);
    if (!plan.items.length) return derived;
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
   */
  function budgetsFor(plan) {
    const files = filesOf(plan);
    const code = plan.kind === 'build' || files.length > 0;
    const perDependency = code
      ? Math.min(24000, 6000 + files.length * 2500)
      : Math.min(12000, 4000 + (plan.items || []).length * 800);
    return {
      maxContextCharsPerDependency: perDependency,
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

  /** One line naming what this run owes, for the trace. */
  function summaryOf(plan) {
    const n = (plan.items || []).length;
    return `${n} deliverable${n === 1 ? '' : 's'}` + (plan.pieces && plan.pieces.length ? ` · ${plan.pieces.join(', ')}` : '');
  }

  window.HCSwarmDeliverables = {
    MAX_ITEMS, MAX_BAR, PIECES,
    kindOf, piecesOf, extraPagesOf, derive, messages, readPlan, normalise, merge,
    filesOf, budgetsFor, contractsOf, summaryOf,
  };
})();
