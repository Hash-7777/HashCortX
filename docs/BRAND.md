# HashCortx — Brand Guide

## Name

**HashCortx** — Hash (the prompt, the identifier) + Cortex (the thinking layer).

Written `HashCortx`: capital H, capital C, lowercase x, no space. In terminal contexts, `hashcortx_`.

> The GitHub repository is `Hash-7777/HashCortX` with a capital X, and URLs must keep that spelling. Everywhere else — the app, the docs, prose — use `HashCortx`. `tauri.conf.json` sets `"productName": "HashCortx"`.

## Tagline

> Local-first AI workspace

## Identity statement

```
HashCortx — 100% local. Zero cloud. No account.

Your API keys stay on your machine.
Your files never leave it.
No telemetry. No tracking. No backend server.
Air-gapped capable with local models (Ollama).

Every AI request travels: your device → provider API → back.
Nothing passes through us. There is no "us".
```

> Do not write "your keys never leave your keychain." Keys are **not** in the macOS Keychain — they live in an app-scoped local store, in plain text, protected by the user account rather than by encryption. See [SECURITY.md](SECURITY.md). Claiming Keychain storage is a false security claim.

## The mark

The brand mark is the **white brain** — a top-down anatomical brain outline with rays converging on the brainstem, drawn in white on near-black. It ships as the app icon and lives at `logosss/new hashcortx logo no bg.png` (white art on transparency).

Use it white. Do not recolour it, do not add a glow, do not place it on a light background without a dark plate behind it.

```
[brain mark]  hashcortx_
              └────────┘└ cursor
```

`scripts/gen-icon.py` draws a seven-ray neon-green burst and **does not produce the shipped icon.** It predates the brain mark. Do not run it expecting the current icon.

## Colours

Read this section before you touch a colour. **Three palettes currently coexist in the app**, and the token names lie about two of them. This is real technical debt, documented here rather than hidden.

### 1. The live token set — `src/css/vars.css` `:root`

These are the tokens components should use.

| Token | Hex | Use |
|---|---|---|
| `--gold` | `#c9a96e` | Primary accent — the Send button, primary actions |
| `--gold-2` | `#dfc38e` | Hover, highlights |
| `--gold-deep` | `#8b6d2c` | Pressed, dim accent |
| `--emerald` | `#4ade80` | Success, safe, allowed — active tab icons |
| `--rose` | `#f87171` | Danger, denied, destructive |
| `--bg-0` | `#06070a` | App background |
| `--bg-2` | `#0d1117` | Panels |
| `--text` | `#ece7dc` | Primary text |
| `--text-dim` | `#a39d91` | Secondary text |
| `--muted` | `#6b6558` | Tertiary text |

### 2. Hardcoded cyan in the chrome

`tabs.css`, `sidebar.css` and friends do **not** use the tokens above for borders and glows. They hardcode `rgba(34, 211, 238, …)` — cyan — for tab borders, focus rings and glow shadows, with mint `#b6e5c7` label text and `--emerald` icons.

This is why the app reads as cool green-teal on screen even though the accent token is gold. The gold shows up mainly on the Send button.

### 3. Terminal green in Coder

`coder-mode.css` uses `#39ff81` — neon terminal green — for output and status text. That is the colour `scripts/gen-icon.py` was built around, and it survives only inside Coder.

### Traps

- `src/styles.css` defines a legacy `--hc-*` set on `:root` in which **`--hc-green` is `#22d3ee`, which is cyan, not green.** The name is wrong. These tokens are effectively unused; do not build on them.
- `src/styles.css` also redefines `--gold` as `#22d3ee` — but scoped to `#intro-screen` only. That is the splash screen's local palette, not the app's. An earlier version of this guide read that line, concluded the primary was cyan, and was wrong. So was the version that claimed gold was the only accent.
- `styles.css` loads **last** in `index.html`, so anything it puts on `:root` wins. Check the selector before you assume a token is global.

### Documentation art

**README diagrams are monochrome** — white and grey on near-black, with emerald and rose reserved for allowed and denied. They deliberately do not follow the app palette, because the app palette is currently three palettes. Keep the docs art white until the UI colours are unified.

## Typography

- **UI body**: the system sans stack (`--sans`) — SF Pro on macOS.
- **Code, terminal surfaces, modals**: JetBrains Mono, falling back to `ui-monospace`.
- **Diagrams and the README hero**: monospace throughout.

The claim that the entire UI is monospace is not true, and never was.

## Voice and tone

- Terminal-first: short, direct, no filler.
- Action-oriented: "patching", "running", "done".
- No marketing speak. Never "powerful", "seamless", "revolutionary".
- Security-confident, which means stating facts including the unflattering ones. If a protection is weaker than a reader would assume, say so before they find out.

## What HashCortx is not

- Not a cloud service
- Not a subscription
- Not a data company
- Not a wrapper around another product
