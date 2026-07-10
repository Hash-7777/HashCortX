# HashCortx — Security Architecture

This document describes what HashCortx **actually does** as of v2.0.0. Where a protection is weaker than you might expect, that is stated plainly rather than papered over. If you find a claim here that the code does not support, please [open an issue](https://github.com/Hash-7777/HashCortX/issues/new/choose) — a security document that flatters the code is worse than no security document.

## Threat model

HashCortx is a local desktop app that:

1. Calls AI provider APIs using the user's own keys
2. Reads and writes the local filesystem (Coder mode, behind a permission gate)
3. Executes shell commands (Coder mode, behind a permission gate and a command denylist)
4. Runs Python in a WebAssembly sandbox (Pyodide)
5. Has no backend server, no user accounts, and no cloud storage

**Out of scope.** HashCortx does not defend against a local attacker who already runs code as your user, and it does not defend against a malicious AI provider you have handed a key to. It cannot: it is an app on your machine talking to a service you chose.

---

## Where API keys live

Keys are stored as a single JSON bundle under the key `hc_api_bundle_v2` in the renderer's `localStorage`, which Tauri writes into the app's own WebKit data directory:

```
~/Library/Application Support/com.hashcortx.app/WebKit/
```

That directory is keyed by the **bundle identifier**, not by the binary, so it survives every rebuild.

### They are not in the macOS Keychain, and that is a deliberate trade

A Keychain item's access control list is bound to the binary's code signature. While the build is unsigned, every new DMG carries a different signature, so macOS would prompt for your password once per key on every single update. That made the Keychain unusable in practice.

`src-tauri/src/commands/keychain.rs` still ships. On first run, `src/platform/tauri/keychain.js` silently pulls any keys out of the old Keychain bundle, copies them into the local store, and deletes the Keychain entry so it never prompts again.

**What this costs you, stated plainly:**

- Keys sit on disk **in plain text**, inside a directory only this app writes to.
- They are protected by your macOS user account and filesystem permissions, **not by encryption**.
- Any process running as your user can read them. That is the same exposure as a `.env` file, and weaker than the Keychain.
- The JavaScript layer **does** hold the raw key in memory, and the renderer makes the HTTPS call to the provider directly. The key does not round-trip through Rust.

Code signing is on the roadmap. Once the build is signed, Keychain storage becomes practical again and this section will change.

---

## The Permission Guard

Every filesystem and shell call the coding agent wants to make passes through `HC.guard.request()` in `src/platform/tauri/guard.js`, which raises a dialog before anything executes. The Rust command handlers apply the denylist below independently, so bypassing the JavaScript dialog still does not reach a blocked path.

Coverage is **not yet total**: Virtual OS and 3D Forge native calls are not routed through the guard. That work is on the roadmap.

### Filesystem denylist — compiled into Rust, cannot be overridden

From `src-tauri/src/security/denylist.rs`. These are matched against the absolute, expanded path and refused regardless of what you approve in a dialog:

```
/.ssh               /System            /etc
/.aws               /usr/bin           /bin
/.gnupg             /usr/sbin          /sbin
/Library/Keychains  /usr/lib           /private/etc
                                       /private/var
```

Any path containing these substrings is refused too:

```
.ssh   .aws   .gnupg   id_rsa   id_ed25519   credentials   Keychains
```

### Shell commands — a denylist, not an allowlist

This is the important nuance. HashCortx does **not** restrict the agent to a fixed set of safe commands. It runs what it is asked to run, minus a blocked list that includes:

```
sudo   rm -rf   dd       mkfs     shutdown
su     rm -fr   fdisk    parted   reboot
       rm -r    format   diskutil eraseDisk
```

An allowlist would be stronger. Treat the shell tool as what it is: an agent holding your shell, restrained by a permission prompt and a list of the worst commands.

### Audit log

Every guarded action, allowed or denied, is appended to:

```
~/.hashcortx/audit.log
```

Format: `TIMESTAMP [scope] action target`. It is append-only from the app's perspective, and readable from Settings.

---

## Content Security Policy

Defined in `src-tauri/tauri.conf.json`. `connect-src` is restricted to AI provider endpoints, the grounding backends (Tavily, Google Programmable Search, Wikipedia, PubMed, DuckDuckGo), and local Ollama ports.

Two honest caveats:

- `script-src` permits `'unsafe-inline'` and three external CDNs (`cdn.jsdelivr.net`, `cdnjs.cloudflare.com`, `cdn.sheetjs.com`). This is not a locked-down policy.
- `connect-src` includes wildcard local ports (`http://*:11434`, `http://*:1234`, `http://*:8080`) so self-hosted model servers work.

Most third-party libraries are vendored into `src/js/vendor/` and load from disk rather than a CDN.

---

## Network behaviour

- **No backend server.** Every AI request goes from the renderer straight to the provider you configured. There is no HashCortx intermediary, because there is no HashCortx infrastructure.
- **No telemetry.** No analytics, no usage reporting, no crash reporting.
- **No accounts.** Nothing to sign up for.
- **No auto-updater.** The app never reaches out on its own.
- **Air-gapped capable.** With Ollama, it works with the network off.

Token counts are appended locally to `~/.hashcortx/usage.jsonl`. That file never leaves your disk; [HashMeterAi](https://github.com/Hash-7777/HashMeterAi) reads it if you install it.

---

## What HashCortx does *not* have

These are commonly assumed, and worth naming because an earlier version of this document claimed several of them:

- **No prompt-injection filter.** User input is not scanned for jailbreak or instruction-override patterns. (The `/inject` command toggles RAG and web-context *injection into the prompt* — an unrelated feature with a confusingly similar name.)
- **No request rate limiting.** There is no concurrency cap and no requests-per-minute cap. There is retry with backoff on `429` and `5xx`, and a Stop button that aborts a run.
- **No shell command allowlist.** See above — it is a denylist.
- **No Hardened Runtime, no notarisation, no code signature.** The v2.0.0 build is unsigned, so installing it requires a Gatekeeper bypass.
- **No encryption at rest** for API keys, chat history, or the audit log.

---

## Data flow

```
[Your prompt]
     |
     v
[Renderer: app.js] ---- HTTPS, key in Authorization header ----> [Provider API]
     |                                                                  |
     |  <----------------------- response ------------------------------+
     v
[UI renders]  ->  token counts appended to ~/.hashcortx/usage.jsonl


[Agent wants a file or a shell command]
     |
     v
[guard.js: permission dialog] --> [Rust: denylist check] --> [OS]
     |                                    |
     +----------- refused <---------------+
                      |
                      v
             ~/.hashcortx/audit.log
```

---

## Reporting a vulnerability

Open a [GitHub issue](https://github.com/Hash-7777/HashCortX/issues/new/choose) for non-sensitive findings. For anything that would put users at risk if disclosed publicly, use GitHub's private vulnerability reporting on the repository instead.
