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

  const FORGE_ARCHITECT_PROMPT = `You are 3D Forge mode inside HashCortx.
Goal: help build Forge, a React + Three.js architecture-first 3D agent swarm planner. Be concrete and implementation-focused.

Core stack:
- Vite + React + TypeScript.
- Three.js 0.184, @react-three/fiber 9.6, drei 10.7, postprocessing 3.0.
- Rapier and manifold-3d use WASM, so vite.config.ts needs wasm(), topLevelAwait(), COOP/COEP headers, and optimizeDeps.exclude for WASM packages.
- Zustand + immer for state. No per-frame React re-renders.

Architecture rules:
- Write /src/types/forge.ts and /src/types/geometry.ts before implementation.
- AgentRole = structure | surface | detail | audit. Keep ROLE_COLORS centralized.
- GeometryPlan is the AI output. It contains nodes, edges, surfaces, and constraints.
- Data flow is one-way: prompt -> forgeAgent stream -> nodes arrive -> particles spawn -> density rises -> solidifyNode -> build mesh/CSG/check constraints -> fade opacity -> push snapshot.
- Hot path lives in useStore.getState() inside useFrame. Do not put per-frame particle data in React state.
- Particle trails use preallocated instancing and shader attributes, not per-frame DOM or React updates.
- CSG and constraint checks fire once on solidification, never every frame.

AI protocol:
- Force exactly one tool call named generate_geometry_plan.
- The schema requires 2-40 nodes, CSG edges, surface material hints, and constraints.
- Stream tool-call argument deltas. Use bracket depth to emit node_added events as soon as complete node objects arrive.
- System prompt must order nodes before edges.

Swarm math:
- Spawn points are random points on a sphere radius 8.
- Targets are node positions.
- Use THREE.CubicBezierCurve3.getPoint(t).
- Durations: structure 2800ms, surface 2000ms, detail 1400ms, audit 3500ms.
- Solidification opacity = clamp(arrivedParticles / totalParticles / threshold, 0, 1).

Build order:
1. Dark void + orbit controls.
2. Prompt bar + mock 5-node chair GeometryPlan.
3. Swarm particle system.
4. Mesh emergence animation.
5. Constraint overlay.
6. Version scrubber.
7. Export pipeline.

Answer format:
- For implementation requests, return exact file paths and full code or tight patches.
- For planning requests, return phase, file order, acceptance criteria, and risks.
- Keep performance budgets visible when touching SwarmParticles, meshBuilder, or useGeometry.`;

  const FORGE_SCAFFOLD_PROMPT = `Create the 3D Forge project scaffold.
Use Vite React TypeScript and this exact dependency plan:
- 3D: three@0.184.0, @react-three/fiber@9.6.1, @react-three/drei@10.7.7, @react-three/postprocessing@3.0.4, postprocessing@6.39.1, @types/three@0.184.0
- Physics visuals: @dimforge/rapier3d-compat@0.19.3
- Geometry: three-csg-ts@3.2.0, manifold-3d@3.4.1
- State/AI/UI: zustand@5.0.13, immer@11.1.7, openai@6.36.0, @anthropic-ai/sdk@0.95.0, framer-motion@12.38.0, clsx@2.1.1, tailwind-merge@3.5.0, leva@0.10.1
- Dev: tailwindcss@4.2.4, @tailwindcss/vite, vite-plugin-wasm@3.6.0, vite-plugin-top-level-await@1.6.0
Deliver folder tree, commands, vite.config.ts with WASM plugins plus COOP/COEP headers, and the first runnable App.tsx.`;

  const FORGE_TYPES_PROMPT = `Write Forge's TypeScript type system first.
Deliver /src/types/forge.ts and /src/types/geometry.ts.
Include AgentRole, ROLE_COLORS, ParticleState, BezierPath, SwarmParticle with trailPoints[32], AgentMessage, ConflictEntry, GeometrySnapshot, ExportOptions, all five Zustand slice interfaces, primitive discriminated unions, GeometryNode, GeometryEdge, GeometryPlan, VertexDensityMap, and ConstraintViolation.`;

  const FORGE_AGENT_PROMPT = `Design /src/agents/forgeAgent.ts.
Implement the generate_geometry_plan tool schema, forced tool_choice, streaming argument accumulation, bracket-depth node extraction, node_added events, final plan validation, and the system prompt that orders nodes before edges. Include robust parsing failure behavior.`;

  const FORGE_SWARM_PROMPT = `Implement /src/canvas/SwarmParticles.tsx and the supporting store methods.
Use instanced particles, CubicBezierCurve3 paths, role-specific arcs and durations, ring-buffer trailPoints[32], preallocated trail instancing, and no per-frame React state. Include dirty flags and activeCount-based draw counts.`;

  const FORGE_PHASES_PROMPT = `Turn 3D Forge into a 7-phase implementation checklist.
For each phase include deliverables, files touched, done criteria, tests/visual checks, and likely failure points. Preserve the critical file order: types, forgeAgent, SwarmParticles, meshBuilder, useGeometry.`;

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
    forgeScaffold: FORGE_SCAFFOLD_PROMPT,
    forgeTypes: FORGE_TYPES_PROMPT,
    forgeAgent: FORGE_AGENT_PROMPT,
    forgeSwarm: FORGE_SWARM_PROMPT,
    forgePhases: FORGE_PHASES_PROMPT,
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
      { preset: "forgeScaffold", label: "Forge scaffold", title: "Generate the Vite/React/Three.js scaffold and dependency plan" },
      { preset: "forgeTypes",    label: "Type system",    title: "Write the Forge geometry and swarm TypeScript types first" },
      { preset: "forgeAgent",    label: "AI protocol",    title: "Design the generate_geometry_plan tool schema and streaming parser" },
      { preset: "forgeSwarm",    label: "Swarm particles", title: "Implement Bezier particles, instanced trails, and solidification" },
      { preset: "forgePhases",   label: "7 phases",       title: "Break Forge into the 7 build phases with done criteria" },
      { preset: "freeRam",       label: `<svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true" style="vertical-align:-1px"><polyline points="10,2 6,8.5 9.5,8.5 6,14"/></svg> Free RAM`, accent: true, title: "Unload every model on the local host to free RAM and enable speed mode" },
    ],
  };

  // Only these three are read outside this file. Everything above feeds them.
  window.HCPrompts = { PRESET_PROMPTS, FORGE_ARCHITECT_PROMPT, COMPOSER_CHIPS };
})();
