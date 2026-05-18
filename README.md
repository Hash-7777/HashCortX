<img width="2560" height="1664" alt="logo with words no bg " src="https://github.com/user-attachments/assets/bc4748a3-f05b-4531-8bf6-5fb88de01aad" />

-> https://hashcortx.com
--> you will find real screenshots below description  :)

HashCortX is a local-first, open-source AI desktop agent built with Tauri, Rust, and vanilla JavaScript. It runs natively on macOS, Windows, and Linux — no Electron, no browser tab, no cloud dependency. Your API keys are stored in your OS keychain and never leave your machine.

The app ships with six purpose-built modes: Coder (autonomous multi-step coding agent with file tools, shell access, and live code execution), Finance AI (structured financial analysis studio that reads PDFs, CSVs, and bank statements and generates full reports with charts and KPIs), Forge (parametric multi-agent builder that spins up parallel specialist agents for large tasks), Swarm (visual agent orchestration where you design and run networks of AI workers), Sandbox (isolated code execution environment), and Virtual OS (a simulated operating environment for agents to work inside).

Supports 10+ AI providers out of the box — Anthropic Claude, OpenAI GPT, Google Gemini, Groq, Cerebras, SambaNova, DeepSeek, Mistral, Moonshot (Kimi), and local Ollama models — with automatic failover routing so if one provider rate-limits you, the agent seamlessly continues on the next available model. All provider keys are stored in the native OS keychain (macOS Keychain / Windows Credential Manager), never in files or environment variables.

Zero telemetry. Zero accounts. Zero subscriptions. Clone, build, and own it completely.
---

Run in the folder
```bash
npm install 
```
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


<img width="1199" height="868" alt="Screenshot 2026-05-16 at 5 35 02 AM" src="https://github.com/user-attachments/assets/120dfafa-a778-4758-8314-83dc41752a28" />


<img width="1199" height="868" alt="Screenshot 2026-05-16 at 4 43 04 AM" src="https://github.com/user-attachments/assets/a07931d6-6e4c-4221-9ab2-cb3668fc70e2" />


<img width="1199" height="868" alt="Screenshot 2026-05-16 at 4 44 27 AM" src="https://github.com/user-attachments/assets/00a538b5-bf12-4a24-aa23-3bc3a191840a" />


<img width="1199" height="868" alt="Screenshot 2026-05-16 at 4 44 41 AM" src="https://github.com/user-attachments/assets/5e2cdc5c-854a-4331-a786-97a6337f0121" />


<img width="1199" height="868" alt="Screenshot 2026-05-16 at 4 42 25 AM" src="https://github.com/user-attachments/assets/305cd8ef-d77f-4f52-9bbb-c0c0ede2ac75" />

══════════════════════════════════════════════════════════════
  HashCortX — Modes Guide
  v2.0  ·  github.com/Hash-7777/HashCortX
══════════════════════════════════════════════════════════════

HashCortX has 11 modes, each built for a specific type of work.
They all share your API keys and model picker — switch freely.

──────────────────────────────────────────────────────────────
1. CHATS
──────────────────────────────────────────────────────────────
Your main conversation workspace. Talk to any model you have
an API key for — Groq, Gemini, OpenAI, Anthropic, Cerebras,
SambaNova, DeepSeek, Moonshot, Mistral, or a local model via
Ollama. Supports file attachments, chat history, and projects 
to keep conversations organised. 
Use /commands in the input bar to access shortcuts.


──────────────────────────────────────────────────────────────
2. AGENTS
──────────────────────────────────────────────────────────────
Pre-built specialist agents ready to use. Each agent has a
custom system prompt and a curated set of tools tuned for its
job. Included agents:

  • Personal Assistant  — direct, calibrated, senior-engineer
                          style responses
  • Quick Assistant     — short and accurate answers, fast
  • Research Agent      — iterative web search with sourcing
  • Deep Research       — long-form, source-grounded analysis
  • Senior Engineer     — ship-ready code and product advice
  • Page Analyzer       — fetches and reads URLs you provide
  • PubMed Agent        — searches peer-reviewed medical
                          literature, cites every claim
  • Drug Interaction    — clinical pharmacology checks with
                          safety-first framing
  • ATS CV Auditor      — resume analysis against 2026 ATS
                          standards and recruiter filters

You can also build your own custom agents from the Agent Maker
tab and run them here.


