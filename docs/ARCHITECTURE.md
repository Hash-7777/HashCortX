# HashCortx — Architecture

Tauri v2 desktop application. Rust core, native system webview, vanilla JavaScript frontend. No bundler, no framework, no build step for the frontend — `tauri.conf.json` serves `src/` directly via `"frontendDist": "../src"`.

Roughly **34,000 lines of JavaScript** (plus ~19,000 more in vendored libraries) and **3,700 lines of Rust**.

> This document describes the tree as it exists today. An earlier version described a planned `core/` + `platform/` split full of files that were never written; that plan is preserved at the bottom under *Abandoned plan* so the intent is not lost.

---

## Real directory structure

```
HashCortX/
├── src/                             frontend, served as-is
│   ├── index.html                   the app shell — and still every mode's markup
│   ├── main.js                      bootstrap
│   ├── styles.css                   the second design system, linked last
│   ├── css/                         the shared stylesheets: tokens, base,
│   │                                sidebar, tabs, main, composer, modes, modals
│   │
│   ├── modes/                       one folder per mode. Adding a mode is a
│   │   │                            folder and one line in the manifest.
│   │   ├── manifest.js         35   the only place a mode is named
│   │   ├── boot.js             55   turns that list into <link> and <script>
│   │   ├── systems/          4,220  ERP prototype generator      (mode.js + mode.css)
│   │   ├── virtual-os/       3,836  virtual project desktop
│   │   ├── forge/            3,756  3D planning
│   │   ├── agent-maker/      3,025  chain / vote / failover
│   │   ├── finance/          2,705  financial document analysis
│   │   ├── code/             2,695  the Coder agent loop
│   │   └── sandbox/            603  security scanner
│   │
│   ├── core/                        pieces taken out of app.js
│   │   └── settings/
│   │       ├── memory-pane.js  534  the memory list and the radial map
│   │       └── local-model.js  197  the Local model walkthrough
│   │
│   ├── data/                        content, not behaviour
│   │   ├── prompts.js          292  every preset prompt and chip row
│   │   └── cloud-models.js     108  the fallback model catalogue
│   │
│   ├── js/
│   │   ├── app.js            7,695  core: state, chat, agents, tools, providers
│   │   ├── rag-search.js       119  knowledge-base ranking: keywords,
│   │   │                              cosine, rank fusion — pure, tested
│   │   ├── rag-store.js        123  how a document becomes passages —
│   │   │                              chunking must cover the whole text
│   │   ├── url-safety.js        93  addresses the fetch tool may reach
│   │   ├── providers.js        277  each provider's endpoint and auth, plus
│   │                                Moonshot's four hosts and two account systems
│   │   ├── markdown-safe.js    131  link sanitiser, entity decoding, escaping
│   │   ├── agent-shape.js      186  images, tools and tool results per provider
│   │   ├── model-names.js      190  provider, display name, size class, failover
│   │   ├── memory.js           276  reading facts from a message, ranking them
│   │   ├── diff.js             171  line diff behind the Coder change view
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
│           └── keychain.js          API key bundle (localStorage, see SECURITY.md)
│
├── src-tauri/
│   ├── src/
│   │   ├── main.rs                  entry point
│   │   ├── lib.rs                   plugin registration and builder
│   │   ├── commands/
│   │   │   ├── shell.rs       432   process execution: denylist, timeout,
│   │   │   │                        closed stdin, output cap
│   │   │   ├── embed.rs       288   sentence embeddings, run natively
│   │   │   ├── checkpoint.rs  314   what a file held before the agent changed it
│   │   │   ├── net.rs         229   resolves a hostname and refuses private ones
│   │   │   ├── fs.rs          451   filesystem bridge, applies the denylist
│   │   │   ├── keychain.rs    113   one-time migration out of the old Keychain
│   │   │   ├── usage_log.rs    93   appends token counts to usage.jsonl
│   │   │   ├── notch.rs        92   Hash D Island live-activity ping
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
├── scripts/checks/                  the automated frontend checks — 1,096 of
│   │                                them, all loading the real source
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
│   └── memory.mjs                   what is remembered, and found again
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
  appendAssistantToolCallTurn,
  appendToolResult,
  afterRender,          // hook: lets code-mode.js re-inject tool blocks after render()
  ...
};
```

