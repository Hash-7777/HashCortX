# HashCortx — Security Architecture

This document describes what HashCortx **actually does** as of v2.6.0. Where a protection is weaker than you might expect, that is stated plainly rather than papered over. If you find a claim here that the code does not support, please [open an issue](https://github.com/Hash-7777/HashCortX/issues/new/choose) — a security document that flatters the code is worse than no security document.

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

`src-tauri/src/commands/keychain.rs` still ships, and now does only that one job. On first run, `src/platform/tauri/keychain.js` silently pulls any keys out of the old Keychain bundle, copies them into the local store, and deletes the Keychain entry so it never prompts again.

Reading that bundle and deleting it are the only two Keychain commands the app registers. Three more — storing a key, storing the bundle, reading a single key — were registered with nothing calling any of them. A registered command is an entry point the renderer can reach, and one of those would have written a secret *into* the Keychain, which is the arrangement this app moved away from. They are gone, and `scripts/checks/native-surface.mjs` now fails on any command registered without a caller.

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
| write, patch, move | no dialog | **asks** |
| delete, shell | **asks** | **asks** |
| fetch a web page | **asks** | **asks** |

Reading a web page asks even though it touches no file, and it asks in chat as well as in Coder. The address comes from the model, and a URL carries whatever is put in it — so a fetch is a way for something the agent has just read, whether a project file or your knowledge base, to leave the machine. The address checks described further down stop it reaching your own network; they have no opinion about a public host, which is why this one is a question rather than a rule. A link you paste yourself is not the model's choice and is read without a dialog.

Reads outside the project folder used to be auto-approved with no dialog at all, on the reasoning that reading modifies nothing. That reasoning does not hold for an agent whose purpose is to send what it reads to a model provider — a prompt-injected model could have read any file you could and placed it in its next request, without you seeing a prompt. They now ask.

**"Inside the project folder" means where the path really leads.** The guard used to decide that by comparing two strings, and a symlink is written exactly like an ordinary folder — so a link inside your project pointing anywhere on the disk read as being inside the project, and reading, writing, listing and searching through it were approved with no dialog. The renderer cannot resolve a link, so it asks Rust (`fs_path_inside_root`), which follows every link in the path — including for a file that does not exist yet, which is the case a write presents. A path it cannot resolve raises the dialog rather than being allowed or refused outright.

Choosing **Allow for session** on a file also covers the folder it is in, so reading a second file next to the first does not ask again. That grant never extends to shell commands, which stay exact. On a web page it covers the **host** you granted and only that host, matched whole — so allowing one site for the session does not quietly allow another whose name merely begins with it.

**A move is two questions, not one.** It ends a file at one path and starts it at another, and each end is judged on its own, so moving something out of the project asks about where it is going even though writing inside the project does not ask at all.

**Virtual OS and 3D Forge are not gaps in this, despite what this document used to say.** It claimed their native calls were not routed through the guard. Neither mode invokes a native command itself. Virtual OS looks like a filesystem and is not one — its `fs_read`, `fs_write` and `terminal_run` tools operate on a project stored in IndexedDB and a terminal simulated in JavaScript, so nothing an agent does there can touch a real file.

Both modes do save exports to a real disk, through `HC.save` in `src/platform/tauri/save.js`. That is not a hole in the rule above. No model can reach it: every path starts with you clicking an export control, the destination comes from a native save dialog you answer, and the write goes through `export_write_file`, which applies the same denylist as every other write. A dialog is your consent to save a file — it is not consent to overwrite a private key, so a protected destination is still refused.

3D Forge also keeps your saved models in a file, at `~/.hashcortx/forge/projects.json`, through `HC.forgeProjects` in `src/platform/index.js`. They were in the renderer's `localStorage` until now, which has a quota a large model can exhaust and is cleared along with website data — and the failed write was swallowed, so the app said a project was saved when it was not. This is the same shape as the export door and not a hole either: the mode hands over one string and gets one back, the destination is fixed in Rust and cannot be named by the caller, the content is checked for being a list before anything on disk is touched, and the file is replaced atomically so a failure mid-write leaves the previous one intact. `~/.hashcortx` is itself on the denylist below, so the coding agent cannot read or write what you have made there.

That claim was wrong in the alarming direction, describing an exposure the app does not have, and it sat on the roadmap as work nobody needed to do. `scripts/checks/native-surface.mjs` now enforces the real property: it scans the source, asserts which files may invoke a native command at all, and fails if one appears in a mode that is supposed to be sandboxed.

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

The last two are HashCortX's own directories: the plaintext key bundle described above, the audit log, and the undo checkpoints below. The agent has no business reading your keys, editing the record of what it did, or deleting the copy of a file it just overwrote — and the app reaches all three through separate commands that do not accept a path.

### Undo checkpoints

Before the coding agent writes or deletes a file, what that file held is copied to:

```
~/.hashcortx/checkpoints/
```

That location is deliberate. It is inside the denylisted directory above, so the agent cannot read those copies back, overwrite them, or delete them — an agent that could erase its own undo history could make a change permanent. The `checkpoint_*` commands take no directory from the caller, only an id they generated themselves, so there is nothing in them to point elsewhere; and saving a checkpoint applies the same path guard as reading a file, so it cannot be used to copy a protected file into somewhere readable.

Restoring goes back out through `fs_write_file`, which means an undo passes the same denylist as any other write. A checkpoint of a binary file, or one over 8 MB, keeps no contents — it is marked as unrestorable and the Undo button is disabled and says why, rather than offering to write something that is not what was there.

Checkpoints hold file contents from your project, in your home directory, in plain text. They are removed when you keep a change, when you undo one, and **after seven days if you never answered it**.

That last rule is new, and it closes a leak of a different kind. Records only ever went away when a change was answered, and the panel offering that answer lived in the run that made it — so closing the app with a change pending lost the button and kept the copy, for good. A directory of your file contents only ever grew, and nothing in the app could show you what was in it. Coder now lists changes left over from your last session when it opens, so an undo outlives the run that offered it, and anything still unanswered a week later is deleted.

Coder's saved session no longer carries file contents either. It used to store every changed file, before and after, in `localStorage` — the same store your API keys are in, with a quota that fails silently once it is full — and nothing ever read it back. The undo history on disk is the record now.

**Links are followed to their destination before the rule is applied.** A path containing `..` is refused outright, and a single file operation resolves symlinks and checks where they actually lead.

The recursive tools — file search, fuzzy find and code grep — check every link they meet while walking, against two rules: the denylist, and **the folder you asked them to search**. The second is the one that matters most and it was missing. Refusing only denylisted destinations meant a link to any *ordinary* directory outside the search — your home folder, another project — was walked like part of the tree, and code grep returns the contents of the files it matches. Searching inside the project raises no dialog, so that was a way to read files you were never asked about. A link is now judged by whether its destination is inside the folder being searched; one leading to a folder within it is followed as normal.

### Shell commands — a denylist, not an allowlist, and not a sandbox

This is the important nuance. HashCortx does **not** restrict the agent to a fixed set of safe commands. It runs what it is asked to run, minus:

- **`rm` that is both recursive and forceful**, in any spelling — `-rf`, `-fR`, `-r -f`, `--recursive --force`.
- **Privilege and power words**, matched as whole tokens: `sudo`, `su`, `shutdown`, `reboot`, `halt`, `poweroff`, `pkill`, `launchctl`.
- **Disk tools**, matched as the program being run (including their families, e.g. `mkfs.ext4`, `newfs_hfs`): `dd`, `mkfs`, `fdisk`, `parted`, `format`, `newfs`.
- **Phrases that cannot occur innocently**: `diskutil eraseDisk`, `chmod 777`, `chown root`, piping anything into an interpreter (`… | sh`, `| bash`, `| python`, …), and process substitution (`bash <(…)`).
- **Any command naming a protected location** — `cat ~/.ssh/id_ed25519` is refused. Before this the filesystem denylist was decorative wherever a shell existed: `fs_read_file` refused that path and `shell_run` read it anyway.
- **Any command naming a credential directory**, whether or not a filename follows it. `.ssh`, `.aws`, `.gnupg` and HashCortX's own `.hashcortx` are matched as whole path tokens, so copying, archiving or linking a whole store is refused the same way reading one key out of it is. An ordinary file whose name merely ends the same way — `deploy.aws`, `config.ssh` — is not a protected location and is left alone.

**The working directory is part of the command.** It is chosen by the model, and it decides what every relative path in the command means — `rm output.o` removes a different file in a different folder. It is shown in the permission dialog alongside the command, so approving one is approving both, and it passes the same path guard a file operation does. It used to be checked against the denylist as written, which half of that list cannot answer: those entries are prefixes, and a directory that climbs out with `..` is not spelled like any of them, so the shell started there.

**Be clear about what this is not.** The agent composes the command string, so obfuscation — base64, `eval`, splicing a word out of a variable — defeats any string match, and no addition to the list changes that. An allowlist would be stronger. Treat the shell tool as what it is: an agent holding your shell, restrained by a permission prompt and a list of the worst commands.

### Every command run is bounded

From `src-tauri/src/commands/shell.rs`:

- **Timeout** — five minutes by default, then the child is killed. A caller can ask for more, up to ten minutes.
- **Closed stdin** — a command that prompts for input gets end-of-file and fails fast, instead of waiting forever on input that can never arrive.
- **Output cap** — 512 KB per stream, then the rest is dropped with a notice.

Honest limit: killing the child kills the process the shell became. A command that puts work in the background can leave grandchildren running. This is a time limit, not a process supervisor.

### Where the agent's fetch tool may go

`fetch_url` takes a URL a language model chose. If it can be pointed at your own network, a prompt-injected model can read a router's admin page, a service on your machine, or a cloud instance's metadata endpoint, and put what it finds in its next request to a provider.

Two checks run before any fetch, and both must pass:

1. **The address as written** (`src/js/url-safety.js`). Only `http:` and `https:`; no credentials embedded in the URL; and no literal loopback, private, link-local, unique-local or carrier-grade-NAT address, in IPv4 or IPv6, including the `::ffff:` spellings of an IPv4 address.
2. **Where the name actually leads** (`src-tauri/src/commands/net.rs`). The hostname is resolved and refused if **any** address it answers with is one of those — any, not the first, because a name that returns one public address and one private one is exactly the case worth catching. A name that does not resolve is refused rather than allowed.

The second check is new. Before it, only the first existed, and a perfectly ordinary-looking hostname pointing at a private address passed it — while a comment in the source claimed a server proxy performed the real address check. No server ships with this app, so nothing performed it.

**The fetch itself now happens in Rust, and that is what makes the second check mean anything.** It used to be made by the web view, which resolved the hostname *again* to open the connection — so a name that answered with a public address when it was checked and a private one a moment later walked straight through. `net_fetch_text` resolves once, judges every address it gets, and pins the connection to those addresses. The certificate is still validated against the hostname, so pinning the address does not weaken TLS. Every redirect is a fresh address and goes through the whole check again, up to five hops. The reply must be a text-ish content type, is capped at 1 MB, and the request has a 20-second deadline.

Moving the fetch also removed an accidental limit worth naming: under the Content Security Policy the web view could only reach the hosts in `connect-src`, so `fetch_url` could read about twenty addresses and no others. That was never a designed protection — it also meant the tool could not read an ordinary web page — but while it held, a model could only fetch from that short list. Now that the whole web is reachable, **a fetch to an address the model chose asks you first**, in chat as well as in Coder, and a session grant covers that one host. A link you pasted yourself is read without a dialog.

In a plain browser build there is no Rust to fetch through, so only the first check applies and the request is made by the web view. The shipped desktop app runs both.

### Audit log

Every guarded action, allowed or denied, is appended to:

```
~/.hashcortx/audit.log
```

Format: `TIMESTAMP [scope] action target`. It is append-only from the app's perspective, and readable from Settings.

---

## Content Security Policy

Defined in `src-tauri/tauri.conf.json`, and checked by `scripts/checks/csp.mjs` so a rule cannot be widened without a test failing.

`connect-src` is restricted to AI provider endpoints, the grounding backends (Tavily, Google Programmable Search, Wikipedia, Europe PMC, DuckDuckGo), the jsDelivr CDN that serves the Python runtime, and Ollama.

### The policy and the code have to name the same host

A host in `connect-src` that nothing calls grants reach for no feature. A host the code calls that is not in `connect-src` fails as an ordinary network error — and the app reports that as the service being unreachable, with nothing in the interface able to say why.

Three had drifted apart, and each one cost a feature that this repository advertised:

- the Google Programmable Search tool asked `www.googleapis.com`; only `customsearch.googleapis.com` was permitted. The same API answers on both names, so the code now uses the permitted one.
- the PubMed tool reads Europe PMC at `www.ebi.ac.uk`; the policy permitted `eutils.ncbi.nlm.nih.gov`, which nothing in the app calls.
- Pyodide fetches its runtime from `cdn.jsdelivr.net`, which was permitted in `script-src` only. The `<script>` tag loaded and the runtime fetch behind it did not.

`api.together.xyz` was permitted with no caller anywhere and has been removed. `scripts/checks/csp.mjs` now pins both directions, so neither kind of drift can return quietly.

**One thing to know before testing any of this by hand:** `tauri dev` serves the frontend from a local dev server and applies **no** policy at all. Every rule in this section is invisible until `tauri build`. That is why the drift above survived so long — in development, all of it worked.

### No image is loaded from the network

`img-src` permits `'self'`, `data:` and `blob:` — nothing remote. Every picture the app shows is a bundled asset, a generated or pasted image as a `data:` URL, or a `blob:`, so this costs no feature.

It used to permit `https:` as well, and that was a way out of the app. A markdown image in a model's reply — `![](https://host/?…)` — was rendered as an `<img>` by the markdown library's default renderer and fetched the moment the reply was drawn. No click, nothing shown in the interface, and the URL is whatever the model chose to write. In an app whose agent reads your files and fetches web pages, text injected into either could put what it just read into that URL. Chat now renders a picture from another site as a link you can choose to open, and `img-src` is what enforces it.

### One wildcard host, and why

`connect-src` contains a single wildcard, `http://*:11434` — Ollama's port. Ollama may run on another machine on your network, so it cannot be pinned to loopback.

Three more used to sit beside it: `http://*:1234`, `http://*:8080` and `http://*:11435`, listed for "self-hosted model servers". No line in this app has ever connected to any of them. They granted plaintext access to every host on the internet's most common alternate web ports and bought nothing. They are gone, and the check above fails on a wildcard that has no caller in the source.

### Honest caveats

- `script-src` permits `'unsafe-inline'`, `'wasm-unsafe-eval'` and one external CDN, `cdn.jsdelivr.net`. This is not a locked-down policy. The CDN is there for Pyodide, which fetches CPython and the packages it bundles on demand and cannot sensibly be shipped inside the app. `'wasm-unsafe-eval'` is there because compiling a WebAssembly module counts as evaluating script, and the sandbox is WebAssembly — without it every `WebAssembly.instantiate` was refused and the sandbox could not start at all. It permits WebAssembly and nothing else: `eval()` and `new Function()` stay refused, full `'unsafe-eval'` is not permitted, and `csp.mjs` fails if it is ever added. (This document previously named three CDNs; the other two were vendored and removed, and the paragraph was not updated. The check now compares the two.)
- `style-src` permits `'unsafe-inline'`, which the app's dynamic theme tokens need.

Most third-party libraries are vendored into `src/js/vendor/` and load from disk rather than a CDN.

---

## Network behaviour

- **No backend server.** Every AI request goes from the renderer straight to the provider you configured. There is no HashCortx intermediary, because there is no HashCortx infrastructure.
- **No telemetry.** No analytics, no usage reporting, no crash reporting.
- **No accounts.** Nothing to sign up for.
- **No auto-updater.** The app never reaches out on its own.
- **Air-gapped capable, with one exception.** With Ollama, chat, the coding agent, the knowledge base, 3D Forge and spreadsheet import all work with the network off. **The Python sandbox does not** — Pyodide fetches its CPython runtime, and the packages it bundles (pandas, numpy, matplotlib), from jsDelivr on first use, and those are far too large to ship. That is the only reason `script-src` and `connect-src` still name a CDN. The three packages Pyodide does not bundle — python-docx, openpyxl and reportlab — ship with the app in `src/wheels/` and install from its own origin, so the sandbox needs the network for its runtime and nothing else.

  Until recently this was less true than it said: 3D Forge loaded three.js and four of its loaders from a CDN, so it failed outright offline, and spreadsheet import fetched SheetJS the same way. Both are vendored now.

Token counts are appended locally to `~/.hashcortx/usage.jsonl`. That file never leaves your disk; [HashMeterAi](https://github.com/Hash-7777/HashMeterAi) reads it if you install it.

---

## The knowledge base

What you ingest is indexed twice: by keyword, and as a vector produced by a sentence-embedding model. Searching combines the two rankings, so a question can find a passage that *means* the same thing rather than only one that repeats its words.

**The model is inside the app.** `bge-small-en-v1.5` (MIT, from BAAI) ships with HashCortx and runs through ONNX Runtime in the Rust process. It is inference-only — a fixed, pre-trained sentence encoder, not a language model, and it cannot generate text.

**It is not in every build.** That ONNX Runtime is compiled for x86-64 processors with AVX2 and BMI2, and linked statically, so on an older processor the app cannot start at all. Building with `--no-default-features` leaves the model and its runtime out entirely: the knowledge base then ranks by keyword only, and `embed_available` returns false so the interface can say so. Nothing in this section changes for such a build — there is simply no embedding step, rather than one that silently fails, which is exactly what the CDN implementation described below used to do.

This matters for the privacy claim above, so it is worth being precise about:

- **Nothing is downloaded.** The weights are compiled into the binary. There is no first-run fetch, no cache to warm, and no host to reach.
- **Nothing is uploaded.** Embedding happens in the same process as the rest of the app. What you index never crosses a network boundary — not to a provider, not to HashCortx, which has no infrastructure to send it to.
- **It works with the network off**, on the first launch, with no configuration.

The previous implementation did none of this. It loaded a library from a CDN and fetched weights from `huggingface.co`, a host `connect-src` does not permit — so every embedding attempt failed, was swallowed, and semantic search never ran in any shipped build while the docs described it as working. Moving the model into the binary means no CSP rule can silently disable it again.

Provenance, the exact file's SHA-256, and the measurements behind the ranking design are in `src-tauri/models/bge-small-en-v1.5/PROVENANCE.md`.

---

## What HashCortx does *not* have

These are commonly assumed, and worth naming because an earlier version of this document claimed several of them:

- **No prompt-injection filter.** User input is not scanned for jailbreak or instruction-override patterns. (The `/inject` command toggles knowledge-base *injection into the prompt* — an unrelated feature with a confusingly similar name.)
- **No request rate limiting.** There is no concurrency cap and no requests-per-minute cap. There is retry with backoff on `429` and `5xx`, and a Stop button that aborts a run.
- **No shell command allowlist.** See above — it is a denylist.
- **No Hardened Runtime, no notarisation, no code signature.** The v2.6.0 build is unsigned on both platforms, so macOS requires a Gatekeeper bypass to install it and Windows shows a SmartScreen warning the first time it is run.
- **No encryption at rest** for API keys, chat history, or the audit log.
- **No semantic search over anything you did not put there.** The knowledge base only contains what you ingested. See below for how it works.

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

Open a [GitHub issue](https://github.com/Hash-7777/HashCortX/issues/new/choose) for non-sensitive findings.

For anything that would put users at risk if disclosed publicly: **open an issue saying only that you have a security finding and asking for a private channel — no details.** GitHub's private vulnerability reporting is not currently enabled on this repository, so an issue is the only way to make contact, and a public issue is the wrong place for the specifics.

This document previously told you to use private vulnerability reporting. That was wrong: the setting is off, so anyone following that instruction found nothing to click and may reasonably have posted the details publicly instead. Enabling it is the better answer and is on the roadmap; until then, the paragraph above is what actually works.
