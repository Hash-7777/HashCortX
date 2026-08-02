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

Every filesystem and shell call the coding agent wants to make passes through `HC.guard.request()` in `src/platform/tauri/guard.js`. The Rust command handlers apply the denylist below independently, so talking the JavaScript dialog into approving something still does not reach a blocked path.

**What raises a dialog, and what does not:**

| | Inside the open project folder | Anywhere else |
|---|---|---|
| read, list, search | no dialog | **asks** |
| write, patch | no dialog | **asks** |
| delete, shell | **asks** | **asks** |

Reads outside the project folder used to be auto-approved with no dialog at all, on the reasoning that reading modifies nothing. That reasoning does not hold for an agent whose purpose is to send what it reads to a model provider — a prompt-injected model could have read any file you could and placed it in its next request, without you seeing a prompt. They now ask.

Choosing **Allow for session** on a file also covers the folder it is in, so reading a second file next to the first does not ask again. That grant never extends to shell commands, which stay exact.

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
.ssh    .aws     .gnupg   id_rsa   id_dsa    id_ecdsa   id_ed25519
.netrc  .npmrc   .pypirc  .kube/config       .docker/config.json
.config/gh/      .config/gcloud     Keychains
com.hashcortx.app          .hashcortx
```

The last two are HashCortX's own directories: the plaintext key bundle described above, and the audit log. The agent has no business reading your keys or editing the record of what it did, and the app reaches both through separate commands that do not accept a path.

### Shell commands — a denylist, not an allowlist, and not a sandbox

This is the important nuance. HashCortx does **not** restrict the agent to a fixed set of safe commands. It runs what it is asked to run, minus:

- **`rm` that is both recursive and forceful**, in any spelling — `-rf`, `-fR`, `-r -f`, `--recursive --force`.
- **Privilege and power words**, matched as whole tokens: `sudo`, `su`, `shutdown`, `reboot`, `halt`, `poweroff`, `pkill`, `launchctl`.
- **Disk tools**, matched as the program being run (including their families, e.g. `mkfs.ext4`, `newfs_hfs`): `dd`, `mkfs`, `fdisk`, `parted`, `format`, `newfs`.
- **Phrases that cannot occur innocently**: `diskutil eraseDisk`, `chmod 777`, `chown root`, piping anything into an interpreter (`… | sh`, `| bash`, `| python`, …), and process substitution (`bash <(…)`).
- **Any command naming a protected location** — `cat ~/.ssh/id_ed25519` is refused. Before this the filesystem denylist was decorative wherever a shell existed: `fs_read_file` refused that path and `shell_run` read it anyway.

**Be clear about what this is not.** The agent composes the command string, so obfuscation — base64, `eval`, splicing a word out of a variable — defeats any string match, and no addition to the list changes that. An allowlist would be stronger. Treat the shell tool as what it is: an agent holding your shell, restrained by a permission prompt and a list of the worst commands.

### Every command run is bounded

From `src-tauri/src/commands/shell.rs`:

- **Timeout** — five minutes by default, then the child is killed. A caller can ask for more, up to ten minutes.
- **Closed stdin** — a command that prompts for input gets end-of-file and fails fast, instead of waiting forever on input that can never arrive.
- **Output cap** — 512 KB per stream, then the rest is dropped with a notice.

Honest limit: killing the child kills the process the shell became. A command that puts work in the background can leave grandchildren running. This is a time limit, not a process supervisor.

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
- **No working semantic search yet.** The knowledge base ranks by keyword. The vector-search code exists but does not run: it loads its model from a CDN, which `connect-src` does not permit, so every embedding attempt fails and is caught. Bundling the model so it works offline is the next piece of work. Until then, treat the knowledge base as keyword search.

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