`code-mode.js` additionally exposes `window.HC_CODE`. This is the seam to respect when adding a mode: **never import across mode files directly** — go through `_H`.

The `afterRender` hook exists because `render()` rebuilds the chat DOM wholesale, which would otherwise destroy the collapsible tool-call blocks that Coder mode injects.

---

## Design rules

1. `src/platform/` is the only place allowed to touch `window.__TAURI__`. Enforced by `scripts/checks/native-surface.mjs`, which also pins the set of files outside it that may invoke a command, and the modes that must invoke none.
2. Every native call is intercepted by `guard.js` before executing, and independently re-checked in Rust.
3. Every guarded action is appended to the audit log, allowed or denied.
4. `src/main.js` only bootstraps — no feature code.
5. One folder per mode in `src/modes/<id>/`, named once in `modes/manifest.js`. Cross-module access goes through `window._H`. Enforced by `scripts/checks/modes.mjs`, which also counts how many shared files still name each mode and refuses to let that number rise.
6. Third-party libraries are vendored into `src/js/vendor/`, never fetched from a CDN at runtime — **with exactly one exception**: Pyodide, whose CPython runtime and wheels (pandas, numpy, matplotlib) are fetched on first use and are far too large to ship. It is the only reason `script-src` still names a host. three.js, its four loaders and SheetJS used to be fetched too; they are vendored now, which is what makes 3D Forge and spreadsheet import work offline.
7. No bundler and no framework. This is a constraint, not an oversight: it keeps the application itself around 7 MB, and it lets a reader trace a button to the Rust function it triggers without a source map. The DMG is 41.2 MB because the bundled embedding model is 34 MB of it — a cost paid once, deliberately, so the knowledge base works offline.

---

## Known architectural debt

- `app.js` is still a 7,695-line monolith, down from 8,682. Out so far: the prompt library, the fallback model catalogue, and two settings panes. The send pipeline, the agent tools, the Python sandbox and persistence are the next slices, and `scripts/checks/app-size.mjs` holds the ceiling so it cannot drift back.
- Every mode's markup is still in `index.html` — 1,124 lines of it, 47% of the shell, parsed on every launch for the one mode the user is in. The JS and CSS have moved into `src/modes/<id>/`; the markup has not.
- `legacyRun` in `modes/code/mode.js` is a single ~1,800-line function.
- The frontend's automated coverage is `scripts/checks/` — 1,096 checks over retrieval, the Permission Guard, the agent loop, exports, layout, idle power, the native surface, the usage log, element lookups, diffs, undo, knowledge-base chunking, fetch addresses, cloud providers, module imports, markdown safety, agent request shapes, model identifiers and memory. They load the real source, but none of them drives the UI: nothing catches a broken button. `dom-ids.mjs` is the nearest thing to a guard against that — it cannot tell whether a button works, but it does catch a control the code reads and the markup no longer has.
- The build is unsigned. See [SECURITY.md](SECURITY.md).

---

## Abandoned plan

The original design called for a platform-agnostic `core/` layer — pure JS, testable in a browser without Tauri — sitting behind a `platform/` abstraction with `browser.js` and `tauri/` implementations, so that a mobile target would need only a new `platform/` folder. Phase 1 got as far as pulling the mode files out of `app.js` into `src/js/`, and they have since moved again into `src/modes/<id>/`. `core/` has now been started — it holds the settings panes taken out of app.js — but it is nothing like the platform-agnostic layer that was planned, and `platform/` still holds just the Tauri bridge files.

It is recorded here because the goal is still sound. It is not recorded as current structure, because it is not.
