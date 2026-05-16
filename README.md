<img width="2560" height="1664" alt="logo with words no bg " src="https://github.com/user-attachments/assets/bc4748a3-f05b-4531-8bf6-5fb88de01aad" />

https://hashcortx.com

HashCortX is a local-first, open-source AI desktop agent built with Tauri, Rust, and vanilla JavaScript. It runs natively on macOS, Windows, and Linux — no Electron, no browser tab, no cloud dependency. Your API keys are stored in your OS keychain and never leave your machine.

The app ships with six purpose-built modes: Coder (autonomous multi-step coding agent with file tools, shell access, and live code execution), Finance AI (structured financial analysis studio that reads PDFs, CSVs, and bank statements and generates full reports with charts and KPIs), Forge (parametric multi-agent builder that spins up parallel specialist agents for large tasks), Swarm (visual agent orchestration where you design and run networks of AI workers), Sandbox (isolated code execution environment), and Virtual OS (a simulated operating environment for agents to work inside).

Supports 10+ AI providers out of the box — Anthropic Claude, OpenAI GPT, Google Gemini, Groq, Cerebras, SambaNova, DeepSeek, Mistral, Moonshot (Kimi), and local Ollama models — with automatic failover routing so if one provider rate-limits you, the agent seamlessly continues on the next available model. All provider keys are stored in the native OS keychain (macOS Keychain / Windows Credential Manager), never in files or environment variables.

Zero telemetry. Zero accounts. Zero subscriptions. Clone, build, and own it completely.
---

## Dev Start

```bash
npm install
npm run tauri dev
```

Main Build:
```bash
npm run tauri build
```

---
