# HashCortx — Architecture

Tauri v2 desktop application. Rust core, native system webview, vanilla JavaScript frontend. No bundler, no framework, no build step for the frontend — `tauri.conf.json` serves `src/` directly via `"frontendDist": "../src"`.

Roughly **48,000 lines of JavaScript** (plus ~18,700 more in vendored libraries) and **5,500 lines of Rust**, measured on 12 September 2026. Most per-file sizes below were measured on 10 September 2026; the budgets that stop the large files growing are in `scripts/checks/app-size.mjs`, which is the place to look for a current figure.

> This document describes the tree as it exists today. An earlier version described a planned `core/` + `platform/` split full of files that were never written; that plan is preserved at the bottom under *Abandoned plan* so the intent is not lost.

---

## Real directory structure

```
HashCortX/
├── src/                             frontend, served as-is
│   ├── index.html              645  the shell: the intro screen, the sidebar
│   │                                and the chat column. Nothing else.
│   ├── boot.js                      puts the hidden panels in, then runs
│   │                                every script in order
│   ├── main.js                      bootstrap
│   ├── styles.css                   the second design system, linked last
│   ├── css/                         the shared stylesheets: tokens, base,
│   │                                sidebar, tabs, main, composer, modes, modals
│   │
│   ├── modes/                       one folder per mode. Adding a mode is a
│   │   │                            folder and one line in the manifest.
│   │   ├── manifest.js              the only place a mode is named
│   │   ├── boot.js                  turns that list into the stylesheet, the
│   │   │                            tab button, the markup and the script
│   │   ├── forge/            3,855  offline parametric part generator
│   │   │                            (lines of mode.js; each folder also holds
│   │   │                            mode.css and panel.html)
│   │   ├── virtual-os/       3,545  virtual project desktop
│   │   ├── systems/          3,220  ERP prototype generator
│   │   ├── agent-maker/      2,275  chain / vote / failover
│   │   ├── code/             2,630  the Coder agent loop
│   │   ├── finance/          2,378  financial document analysis
│   │   └── sandbox/            603  security scanner
│   │
│   ├── core/                        pieces taken out of app.js, each with
│   │   │                            its own markup beside it
│   │   ├── settings/  panel.html + memory-pane.js + local-model.js
│   │   │              + model-lists.js (Update model lists)
│   │   ├── memory/    store.js + map-panel.html
│   │   ├── agents/    panel.html
│   │   ├── rag/       knowledge-base.js
│   │   ├── sandbox/   pyodide.js    the Python runtime loader, bounded at
│   │   │                            every stage so it cannot hang the agent
│   │   └── overlays/  panel.html   templates, preview, the alert dialog
│   │
│   ├── wheels/                      the Python packages Pyodide does not
│   │                                bundle — python-docx, openpyxl,
│   │                                reportlab and two dependencies. Shipped
│   │                                rather than fetched, because micropip
│   │                                takes them from PyPI, which the policy
│   │                                does not permit. See PROVENANCE.md
│   │
│   ├── data/                        content, not behaviour
│   │   ├── prompts.js          281  every preset prompt and chip row
│   │   ├── cloud-models.js     107  the fallback model catalogue
│   │   └── swarm-templates.js  122  the Agent Swarm's starter teams
│   │
│   ├── js/                          app.js, and the pieces taken out of it and
│   │   │                            out of the modes. Each piece is pure where
│   │   │                            it can be and has a check file of its own
│   │   ├── app.js            6,541  core: state, chat, agents, tools, providers
│   │   ├── providers.js        390  each provider's endpoint and auth, plus
│   │   │                            Moonshot's two hosts and account systems,
│   │   │                            and which three the app sends for itself
│   │   ├── cloud-model-fetch.js 298 asking each provider what models it has,
│   │   │                            with each model's limits
│   │   ├── cloud-catalogue.js  113  keeping those lists, and what each provider
│   │   │                            answered last time
│   │   ├── model-limits.js     268  how long an answer each request asks for, and
│   │   │                            the limits a provider names when it refuses
│   │   ├── cloud-model-memory.js 150 the model list a provider gave last time,
│   │   │                            and when to ask again after it failed
│   │   ├── model-names.js      216  provider, display name, size class, failover
│   │   ├── model-routes.js     248  which model a run asks next, by why the last
│   │   │                            one failed and what it can hold; models a
│   │   │                            provider says are gone; waiting on a stream
│   │   ├── agent-shape.js      399  images, tools and tool results per provider,
│   │   │                            and carrying on an answer that was cut off
│   │   ├── agent-context.js    136  what the model sees of a long agent run
│   │   ├── agent-policy.js     221  what may run together, and when to stop
│   │   ├── rag-search.js       119  knowledge-base ranking: keywords,
│   │   │                            cosine, rank fusion
│   │   ├── rag-store.js        123  how a document becomes passages —
│   │   │                            chunking must cover the whole text
│   │   ├── memory.js           276  reading facts from a message, ranking them
│   │   ├── vector-map.js       404  placing memory vectors on a flat picture
│   │   ├── url-safety.js        95  addresses the fetch tool may reach
│   │   ├── page-text.js        107  a fetched web page, as text a model can read
│   │   ├── pdf-text.js         123  a PDF, as text
│   │   ├── markdown-safe.js    206  link sanitiser, escaping, and the renderer
│   │   │                            for text a model wrote
│   │   ├── fences.js           139  code fences, read as the chat draws them —
│   │   │                            everything that looks for code uses it
│   │   ├── export-format.js    343  the shared half of every export
│   │   ├── diff.js             223  line and word diffs behind the change views
│   │   ├── edit-history.js      90  undo and redo for hand edits
│   │   ├── trace-copy.js        81  a run's trace, selected and copied as text
│   │   ├── model-plan.js       982  a generated 3D model's parts, made trustworthy
│   │   ├── power.js            183  stops work nobody can see
│   │   ├── host-profile.js     141  whether this machine can draw, and its OS,
│   │   │                            known before the first frame
│   │   ├── stream/             146  reading a streamed answer off the wire —
│   │   │                            the one place a response body is read
│   │   ├── chat/               249  what a model is told, and which to try next
│   │   ├── code/               364  Coder: terminal colour, export, file names
│   │   ├── swarm/            1,951  Agent Swarm: what kind of task it is,
│   │   │                            layout, scheduling, fencing, what a web
│   │   │                            task's agents are told about the site,
│   │   │                            a site's files and the one page built
│   │   │                            from them, each run kept as a
│   │   │                            conversation with versions (IndexedDB),
│   │   │                            and the Result view that shows it, where
│   │   │                            its agents, or the whole team, can be
│   │   │                            asked for changes and two versions of a
│   │   │                            file compared
│   │   ├── forge/            4,917  Forge: fields, surfaces, units, the plan
│   │   │                            gate, and io/ — STL, OBJ, 3MF and STEP
│   │   ├── systems/          2,824  ERP: spec, money, domain, the generated books,
│   │   │                            how every screen shows a record, the
│   │   │                            figures its dashboards are worked out from,
│   │   │                            and stand-ins for values a model left out
│   │   ├── finance/            502  Finance: reading amounts, drawing charts
│   │   ├── vos/                621  Virtual OS: tree, shell, answers, saved project
│   │   ├── io/zip.js           182  a stored zip, used by 3MF and downloads
│   │   └── vendor/                  marked, highlight.js, DOMPurify, mermaid,
│   │                                pdf.js, jsPDF, SheetJS, and three/ —
│   │                                core + module + add-ons + utils, r184,
│   │                                all local, none fetched
│   │
│   └── platform/
│       ├── index.js                 detects browser vs Tauri
│       └── tauri/
│           ├── hashcoder.js         HC.code.* file and shell tools
│           ├── guard.js             HC.guard.request() permission dialog
│           ├── undo.js              saves what a file held, and puts it back
│           ├── provider-bridge.js   the three providers a web page cannot call,
│           │                        sent by the app and read back as a Response
│           └── keychain.js          API key bundle (localStorage, see SECURITY.md)
│
├── src-tauri/
│   ├── src/
│   │   ├── main.rs                  entry point
│   │   ├── lib.rs                   plugin registration and builder
│   │   ├── commands/
│   │   │   ├── shell.rs       469   process execution: denylist, timeout,
│   │   │   │                        closed stdin, output cap
│   │   │   ├── embed.rs       374   sentence embeddings, run natively
│   │   │   ├── checkpoint.rs  538   what a file held before the agent changed it
│   │   │   ├── net.rs         795   resolves a hostname and refuses private ones
│   │   │   ├── provider.rs    524   SambaNova, NVIDIA and Kimi Code, at six
│   │   │   │                        fixed addresses and nowhere else
│   │   │   ├── fs.rs          985   filesystem bridge, applies the denylist
│   │   │   ├── keychain.rs    103   one-time migration out of the old Keychain
│   │   │   ├── export.rs      261   writes a file the user named in a save dialog
│   │   │   ├── forge_projects.rs 185 saved Forge models, in ~/.hashcortx/forge
│   │   │   ├── swarm_site.rs  137   a Swarm-built site, opened in the browser
│   │   │   ├── usage_log.rs    93   appends token counts to usage.jsonl
│   │   │   ├── notch.rs       160   HashNotch live-activity ping
│   │   │   └── audit.rs        52   append-only audit log
│   │   └── security/
│   │       └── denylist.rs    648   hardcoded blocked paths and commands
│   ├── models/bge-small-en-v1.5/    bundled embedding model, MIT, 34 MB
│   │                                compiled into the binary; PROVENANCE.md
│   ├── capabilities/default.json
│   ├── icons/
│   ├── Cargo.toml
│   └── tauri.conf.json
│
├── scripts/checks/                  the automated frontend checks — 100 files,
│   │                                all loading the real source
│   ├── syntax.mjs                   every loaded script parses
│   ├── guard.mjs                    what the Permission Guard refuses,
│   │                                asks about, and lets through
│   ├── rag.mjs                      how retrieval orders its results
│   ├── agent-context.mjs            what the model sees of a long run
│   ├── agent-policy.mjs             what may run in parallel, when to stop
│   ├── export.mjs                   CSV, PDF text, filenames, markdown
│   ├── layout.mjs                   the CSS mistakes that clip text
│   ├── power.mjs                    what stops when nobody is looking
│   ├── native-surface.mjs           which files may reach the machine
│   ├── usage.mjs                    every path records real token counts
│   ├── dom-ids.mjs                  every element lookup resolves, or is
│   │                                written down as deliberately absent
│   ├── diff.mjs                     both files rebuild exactly from the diff
│   │                                the Coder panel shows before you undo
│   ├── undo.mjs                     a change is put back, or refused — never
│   │                                reported as undone while it still stands
│   ├── rag-store.mjs                chunking covers every character of a
│   │                                document, over random inputs
│   ├── url-safety.mjs               where the agent's fetch tool may go
│   ├── providers.mjs                every provider endpoint is inside the
│   │                                Content Security Policy
│   ├── imports.mjs                  every import resolves to a file that is
│   │                                actually there
│   ├── markdown-safe.mjs            which links in a reply are safe to click
│   ├── agent-shape.mjs              how the conversation reaches each provider
│   ├── model-names.mjs              provider, name and class of a model
│   ├── memory.mjs                   what is remembered, and found again
│   ├── save.mjs                     where a file the user exports ends up
│   ├── forge.mjs                    what 3D Forge reports as finished
│   ├── theme.mjs                    the colour budget per stylesheet
│   ├── controls.mjs                 every control the markup offers is wired
│   ├── csp.mjs                      the security policy against the code:
│   │                                every host the source builds is allowed,
│   │                                every host allowed has something that
│   │                                builds it, and only WebAssembly may be
│   │                                compiled from a string
│   ├── modes.mjs                    a mode is a folder named once
│   ├── css-layers.mjs               no selector is declared in two sheets
│   ├── app-size.mjs                 the ratchets: app.js and the shell may
│   │                                shrink, never grow
│   ├── extraction.mjs               a module taken out of app.js is loaded
│   │                                first and reads no name it does not own
│   └── bridge.mjs                   window._H exposes what is called, and
│                                    only what is called
│
├── .github/workflows/ci.yml         runs both, plus cargo check and test
│
├── docs/
│   ├── ARCHITECTURE.md              (this file)
│   ├── BRAND.md
│   ├── SECURITY.md
│   └── assets/                      README diagrams
│
├── scripts/gen-icon.py              legacy — does NOT produce the shipped icon
├── MODES_GUIDE.txt
├── LICENSE                          MIT
└── README.md
```

