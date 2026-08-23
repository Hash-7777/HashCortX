// ==============================================================
// Preset prompt library
//
// Every prompt behind a composer chip: the four general presets, the nine
// coding presets, the five Forge presets, and the shared design vocabulary two
// of them embed. 233 lines of prose that app.js carried but never read — the
// only names that ever crossed back out of it were PRESET_PROMPTS, which the
// chip handler indexes, and FORGE_ARCHITECT_PROMPT, which the send path uses
// as a system prompt in Forge.
//
// Prompt text is content, not behaviour. Keeping it here means editing what a
// chip says is a change to one small file with nothing else in it, instead of
// a change somewhere inside the middle of the largest file in the app.
//
// The chip rows live here too — COMPOSER_CHIPS. A chip is a label plus the
// name of a preset, so keeping the two apart meant editing two files to change
// one button, in two different parts of the app.
//
// Loaded before app.js in index.html.
// ==============================================================
(function () {
  'use strict';

  // Every preset ends with a TASK slot the user fills in. Short = less prompt
  // processing on the local host, faster first token.

  // 2026 design vocabulary. Concrete and descriptive so even local models with
  // older training cutoffs (that have never "seen" 2026) produce the right look.
  const LOOK_2026 = `=== 2026 LOOK (concrete spec — follow exactly even if your training is older) ===
Layout: bento-grid sections (asymmetric tiles, varied row heights), generous whitespace, max-width ~1200px content gutters.
Background: warm-tinted near-black (e.g. #0a0a0f, #0d0e14 — never pure #000 or pure #fff). Add a soft mesh/aurora gradient blob (2-3 stops, 40% opacity, blurred 80px+) behind the hero.
Typography: variable sans for body (Geist, Inter, or Satoshi). Editorial serif display for hero headlines (Fraunces, Instrument Serif, or Cormorant). Headlines 4xl-7xl, tight tracking (-0.02em), line-height 1.0-1.1.
Color: ONE bold accent (e.g. electric violet #7c3aed, lime #a3e635, or warm amber #f59e0b) + 2 neutral grays. No rainbow. No flat primary blue.
Surfaces: glass cards — bg rgba(255,255,255,0.04), backdrop-blur(20px), 1px hairline border rgba(255,255,255,0.08), rounded-2xl (16px) or rounded-3xl (24px) corners.
Texture: 3% opacity grain/noise overlay across large surfaces (SVG noise filter). Breaks the flatness.
Buttons: pill-shaped (rounded-full), accent-colored solid for primary, ghost (transparent border) for secondary. No drop shadows — use inner highlight + 1px ring instead.
Motion: spring physics (Framer Motion on web, Reanimated on RN). Hover = scale 1.02 + soft glow, 150ms. Press = scale 0.97, 100ms. Page enter = fade + 8px upward slide, 300ms cubic-bezier(0.22,1,0.36,1). Lists = stagger 40ms per item. Respect prefers-reduced-motion.
Patterns: floating sticky nav (backdrop-blur, hairline border), Cmd+K command palette, skeleton loaders not spinners, optimistic UI, empty states with personality.
Reference vibe: Linear + Vercel + Arc Browser + Raycast. Quiet confidence, not loud. Every detail intentional.`;

  const HASH_AI_PROMPT = `You are the user's personal AI assistant.
Be direct and concise. No preamble, no filler, no closing remarks.
Use bullet points for lists. Use code blocks for all code.
Prefer practical steps over theory.
Never guess or invent facts — say "I don't know" instead.`;

  const FULLSTACK_PROMPT = `Build a production-ready full-stack web app.
Stack: Next.js 15 + TS + Tailwind v4 + shadcn/ui + Framer Motion · tRPC v11 · Drizzle + Postgres · Auth.js · Zod · pnpm.
Deliverables: folder tree, every file's full contents (labeled), run commands, .env.example.

${LOOK_2026}`;

  const MOBILE_PROMPT = `Build a production-ready cross-platform mobile app.
Stack: Expo SDK 52 + TS + Expo Router + NativeWind v4 + Reanimated v3 + Zustand + TanStack Query · pnpm.
Deliverables: folder tree, every file's full contents (labeled), run commands.
Mobile extras: animated custom tab bar, haptics on every meaningful interaction, light+dark with smooth transition, shared-element transitions between screens.

${LOOK_2026}`;

  const SPEED_PROMPT = `SPEED MODE — until I say "normal mode":
- 1-3 short sentences by default. No preamble, no recap, no closers.
- Shortest correct reasoning path. Don't think out loud.
- "unknown" if you don't know. Never invent APIs/citations.
- Bullets over prose. Code blocks only when code is needed.`;

  // ================ Coding-mode preset prompts ================
  // Tight, task-focused. They lean on past chat for the actual code rather
  // than re-shipping a long preamble — that keeps prompt processing fast.

  const REST_API_PROMPT = `Build a production REST API.
Stack: TS + Fastify or NestJS · JWT (access+refresh, httpOnly, rotation) · Postgres + Prisma/Drizzle · Zod on every route · pino logs · helmet + CORS + rate limit · vitest + supertest · multi-stage Dockerfile + docker-compose.
Deliver: folder tree → every file → run commands.`;

  const REFACTOR_PROMPT = `Refactor the code from our chat above.
1. Top 3 concrete issues (naming, coupling, dead code, types, a11y, perf).
2. Full refactored file (not a diff). Preserve public behavior.
3. Bullet list: every change → one-line rationale.`;

  const EXPLAIN_ERROR_PROMPT = `Explain the error from our chat above.
1. Exact cause (one sentence).
2. Why it happens (2-4 mechanism-level bullets).
3. Full corrected snippet.
4. Hardening: guard / test / lint rule that prevents recurrence.`;

  const WRITE_TESTS_PROMPT = `Write tests for the code from our chat above.
- Pick the right framework for the stack (vitest / jest / pytest / xctest).
- Unit tests per exported function: happy + 1 failure + 1 edge.
- Integration tests where there's real IO (DB/HTTP/FS).
- Run command + expected output at the end.`;

  const DEBUG_PROMPT = `Debug the code from our chat above.
1. What it currently does (3 lines).
2. What it should do.
3. The specific bug, named (off-by-one, race, stale closure, type coercion…).
4. Full corrected file.
5. A one-liner test that would have caught it.`;

  const OPTIMIZE_PROMPT = `Optimize the code from our chat above (speed / memory / bundle / DB / render).
1. Name the profiling tool you'd use to confirm the bottleneck.
2. Full optimized file.
3. Table: change → expected win → cost.
If it's already fine, say so.`;

  const CODE_REVIEW_PROMPT = `Review the diff/file from our chat above like a staff engineer.
- Correctness (must-fix), design (should-fix, justify), style (optional), security/a11y/perf, missing tests.
- Each finding: verdict + rationale + suggested fix as code.
- End with a 1-sentence ship/no-ship call.`;

  // ── 3D Forge ────────────────────────────────────────────────────────
  //
  // What stood here described a different application: a React and TypeScript
  // project with a state library, a physics package, a bundler config and a
  // swarm of particles assembling parts on screen. None of it is true of this
  // app, which is plain JavaScript served unbundled, and the parts it named
  // had already been removed. It was the live system prompt for every message
  // sent from Forge, so the model was told the app worked in a way it never
  // has, and five buttons under the composer offered to scaffold that project
  // for the user.
  //
  // This is what Forge actually is, written so the model can help with the
  // thing on screen rather than with an architecture nobody is building.

  const FORGE_ARCHITECT_PROMPT = `You are helping inside 3D Forge, where a description becomes a 3D model the person can look at, edit and export.

How the mode works, so your advice fits it:
- One request to a model returns a design: a list of named parts, each a shape with a size, a position and a rotation.
- The app then does the arithmetic itself — it mirrors anything marked symmetric, brings loose parts onto the body, closes the seams between them, sets the model on the floor and measures it. Do not tell the person to do those by hand.
- Shapes available: a silhouette given thickness, a profile turned around an axis, a rounded tube, a sphere, a cone, a ring, a box, a cylinder, or a surface given as vertices.
- The whole model is shown as one solid piece in a single material. Colour is not part of a design.
- It exports as GLB, STL or OBJ.

How to help:
- Turn a vague idea into a description with real proportions and named parts. "A mug" is not a design; "a cylinder 95 mm tall and 80 mm across, wall 4 mm, with a handle" is.
- Say which parts an object genuinely needs and which are noise. Fewer parts that read correctly beat many that do not.
- When the person shows you a run that went wrong, name the part and the change, not the whole model.
- For printing, talk about wall thickness, what rests on the bed and what overhangs.
- Be specific and short. No preamble.`;

  const FORGE_DESCRIBE_PROMPT = `Turn what I describe below into one paragraph a 3D design tool can work from.

Give it real proportions in millimetres, name every part, and say how the parts meet. Say which way up it rests and which way it faces. Keep it to the parts the object genuinely needs. If my description is missing something you cannot guess, pick a sensible value and say which ones you picked.

Here it is:
`;

  const FORGE_PARTS_PROMPT = `Break the object below into the parts a 3D model of it actually needs.

For each part: what it is called, roughly what shape it is, its size relative to the whole, and what it attaches to. Say which parts are mirrored pairs. At the end, name anything a person might expect that is deliberately not there, and why leaving it out reads better.

The object:
`;

  const FORGE_FIX_PROMPT = `Below is what came out of a 3D model run — the parts it made, the measurements, or what went wrong.

Tell me the smallest set of changes that fixes it. Name the part, say what the number should be instead, and say what that will change on screen. Do not redesign the whole thing. If something is fine, leave it alone and say so.

Here it is:
`;

  const FORGE_PRINT_PROMPT = `I want to 3D print the model below.

Cover, in this order: which way up it should sit on the bed and why; anything that overhangs far enough to need support; any wall or detail too thin to survive; and whether it needs to be hollow. Give thicknesses in millimetres. If it is fine as it is, say so plainly.

The model:
`;

  // ── The chat starter prompts ────────────────────────────────────────
  //
  // The old set was three build briefs and a RAM button: "Full Stack",
  // "Mobile App". They wrote a website for you whether or not that was what
  // you came for, and none of them touched anything this app can do that a
  // plain chat box cannot. Each of these turns on a different part of it —
  // grounded search, the knowledge base, the Python sandbox, two models at
  // once — and each is written so the answer is checkable.

  const EXPLAIN_ANY_PROMPT = `Explain what I paste below, in plain language.

In this order:
1. What it is, in one sentence.
2. What it actually does, step by step.
3. The part people usually get wrong about it.
4. What I should do next.

Assume I am capable but new to this. Define any jargon the first time you use it. If something in it looks wrong or risky, say so.

Here it is:
`;

  const GROUNDED_PROMPT = `Look this up before you answer. Do not answer from memory.

- Search first, then answer in a few sentences.
- Put the evidence underneath, and say which page each claim came from.
- If the sources disagree, show both sides rather than picking one quietly.
- If you cannot find it, say "not found". Do not fill the gap with a guess.

My question:
`;

  const KNOWLEDGE_PROMPT = `Answer using only my knowledge base. Nothing from your own memory.

- Quote the passages you used, word for word.
- Name the file each quote came from.
- If my documents do not cover it, say so plainly and stop there. Do not complete the answer from general knowledge — I need to know what my own notes actually say.

My question:
`;

  const COMPUTE_PROMPT = `Work this out in Python rather than in your head.

- Write the code, run it, and show me both the code and the result.
- Print the intermediate steps, not just the final number, so I can check the reasoning.
- Draw a chart if it makes the answer clearer.
- State your assumptions before you start, and flag any that would change the answer a lot.

The problem:
`;

  const SECOND_OPINION_PROMPT = `Answer this as carefully as you can. I am putting the same question to a second model and comparing the two.

Commit to a position rather than listing every possibility, and mark clearly the parts you are unsure about.

My question:
`;

  const PRESET_PROMPTS = {
    explainAny: EXPLAIN_ANY_PROMPT,
    grounded: GROUNDED_PROMPT,
    knowledge: KNOWLEDGE_PROMPT,
    compute: COMPUTE_PROMPT,
    secondOpinion: SECOND_OPINION_PROMPT,
    hashAi: HASH_AI_PROMPT,
    fullstack: FULLSTACK_PROMPT,
    mobile: MOBILE_PROMPT,
    freeRam: SPEED_PROMPT,
    restApi: REST_API_PROMPT,
    refactor: REFACTOR_PROMPT,
    explainErr: EXPLAIN_ERROR_PROMPT,
    writeTests: WRITE_TESTS_PROMPT,
    debug: DEBUG_PROMPT,
    optimize: OPTIMIZE_PROMPT,
    codeReview: CODE_REVIEW_PROMPT,
    forgeDescribe: FORGE_DESCRIBE_PROMPT,
    forgeParts: FORGE_PARTS_PROMPT,
    forgeFix: FORGE_FIX_PROMPT,
    forgePrint: FORGE_PRINT_PROMPT,
  };

  // Composer chip presets. Default = general-purpose, code = Claude-Code style.
  const COMPOSER_CHIPS = {
    default: [
      { preset: "explainAny",    label: "Explain this",   title: "Paste anything — code, an error, a contract, a log — and get it in plain language" },
      { preset: "grounded",      label: "Look it up",     title: "Search the web first, then answer with the source behind every claim" },
      { preset: "knowledge",     label: "Use my notes",   title: "Answer from your knowledge base only, quoting the passages it used" },
      { preset: "compute",       label: "Work it out",    title: "Do the maths in Python and show the code, the steps and the result" },
      { preset: "secondOpinion", label: "Ask two models", title: "Turn on Split and put the same question to two models side by side" },
      { preset: "freeRam",       label: `<svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true" style="vertical-align:-1px"><polyline points="10,2 6,8.5 9.5,8.5 6,14"/></svg> Free RAM`, accent: true, title: "Unload every model on the local host to free memory and switch to short answers" },
    ],
    code: [
      { preset: "fullstack",   label: "⌘ Full-stack app",     title: "Scaffold a production full-stack web app" },
      { preset: "mobile",      label: "⌘ Mobile app",         title: "Scaffold a production React Native app" },
      { preset: "restApi",     label: "⌘ REST API + auth",    title: "Build a secured REST API with auth, validation, rate-limit" },
      { preset: "refactor",    label: "⌘ Refactor",           title: "Refactor a pasted file/function for clarity, perf, a11y" },
      { preset: "explainErr",  label: "⌘ Explain error",      title: "Paste an error/stack trace — get cause + fix" },
      { preset: "writeTests",  label: "⌘ Write tests",        title: "Write unit + integration tests for a pasted file" },
      { preset: "debug",       label: "⌘ Debug",              title: "Systematic debug walkthrough of a pasted snippet" },
      { preset: "optimize",    label: "⌘ Optimize",           title: "Improve speed, bundle size, memory, query cost" },
      { preset: "codeReview",  label: "⌘ Code review",        title: "Senior-staff code review of a pasted PR/diff" },
      { preset: "freeRam",     label: `<svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true" style="vertical-align:-1px"><polyline points="10,2 6,8.5 9.5,8.5 6,14"/></svg> Free RAM`, accent: true, title: "Unload every model on the local host to free RAM and enable speed mode" },
    ],
    forge: [
      { preset: "forgeDescribe", label: "Describe it for me", title: "Turn a rough idea into a description with real sizes and named parts" },
      { preset: "forgeParts",    label: "What parts?",        title: "Break an object into the parts it actually needs, with proportions" },
      { preset: "forgeFix",      label: "Fix my model",       title: "Paste what the run said and get the specific changes to make" },
      { preset: "forgePrint",    label: "Ready to print?",    title: "Wall thickness, which way up it sits, and what will need support" },
      { preset: "freeRam",       label: `<svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true" style="vertical-align:-1px"><polyline points="10,2 6,8.5 9.5,8.5 6,14"/></svg> Free RAM`, accent: true, title: "Unload every model on the local host to free RAM and enable speed mode" },
    ],
  };

  // Only these three are read outside this file. Everything above feeds them.
  window.HCPrompts = { PRESET_PROMPTS, FORGE_ARCHITECT_PROMPT, COMPOSER_CHIPS };
})();