──────────────────────────────────────────────────────────────
3. CODE  (HashCortX Coder)
──────────────────────────────────────────────────────────────
A full coding agent that reads, writes, and edits files using
real tools — not just text suggestions. It has its own chat
history separate from the main Chats tab, its own file explorer, 
its own model picker, and an auto-router that tries up to 
10 providers automatically,
if one rate-limits or fails. Supports all cloud providers and
local models. Use it to write features, debug, refactor, or
explain any codebase.


──────────────────────────────────────────────────────────────
4. SPLIT
──────────────────────────────────────────────────────────────
Side-by-side model comparison. Pick two models and send the
same prompt to both at once. See their answers next to each
other in real time. Useful for comparing quality, speed, and
style between providers before committing to one model for a
task.


──────────────────────────────────────────────────────────────
5. 3D FORGE
──────────────────────────────────────────────────────────────
Architecture-first 3D planning agent. Describe what you want
to build in 3D and the agent designs geometry, data flow, and
swarm task plans. It outputs structured node/mesh plans that
can feed into a build pipeline. Best for spatial design
thinking, game-level layout, generative architecture concepts,
and agentic 3D workflow planning.


──────────────────────────────────────────────────────────────
6. FINANCE AI
──────────────────────────────────────────────────────────────
Full-screen financial analysis studio. Attach a bank statement,
CSV, PDF, or XLSX file and get a structured report that
includes KPIs (net income, savings rate, burn rate, top spend
categories), a transaction table, charts, and actionable
recommendations — all calculated from your actual data, never
invented.

Rules the AI follows:
  • Never makes up numbers — everything comes from your file
  • Never gives investment advice or predictions
  • Clearly flags anything it cannot calculate from the data
  • Can produce example/demo reports if you explicitly ask for
    "dummy data" or "show me how it looks"

Has its own model picker so you can choose a capable model
independently of the rest of the app.


──────────────────────────────────────────────────────────────
7. SANDBOX
──────────────────────────────────────────────────────────────
Security scanner powered by a swarm of models. Paste code,
a script, or any text and the sandbox analyses it for malware
patterns, trojans, prompt injections, and suspicious logic.
Each model in the swarm gives an independent verdict, then the
results are combined. Designed for checking untrusted code or
AI-generated output before running it.


──────────────────────────────────────────────────────────────
8. ERP  (Systems Builder)
──────────────────────────────────────────────────────────────
Describe a business workflow and the agent generates a working
interactive prototype — forms, tables, dashboards, and logic.
Think of it as a rapid internal-tool builder. Good for mocking
up CRM flows, inventory screens, order trackers, or any
internal business app without writing frontend code manually.


──────────────────────────────────────────────────────────────
9. AGENT SWARM  (Swarm Designer)
──────────────────────────────────────────────────────────────
Design, build, and run multi-agent pipelines. Define agents,
assign them roles and tools, connect them in a flow, and run
the whole swarm on a task. Includes voting mode (all agents
answer independently and results are compared) and chain mode
(each agent refines the previous agent's output step by step).
Best for complex tasks that benefit from multiple perspectives
or sequential specialised reasoning.


──────────────────────────────────────────────────────────────
10. VIRTUAL OS
──────────────────────────────────────────────────────────────
A virtual project desktop and AI file builder. Gives you a
simulated file system, a workspace, and an AI that can create,
edit, and organise files within that environment. Use it to
plan project structures, scaffold repos, or have the AI build
and iterate on a set of files as if it were working inside a
real project directory.


──────────────────────────────────────────────────────────────
11. AGENT MAKER
──────────────────────────────────────────────────────────────
Build your own custom agents. Give an agent a name, icon,
description, system prompt, and a selection of tools from the
available tool set. Saved agents appear in the Agents tab and
can be used in swarms. No code required — everything is
configured through the UI.


══════════════════════════════════════════════════════════════
  GENERAL TIPS
══════════════════════════════════════════════════════════════

  • Add your API keys in the Settings panel (top-right gear
    icon). You only need keys for the providers you want to use.

  • The main model picker (top of the sidebar) applies to all
    modes unless a mode has its own picker (Code and Finance AI
    do). Set it to a model you have access to.

  • The auto-router in Coder mode will fall back through up to
    10 providers automatically — so even if one API rate-limits
    you mid-session, the work keeps going.

  • All data and chat history stays on your machine. Nothing
    is sent anywhere except the API call to your chosen
    provider.

  • Keyboard shortcut: Cmd/Ctrl + Shift + N starts a new chat
    from anywhere in the app.

══════════════════════════════════════════════════════════════
  github.com/Hash-7777/HashCortX  ·  MIT License
  Built by Seif Hashish  ·  HashCortX.com
══════════════════════════════════════════════════════════════
