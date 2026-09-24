# HashCortx — Architecture

Tauri v2 desktop application. Rust core, native system webview, vanilla JavaScript frontend. No bundler, no framework, no build step for the frontend — `tauri.conf.json` serves `src/` directly via `"frontendDist": "../src"`.

Roughly **48,000 lines of JavaScript** (plus ~20,000 more in vendored libraries) and **about 10,000 lines of Rust**, measured on 12 September 2026 (the vendored figure on 14 September, the Rust figure on 24 September). Most per-file sizes below were measured on 10 September 2026; the budgets that stop the large files growing are in `scripts/checks/app-size.mjs`, which is the place to look for a current figure.

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
│   │   ├── forge/            3,724  offline parametric part generator
│   │   │                            (lines of mode.js; each folder also holds
│   │   │                            mode.css and panel.html)
│   │   ├── virtual-os/       3,309  virtual project desktop
│   │   ├── systems/          3,232  ERP: the system full screen, and its agent
│   │   ├── agent-maker/      2,461  chain / vote / failover
│   │   ├── code/             2,608  the Coder agent loop
│   │   ├── finance/          2,357  financial document analysis
│   │   └── sandbox/            535  security scanner
│   │
│   ├── core/                        pieces taken out of app.js, each with
│   │   │                            its own markup beside it
│   │   ├── settings/  panel.html + memory-pane.js + local-model.js
│   │   │              + model-lists.js (Update model lists)
│   │   ├── memory/    store.js + map-panel.html
│   │   ├── agents/    panel.html
│   │   ├── rag/       knowledge-base.js
│   │   ├── sandbox/   pyodide.js    starts, feeds and stops the Python
│   │   │                            worker, with a time limit on each
│   │   └── overlays/  panel.html   templates, preview, the alert dialog
│   │
│   ├── workers/python.js            the Python sandbox: a worker with no
│   │                                way out, loaded only by pyodide.js
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
│   │   ├── app.js            6,539  core: state, chat, agents, tools, providers
│   │   ├── request-cap.js      139  the cap on cloud AI requests: 30 a minute, 6 at once
│   │   ├── providers.js        536  each provider's endpoint and auth, plus
│   │   │                            Moonshot's two hosts and account systems,
│   │   │                            and which three the app sends for itself
│   │   ├── cloud-model-fetch.js 367 asking each provider what models it has,
│   │   │                            with each model's limits
│   │   ├── cloud-catalogue.js  113  keeping those lists, and what each provider
│   │   │                            answered last time
│   │   ├── model-limits.js     268  how long an answer each request asks for, and
│   │   │                            the limits a provider names when it refuses
│   │   ├── cloud-model-memory.js 150 the model list a provider gave last time,
│   │   │                            and when to ask again after it failed
│   │   ├── model-names.js      189  provider, display name, size class
│   │   ├── model-speed.js      140  how long each model's answers take and when
│   │   │                            one ran out of time, so a model is chosen
│   │   │                            by how it answers, not only by its name
│   │   ├── model-routes.js     414  which model a run asks next, by why the last
│   │   │                            one failed, what it can hold and how it has
│   │   │                            answered; models a provider says are gone;
│   │   │                            waiting on a stream; a call cancelled when
│   │   │                            its time is up; one question asked until a
│   │   │                            model can answer it
│   │   ├── local-context.js    148  how much a local model is given room to
│   │   │                            read: sized to the request, so Ollama never
│   │   │                            drops its instructions, and the window it
│   │   │                            is loaded with kept while it fits; and what
│   │   │                            it can do: tools, pictures, or search only
│   │   ├── local-apps.js       201  models on another local model app: found
│   │   │                            on the usual ports, offered, and read the
│   │   │                            way an Ollama reply is
│   │   ├── local-client.js     172  the one request to a local model and the one
│   │   │                            reading of its reply: words, thinking and
│   │   │                            tool calls as they arrive, each answer
│   │   │                            ending where its window does; and loading
│   │   │                            a model while the message is written
│   │   ├── tool-text.js        248  a tool call a model wrote in its words, in
│   │   │                            each of the ways local models write one
│   │   ├── agent-shape.js      597  images, tools and tool results per provider,
│   │   │                            tools told in words to a model that cannot
│   │   │                            take them, carrying on an answer that was
│   │   │                            cut off, timing every answer, and tool calls
│   │   │                            or Python runs a model wrote as text
│   │   ├── agent-context.js    136  what the model sees of a long agent run
│   │   ├── agent-policy.js     221  what may run together, and when to stop
│   │   ├── rag-search.js       119  knowledge-base ranking: keywords,
│   │   │                            cosine, rank fusion
│   │   ├── rag-store.js        123  how a document becomes passages —
│   │   │                            chunking must cover the whole text
│   │   ├── memory.js           285  reading facts from a message, ranking them
│   │   ├── vector-map.js       404  placing memory vectors on a flat picture
│   │   ├── url-safety.js        95  addresses the fetch tool may reach
│   │   ├── page-text.js        107  a fetched web page, as text a model can read
│   │   ├── pdf-text.js         123  a PDF, as text
│   │   ├── markdown-safe.js    206  link sanitiser, escaping, and the renderer
│   │   │                            for text a model wrote
│   │   ├── fences.js           139  code fences, read as the chat draws them —
│   │   │                            everything that looks for code uses it
│   │   ├── export-format.js    471  the shared half of every export, and the
│   │   │                            chat's PDF layout
│   │   ├── diff.js             223  line and word diffs behind the change views
│   │   ├── edit-history.js      90  undo and redo for hand edits
│   │   ├── trace-copy.js        81  a run's trace, selected and copied as text
│   │   ├── trace-time.js        47  when a trace line was written, as a stopwatch
│   │   ├── model-plan.js     1,044  a generated 3D model's parts, made trustworthy
│   │   ├── power.js            183  stops work nobody can see
│   │   ├── host-profile.js     141  whether this machine can draw, and its OS,
│   │   │                            known before the first frame
│   │   ├── stream/             243  reading a streamed answer off the wire —
│   │   │                            the one place a response body is read;
│   │   │                            a failure sent inside a 200 reply, thinking
│   │   │                            told from the answer, and a free model that
│   │   │                            never starts left after 45 s
│   │   ├── chat/             1,097  what a model is told, which to try next
│   │   │                            (an agent's turns too), the web searches
│   │   │                            an agent makes, what its code printed,
│   │   │                            what a model thought before it answered,
│   │   │                            whole-number arithmetic and the days between
│   │   │                            dates done exactly, the time anywhere, what
│   │   │                            a model reads kept apart from what it is
│   │   │                            asked, and a
│   │   │                            local agent's turn in steps: the app or the
│   │   │                            model decides, the app acts, the model answers
│   │   ├── mcp/              1,243  connected systems over MCP: which of a
│   │   │                            system's tools only read, each tool pinned
│   │   │                            to what was switched on, what an agent is
│   │   │                            told of one switched off, the protocol in
│   │   │                            both generations, the ready-made ones and
│   │   │                            how a key is presented, the connections
│   │   │                            with their Settings section, what the
│   │   │                            Coder and a Swarm run are offered of them,
│   │   │                            and reading a system's records, which the
│   │   │                            ERP and Finance share
│   │   ├── code/               429  Coder: terminal colour, export, file names,
│   │   │                            and patch_file's text work
│   │   ├── swarm/            4,419  Agent Swarm: what kind of task it is,
│   │   │                            how many agents it needs, here or in
│   │   │                            the cloud, and a team cut to that,
│   │   │                            how strong each model is for its roles,
│   │   │                            what THIS task's deliverables are, the
│   │   │                            one call that asks a model for them and
│   │   │                            which agent writes which of them,
│   │   │                            who plans, makes, checks and delivers,
│   │   │                            what to ask the person before a run,
│   │   │                            the mark drawn beside each agent,
│   │   │                            layout, scheduling, fencing, what a web
│   │   │                            task's agents are told about the site,
│   │   │                            the openly licensed photographs found
│   │   │                            for it on Openverse,
│   │   │                            a site's files and the one page built
│   │   │                            from them, each run kept as a
│   │   │                            conversation with versions (IndexedDB),
│   │   │                            and the Result view that shows it, where
│   │   │                            its agents, or the whole team, can be
│   │   │                            asked for changes, the agents that did
│   │   │                            not finish run again on their own, and
│   │   │                            two versions of a file compared
│   │   ├── forge/            5,860  Forge: fields, surfaces, units, the plan
│   │   │                            gate, the one path a design takes to the
│   │   │                            scene and whether it holds together,
│   │   │                            applying Improve's answer, and io/ —
│   │   │                            STL, OBJ, 3MF and STEP
│   │   ├── systems/          5,684  ERP: spec, money, domain, the generated books,
│   │   │                            a design change as a short list of edits
│   │   │                            the app makes, how every screen shows a record, the
│   │   │                            figures its dashboards are worked out from,
│   │   │                            stand-ins for values a model left out, and
│   │   │                            the agent: what it is shown and what is
│   │   │                            done with what it says (a build asked about
│   │   │                            before a name or place is made up, no change
│   │   │                            claimed that did not happen), its
│   │   │                            conversation, what its builder is told, and
│   │   │                            reading a connected system: answering from
│   │   │                            its records and bringing them into a table
│   │   ├── finance/            976  Finance: reading amounts, working out a
│   │   │                            report from its figures, drawing charts,
│   │   │                            what the model is told, and a connected
│   │   │                            system's records read into a report
│   │   ├── sandbox/             63  Sandbox: the instant pattern scan, run
│   │   │                            before any model reads the code
│   │   ├── vos/                773  Virtual OS: tree, shell, answers, saved project,
│   │   │                            and which model is asked
│   │   ├── io/zip.js           182  a stored zip, used by 3MF and downloads
│   │   └── vendor/                  marked, highlight.js, DOMPurify, mermaid,
│   │                                pdf.js, jsPDF, SheetJS, and three/ —
│   │                                core + module + add-ons + utils, r184,
│   │                                all local, none fetched; PROVENANCE.md
│   │
│   └── platform/
│       ├── index.js                 detects browser vs Tauri
│       └── tauri/
│           ├── hashcoder.js         HC.code.* file and shell tools, and the
│           │                        list of them a model is offered
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
│   │   │   ├── shell.rs       838   process execution: denylist, timeout, stop,
│   │   │   │                        closed stdin, output cap, no secrets for the agent
│   │   │   ├── embed.rs       376   sentence embeddings, run natively
│   │   │   ├── checkpoint.rs  656   what a file held before the agent changed it,
│   │   │   │                        and whether it has changed since
│   │   │   ├── net.rs         802   resolves a hostname and refuses private ones
│   │   │   ├── provider.rs    694   SambaNova, NVIDIA and Kimi Code, at six
│   │   │   │                        fixed addresses and nowhere else; and a
│   │   │   │                        model app on this computer, by port
│   │   │   ├── mcp.rs         777   connected systems: address and secret kept
│   │   │   │                        together, out of the page's reach; requests
│   │   │   │                        only to that address, five methods, no redirect
│   │   │   ├── mcp/oauth.rs 1,384   signing in to one through the browser: where
│   │   │   │                        to sign in, PKCE, the answer on a one-time
│   │   │   │                        address, the tokens kept here and renewed
│   │   │   ├── fs.rs        1,239   filesystem bridge, applies the denylist;
│   │   │   │                        a write replaces a file whole or not at all
│   │   │   ├── keychain.rs    103   one-time migration out of the old Keychain
│   │   │   ├── export.rs      265   writes a file the user named in a save dialog
│   │   │   ├── forge_projects.rs 185 saved Forge models, in ~/.hashcortx/forge
│   │   │   ├── swarm_site.rs  137   a Swarm-built site, opened in the browser
│   │   │   ├── usage_log.rs   142   appends token counts to usage.jsonl
│   │   │   ├── notch.rs       201   HashNotch live-activity ping
│   │   │   └── audit.rs       231   append-only audit log, bounded
│   │   └── security/
│   │       ├── agent_sandbox.rs 288 macOS sandbox around the agent's commands
│   │       ├── denylist.rs    823   hardcoded blocked paths and commands
│   │       ├── navigation.rs   75   the window shows the app and nothing else
│   │       └── private_dir.rs 146   ~/.hashcortx, readable by its owner only
│   ├── models/bge-small-en-v1.5/    bundled embedding model, MIT, 34 MB
│   │                                compiled into the binary; PROVENANCE.md
│   ├── capabilities/default.json
│   ├── icons/
│   ├── Cargo.toml
│   └── tauri.conf.json
│
├── scripts/checks/                  the automated frontend checks — 154 files,
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
│   ├── no-emoji.mjs                 no mark is a picture typed as text —
│   │                                the app, the checks, the Rust, the build
│   │                                config, the hooks and the docs, plus what
│   │                                the app asks a model to write
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
├── scripts/bench/coder/             the Coder benchmark: twenty tasks with
│                                    hidden checks, run in a sandbox
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

A command written without `async` runs on the main thread, and the window waits for it. Every command that can take more than a moment — the shell, a page read, a search over a project, an export, loading the embedding model, a provider request — is `async` and does its work on a worker thread; `off_main` in `commands/mod.rs` is the shared way to do that.

**Two things worth knowing, because they surprise people:**

1. **Most AI requests do not go through Rust.** `app.js` calls `fetch()` in the renderer, straight to the provider, with the API key in the `Authorization` header. The exceptions are SambaNova, NVIDIA and Kimi Code, whose servers refuse a web page: `commands/provider.rs` sends those, to fixed addresses, and it also reaches a model app on this computer at a port the person's app uses. A connected business system is reached only through `commands/mcp.rs`, which keeps its sign-in secret, and the tokens a browser sign-in leaves (`commands/mcp/oauth.rs`), away from the renderer. Rust also reads web pages for the agent's fetch tool (`net.rs`) and handles the filesystem, the shell, embeddings, undo checkpoints, exports, and the audit and usage logs.

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
2. Every file, shell and fetch action an agent can take goes through `guard.js` before it runs, and the file and shell ones are checked again in Rust against the denylist. The other native commands take nothing an agent chooses a destination with: a fixed file under `~/.hashcortx`, a path from a save dialog the user answered, or a provider picked from a fixed table.
3. Every guarded action is appended to the audit log, allowed or denied.
4. `src/main.js` only bootstraps — no feature code.
5. One folder per mode in `src/modes/<id>/` — `mode.js`, `mode.css`, `panel.html` — named once in `modes/manifest.js`. Nothing else in the app names a mode. Cross-module access goes through `window._H`. Enforced by `scripts/checks/modes.mjs`, which also counts how many shared files still name each mode and refuses to let that number rise.
6. Third-party libraries are vendored into `src/js/vendor/`, never fetched from a CDN at runtime — **with exactly one exception**: Pyodide, whose CPython runtime and bundled wheels (pandas, numpy, matplotlib) are fetched on first use and are far too large to ship. It is the only reason `script-src` and `connect-src` still name a CDN, and they name only the runtime's own path on it. The three packages Pyodide does *not* bundle — python-docx, openpyxl and reportlab — are vendored in `src/wheels/` and installed from the app's own origin, because the alternative was permitting PyPI, and this rule is what says vendor the library instead. three.js, its four loaders and SheetJS used to be fetched too; they are vendored now, which is what makes 3D Forge and spreadsheet import work offline.
7. No bundler and no framework. This is a constraint, not an oversight: it keeps the application itself around 7 MB, and it lets a reader trace a button to the Rust function it triggers without a source map. The DMG is 41.2 MB because the bundled embedding model is 34 MB of it — a cost paid once, deliberately, so the knowledge base works offline.

---

## Known architectural debt

- `app.js` is still a 6,501-line monolith, down from 8,682. Out so far: the prompt library, the fallback model catalogue, two settings panes, the provider endpoints and model lists, the agent's context and request shapes, and the reading of a streamed answer. What is left is mostly the send pipeline, message rendering and the agent loop, which are tied to the app's shared state rather than being separable pieces, and `scripts/checks/app-size.mjs` holds the ceiling so it cannot drift back.
- The Coder mode is one closure of shared state holding most of its screen code; its separable pieces — terminal colour, export and file names — are out, and what is left needs restructuring rather than moving.
- Coder still boxes its messages: `modes.css` forces a background on `.app.code-mode .msg .bubble`, so it reads as a different app from the rebuilt chat. The header rework only touched normal chat, and six modes restyle the topbar without having been checked against it.
- The frontend's automated coverage is `scripts/checks/` — 7,613 checks over retrieval, the Permission Guard, the agent loop, exports, layout, idle power, the native surface, the usage log, element lookups, diffs, undo, knowledge-base chunking, fetch addresses, cloud providers, module imports, markdown safety, agent request shapes, model identifiers, memory, the vector map, names that are called, functions used as values, and each mode's extracted pieces — the Forge plan gate, the generated ERP books, the Virtual OS save, agent scheduling, the Finance charts, the Coder's terminal, export and patching, and stream reading. They load the real source.
- **`npm run models` asks each provider what still exists.** The fallback
  catalogue in `src/data/cloud-models.js` is what the picker shows before any
  provider has been asked, and it is a table of other people's decisions.
  Measured twice, three weeks apart: seven of the eight OpenRouter entries were
  dead both times, so a first run offered eight free models of which seven
  failed on use. OpenRouter, SambaNova and NVIDIA publish their catalogues with
  no key; the rest are checked when a key is in the environment, and it says
  which it could not check. Not in CI — it needs the network.
- **`npm run align` measures every button.** An icon button drawn 28px tall
  kept the app's general button padding, leaving 8px of room inside it for a
  15px mark: the mark could not fit, so centring it had nothing to centre in
  and it sat below the middle. Every rule involved was correct on its own, so
  nothing that reads the stylesheet could find it. This opens each mode and
  compares where a button's contents ended up with the box they had to sit in.
  Like the sweep it needs a real browser, so it is not in CI.
- **`npm run bench:coder` measures the Coder on real tasks.** Twenty small
  projects, each with a task and a hidden check the agent never sees: fix a
  bug a test exposes, add a feature to a written spec, rename across files,
  refactor with the tests kept green, edit a settings file, build a page,
  answer a question without changing anything. It runs the real app in a
  headless browser with a local model and records what passed, the minutes,
  steps, failed edits and tokens, so a change to the agent is measured rather
  than guessed at. Everything happens in one temporary folder: file requests
  outside the task's project are refused, and every command runs in the macOS
  sandbox with writing allowed only in that folder, the home folder unreadable
  and no network. `--self-test` shows each check fails on the untouched
  project and passes on a reference answer. It needs macOS, a browser and a
  local model, so it is not in CI.
- **`npm run sweep` drives the UI**, which the checks cannot: it opens each mode in a headless browser, clicks every control visible from a cold start, and reports what throws. It is not in CI — it needs a real browser — and it covers each mode from cold, not states that need content. Before it existed nothing caught a broken button; it was written after a menu was found that opened, closed, wrote no file and said nothing.
- The build is unsigned. See [SECURITY.md](SECURITY.md).

---

## Abandoned plan

The original design called for a platform-agnostic `core/` layer — pure JS, testable in a browser without Tauri — sitting behind a `platform/` abstraction with `browser.js` and `tauri/` implementations, so that a mobile target would need only a new `platform/` folder. Phase 1 got as far as pulling the mode files out of `app.js` into `src/js/`, and they have since moved again into `src/modes/<id>/`. `core/` has now been started — it holds the settings panes taken out of app.js — but it is nothing like the platform-agnostic layer that was planned, and `platform/` still holds just the Tauri bridge files.

It is recorded here because the goal is still sound. It is not recorded as current structure, because it is not.
