# HashCortx

**Local-first AI coding agents. Your terminal. Your agents. Your code.**

```
100% local  ·  zero cloud  ·  your keys  ·  your data
```

Your API keys never leave your keychain.
Your files never leave your machine.
No telemetry. No tracking. No backend server.
Air-gapped capable with local models (Ollama, LM Studio).

Every AI request travels: your device → provider API → back.
Nothing passes through us. There is no "us".

---

## Quick Start

```bash
npm install
npm run tauri dev
```

Build for distribution:
```bash
npm run tauri build
```

---

## Master Plan — All 8 Phases

---

### Phase 0 — Foundation & Brand ✅ COMPLETE

**Goal:** Logo, icon, color system, brand docs, Tauri window, intro screen.

**Deliverables:**
- `logo-full.png` — star mark + "HashCortx" handwriting text, neon green `#39ff81`
- `icon-master.png` — 1024×1024 squircle icon for all platforms
- `BRAND.md` — full style guide
- Tauri window with `titleBarStyle: Overlay` (custom title bar)
- iOS-style frosted-glass toolbar as persistent drag handle
- Intro boot screen: exact Hash_UI recreation in HashCortx green
- All Hash_UI modes ported (CSS + JS) with gold→green color adaptation

**Brand Identity:**

| Element | Spec |
|---|---|
| Wordmark | `HashCortx` |
| Primary | `#39ff81` (terminal green) |
| Accent | `#22d3ee` (electric cyan) |
| Warning | `#fbbf24` (amber — permission prompts) |
| Danger | `#f87171` (alert red — destructive actions) |
| Background | `#040704` (near-black, terminal feel) |
| Typography | JetBrains Mono / Berkeley Mono everywhere |

---

### Phase 1 — Architecture Refactor ✅ IN PROGRESS

**Goal:** Split the current monolithic files into `core/` + `platform/` so the app stays testable in a browser AND works inside Tauri.

**Done (May 2026):**
- `src/js/canvas.js` — Orchestration Canvas extracted from app.js (~854 lines). Uses `window._H` bridge for `ollamaChat`, `escapeHtml`, `runSwarm`, `state`, `render`, `persistCurrentChat`.
- `src/js/sandbox.js` — Sandbox Security Scanner extracted from app.js (~588 lines). Uses `window._H` bridge.
- `window._H` extended with `escapeHtml` and `runSwarm`.
- app.js reduced from 10,035 → 8,594 lines.

**Key principle:** `core/` never imports from Tauri. All native calls go through `platform/index.js`.

```
core/agent/hashcoder.js
     calls platform/index.js → platform/tauri/fs.js   (in app)
                              → platform/browser.js    (in browser)
```

**Target structure:**
```
src/
├── core/
│   ├── agent/          # One file per agent (hashcoder, forge, swarm, virtual-os)
│   ├── ui/modes/       # One file per mode UI
│   └── state/          # store.js, settings.js, permissions-store.js
└── platform/
    ├── index.js         # isWeb / isTauri detection
    ├── browser.js       # Browser fallback (IndexedDB)
    └── tauri/
        ├── fs.js        # Real FS (gated by guard)
        ├── shell.js     # Real shell (gated by guard)
        ├── keychain.js  # API key storage
        └── guard.js     # Permission gatekeeper ⭐
```

**Outcome:** Browser version still works perfectly. All existing features intact.

---

### Phase 2 — Tauri Wrapper ✅ IN PROGRESS

**Goal:** App runs as `.app` / `.exe`. Existing Hash_UI features all work inside the Tauri shell. API keys move from localStorage to OS Keychain.

**Deliverables:**
- All 9 Hash_UI modes running inside Tauri
- `tauri-plugin-store` for persistent settings
- `tauri-plugin-notification` for agent alerts
- API keys stored in OS Keychain (never plaintext)
- CSP locked to known AI provider domains

**Modes ported:**
| Mode | Status |
|------|--------|
| Code Mode | ✅ Ported |
| Virtual OS | ✅ Ported |
| Forge | ✅ Ported |
| Swarm Maker | ✅ Ported |
| System Maker | ✅ Ported |
| Agent Maker | ✅ Ported |
| All other modes | ✅ CSS adapted |

---

### Phase 3 — Permission Guard + Audit Log

**Goal:** Every native call (file read/write, shell exec, network) requires explicit user approval. Full audit trail.

