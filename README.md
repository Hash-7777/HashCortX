<div align="center">

# HashCortX

**The local-first AI workspace. Eleven modes. Ten providers. Zero telemetry.**

[Website](https://hashcortx.com) · [Latest Release](https://github.com/Hash-7777/HashCortX/releases/latest) · [Wiki](https://github.com/Hash-7777/HashCortX/wiki) · [Discussions](https://github.com/Hash-7777/HashCortX/discussions) · [Youtube](https://youtu.be/On5wPdKZDfg)

![License: MIT](https://img.shields.io/badge/license-MIT-39ff81.svg)
![Platform: macOS](https://img.shields.io/badge/platform-macOS%20Apple%20Silicon-39ff81.svg)
![Version: 2.0.0](https://img.shields.io/badge/version-2.0.0-39ff81.svg)
![Size: 8.9 MB](https://img.shields.io/badge/dmg-8.9%20MB-39ff81.svg)

</div>

![HashCortx main interface](https://github.com/user-attachments/assets/120dfafa-a778-4758-8314-83dc41752a28)

---

## What is HashCortX?

**HashCortX is a local-first, open-source AI desktop application for developers that combines a multi-provider chat workspace, an autonomous coding agent, multi-agent swarms, 9 pre-built specialist agents, financial document analysis, security scanning, 3D planning, and a virtual project desktop — into a single native 8.9 MB macOS app built with Tauri v2, Rust, and vanilla JavaScript.**

API keys are stored in the renderer's localStorage as a single JSON bundle — not in the OS keychain on the hot path. There IS an OS keychain implementation in Rust, but it's no longer used for daily reads. There is no HashCortX cloud backend, no telemetry, no analytics, no accounts, and no subscriptions. With Ollama, the entire app runs air-gapped offline. With cloud providers, every request travels directly from your device to the provider you chose — nothing passes through HashCortX infrastructure, because HashCortX infrastructure does not exist.

**HashCortX is a free, open-source alternative to commercial AI coding tools** like Cursor, Claude Code, Continue, Aider, and Cline — with a wider feature set than any of them.

---

## Key facts

| | |
|---|---|
| **Type** | Native AI desktop application |
| **Platform** | macOS Apple Silicon (Windows and Linux planned) |
| **License** | MIT |
| **Version** | v2.0.0 (May 2026) |
| **Bundle size** | 8.9 MB |
| **Stack** | Tauri v2 · Rust · vanilla JavaScript · macOS Keychain |
| **AI providers** | Anthropic · OpenAI · Google · Groq · Cerebras · SambaNova · DeepSeek · Moonshot · Mistral · OpenRouter · Ollama (local) |
| **Modes** | 11 specialized AI workspaces |
| **Pre-built agents** | 9 specialists |
| **Telemetry** | None |
| **Backend server** | None |
| **Author** | [Seif Hashish](https://github.com/Hash-7777) |

---

## Why HashCortX

- **Truly local-first.** No cloud backend, no auto-update, no telemetry, no accounts. The binary phones home to nothing.
- **Multi-provider by design.** Ten cloud providers and Ollama for local models — all configured side-by-side, switched freely, with automatic provider failover in swarm runs.
- **One app, eleven modes.** Coding, chat, swarms, research, financial analysis, security scanning, 3D planning, ERP generation, virtual OS — without juggling separate tools.
- **OS-grade key storage.**  API keys are stored in the renderer's localStorage as a single JSON bundle — not in the OS keychain on the hot path. There IS an OS keychain implementation in Rust, but it's no longer used for daily reads.
- **Tiny footprint.** 8.9 MB — roughly 30× smaller than Electron-based AI desktop apps that ship at 100–300 MB.
- **Open source under MIT.** Read every line. Fork it. Ship your own version.

---

## About this project's development

**Product, architecture, modes, philosophy, and every idea in this app are 100% by Seif Hashish.** The 11-mode structure, the local-first principle, the OS Keychain choice, the Permission Guard / Audit Log security model, the swarm-failover routing pattern, the pharma-informed source-grounding constraints in PubMed Agent, Drug Interaction, and Finance AI — every design decision was conceived and directed by the human author.

**HashCortX was built with heavy AI assistance — approximately 30 million tokens consumed** across Claude, GPT, and other frontier models during the v2.0.0 build. AI handled the bulk of implementation, refactoring, and iteration under human direction. Architecture decisions, security model, mode boundaries, and final code review were the author's. This is disclosed because HashCortX is itself an AI tool — using AI to build it and hiding that fact would be inconsistent.

All source is open at [Hash-7777/HashCortX](https://github.com/Hash-7777/HashCortX) and reviewable line by line.

---

## Screenshots

![Code mode with file explorer and agent chat](https://github.com/user-attachments/assets/00a538b5-bf12-4a24-aa23-3bc3a191840a)

![Agent Swarm orchestration](https://github.com/user-attachments/assets/a07931d6-6e4c-4221-9ab2-cb3668fc70e2)

![Finance AI analysis studio](https://github.com/user-attachments/assets/5e2cdc5c-854a-4331-a786-97a6337f0121)

![3D Forge spatial planning](https://github.com/user-attachments/assets/305cd8ef-d77f-4f52-9bbb-c0c0ede2ac75)

---

## The 11 Modes

| # | Mode | What it does |
|---|---|---|
| 1 | **Chats** | Multi-provider chat workspace with projects, file attachments, slash commands, and chat history |
| 2 | **Agents** | 9 pre-built specialist agents: Personal Assistant, Quick Assistant, Research Agent, Deep Research, Senior Engineer, Page Analyzer, PubMed Agent, Drug Interaction, ATS CV Auditor |
| 3 | **Code (HashCoder)** | Full AI coding agent with file tree, project picker, real file-edit tools, shell access, and a browser panel |
| 4 | **Split** | Side-by-side real-time comparison of two models on the same prompt |
| 5 | **3D Forge** | Architecture-first 3D planning agent producing structured node/mesh plans for game levels, generative architecture, and spatial design |
| 6 | **Finance AI** | Full-screen financial analysis studio for bank statements, CSVs, PDFs, and XLSX files — KPIs, charts, recommendations, never invents numbers |
| 7 | **Sandbox** | Swarm-based security scanner for malware patterns, trojans, prompt injections, and suspicious logic in untrusted code or AI output |
| 8 | **ERP / Systems Builder** | Generates working interactive prototypes — forms, tables, dashboards — from a workflow description |
| 9 | **Agent Swarm** | Designer for multi-agent pipelines with voting mode, chain mode, and automatic provider failover when a model rate-limits or fails mid-run |
| 10 | **Virtual OS** | Simulated project desktop where an AI agent creates, edits, and organizes files in a sandboxed workspace |
| 11 | **Agent Maker** | No-code builder for custom agents with name, icon, system prompt, and curated tool sets |

Full descriptions: [Wiki → Features](https://github.com/Hash-7777/HashCortX/wiki/Features) · [MODES_GUIDE.txt](MODES_GUIDE.txt)

---

## Supported AI providers

### Cloud providers (bring your own API key)

| Provider | Notes |
|---|---|
| **Anthropic** | Claude family (Opus, Sonnet, Haiku) |
| **OpenAI** | GPT family |
| **Google** | Gemini Pro, Flash |
| **Groq** | Llama, Mixtral — fast inference |
| **Cerebras** | Ultra-fast inference |
| **SambaNova** | Llama, DeepSeek hosting |
| **DeepSeek** | V3, R1 |
| **Moonshot** | Kimi |
| **Mistral** | Mistral family |
| **OpenRouter** | Meta-provider aggregating frontier models |

### Local models

| Provider | Notes |
|---|---|
| **Ollama** | Any Ollama-hosted local model. No API key required. Air-gapped capable. |

API keys are stored in the renderer's localStorage as a single JSON bundle — not in the OS keychain on the hot path. There IS an OS keychain implementation in Rust, but it's no longer used for daily reads.

---

## Install

### Quick install (macOS, Apple Silicon)

1. Download `HashCortx-2.0.0-macOS-arm64.dmg` from the [latest release](https://github.com/Hash-7777/HashCortX/releases/latest)
2. Open the DMG and drag HashCortX to `/Applications`
3. On first launch: right-click → **Open** → **Open** (the v2.0.0 build is unsigned)
4. Open **Settings → Providers** and add API keys for the providers you want to use
5. Or skip API keys and use local models via Ollama

### Bypass Gatekeeper (unsigned build workaround)

```bash
xattr -dr com.apple.quarantine /Applications/HashCortx.app
```

Code signing is planned for a future release.

---

## Build from source

```bash
git clone https://github.com/Hash-7777/HashCortX.git
cd HashCortX
npm install
npm run tauri dev
```

Build a distributable:

```bash
npm run tauri build
```

Output: `src-tauri/target/release/bundle/dmg/`

### Requirements

- macOS, Node 18+, Rust toolchain (`rustup`), Xcode Command Line Tools.

---

## Tech stack

| Layer | Technology |
|---|---|
| **Framework** | Tauri v2 (Rust + native webview) |
| **Backend** | Rust |
| **Frontend** | Vanilla JavaScript (no React, no TypeScript, no bundler) |
| **Native APIs** | macOS Keychain (via `keyring` crate), filesystem and shell via Tauri commands, API keys are stored in the renderer's localStorage as a single JSON bundle — not in the OS keychain on the hot path. There IS an OS keychain implementation in Rust, but it's no longer used for daily reads. |
| **Styling** | Plain CSS, JetBrains Mono / Berkeley Mono typography |
| **Local models** | Ollama integration |

The choice of vanilla JS (no React, no bundler) is deliberate — it keeps the bundle at 8.9 MB and the codebase auditable end-to-end.

---

## Privacy and security

- **No backend server.** Every AI request travels directly from your machine to the provider you configured. There is no HashCortX intermediary.
- **No telemetry.** No analytics, no tracking, no usage reporting, no error-reporting backend. The binary has no network calls except to AI provider endpoints you explicitly configure.
- **No accounts.** No sign-up, no login, no email collection.
- **OS Keychain storage.** API keys are stored in the renderer's localStorage as a single JSON bundle — not in the OS keychain on the hot path. There IS an OS keychain implementation in Rust, but it's no longer used for daily reads.
- **Permission Guard.** Filesystem and shell calls from the coding agent are intercepted by a denylist-based gatekeeper before execution. Every guarded action is logged to the built-in Audit Log.
- **Source-grounded modes.** PubMed Agent, Drug Interaction, and Finance AI are constrained to never fabricate data.
- **Air-gapped capable.** With Ollama, the app runs fully offline.

---

## How HashCortX compares

| | HashCortX | Cursor | Claude Code | Continue | Aider | Cline | Zed |
|---|---|---|---|---|---|---|---|
| Type | Native desktop app | VS Code fork | CLI | VS Code/JetBrains extension | Terminal CLI | VS Code extension | Native editor |
| License | MIT | Proprietary | Proprietary | Apache 2.0 | Apache 2.0 | Apache 2.0 | GPL/AGPL |
| Free | Yes (BYO key) | Subscription | Subscription/API | Yes | Yes | Yes | Yes |
| Local-first | Yes | No | No | Yes | Yes | Yes | Yes |
| OS Keychain | Yes | No | Yes | No | No | No | No |
| Cloud providers | 10 | Limited | Anthropic only | Many | Many | Many | Several |
| Local models (Ollama) | Yes | Limited | No | Yes | Yes | Yes | Yes |
| Multi-agent swarms | Yes | No | No | No | No | No | No |
| Modes beyond coding | Yes (11) | No | No | No | No | No | No |
| Pre-built agents | 9 | None | None | None | None | None | None |
| Telemetry | None | Yes | Yes (opt-out) | Opt-in | None | None | Opt-in |

Detailed breakdown: [Wiki → Comparison](https://github.com/Hash-7777/HashCortX/wiki/Comparison)

---

## FAQ

### Is HashCortX free?
Yes. MIT-licensed, no paid tier, no usage caps. You pay AI providers directly for their API usage, or use Ollama to avoid all AI costs.

### Does HashCortX work offline?
Yes, with Ollama. Cloud providers require internet.

### Which operating systems are supported?
macOS Apple Silicon in v2.0.0. Intel Mac, Windows, and Linux builds are planned.

### Does HashCortX send my code or data anywhere?
Only to AI providers you explicitly configure. There is no HashCortX server.

### Can I use Claude, GPT, and Gemini at the same time?
Yes. Configure all your keys at once and switch freely. In Agent Swarm mode, automatic provider failover kicks in when a model fails or rate-limits.

### Was HashCortX built with AI?
Yes — heavy AI assistance, approximately 30 million tokens consumed during development. All product ideas, architecture, and direction were by the human author. See [About this project's development](#about-this-projects-development).

### How big is HashCortX?
8.9 MB DMG. Roughly 30× smaller than Electron-based equivalents.

Full FAQ: [Wiki → FAQ](https://github.com/Hash-7777/HashCortX/wiki/FAQ)

---

## Roadmap

- Code signing for the macOS build
- Intel Mac, Windows, and Linux builds
- Further extraction of monolithic source modules
- Permission Guard coverage for Virtual OS and 3D Forge native calls
- Additional pre-built specialist agents based on user requests

Suggest features via [GitHub Issues](https://github.com/Hash-7777/HashCortX/issues/new/choose).

---

## Keyboard shortcuts

| Shortcut | Action |
|---|---|
| `Cmd/Ctrl + Shift + N` | Start a new chat from anywhere |

---

## Documentation

- [Wiki Home](https://github.com/Hash-7777/HashCortX/wiki) — overview and entry point
- [Features](https://github.com/Hash-7777/HashCortX/wiki/Features) — full descriptions of all 11 modes
- [Supported Providers](https://github.com/Hash-7777/HashCortX/wiki/Supported-Providers) — provider list with model details
- [Comparison](https://github.com/Hash-7777/HashCortX/wiki/Comparison) — vs Cursor, Claude Code, Continue, Aider, Cline, Zed
- [Privacy and Security](https://github.com/Hash-7777/HashCortX/wiki/Privacy-and-Security) — full security architecture
- [FAQ](https://github.com/Hash-7777/HashCortX/wiki/FAQ) — comprehensive Q&A
- [MODES_GUIDE.txt](MODES_GUIDE.txt) — full mode reference

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, architecture rules, and how to propose changes. Bug reports and feature requests via [GitHub Issues](https://github.com/Hash-7777/HashCortX/issues). Questions and ideas via [GitHub Discussions](https://github.com/Hash-7777/HashCortX/discussions).

---

## License

MIT. See [LICENSE](LICENSE).

---

## Author

**Seif Hashish** — independent open-source developer with a pharma and clinical background. The pharma background informs the source-grounding constraints in HashCortX's PubMed Agent, Drug Interaction, and Finance AI modes.

- GitHub: [@Hash-7777](https://github.com/Hash-7777)
- Website: [hashcortx.com](https://hashcortx.com)

---

<div align="center">

**HashCortX**

One UI · Agent Swarms · Zero Data Leak · Local-First · Open Source

[Download](https://github.com/Hash-7777/HashCortX/releases/latest) · [Wiki](https://github.com/Hash-7777/HashCortX/wiki) · [Discussions](https://github.com/Hash-7777/HashCortX/discussions)

</div>