There is no `ai.rs`, no `allowlist.rs`, and no `browser.js`. `core/` exists now, but only as far as app.js has been taken apart — two settings panes. Release builds are still run by hand; `.github/workflows/ci.yml` only checks the code, it does not produce a DMG.

---

## How the layers actually talk

```
src/js/*.js  ──▶  window.HC.*        ──▶  Tauri IPC  ──▶  src-tauri/src/commands/*.rs
(renderer)        (platform/tauri/)                        (Rust, applies denylist)
```

**Two things worth knowing, because they surprise people:**

1. **AI requests do not go through Rust.** `app.js` calls `fetch()` in the renderer, straight to the provider, with the API key in the `Authorization` header. Rust is involved only in filesystem, shell, audit, and usage logging.

2. **The denylist is enforced in Rust, not JavaScript.** `guard.js` raises the permission dialog, but `fs.rs` and `shell.rs` consult `security/denylist.rs` independently. A compromised prompt that talks its way past the dialog still cannot read `~/.ssh` — through either door. That was not true until recently: `shell.rs` checked only the working directory, never the command text, so `cat ~/.ssh/id_ed25519` ran even though `fs_read_file` refused the identical path. Both are checked now, and the difference is covered by tests in `denylist.rs`.

---

## The cross-module bridge

