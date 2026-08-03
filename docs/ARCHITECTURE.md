# HashCortx — Architecture

Tauri v2 desktop application. Rust core, native system webview, vanilla JavaScript frontend. No bundler, no framework, no build step for the frontend — `tauri.conf.json` serves `src/` directly via `"frontendDist": "../src"`.

Roughly **32,100 lines of JavaScript** (plus ~4,000 more in vendored libraries) and **2,820 lines of Rust**.

> This document describes the tree as it exists today. An earlier version described a planned `core/` + `platform/` split full of files that were never written; that plan is preserved at the bottom under *Abandoned plan* so the intent is not lost.

---

## Real directory structure

```
HashCortX/
├── src/                             frontend, served as-is
│   ├── index.html                   the app shell and every mode's markup
│   ├── main.js                      bootstrap
│   ├── styles.css                   design tokens
│   ├── css/                         one stylesheet per mode
│   │
│   ├── js/
│   │   ├── app.js            8,632  core: state, chat, agents, tools, providers
│   │   ├── rag-search.js       119  knowledge-base ranking: keywords,
│   │   │                              cosine, rank fusion — pure, tested
│   │   ├── rag-store.js        123  how a document becomes passages —
│   │   │                              chunking must cover the whole text
│   │   ├── url-safety.js        93  addresses the fetch tool may reach
│   │   ├── providers.js        148  each cloud provider's endpoint and auth
│   │   ├── system-maker.js   4,186  ERP prototype generator
│   │   ├── virtual-os.js     3,846  virtual project desktop
│   │   ├── forge-mode.js     3,657  3D planning
│   │   ├── swarm-maker.js    3,022  chain / vote / failover
│   │   ├── finance-mode.js   2,715  financial document analysis
│   │   ├── code-mode.js      2,488  the Coder agent loop
│   │   ├── diff.js             171  line diff behind the Coder change view
│   │   ├── sandbox.js          603  security scanner
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
├── scripts/checks/                  the automated frontend checks — 471 of
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
│   └── imports.mjs                  every import resolves to a file that is
│                                    actually there
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

There is no `core/` directory, no `ai.rs`, no `allowlist.rs`, and no `browser.js`. Release builds are still run by hand; `.github/workflows/ci.yml` only checks the code, it does not produce a DMG.

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

`app.js` is a monolith, and the other mode files load after it as separate `<script>` tags. They share state through a global bridge that `app.js` publishes near the bottom of the file:

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
5. One mode per file in `src/js/`. Cross-module access goes through `window._H`.
6. Third-party libraries are vendored into `src/js/vendor/`, never fetched from a CDN at runtime — **with exactly one exception**: Pyodide, whose CPython runtime and wheels (pandas, numpy, matplotlib) are fetched on first use and are far too large to ship. It is the only reason `script-src` still names a host. three.js, its four loaders and SheetJS used to be fetched too; they are vendored now, which is what makes 3D Forge and spreadsheet import work offline.
7. No bundler and no framework. This is a constraint, not an oversight: it keeps the application itself around 7 MB, and it lets a reader trace a button to the Rust function it triggers without a source map. The DMG is 41.2 MB because the bundled embedding model is 34 MB of it — a cost paid once, deliberately, so the knowledge base works offline.

---

## Known architectural debt

- `app.js` is still an ~8,830-line monolith. The retrieval maths is out (`js/rag-search.js`); the rest of the memory system, the model utilities and the swarm log are the next slices.
- `legacyRun` in `code-mode.js` is a single ~1,800-line function.
- The frontend's automated coverage is `scripts/checks/` — 471 checks over retrieval, the Permission Guard, the agent loop, exports, layout, idle power, the native surface, the usage log, element lookups, diffs, undo, knowledge-base chunking, fetch addresses, cloud providers and module imports. They load the real source, but none of them drives the UI: nothing catches a broken button. `dom-ids.mjs` is the nearest thing to a guard against that — it cannot tell whether a button works, but it does catch a control the code reads and the markup no longer has.
- The build is unsigned. See [SECURITY.md](SECURITY.md).

---

## Abandoned plan

The original design called for a platform-agnostic `core/` layer — pure JS, testable in a browser without Tauri — sitting behind a `platform/` abstraction with `browser.js` and `tauri/` implementations, so that a mobile target would need only a new `platform/` folder. Phase 1 got as far as pulling the mode files out of `app.js` into `src/js/`. The `core/` split was never built, and `platform/` ended up holding just the three Tauri bridge files.

It is recorded here because the goal is still sound. It is not recorded as current structure, because it is not.
