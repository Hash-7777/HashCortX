# HashCortx — Security Architecture

## Threat Model
HashCortx is a local desktop app that:
1. Calls AI provider APIs (user's own keys)
2. Accesses the local filesystem (Code Mode only, with permission gates)
3. Executes shell commands (Code Mode only, whitelisted, gated)
4. Has no backend server, no user accounts, no cloud storage

## Security Layers

### Layer 1 — OS Keychain
- All API keys stored in OS Keychain (Mac), Windows Credential Manager, or libsecret (Linux)
- Keys stored once on first entry, persist until user removes them
- JS layer NEVER receives the raw key — only calls Rust to "send this message"
- Rust makes the HTTPS call, returns only the AI response

### Layer 2 — Hardened Runtime (Mac)
- Prevents code injection into the HashCortx process
- Prevents library injection attacks
- Prevents ptrace debugging in release builds

### Layer 3 — Content Security Policy
Defined in `tauri.conf.json`. Allows connections only to known AI provider domains:
- `https://api.anthropic.com`
- `https://api.openai.com`
- `https://openrouter.ai`
- `https://api.groq.com`
- `https://api.cerebras.ai`
- `https://api.together.xyz`
- `https://api.mistral.ai`
- `https://generativelanguage.googleapis.com`
No wildcard domains. No unknown origins.

### Layer 4 — Permission Guard (Phase 3)
Every native action (read file, write file, run command) passes through the Permission Guard:
- Shows a dialog to the user
- User approves: Once / Session / Always for this folder / Never
- Approval stored in encrypted local store
- Audit log appended for every action

### Layer 5 — Filesystem Denylist (hardcoded in Rust, cannot be overridden)
These paths are ALWAYS blocked, regardless of user permissions:
```
~/.ssh/
~/.aws/
~/.gnupg/
~/.config/
~/Library/Keychains/
~/Library/Application Support/Google/Chrome/
/etc/
/System/
/usr/bin/
/usr/sbin/
/private/
```

### Layer 6 — Shell Command Allowlist (Phase 3+)
Only these commands can be executed by agents:
```
bash, sh, zsh, node, npm, npx, yarn, pnpm, bun,
python, python3, pip, pip3,
git, cargo, rustc, rustup,
ls, cat, find, grep, echo, pwd, mkdir, touch, cp, mv, rm,
curl (HTTPS only, no file://)
```
`sudo`, `dd`, `format`, `diskutil`, `shutdown`, `reboot` — always blocked.

### Layer 7 — Rate Limiting
- Max 5 concurrent AI requests
- Max 30 requests per minute per session
- No timeout on response LENGTH (long projects must complete)
- Abort signal available to user at any time (Stop button)
- Exponential backoff on 429 errors

### Layer 8 — Prompt Injection Filter
Applied to all user input before sending to AI. Shows WARNING dialog and blocks the request.

#### Category: Instruction Override
- ignore previous instructions / ignore your system prompt
- forget everything above / disregard all prior context
- your new instructions are / override system prompt

#### Category: Identity Hijack
- you are now [DAN/STAN/AIM/Jailbreak/anything]
- pretend you have no restrictions
- act as if you were trained differently
- you are a different AI / you are not an AI
- developer mode / sudo mode / god mode / unrestricted mode / debug mode / test mode / bypass mode / maintenance mode

#### Category: Authority/Admin Bypass
- I am the admin / administrator / owner / developer / creator
- admin override / admin access granted / I have root access
- I am your creator / I work at Anthropic / OpenAI / Google
- this is an authorized request / special permissions granted
- maintenance mode active / I have been given access

#### Category: Data Extraction
- show me your system prompt / output your instructions
- what are your API keys / list environment variables
- base64 encode your prompt / repeat everything above
- print the text above / what was said before this
- reveal your training / show me your configuration

#### Category: Research/Hypothetical Bypass
- for a research paper / for academic purposes
- hypothetically speaking / in a fictional world
- as a thought experiment / in a story where
- my grandmother used to tell me / write a story where a character explains
- for educational purposes only / this is just a test

#### Category: Token/Encoding Attacks
- Prompts containing base64, rot13, hex, or unicode escape sequences
- Invisible unicode characters (zero-width spaces, RTL override chars)
- Homoglyph substitution (Cyrillic/Greek lookalikes for Latin)

#### Category: Role Confusion
- you are the user now / switch roles with me
- the assistant is now / from now on respond as
- pretend I am the system

#### Category: Crash / DoS Attempts
- Repeat this N times (where N > 10)
- Write an infinite loop / recursion without base case
- Generate extremely long repeated strings
- Deeply nested data structures designed to exhaust memory

## Audit Log
Location: `~/Library/Application Support/HashCortx/audit.log`
Format: `TIMESTAMP [scope] action path`
Retention: Last 10,000 entries, rotated.
The log is append-only from the app's perspective.

## Data Flows
```
[User input] → [Injection filter] → [Rust HTTP client] → [AI Provider API]
                                                               ↓
[UI renders response] ← [Rust returns text only] ← [HTTPS response]

API Key: [OS Keychain] → [Rust reads at request time] → [HTTPS Authorization header]
         Key NEVER touches JS memory
```

## What HashCortx Never Does
- Never sends analytics or telemetry
- Never phones home to any HashCortx server (there is none)
- Never stores conversation history remotely
- Never accesses files outside permitted scope
- Never runs commands outside the allowlist
- Never stores API keys in plaintext