`app.js` is a monolith, and the mode files load after it as separate `<script>` tags, written by `modes/boot.js` from the manifest. They share state through a global bridge that `app.js` publishes near the bottom of the file:

```js
window._H = {
  get state() { return state; },
  runOneTool,
  memAdd, memRecall, memAutoExtract,
  appendAssistantToolCallTurn,
  appendToolResult,
  ...
};
```

This is the seam to respect when adding a mode: **never import across mode files directly** — go through `_H`. It holds 24 members: the 23 something calls, plus `registerMode`, which is the documented way for a mode to register itself even though every mode currently writes `window._registeredModes` directly.

`scripts/checks/bridge.mjs` holds that to equality in both directions, because both ways of getting it wrong are silent. It was 38 members with 23 of them unused — and, worse, three names were *called and never exposed*: `memAdd`, `memRecall` and `memAutoExtract`. The Coder agent's `remember_fact` and `recall_facts` tools call through this object and the system prompt tells the model it has them, but the call sites are written defensively, so the model was told "Memory not available" every time instead of anything failing. That feature had never worked.

`modes/code/mode.js` additionally exposes `window.HC_CODE`, and `render()` calls its `afterRender` hook — that hook is on `HC_CODE`, not on `_H`. It exists because `render()` rebuilds the chat DOM wholesale, which would otherwise destroy the collapsible tool-call blocks Coder injects.

