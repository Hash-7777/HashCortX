# Changelog

All notable changes to HashCortx are recorded here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

Everything below has landed on `main` but is not yet in a tagged release or a DMG.

### Added
- Token usage log. Every model response appends one JSON line — timestamp, model id, token counts, and nothing else — to `~/.hashcortx/usage.jsonl`, so [HashMeterAi](https://github.com/Hash-7777/HashMeterAi) can report HashCortx usage as measured rather than estimated. Counts come from the provider's response metadata; when a provider reports none, nothing is written.
- Hash ecosystem section in the README and in the app's About pane.
- Seven hand-drawn SVG diagrams in `docs/assets/`, and a rebuilt README.

### Changed
- **API keys moved out of the macOS Keychain** into a plain-text JSON bundle (`hc_api_bundle_v2`) in the app's own local store, keyed by bundle identifier. A Keychain item's access list is bound to the binary's code signature, so every unsigned rebuild re-prompted for every key. Existing Keychain keys migrate across once on first run, then the Keychain entry is deleted. This is weaker than Keychain storage and is documented as such in [docs/SECURITY.md](docs/SECURITY.md). It will be reverted once the build is signed.

### Fixed
- `docs/SECURITY.md` claimed keys were stored in the OS Keychain and that the JavaScript layer never sees a raw key. Both were the opposite of what the code does. It also documented a shell command allowlist, a prompt-injection filter, a Hardened Runtime and request rate limiting — none of which exist. Rewritten against the source.
- `docs/ARCHITECTURE.md` described a `core/` directory, `ai.rs`, `allowlist.rs` and a CI workflow that were never written. Replaced with the real tree.
- `docs/BRAND.md` specified a cyan primary that was never shipped, and described the brand mark as a `#`. The mark is the white brain; the colour situation is now documented honestly, including the three competing palettes.
- `CONTRIBUTING.md` required contributors to store keys via `keychain.rs` and forbade localStorage, contradicting the shipping code.
- README listed ten cloud providers (there are eleven — NVIDIA NIM was missing), eleven modes (there are ten workspace tabs), nine agent names that did not match `BUILTIN_AGENTS`, and one keyboard shortcut out of three. The Pyodide Python sandbox was undocumented.
- README screenshots sat under the wrong headings — the Coder section showed Agent Swarm, the Agent Swarm section showed the About pane, and Finance and 3D Forge were swapped.
- `scripts/gen-icon.py` draws a neon-green burst that is not the shipped icon. Flagged as legacy so nobody regenerates the wrong mark.

---

## [2.0.0] — 2026-05-19

First public release. macOS Apple Silicon, unsigned, 8.9 MB DMG.

### Added
- **Ten workspaces** in one window: Chats, Agents, Coder, Split, 3D Forge, Finance, Sandbox, ERP, Agent Swarm, Virtual OS.
- **Coder** — an agent with a file tree, project picker, real file edits, shell access and a browser panel, with every native call gated.
- **Permission Guard and audit log.** Filesystem and shell calls from the agent are intercepted by `HC.guard.request()` and independently re-checked against a denylist compiled into Rust that no prompt can override. Every guarded action, allowed or denied, is appended to `~/.hashcortx/audit.log`.
- **Agent Swarm** — chain and vote pipelines across many models, with automatic provider failover when one rate-limits mid-run.
- **Nine built-in specialist agents**: HashCortx, HashCortx Lite, Researcher, Deep Research, Coder, URL Reader, Published Papers Researcher, Medical Lexi-Check, ATS CV Auditor. Plus a no-code builder for your own.
- **Eleven cloud providers** — Anthropic, OpenAI, Google Gemini, Groq, Cerebras, SambaNova, DeepSeek, Moonshot, Mistral, OpenRouter, NVIDIA NIM — and Ollama for local models, with a Test button per key.
- **Python sandbox.** `execute_python` runs CPython on WebAssembly via Pyodide, preloaded with pandas, numpy, matplotlib, python-docx, openpyxl and reportlab. Anything written to `/output/` downloads to your machine, so the agent produces real `.docx`, `.xlsx` and `.pdf` files.
- **Finance** — statements, CSV, PDF and XLSX into KPIs, charts and recommendations, constrained never to invent a figure.
- **Sandbox** — a swarm scanning untrusted code and AI output for malware, trojans and prompt injection.
- **3D Forge**, **ERP** and **Virtual OS**.
- Keyboard shortcuts: `Cmd/Ctrl+Shift+C` toggles Coder, `Cmd/Ctrl+Shift+N` starts a new chat, `Cmd/Ctrl+K` jumps to the model picker.

### Security
- No backend server, no telemetry, no accounts, no auto-updater. Every AI request goes from the renderer straight to the provider you configured.
- The build is unsigned. Installing requires a Gatekeeper bypass. Code signing is on the roadmap.

---

## Before 2.0.0

Development history predating the first public release was not kept as a changelog. The repository history begins on 2026-05-16.

[Unreleased]: https://github.com/Hash-7777/HashCortX/compare/v2.0.0...HEAD
[2.0.0]: https://github.com/Hash-7777/HashCortX/releases/tag/v2.0.0
