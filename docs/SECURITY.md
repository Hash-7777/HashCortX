# HashCortx — Security Architecture

This document describes what HashCortx **actually does** as of v2.6.0. Where a protection is weaker than you might expect, that is stated plainly rather than papered over. If you find a claim here that the code does not support, please [open an issue](https://github.com/Hash-7777/HashCortX/issues/new/choose) — a security document that flatters the code is worse than no security document.

## Threat model

HashCortx is a local desktop app that:

1. Calls AI provider APIs using the user's own keys
2. Reads and writes the local filesystem (Coder mode, behind a permission gate)
3. Executes shell commands (Coder mode, behind a permission gate and a command denylist)
4. Runs Python in a WebAssembly sandbox (Pyodide), inside a worker that reaches nothing of the app's
5. Connects to business systems you add, over MCP, only by web address and behind the same permission gate
6. Has no backend server, no user accounts, and no cloud storage

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
- The JavaScript layer **does** hold the raw key in memory, and for most providers the renderer makes the HTTPS call directly. The exceptions are SambaNova, NVIDIA and a Kimi Code key, whose servers refuse a web page: for those the key is handed to Rust for that one request, put into one header to one fixed host, and neither logged nor kept (see *Three providers are called from Rust* below).

Code signing is on the roadmap. Once the build is signed, Keychain storage becomes practical again and this section will change.

---

## The Permission Guard

Every filesystem and shell call the coding agent wants to make passes through `HC.guard.request()` in `src/platform/tauri/guard.js`. The Rust command handlers apply the denylist below independently, so talking the JavaScript dialog into approving something still does not reach a blocked path.

**The folder you opened is a boundary in Rust, not only in the dialog.** The guard above is renderer code, and until recently the boundary it draws existed nowhere else: underneath it the file commands would read or write anything the denylist did not happen to name — your home folder, another project, a folder of invoices. `src-tauri/src/security/root_jail.rs` keeps the same boundary where the caller cannot argue with it. Every file command the agent can reach, the copy taken before each write, and the working directory of any command the agent runs all refuse a path that does not resolve inside the folder you opened, unless you approved that exact path — and it is Rust that remembers the approval, not the renderer that claims it. Opening another folder forgets what was approved for the last one, because you gave that answer about a different piece of work. An approval covers one path: a file does not bring its folder, and a folder does not bring its parent. A whole home directory or disk is refused as a "project", since opening one would hand over everything in a single click while looking like a boundary.

**Be clear about what that does and does not stop.** It is depth against a *misbehaving model*, not against code running inside the app's own page. A model drives tools; it cannot invoke a command itself, so it cannot approve a path for itself — you have to. Code running in the renderer could call the approving command directly, and the Content Security Policy is what stands in the way of that, not this. What it buys is that the default is closed, and that a mistake in the dialog — a path compared wrongly, an answer not waited for — no longer opens the whole disk.

Commands **you** type in the terminal are not held to it. You can change directory wherever you like; it is your shell, and none of it is the agent's reach.

**What raises a dialog, and what does not:**

| | Inside the open project folder | Anywhere else |
|---|---|---|
| read, list, search | no dialog | **asks** |
| write, patch, move | no dialog | **asks** |
| replace a file Undo cannot restore | **asks** | **asks** |
| delete, shell | **asks** | **asks** |
| fetch a web page | **asks** | **asks** |

Reading a web page asks even though it touches no file, and it asks in chat as well as in Coder. The address comes from the model, and a URL carries whatever is put in it — so a fetch is a way for something the agent has just read, whether a project file or your knowledge base, to leave the machine. The address checks described further down stop it reaching your own network; they have no opinion about a public host, which is why this one is a question rather than a rule. A link you paste yourself is not the model's choice and is read without a dialog.

Reads outside the project folder used to be auto-approved with no dialog at all, on the reasoning that reading modifies nothing. That reasoning does not hold for an agent whose purpose is to send what it reads to a model provider — a prompt-injected model could have read any file you could and placed it in its next request, without you seeing a prompt. They now ask.

**"Inside the project folder" means where the path really leads.** The guard used to decide that by comparing two strings, and a symlink is written exactly like an ordinary folder — so a link inside your project pointing anywhere on the disk read as being inside the project, and reading, writing, listing and searching through it were approved with no dialog. The renderer cannot resolve a link, so it asks Rust (`fs_path_inside_root`), which follows every link in the path — including for a file that does not exist yet, which is the case a write presents. A path it cannot resolve raises the dialog rather than being allowed or refused outright.

Choosing **Allow for session** on a file also covers the folder it is in, so reading a second file next to the first does not ask again. That grant never extends to shell commands, which stay exact. On a web page it covers the **host** you granted and only that host, matched whole — so allowing one site for the session does not quietly allow another whose name merely begins with it.

**Writing inside the project is free because Undo can put the file back.** Where it cannot — a binary file, one too large for a copy to be kept, one that is not UTF-8 text — replacing the file asks first and says why, and deleting it says so in the question. `patch_file` edits only UTF-8 text, from the file's full contents.

**A file is replaced whole or not at all.** `fs_write_file` writes the new contents to a hidden file beside the old one, gives it the old file's permissions, flushes it to the disk and renames it over the old one in one step, so a crash or a full disk part-way leaves the previous contents intact. A link is followed and stays a link. Where a rename would change more than the contents — a file with a second name, one owned by another account or group, a folder that will not take a new file, or a rename the system refuses — the file is written in place, as before. A rename does not carry over extended attributes, such as Finder tags, or the file's creation date.

**A move is two questions, not one.** It ends a file at one path and starts it at another, and each end is judged on its own, so moving something out of the project asks about where it is going even though writing inside the project does not ask at all.

**Virtual OS and 3D Forge are not gaps in this, despite what this document used to say.** It claimed their native calls were not routed through the guard. Neither mode invokes a native command itself. Virtual OS looks like a filesystem and is not one — its `fs_read`, `fs_write` and `terminal_run` tools operate on a project stored in IndexedDB and a terminal simulated in JavaScript, so nothing an agent does there can touch a real file.

Both modes do save exports to a real disk, through `HC.save` in `src/platform/tauri/save.js`. That is not a hole in the rule above. No model can reach it: every path starts with you clicking an export control, the destination comes from a native save dialog you answer, and the write goes through `export_write_file`, which applies the same denylist as every other write. A dialog is your consent to save a file — it is not consent to overwrite a private key, so a protected destination is still refused.

3D Forge also keeps your saved models in a file, at `~/.hashcortx/forge/projects.json`, through `HC.forgeProjects` in `src/platform/index.js`. They were in the renderer's `localStorage` until now, which has a quota a large model can exhaust and is cleared along with website data — and the failed write was swallowed, so the app said a project was saved when it was not. This is the same shape as the export door and not a hole either: the mode hands over one string and gets one back, the destination is fixed in Rust and cannot be named by the caller, the content is checked for being a list before anything on disk is touched, and the file is replaced atomically so a failure mid-write leaves the previous one intact. `~/.hashcortx` is itself on the denylist below, so the coding agent cannot read or write what you have made there.

The Agent Swarm's Workspace can open a site its agents built in your browser, through `swarm_site_open` in `src-tauri/src/commands/swarm_site.rs`, reached only through `HC.swarmSite` in `src/platform/index.js`. It writes the page to one fixed file, `~/.hashcortx/swarm/site.html`, replacing the last one atomically, and opens that file with whatever your system opens `.html` files with. The caller hands over the page and nothing about where it goes, so there is no path to point elsewhere; a page larger than 32 MB or empty is refused. It is a command rather than a preview inside the app because a page drawn inside the app inherits the app's policy, which in a release runs none of a page's inline styles or scripts. The page runs in the browser as a local file, with the browser's rules and no access to this app, its storage or its keys — the same as opening a site you downloaded. Nothing reaches it without a click on Open in browser.

The ERP's agent sends the model you pick in its panel: what the open system is (its name, its tables and fields), how many records each table holds with the totals of its number fields, up to 48 of the most recent records across the tables, the last twelve turns of the conversation, and your message. That is how it can answer about your records; nothing else leaves with it. A change to records is shown to you before it is made, and can be undone. `src/js/systems/agent.js`.

When the Agent Swarm builds a website, it looks for real photographs to put in it. The run's planner, a model you chose, names up to three short searches for the site's subject, two to four plain words each, such as "diamond engagement ring", and the app sends those words, and nothing else, to Openverse (`api.openverse.org`), a free search of openly licensed images run by the WordPress Foundation. It needs no key and gets no account. Not your task, not your answers, not your files: only those words, which the trace shows. Only photographs whose licence allows use in a business's site are kept (public domain, CC0, CC BY, CC BY-SA), and the site must credit each one it shows, which the app checks. The images themselves are loaded by the browser that opens the finished site, from the photographers' hosts, not by HashCortx. **It is a setting:** "Find real photos for websites" in Settings, on unless turned off, and never used while "Local only" is on. With it off, agents are told to draw the site's imagery and write no image address at all. `src/js/swarm/photos.js`.

From the same Workspace you can ask one of the run's agents for a change. That sends the model picked beside the message — by default the model set for that agent, or, if none is set, the model chosen in the app — the run's task, its conversation and its files, cut to fixed budgets, and nothing else. If that model cannot answer (its account is out of quota or credit, its key is refused, it is overloaded, it answers with nothing or not in time), the same message goes to another model you hold a key for, chosen the way a run chooses one, and the Workspace says which model answered. The agent answers without tools, so it cannot search, fetch or run anything while it does. Its answer changes only the files it names in full, never an unlabelled example, and each change is kept as a new version, so none overwrites what came before. Sent to the whole team instead, it runs the blueprint again as a normal run does, with each agent's own model and tools, on the original task with the feedback and the files added. The runs are kept in the app's own IndexedDB store, `hashcortx_swarm_runs`, not in the localStorage that holds your keys.

That claim was wrong in the alarming direction, describing an exposure the app does not have, and it sat on the roadmap as work nobody needed to do. `scripts/checks/native-surface.mjs` now enforces the real property: it scans the source, asserts which files may invoke a native command at all, and fails if one appears in a mode that is supposed to be sandboxed.

**Plugin APIs are limited to what the page calls.** `src-tauri/capabilities/default.json` grants window placement, opening a web or mail link in the system browser, and the open and save dialogs — nothing else. The app registers no plugin it does not use; shell commands and file access go through its own commands, behind the checks in this document.

### Filesystem denylist — compiled into Rust, cannot be overridden

From `src-tauri/src/security/denylist.rs`. These are matched against the absolute, expanded path and refused regardless of what you approve in a dialog:

```
/.ssh               /System            /etc
/.aws               /usr/bin           /bin
/.gnupg             /usr/sbin          /sbin
/Library/Keychains  /usr/lib           /private/etc
                                       /private/var
```

Any path containing these is refused too:

```
key material     .ssh  .aws  .gnupg  id_rsa  id_dsa  id_ecdsa  id_ed25519
                 .netrc  .npmrc  .pypirc  .kube/config  .docker/config.json
                 .config/gh/  .config/gcloud  keychains  .git-credentials
                 .config/git/credentials  .pgpass  .cargo/credentials  .azure/
                 .config/op/  .password-store/  .vault-token
                 .terraform.d/credentials  .gem/credentials
browsers, mail   Library/Cookies  Library/Safari  Library/Mail  Library/Messages
                 the Chrome, Brave, Edge and Firefox profile folders, on every
                 platform
runs by itself   Library/LaunchAgents  Library/LaunchDaemons  Library/StartupItems
                 .config/autostart  the Windows Startup folder
                 .config/fish/config.fish
this app         com.hashcortx.app  .hashcortx
```

So is any path with one of a shell's start-up files as a whole part of it: `.zshrc`, `.zshenv`, `.zprofile`, `.zlogin`, `.bashrc`, `.bash_profile`, `.bash_login`, `.profile`. Those run every time a terminal opens, and they are where people export their API keys.

**Matching ignores case and either slash**, as the file systems it guards do. An entry ending in `/` is a folder: it covers the folder and what is in it, and not a longer name that merely begins the same way, so `src/library/mailer.js` is an ordinary file.

The "runs by itself" group is the newest. A file in one of those places starts a program at every login or every new terminal, so a single approved write would outlive the conversation that asked for it. Scheduling a command to run later — `crontab`, `at` — is refused in the shell for the same reason.

The last two are HashCortX's own directories: the plaintext key bundle described above, the audit log, and the undo checkpoints below. The agent has no business reading your keys, editing the record of what it did, or deleting the copy of a file it just overwrote — and the app reaches all three through separate commands that do not accept a path.

### Undo checkpoints

Before the coding agent writes or deletes a file, what that file held is copied to:

```
~/.hashcortx/checkpoints/
```

That location is deliberate. It is inside the denylisted directory above, so the agent cannot read those copies back, overwrite them, or delete them — an agent that could erase its own undo history could make a change permanent. The `checkpoint_*` commands take no directory from the caller, only an id they generated themselves, so there is nothing in them to point elsewhere; and saving a checkpoint applies the same path guard as reading a file, so it cannot be used to copy a protected file into somewhere readable.

Restoring goes back out through `fs_write_file`, which means an undo passes the same denylist as any other write. A checkpoint of a binary file, or one over 8 MB, keeps no contents — it is marked as unrestorable and the Undo button is disabled and says why, rather than offering to write something that is not what was there.

**Undo asks before it overwrites edits made since.** Right after a change, the record notes the file's length and a hash of its bytes, or that it is gone (`checkpoint_seal`). Undo compares the file with that first (`checkpoint_changed`), and if it has changed since — you edited it, or the agent changed it again — it asks, because putting the old contents back removes those edits too. A no changes nothing and keeps the record. A change saved by an earlier version of the app carries no such note, and is undone without the question, as before.

Checkpoints hold file contents from your project, in your home directory, in plain text. On macOS and Linux the whole `~/.hashcortx` folder is readable by your account only: the app makes it that way when it creates it, and at every launch (`src-tauri/src/security/private_dir.rs`). Windows keeps a profile folder private to its account already. Checkpoints are removed when you keep a change, when you undo one, and **after seven days if you never answered it**.

That last rule is new, and it closes a leak of a different kind. Records only ever went away when a change was answered, and the panel offering that answer lived in the run that made it — so closing the app with a change pending lost the button and kept the copy, for good. A directory of your file contents only ever grew, and nothing in the app could show you what was in it. Coder now lists changes left over from your last session when it opens, so an undo outlives the run that offered it, and anything still unanswered a week later is deleted.

Coder's saved session no longer carries file contents either. It used to store every changed file, before and after, in `localStorage` — the same store your API keys are in, with a quota that fails silently once it is full — and nothing ever read it back. The undo history on disk is the record now.

**Links are followed to their destination before the rule is applied.** A path containing `..` is refused outright, and a single file operation resolves symlinks and checks where they actually lead. That includes a file that does not exist yet, which is judged by where it would land.

The recursive tools — file search, fuzzy find and code grep — check every link they meet while walking, against two rules: the denylist, and **the folder you asked them to search**. The second is the one that matters most and it was missing. Refusing only denylisted destinations meant a link to any *ordinary* directory outside the search — your home folder, another project — was walked like part of the tree, and code grep returns the contents of the files it matches. Searching inside the project raises no dialog, so that was a way to read files you were never asked about. A link is now judged by whether its destination is inside the folder being searched; one leading to a folder within it is followed as normal.

### Shell commands — a denylist, not an allowlist, and a sandbox on macOS

This is the important nuance. HashCortx does **not** restrict the agent to a fixed set of safe commands. It runs what it is asked to run, minus:

- **`rm` that is both recursive and forceful**, in any spelling — `-rf`, `-fR`, `-r -f`, `--recursive --force`.
- **Privilege and power words**, matched as whole tokens: `sudo`, `su`, `shutdown`, `reboot`, `halt`, `poweroff`, `pkill`, `launchctl`.
- **Disk tools and schedulers**, matched as the program being run (including their families, e.g. `mkfs.ext4`, `newfs_hfs`): `dd`, `mkfs`, `fdisk`, `parted`, `format`, `newfs`, the Windows disk and permission tools, and `crontab` and `at`, which leave a command behind to run later.
- **Phrases that cannot occur innocently**: `diskutil eraseDisk`, `chmod 777`, `chown root`, piping anything into an interpreter (`… | sh`, `| bash`, `| python`, …), and process substitution (`bash <(…)`).
- **Any command naming a protected location** — `cat ~/.ssh/id_ed25519` is refused. Before this the filesystem denylist was decorative wherever a shell existed: `fs_read_file` refused that path and `shell_run` read it anyway.
- **Any command naming a credential directory or a shell start-up file**, whether or not a filename follows it. `.ssh`, `.aws`, `.gnupg`, HashCortX's own `.hashcortx` and the start-up files listed above are matched as whole path tokens, so copying, archiving or linking a whole store is refused the same way reading one key out of it is. An ordinary file whose name merely ends the same way — `deploy.aws`, `config.ssh` — is not a protected location and is left alone.

**The working directory is part of the command.** It is chosen by the model, and it decides what every relative path in the command means — `rm output.o` removes a different file in a different folder. It is shown in the permission dialog alongside the command, so approving one is approving both, and it passes the same gate a file operation does — denylist, no climbing out with `..`, links resolved, and the folder boundary. A command the agent runs in a folder outside the one you opened is working outside it whatever the command itself says, so it is refused. It used to be checked against the denylist as written, which half of that list cannot answer: those entries are prefixes, and a directory that climbs out with `..` is not spelled like any of them, so the shell started there.

**On macOS, the system enforces the part that matters most.** Every command the agent runs is started inside macOS's own sandbox (`src-tauri/src/security/agent_sandbox.rs`). The kernel applies it to the command and to everything the command starts, to each path as it really resolves, whatever the command string says. Inside it, the private locations above cannot be read or written — keys, cloud and tool credentials, keychains, browser, mail and message data, the shell's start-up files, and HashCortX's own data, including the store your API keys are in — and nothing can be written to the places that start a program at login. If the sandbox tool is missing, the agent's command is refused rather than run with less. Commands you type in the terminal are not put in the sandbox.

What that costs: a tool that needs one of those locations does not work from the agent — git over SSH, `gh`, a cloud provider's command-line tool, a private npm registry's token in `~/.npmrc`. The agent is told so, and leaves those commands to you.

**Be clear about what this is not.** The sandbox guards those locations, not everything: an approved command can still change or delete any ordinary file you can, and reach the network. The rest of the list above is a string match, which obfuscation — base64, `eval`, splicing a word out of a variable — defeats.

On Linux and Windows there is no kernel sandbox. What those platforms do have, alongside the string match, is the folder boundary described under the Permission Guard: it is enforced in Rust on every file command and on the working directory of every command the agent runs, on all three platforms alike. So a command there still starts inside the folder you opened, and the paths it names are still read relative to that — but once it is running, nothing at the kernel level is stopping it spelling its way somewhere else, and a string match is what stands between it and doing so.

An allowlist would be stronger than any of this. Treat the shell tool as what it is: an agent holding your shell, restrained by a permission prompt, a list of the worst commands, a boundary around the folder you opened and, on macOS, a sandbox around your secrets.

**An agent's command starts without your secrets.** A command's output goes back to the model, and so to its provider, so every command the agent runs starts without the environment settings whose names mark them as secrets — any with `KEY`, `TOKEN`, `SECRET`, `PASSWORD`, `PASS`, `PASSPHRASE`, `CREDENTIALS`, `AUTH` or `PAT` as a whole word of the name, and `DATABASE_URL`. `SSH_AUTH_SOCK` is kept: it is the path to your SSH agent, not a key, and git over SSH needs it. A command you type in the terminal keeps everything. The agent is told this, so a command that needs one of those settings is one to run yourself. This goes by name only: a secret kept in a setting with an ordinary name, or in a file the command can read, is not covered.

### Every command run is bounded

From `src-tauri/src/commands/shell.rs`:

- **Timeout** — five minutes by default, then the child is killed. A caller can ask for more, up to ten minutes.
- **Closed stdin** — a command that prompts for input gets end-of-file and fails fast, instead of waiting forever on input that can never arrive.
- **Output cap** — 512 KB per stream, then the rest is dropped with a notice.

**Stopping an agent run ends its commands.** Every command an agent run starts carries that run's key, and pressing Stop ends each one still going. Commands you type in the terminal carry none, so stopping an agent never ends them.

Ending a command, at its time limit or by Stop, ends what it started too: it runs in a process group of its own on macOS and Linux, and as a process tree on Windows. Honest limit: a process that deliberately leaves its group, as a daemon does, is not followed. This is a time limit and a stop, not a process supervisor.

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

It is bounded. Every entry is one line: control characters, and characters that change how text reads on screen, are written out as escapes, and a very long target is cut with a note saying how much was left out. When the file passes 8 MB it is renamed `audit.log.1`, replacing the previous one, and a new file starts. The viewer in Settings shows the newest 512 KB. The usage log and the HashNotch notice have limits of their own: a usage record with an implausibly long model id or timestamp is refused, and a notice must be small and carry a plain id.

---

### The Python sandbox

`execute_python` runs code a model wrote, and a model can be told what to write by a page it read or a file it opened. It runs in `src/workers/python.js`, a worker started by `src/core/sandbox/pyodide.js`:

- **It reaches nothing of the app's.** A worker has no page: no DOM, no `localStorage` where the keys are, and no Tauri bridge, so none of the native commands.
- **It carries the page's Content Security Policy.** It is started from a blob, which is what makes a worker inherit the policy; that keeps its script and network to the page's list, and refuses `eval`.
- **It has no way out left.** Before any model code runs, the network interfaces, storage, other workers and further script loading are removed from it, and `fetch` is narrowed to the runtime's own package files. If any of them survives, the sandbox refuses to start rather than run without it.
- **It can be stopped.** A run that goes on for three minutes is ended and the worker replaced, and the app carries on.
- **Files leave only through you.** What the code writes to `/output` comes back as bytes and is offered in a save dialog; a name the sandbox gives is used as a suggestion, never as a path.

`scripts/checks/python-sandbox.mjs` holds these, and the headless probe exercises them against the real runtime.

## Content Security Policy

Defined in `src-tauri/tauri.conf.json`, and checked by `scripts/checks/csp.mjs` so a rule cannot be widened without a test failing.

`connect-src` is restricted to AI provider endpoints, the grounding backends (Tavily, Google Programmable Search, Wikipedia, Europe PMC, DuckDuckGo), Openverse's image search for the Agent Swarm's websites, the Python runtime's own path on jsDelivr, and Ollama. `object-src`, `base-uri`, `form-action` and `frame-src` are `'none'`, since nothing in the app uses a plugin, a `<base>`, a submitted form or a frame, and no stylesheet or font comes from another host. It does not list SambaNova, NVIDIA or Kimi Code: the page never calls them (see *Three providers are called from Rust* below), and `providers.mjs` fails if one of their hosts is added. `api.kimi.com` and `api.kimi.ai` used to be listed for Moonshot; neither answers a Moonshot request, and both are gone.

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

- `script-src` permits `'wasm-unsafe-eval'` and one external source — the Python runtime's own path on jsDelivr, `https://cdn.jsdelivr.net/pyodide/v0.26.4/full/`, not the rest of that host — and not `'unsafe-inline'`: inline script — a handler written into markup, a `javascript:` link, a `<script>` put into the page — does not run. The page's own two inline scripts, the import map and the PDF worker path, are allowed by the hashes a production build adds for them. This document used to say `'unsafe-inline'` was permitted; the policy listed it, but in a release those hashes made the browser ignore it, so it did nothing there — and it is gone so that it cannot start to apply if those scripts ever leave the page. `csp.mjs` fails if it returns. The CDN is there for Pyodide, which fetches CPython and the packages it bundles on demand and cannot sensibly be shipped inside the app. `'wasm-unsafe-eval'` is there because compiling a WebAssembly module counts as evaluating script, and the sandbox is WebAssembly — without it every `WebAssembly.instantiate` was refused and the sandbox could not start at all. It permits WebAssembly and nothing else: `eval()` and `new Function()` stay refused, full `'unsafe-eval'` is not permitted, and `csp.mjs` fails if it is ever added. (This document previously named three CDNs; the other two were vendored and removed, and the paragraph was not updated. The check now compares the two.)
- Text a model wrote is never turned into markup as it stands, whatever the script policy would stop, because markup does harm without script too. The chat, the Coder and the Sandbox escape and sanitise it on the way to HTML, and so does the Agent Swarm, through `HCMarkdown.renderUntrusted` in `src/js/markdown-safe.js`: raw HTML in the text is shown rather than built, only `http(s)` links survive, an image from another site is offered as a link instead of fetched, and DOMPurify runs over the result. Without the sanitiser loaded it returns plain escaped text rather than guessing. `swarm-workspace.mjs` fails if the Swarm renders agent text any other way.
- `style-src` permits `'unsafe-inline'`, which the app's dynamic theme tokens need. In a release that only holds because `index.html` contains no `<style>` block: a production build puts a nonce on every one, and a nonce in the directive makes the browser ignore `'unsafe-inline'`. Until this version the page had one, and the released app dropped every `style` attribute it drew. `production-policy.mjs` fails if a style block returns.

- A generated report or business system is a model's answer too, and the colours and ids in it land inside attributes. Finance charts accept only real colour values and build every element id through one sanitiser; the ERP accepts only hex colours at the gate, and draws every system in the app's own colours whatever its answer asked for. `finance-charts.mjs`, `systems-theme.mjs` and `systems-shells.mjs` hold both.
- A PDF is untrusted input. Every place the app opens one passes pdf.js `isEvalSupported: false`, so the reader never turns what it finds in a file into code; `pdf-text.mjs` fails if a call leaves it out.

Most third-party libraries are vendored into `src/js/vendor/` and load from disk rather than a CDN.

---

### The window shows the app and nothing else

Nothing in the app ever means to replace its page with another address, so `src-tauri/src/security/navigation.rs` refuses every navigation away from it — a link, a refresh written into markup, a script setting `location` — and the page carries on as it was. The only addresses the window may show are the app's own.

A link a person clicks opens in the system browser instead, from `src/platform/index.js`: only a real click, only a web or mail address, and nothing on the app's own origin. `links.mjs` holds which clicks open what; the Rust side has its own tests for which addresses are the app's.

### Three providers are called from Rust

A browser asks a server's permission before sending a request from a web page, and SambaNova, NVIDIA and Kimi Code answer without granting it. Inside the app every request is a web page's request, so theirs were never sent. `src-tauri/src/commands/provider.rs` sends them instead, through `HC.providerBridge` in `src/platform/tauri/provider-bridge.js`.

This does not give the page a way onto the network, and it is built so that it cannot become one:

- **The caller names a provider and a route, never an address.** The six endpoints — chat and model list for each of the three — are written in one table in Rust. No host, path, query or header comes from the renderer, so nothing the renderer sends can aim the request anywhere else. A test fails if the table gains a host.
- **What goes out is checked.** The key must be visible ASCII and of a plausible length, so it cannot carry a second header. A chat request must be one JSON object of bounded size; a model-list request carries no body.
- **What comes back is bounded.** No redirect is followed. The reply is capped, the connection has a deadline, TLS is the platform's own and checks the certificate against the fixed host, and at most sixteen of these requests can be open at once.
- **It runs off the main thread,** so a long answer does not freeze the window, and a stopped request is dropped at its next read.

What it cannot do: it does not hide the key from the renderer, which already holds it, and it cannot stop a compromised page from spending your quota at those three providers — the same as it could at any other.

The same command reaches **another model app on this computer** (`src/js/local-apps.js`). For that the caller names only a port, a number from 1024 up: the host is always this computer, `127.0.0.1`, and the path is one of two written in Rust, the model list and the chat. It sends no key unless one is given. A test holds the host and the two paths whatever the port.

## Connected systems

A business system such as an ERP can offer its records to agents over the Model Context Protocol (MCP). HashCortx connects to one only when you add it in **Settings → Connections**, and only by its web address: it never starts a program to do so.

- **The secret stays out of the page.** The address, how the system signs in, and the secret are kept by the app in `~/.hashcortx/connections.json`, a file readable by your account only, inside the folder the agent's file and shell tools refuse to open (`src-tauri/src/commands/mcp.rs`). The page hands a secret over once, when you enter it, and afterwards can only learn that one is set: no command returns it.
- **A secret goes only where it was given.** A request names a saved connection, never an address, and is sent to the address saved with that secret. Changing the address, or how the system signs in, drops the secret until you enter it again. No redirect is followed.
- **Hosted services are set as they document themselves.** Odoo, GitHub, Stripe and Supabase are offered by name (`src/js/mcp/presets.js`). GitHub, Stripe and Supabase are each sent their key only the one way their documentation names, to their own address; GitHub and Supabase use their reading-only addresses unless you turn Reading only off. For any other system, a key with no sign-in chosen is tried as a bearer token and then in the key header most systems read, each only to the address you gave, the second only after the system refused the first. A connection that is refused or cannot be reached is not kept.
- **Signing in through the browser.** A system that has its users sign in on its own page is signed in to that way when no key is given, or when it is chosen under More options (`src-tauri/src/commands/mcp/oauth.rs`). The app reads the system's document naming its sign-in server and uses it only if it is about the system's own address, then uses the sign-in server's document only if it names itself as that server. A server that does not offer PKCE with S256 is refused before the browser opens. The app registers itself as a native app with no secret. The answer comes back to a one-time address on this computer, `127.0.0.1`, which waits five minutes for the answer carrying the state that sign-in made and turns anything else away. An answer that names another server than the one asked is not used, and neither is one with no name from a server that says it gives one. The tokens are kept with the connection, out of the page's reach like a secret, sent only to the connection's own address, renewed when they run out if the server gave a refresh token, and dropped when the address or the way it signs in changes.
- **Only https, except to this computer.** An address on another machine must use https, so what is sent cannot be read on the way; plain http is accepted for this computer itself only. A name and password written into the address are refused.
- **Only what the app needs is sent.** A request is one JSON-RPC object using one of five protocol methods — `server/discover`, `initialize`, `notifications/initialized`, `tools/list` and `tools/call`. A reply is capped at 4 MB, and a request has a deadline.
- **You choose the tools.** A tool that only reads starts switched on; a tool that changes records starts off. A tool counts as reading only when nothing about it says otherwise: its name has no word that changes things, and the system does not say it changes or destroys anything (`src/js/mcp/policy.js`). A switched-off tool is never offered itself. In chat and the Coder, up to six of a system's switched-off tools are offered in their place as tools that send nothing, described in the app's words and not the system's: calling one sends nothing to the system and asks nothing of you, and tells the model the tool is switched off and where you switch it on (`src/js/mcp/connections.js`, `offOffers`).
- **Tools are pinned.** Each tool is kept with the exact definition you switched it on as. The list is read again before tools are offered, at most a minute apart, and a tool the system now describes differently — another description, other arguments — is off until you look at it and switch it on again (`src/js/mcp/connections.js`).
- **Reading asks once per system; changing asks every time.** The first read from a system raises the permission bar, and allowing it for the session covers reads from that system until the app closes. Every create, change or delete raises the bar with everything it will send shown in full, "for the session" is not offered, and neither a yes nor a no is remembered (`src/platform/tauri/guard.js`). The audit log records each decision with the system and the tool, not the records.
- **Records stay on this computer by default.** A system's tools are offered only to models running on this computer — Ollama's, or another local model app's. Letting cloud models see one system's records is a separate switch for that system, with a warning, because the records then go to that model's company. It holds afterwards too: a chat that read a system's records is not sent to a cloud model that system keeps them from, in a turn or in Split — the app says so and suggests a new chat — and a turn that read records does not save to long-term memory, which is added to every model's chats.
- **The ERP only reads a connected system.** Its agent is offered one system's reading tools at a time and never a tool that changes records (`src/js/systems/connected.js`). Records it would bring into a table are shown to you in full first and added only when you confirm, and Undo takes them out again. An ERP holding records brought from a connected system is not sent to a model that system keeps its records from, until Undo takes them out, and an answer read from one is left out of what such a model is shown, with the question that asked for it.
- **The Coder asks the same way.** A single Coder run is offered a connected system's tools only when its request is about one, through the same permission bar, and each tool tells the agent to use it rather than a shell command for that system (`src/js/mcp/connections.js`, `forRun`). A shell command the agent chooses instead still needs its own approval. A Coder conversation that read a system's records is not sent to a model that system keeps them from, and runs with several agents are offered none of these tools.
- **Finance reads only a system a request names.** Its records are read with that system's reading tools, through the same permission bar, and go with the request as an attachment (`src/js/finance/connected.js`). A request that names a system the chosen model may not read is told so rather than answered without the records. Finance sends its whole conversation with each request, so a conversation holding records a system keeps from cloud models is not sent to one; each attachment keeps where it came from, across a restart too.
- **The Agent Swarm only reads.** A run whose task is about a connected system offers its agents that system's reading tools and never one that changes records, because nobody may be watching a run to approve a change (`src/js/mcp/connections.js`, `offerForRun`). The offer belongs to the run, so agents working side by side do not share one another's, and it is made only when every model the run uses may see the system's records: a team that mixes cloud and local models is not offered a system that keeps its records to this computer. The first read asks you, as anywhere. A run that read records keeps where it read them from, and is not run again, or answered in the Workspace, on a model that system keeps them from.
- **What a system says is material, not instructions.** A tool's description reaches a model shortened, with any line addressed to AI systems left out, and what a tool returns reaches it framed as reference material with the same lines left out (`src/js/chat/sources.js`). On screen, everything a system sends is shown as text, never as markup.

What it cannot do: it cannot make the system's own permissions any narrower — connect with an account made for HashCortX that has only the access it needs. The secret, and the tokens a browser sign-in leaves, are protected by your account's file permissions, not encrypted. Leaving out lines addressed to AI systems works on common English phrasings and is guidance, not a guarantee; the permission bar is what stands between a model and a change. A system that signs in only through the browser must let new apps register themselves with its sign-in server; one that accepts only apps registered in advance, or only apps with a public client document, needs a key instead until HashCortX's client document is published.

## Network behaviour

- **No backend server.** Every AI request goes to the provider you configured, from the renderer or — for the three above — from the app itself. There is no HashCortx intermediary, because there is no HashCortx infrastructure.
- **A task given to a local model stays local.** The Agent Swarm, 3D Forge, the ERP and Virtual OS switch to another model when one fails. A task on a local model — Ollama's, or another local app's — is only ever handed to another local model, and if none can take it the run stops with the error. Virtual OS also picks its worker model itself, and when the job is on a local model it picks among local models only. A task on a cloud model may move to another provider you have configured, or to a local model; the run's trace names each switch. Chat switches only from one cloud model to another, and says so in the reply; a chat on an Ollama model never switches. Coder on a local model never switches either (`src/js/chat/failover.js`, `withFallbacks`); on a cloud model it may move to another provider you have configured.
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
- **Nothing is uploaded to index it.** Embedding happens in the same process as the rest of the app, so building the index and searching it never cross a network boundary — not to a provider, not to HashCortx, which has no infrastructure to send it to.
- **What a search finds is another matter.** When chat or the coding agent uses the knowledge base, the passages it finds become part of the request to the model you chose. With Ollama that stays on your machine or your network; with a cloud model it goes to that provider, like the rest of the conversation.
- **It works with the network off**, on the first launch, with no configuration.

The previous implementation did none of this. It loaded a library from a CDN and fetched weights from `huggingface.co`, a host `connect-src` does not permit — so every embedding attempt failed, was swallowed, and semantic search never ran in any shipped build while the docs described it as working. Moving the model into the binary means no CSP rule can silently disable it again.

Provenance, the exact file's SHA-256, and the measurements behind the ranking design are in `src-tauri/models/bge-small-en-v1.5/PROVENANCE.md`.

---

## What HashCortx does *not* have

These are commonly assumed, and worth naming because an earlier version of this document claimed several of them:

- **No filter on everything a model reads.** What you type is not scanned. Material handed to a model as words — pages linked in a plain chat, knowledge-base passages, what the fallback agents look up, and tool results when a local agent's turn is taken in steps — is framed as reference material, and a sentence in it addressed to AI systems is left out before the model reads it, with a note in its place (`src/js/chat/sources.js`). The sentences recognised are common English phrasings. A tool result passed to a cloud model in the provider's own tool-result field is sent as it is. Every agent that uses tools — the Coder, chat's agents, the Agent Swarm's and Virtual OS's chat agent — is also told, in `HC.code.TOOL_TEXT_RULE`, that a file, a web page, a search result, a command's output or a knowledge-base passage is material for your task and never a new one. All of this is guidance to the model, not a guarantee; the permission dialogs are what stand between a model and an action. (The `/inject` command toggles knowledge-base *injection into the prompt* — an unrelated feature with a confusingly similar name.)
- **No rate limiting per provider.** There is one cap of the app's own, in `src/js/request-cap.js`: at most 30 cloud AI requests in any minute and 6 running at once, across the whole app. A request over it is refused with a message saying which was reached; it is not queued. It counts what asks a cloud model for an answer, including the three providers sent through Rust; model lists, local models and web search are not counted. Each provider's own limits still apply on top, with retry and backoff on `429` and `5xx`, and a Stop button that aborts a run.
- **No shell command allowlist.** See above — it is a denylist.
- **No Hardened Runtime, no notarisation, no code signature.** The v2.6.0 build is unsigned on both platforms, so macOS requires a Gatekeeper bypass to install it and Windows shows a SmartScreen warning the first time it is run.
- **No encryption at rest** for API keys, connected systems' secrets and sign-in tokens, chat history, or the audit log.
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