---

## Design rules

1. `src/platform/` is the only place allowed to touch `window.__TAURI__`. Enforced by `scripts/checks/native-surface.mjs`, which also pins the set of files outside it that may invoke a command, and the modes that must invoke none.
2. Every native call is intercepted by `guard.js` before executing, and independently re-checked in Rust.
3. Every guarded action is appended to the audit log, allowed or denied.
4. `src/main.js` only bootstraps — no feature code.
5. One folder per mode in `src/modes/<id>/` — `mode.js`, `mode.css`, `panel.html` — named once in `modes/manifest.js`. Nothing else in the app names a mode. Cross-module access goes through `window._H`. Enforced by `scripts/checks/modes.mjs`, which also counts how many shared files still name each mode and refuses to let that number rise.
6. Third-party libraries are vendored into `src/js/vendor/`, never fetched from a CDN at runtime — **with exactly one exception**: Pyodide, whose CPython runtime and bundled wheels (pandas, numpy, matplotlib) are fetched on first use and are far too large to ship. It is the only reason `script-src` and `connect-src` still name a host. The three packages Pyodide does *not* bundle — python-docx, openpyxl and reportlab — are vendored in `src/wheels/` and installed from the app's own origin, because the alternative was permitting PyPI, and this rule is what says vendor the library instead. three.js, its four loaders and SheetJS used to be fetched too; they are vendored now, which is what makes 3D Forge and spreadsheet import work offline.
7. No bundler and no framework. This is a constraint, not an oversight: it keeps the application itself around 7 MB, and it lets a reader trace a button to the Rust function it triggers without a source map. The DMG is 41.2 MB because the bundled embedding model is 34 MB of it — a cost paid once, deliberately, so the knowledge base works offline.

