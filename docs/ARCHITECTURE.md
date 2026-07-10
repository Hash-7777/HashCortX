# HashCortx — Architecture

Tauri v2 desktop application. Rust core, native system webview, vanilla JavaScript frontend. No bundler, no framework, no build step for the frontend — `tauri.conf.json` serves `src/` directly via `"frontendDist": "../src"`.

Roughly **33,000 lines of JavaScript** and **919 lines of Rust**.

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
│   │   ├── app.js            8,904  core: state, chat, agents, tools, providers
│   │   ├── system-maker.js   4,184  ERP prototype generator
│   │   ├── virtual-os.js     3,837  virtual project desktop
│   │   ├── forge-mode.js     3,819  3D planning
│   │   ├── swarm-maker.js    3,022  chain / vote / failover
│   │   ├── finance-mode.js   2,710  financial document analysis
│   │   ├── code-mode.js      2,215  the Coder agent loop
│   │   ├── sandbox.js          603  security scanner
│   │   └── vendor/                  marked, highlight.js, DOMPurify, mermaid,
│   │                                pdf.js, jsPDF, three.js — all local
│   │
│   └── platform/
│       ├── index.js                 detects browser vs Tauri
│       └── tauri/
│           ├── hashcoder.js         HC.code.* file and shell tools
│           ├── guard.js             HC.guard.request() permission dialog
│           └── keychain.js          API key bundle (localStorage, see SECURITY.md)
│
├── src-tauri/
│   ├── src/
│   │   ├── main.rs                  entry point
│   │   ├── lib.rs                   plugin registration and builder
│   │   ├── commands/
│   │   │   ├── fs.rs          343   filesystem bridge, applies the denylist
│   │   │   ├── shell.rs       133   process execution, applies the denylist
│   │   │   ├── keychain.rs    113   one-time migration out of the old Keychain
│   │   │   ├── usage_log.rs    93   appends token counts to usage.jsonl
│   │   │   └── audit.rs        52   append-only audit log
│   │   └── security/
│   │       └── denylist.rs     99   hardcoded blocked paths and commands
│   ├── capabilities/default.json
│   ├── icons/
│   ├── Cargo.toml
│   └── tauri.conf.json
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

There is no `core/` directory, no `ai.rs`, no `allowlist.rs`, no `browser.js`, and no `.github/workflows/`. Builds are run by hand.

---

## How the layers actually talk

```
src/js/*.js  ──▶  window.HC.*        ──▶  Tauri IPC  ──▶  src-tauri/src/commands/*.rs
(renderer)        (platform/tauri/)                        (Rust, applies denylist)
```

**Two things worth knowing, because they surprise people:**

1. **AI requests do not go through Rust.** `app.js` calls `fetch()` in the renderer, straight to the provider, with the API key in the `Authorization` header. Rust is involved only in filesystem, shell, audit, and usage logging.

2. **The denylist is enforced in Rust, not JavaScript.** `guard.js` raises the permission dialog, but `fs.rs` and `shell.rs` consult `security/denylist.rs` independently. A compromised prompt that talks its way past the dialog still cannot read `~/.ssh`.

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

1. `src/platform/` is the only place allowed to touch `window.__TAURI__`.
2. Every native call is intercepted by `guard.js` before executing, and independently re-checked in Rust.
3. Every guarded action is appended to the audit log, allowed or denied.
4. `src/main.js` only bootstraps — no feature code.
5. One mode per file in `src/js/`. Cross-module access goes through `window._H`.
6. Third-party libraries are vendored into `src/js/vendor/`, never fetched from a CDN at runtime.
7. No bundler and no framework. This is a constraint, not an oversight: it keeps the DMG at 8.9 MB, and it lets a reader trace a button to the Rust function it triggers without a source map.

---

## Known architectural debt

- `app.js` is still an 8,904-line monolith. Extracting the memory/RAG system, the model utilities and the swarm log is the next slice.
- Virtual OS and 3D Forge make native calls that do not yet route through the Permission Guard.
- The frontend has no tests.
- The build is unsigned. See [SECURITY.md](SECURITY.md).

---

## Abandoned plan

The original design called for a platform-agnostic `core/` layer — pure JS, testable in a browser without Tauri — sitting behind a `platform/` abstraction with `browser.js` and `tauri/` implementations, so that a mobile target would need only a new `platform/` folder. Phase 1 got as far as pulling the mode files out of `app.js` into `src/js/`. The `core/` split was never built, and `platform/` ended up holding just the three Tauri bridge files.

It is recorded here because the goal is still sound. It is not recorded as current structure, because it is not.