**The Security Model — Layered Defense:**
```
┌─────────────────────────────────────────────────┐
│  Layer 1: UI / Mode Switcher                    │
│  (Code Mode requires explicit toggle)           │
├─────────────────────────────────────────────────┤
│  Layer 2: Agent Tool Calls                      │
│  (Agent describes what it wants to do)          │
├─────────────────────────────────────────────────┤
│  Layer 3: Permission Guard ← THE GATEKEEPER     │
│  Every native call passes through here:         │
│  • Read file?    → prompt user                  │
│  • Write file?   → prompt user                  │
│  • Run command?  → prompt user                  │
│  • Delete?       → ALWAYS prompt, no bypass     │
│  • Hardcoded denylist: ~/.ssh, ~/.aws, /etc     │
├─────────────────────────────────────────────────┤
│  Layer 4: Tauri Allowlist (compile-time)        │
│  Only these commands ever exist in the binary   │
├─────────────────────────────────────────────────┤
│  Layer 5: OS Sandbox                            │
│  macOS hardened runtime, signed binary          │
└─────────────────────────────────────────────────┘
```

**Permission dialog (modeled on Claude Code):**
```
┌─────────────────────────────────────────────┐
│  ▸ HashCoder wants to:                      │
│                                             │
│      WRITE  /home/user/project/auth.js       │
│             (147 lines, +23 / -8)           │
│                                             │
│  [ Allow once ]  [ Allow always ]           │
│  [ Deny ]        [ Show diff ]              │
│                                             │
│  Reason: "Adding JWT verification step"     │
└─────────────────────────────────────────────┘
```

**Permission scopes:**
- **Once** — just this one action
- **Session** — until app closes
- **Always for this folder** — persistent, scoped to project
- **Never (deny)** — adds to denylist

**Hard rules (cannot be overridden):**
- `~/.ssh/*`, `~/.aws/*`, `~/.gnupg/*`, `~/Library/Keychains/*` — denied always
- `rm -rf`, `sudo`, `dd`, `format` — require typing confirmation
- `/System`, `/usr/bin`, `/etc` — denied always

**Audit log** (append-only, stored locally):
```
2026-05-10 14:23:01 [allow-session] read  /home/user/project/auth.js
2026-05-10 14:23:14 [allow-once]    patch /home/user/project/auth.js (line 42)
2026-05-10 14:23:30 [deny]          shell rm -rf node_modules
```

**Files to create:**
- `src/platform/tauri/guard.js` — the permission gatekeeper
- `src-tauri/src/commands/audit.rs` — append-only audit log
- `src-tauri/src/security/denylist.rs` — hardcoded blocked paths
- `src/core/ui/permission-dialog.js` — the trust prompt UI

---

### Phase 4 — Code Mode (Real Filesystem + Shell)

**Goal:** A new "Code Mode" that gives AI agents real filesystem access and shell execution, gated by the Phase 3 permission guard.

**Two-mode architecture:**
```
┌─────────────────────────────────────────────────┐
│  HashCortx                                      │
│  ┌──────────────────┬──────────────────────┐   │
│  │  Virtual OS Mode │  Code Mode           │   │
│  │  (unchanged)     │                      │   │
│  │  Sandboxed       │  Real filesystem     │   │
│  │  IndexedDB       │  Real shell          │   │
│  │  Agent swarms    │  Real browser        │   │
│  │  Forge / Void    │  Like Claude Code    │   │
│  │  Zero risk —     │  Permission-gated    │   │
│  │  agents play     │  every action        │   │
│  └──────────────────┴──────────────────────┘   │
└─────────────────────────────────────────────────┘
```

**HashCoder agent tools:**
- `read_file(path)` → streams file contents
- `write_file(path, content)` → creates/overwrites (gated)
- `patch_file(path, diff)` → surgical edit (gated)
- `list_dir(path)` → directory listing
- `shell_run(command, args)` → whitelisted shell exec (gated)
- `search_files(pattern)` → ripgrep-style search
- `open_browser(url)` → Tauri WebView (Phase 6)

**Rust commands to add:**
- `src-tauri/src/commands/fs.rs` — FS bridge with denylist
- `src-tauri/src/commands/shell.rs` — shell exec with allowlist

---

### Phase 6 — Multi-Model BYOK Settings

**Goal:** Full BYOK UI. User adds API keys for any provider. Per-mode model assignment.

**Providers supported (no backend, direct API calls):**
- Anthropic (Claude Opus, Sonnet, Haiku)
- OpenAI (GPT-4o, GPT-4, GPT-3.5)
- Google Gemini (via generativelanguage.googleapis.com)
- OpenRouter (1000+ models, many free)
- Groq (ultra-fast llama-3.3-70b free)
- Cerebras (fast inference)
- Together AI
- Mistral
- SambaNova
- Ollama (local, `localhost:11434`)
- Any OpenAI-compatible endpoint

**Settings UI:**
```
Settings → AI Providers
┌───────────────────────────────────────────────┐
│  ✓ Anthropic        sk-ant-•••••••  [Test]    │
│  ✓ OpenAI           sk-•••••••••••  [Test]    │
│  ✓ OpenRouter       sk-or-••••••••  [Test]    │
│    Groq             [+ Add key]               │
│    Ollama           http://localhost:11434    │
└───────────────────────────────────────────────┘
```