---

## Known architectural debt

- `app.js` is still a 6,541-line monolith, down from 8,682. Out so far: the prompt library, the fallback model catalogue, two settings panes, the provider endpoints and model lists, the agent's context and request shapes, and the reading of a streamed answer. What is left is mostly the send pipeline, message rendering and the agent loop, which are tied to the app's shared state rather than being separable pieces, and `scripts/checks/app-size.mjs` holds the ceiling so it cannot drift back.
- The Coder mode is one closure of shared state holding most of its screen code; its separable pieces — terminal colour, export and file names — are out, and what is left needs restructuring rather than moving.
- Coder still boxes its messages: `modes.css` forces a background on `.app.code-mode .msg .bubble`, so it reads as a different app from the rebuilt chat. The header rework only touched normal chat, and six modes restyle the topbar without having been checked against it.
- The frontend's automated coverage is `scripts/checks/` — 4,621 checks over retrieval, the Permission Guard, the agent loop, exports, layout, idle power, the native surface, the usage log, element lookups, diffs, undo, knowledge-base chunking, fetch addresses, cloud providers, module imports, markdown safety, agent request shapes, model identifiers, memory, the vector map, names that are called, functions used as values, and each mode's extracted pieces — the Forge plan gate, the generated ERP books, the Virtual OS save, agent scheduling, the Finance charts, the Coder's terminal and export, and stream reading. They load the real source.
- **`npm run sweep` drives the UI**, which the checks cannot: it opens each mode in a headless browser, clicks every control visible from a cold start, and reports what throws. It is not in CI — it needs a real browser — and it covers each mode from cold, not states that need content. Before it existed nothing caught a broken button; it was written after a menu was found that opened, closed, wrote no file and said nothing.
- The build is unsigned. See [SECURITY.md](SECURITY.md).

---

## Abandoned plan

The original design called for a platform-agnostic `core/` layer — pure JS, testable in a browser without Tauri — sitting behind a `platform/` abstraction with `browser.js` and `tauri/` implementations, so that a mobile target would need only a new `platform/` folder. Phase 1 got as far as pulling the mode files out of `app.js` into `src/js/`, and they have since moved again into `src/modes/<id>/`. `core/` has now been started — it holds the settings panes taken out of app.js — but it is nothing like the platform-agnostic layer that was planned, and `platform/` still holds just the Tauri bridge files.

It is recorded here because the goal is still sound. It is not recorded as current structure, because it is not.
