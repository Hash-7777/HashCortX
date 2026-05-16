# HashCortx — Architecture

## Overview
HashCortx is a Tauri v2 desktop application (Mac/Windows/Linux).
Frontend: HTML/CSS/JS (no framework, no build step needed in dev).
Backend: Rust via Tauri — handles filesystem, shell, keychain, HTTP.

## Phase Roadmap
| Phase | What ships |
|-------|-----------|
| 0 | Foundation: Tauri window, brand, docs, CI/CD |
| 1 | Architecture refactor: split into core/ + platform/ |
| 2 | All existing Hash_UI modes ported and working |
| 3 | Permission Guard + audit log |
| 4 | Code Mode (real filesystem + shell, gated) |
| 5 | Internet browser (Tauri WebView) |
| 6 | Multi-model BYOK settings |
| 7 | Auto-updater + distribution |

## Directory Structure (target — built progressively)
```
hashcortx/
├── src/
│   ├── index.html                 Entry point
│   ├── main.js                    Bootstrap
│   ├── styles.css                 Master design system (all tokens)
│   │
│   ├── core/                      Platform-agnostic logic (no Tauri imports)
│   │   ├── agent/
│   │   │   ├── hashcoder.js       Code Mode agent
│   │   │   ├── forge.js           3D Forge agent
│   │   │   ├── swarm.js           Multi-agent swarm
│   │   │   ├── virtual-os.js      Virtual OS agent
│   │   │   └── prompts/           System prompt templates
│   │   ├── ui/
│   │   │   ├── modes/             One file per mode's UI
│   │   │   ├── permission-dialog.js  The trust gate UI
│   │   │   └── components/        Shared UI components
│   │   └── state/
│   │       ├── store.js           App state (reactive)
│   │       └── settings.js        User preferences
│   │
│   ├── platform/                  Environment abstraction layer
│   │   ├── index.js               Auto-detects: browser vs Tauri
│   │   ├── browser.js             Browser fallback (IndexedDB)
│   │   └── tauri/
│   │       ├── fs.js              Real filesystem (gated by guard)
│   │       ├── shell.js           Shell execution (gated by guard)
│   │       ├── browser.js         WebView control
│   │       ├── keychain.js        API key read/write
│   │       ├── store.js           Tauri persistent store
│   │       └── guard.js           Permission gatekeeper ⭐
│   │
│   └── assets/                    Static assets
│
├── src-tauri/
│   ├── src/
│   │   ├── main.rs                Entry point
│   │   ├── lib.rs                 Plugin registration + builder
│   │   ├── commands/
│   │   │   ├── ai.rs              AI HTTP calls (key stays in Rust)
│   │   │   ├── fs.rs              FS bridge (applies denylist)
│   │   │   ├── shell.rs           Shell exec (applies allowlist)
│   │   │   ├── keychain.rs        OS keychain wrapper
│   │   │   └── audit.rs           Append-only audit log
│   │   └── security/
│   │       ├── denylist.rs        Hardcoded blocked paths
│   │       └── allowlist.rs       Whitelisted shell commands
│   ├── capabilities/
│   │   ├── default.json           Phase 0: minimal
│   │   └── code-mode.json         Phase 4: fs + shell (added then)
│   ├── icons/                     All platform icon sizes
│   ├── Cargo.toml
│   └── tauri.conf.json
│
├── docs/
│   ├── BRAND.md
│   ├── ARCHITECTURE.md            (this file)
│   └── SECURITY.md
│
├── .github/workflows/
│   └── build.yml                  Auto-builds Mac+Win+Linux on tag push
│
├── .gitignore
├── README.md
└── package.json

## Platform Abstraction Pattern
The core layer never imports from Tauri directly.
It calls platform/ which routes to the right implementation:

    core/agent/hashcoder.js
         calls platform/index.js → platform/tauri/fs.js (in app)
                                 → platform/browser.js  (in browser)

When adding a new platform (mobile later), only platform/ changes.
Core logic is untouched.

## Key Design Rules
1. platform/ is the only place that imports @tauri-apps/api
2. core/ is pure JS — testable in a browser without Tauri
3. Every native call logs to audit before executing
4. Every native call is intercepted by guard.js before executing
5. No feature code in src/main.js — it only bootstraps
6. One mode per file in core/ui/modes/
7. styles.css is the single source of truth for all design tokens
```