**Per-mode model defaults:**
| Mode | Default | User can change to |
|---|---|---|
| Forge | OpenRouter free | Any model |
| Swarm | Groq llama-3.3-70b | Any model |
| Virtual OS | Anthropic Sonnet | Any model |
| Code Mode | Anthropic Opus | Any model |

**Storage:** API keys → OS Keychain (hardware-backed encryption, never plaintext).

**Files:**
- `src/core/ui/components/settings-modal.js` — BYOK settings UI
- `src/platform/tauri/keychain.js` — read/write keys from OS keychain
- `src-tauri/src/commands/keychain.rs` — Rust Keychain bridge

---

### Phase 7 — Polish, Signing & Distribution

**Goal:** Production-ready, signed, auto-updating builds for Mac + Windows + Linux.

**Deliverables:**
- macOS: Code signing with Apple Developer certificate, `.dmg` installer
- Windows: Certificate signing, `.exe` NSIS installer + `.msi`
- Linux: `.AppImage` + `.deb`
- Auto-updater via GitHub Releases (Tauri updater plugin)
- App Store preparation (macOS sandbox entitlements)
- GitHub Actions CI/CD: auto-builds on tag push

**Files to activate:**
- `.github/workflows/build.yml` — already written in `docs/future/`, activate when ready
- `src-tauri/tauri.conf.json` — uncomment `plugins.updater` block
- `src-tauri/src/main.rs` — add updater check on launch

**Signing setup:**
1. Buy Apple Developer account ($99/yr)
2. Set `signingIdentity` in `tauri.conf.json` to your cert name
3. Add cert + private key as GitHub Actions secrets
4. Run `npm run tauri signer generate` for updater keypair
5. Add public key to `tauri.conf.json` updater block

---

### Phase 8 — What Sets HashCortx Apart

| Feature | Claude Code | Cursor | Windsurf | **HashCortx** |
|---|---|---|---|---|
| Bring your own model | Limited | ✗ | ✗ | **✓ Any model** |
| Free models (Groq, Ollama) | ✗ | ✗ | ✗ | **✓** |
| Visual sandboxed mode | ✗ | ✗ | ✗ | **✓ Virtual OS** |
| Multiple agent paradigms | ✗ | ✗ | ✗ | **✓ Forge, Swarm, Code, Virtual OS** |
| Permission per action + scopes | ✓ | ✗ | ✗ | **✓ + audit log** |
| No telemetry, no backend | ✗ | ✗ | ✗ | **✓** |
| Air-gapped (Ollama) | ✗ | ✗ | ✗ | **✓** |
| Mac + Windows + Linux | ✓ | ✓ | ✓ | **✓** |

---

## Current Status: Phase 2 In Progress

### What's done
- [x] Phase 0: Foundation complete — logo, icon, Tauri window, brand system
- [x] Intro boot screen (exact Hash_UI recreation, green palette)
- [x] iOS-style toolbar (frosted glass, drag handle, v0.1.0 badge)
- [x] All Hash_UI modes ported: CSS color-adapted, JS brand-adapted
- [x] Vendor libs vendored locally (marked, highlight.js, mermaid, jsPDF, DOMPurify, three.js)
- [x] CSP locked to known AI providers

### What's next
- [ ] Phase 2: Wire all mode functionality end-to-end (test each mode works)
- [ ] Phase 3: Permission guard UI + audit log Rust commands
- [ ] Phase 4: Code Mode agent + real FS/shell commands in Rust

---

## Modes

| Mode | Description |
|------|-------------|
| Code Mode | Real filesystem + shell access. Like Claude Code — but yours. |
| Virtual OS | Sandboxed AI desktop. Safe playground for agents. |
| Forge | 3D generative design agent. |
| Swarm | Multi-agent collaboration. |
| System Maker | AI system design + architecture. |
| Agent Maker | Build and configure custom agents. |

## Models Supported (BYOK)

Anthropic · OpenAI · Google Gemini · OpenRouter · Groq · Cerebras · Together AI · Mistral · SambaNova · Ollama · Any OpenAI-compatible endpoint

## Security

- API keys in OS Keychain — never plaintext
- Every file/shell action requires approval
- Hardcoded denylist: `~/.ssh`, `~/.aws`, `/etc`, `/System`
- Shell allowlist — `sudo`, `dd`, `format` always blocked
- Full audit log of every agent action
- Prompt injection filter (50+ patterns)

See `docs/SECURITY.md` for the full threat model.

## Docs

- `docs/BRAND.md` — visual identity
- `docs/ARCHITECTURE.md` — system design  
- `docs/SECURITY.md` — threat model
