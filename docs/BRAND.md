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

The shipped UI palette, from `src/css/vars.css` — a champagne-gold accent on near-black:

| Token | Hex | Use |
|---|---|---|
| `--gold` | `#c9a96e` | Primary accent, active states |
| `--gold-2` | `#dfc38e` | Hover, highlights |
| `--gold-deep` | `#8b6d2c` | Pressed, dim accent |
| `--emerald` | `#4ade80` | Success, safe, allowed |
| `--rose` | `#f87171` | Danger, denied, destructive |
| `--bg-0` | `#06070a` | App background |
| `--bg-2` | `#0d1117` | Panels |
| `--text` | `#ece7dc` | Primary text |
| `--text-dim` | `#a39d91` | Secondary text |
| `--muted` | `#6b6558` | Tertiary text |

**README diagrams are monochrome**, not gold: white and grey on near-black, with emerald and rose reserved for allowed/denied. The app is gold; the documentation art is white. Both are intentional — keep them separate.

An earlier version of this guide specified a cyan `#22d3ee` primary. That palette was never shipped.

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
