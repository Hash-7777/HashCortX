# Changelog

All notable changes to HashCortx are recorded here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Changed

- **3D Forge no longer searches the web before designing a model.** Every
  generation used to open with two searches and up to two page reads, scraped
  into a list of stray measurements and pasted into the prompt — four tool calls
  and most of the wait, for numbers that may have come from a page about
  something else. A run now goes straight to the single design call. Forge makes
  no network request of its own again.
- **A finished model is drawn as one printed piece.** Parts used to be tinted by
  their role over whatever colour the design had chosen for them, and settled
  slightly see-through, so a fish read as a beige body beside a gold fin with the
  far side showing through the near one. Every part is now the same matte
  material, fully opaque, and parts that sat a hair apart are seated into each
  other so no seam shows.
- **The model arrives whole instead of being assembled on screen.** The mote
  clouds and the per-part stagger are gone; a model fades up in a quarter of a
  second.
- **A shape the app cannot build is read rather than silently boxed.** A part
  whose type was not one of the eleven in the schema became a one-unit box with
  nothing written anywhere — so a design that wrote an egg, a pipe and a ring
  arrived as three identical cubes. The nearest real shape is used, a part
  carrying its own vertices or silhouette keeps them, and every substitution is
  listed in the trace. The run also says when a design came back as plain blocks
  and balls, which is the model's doing and used to look like the app's.
- **A model has a real size, in millimetres.** It was "about two of something",
  and the exported file inherited those somethings, so every print began by
  guessing a scale. The size now shows on the badge and in Properties, can be
  changed without rebuilding anything, and is written into the file — printing
  formats in millimetres, the scene format in metres, because that is what each
  is read in.
- **Every model is built at one working scale.** The tolerances that decide
  whether two parts touch are fixed distances, so they only meant the same thing
  at one size — and models arrived anywhere from a fifth to twice as large as
  each other. Parts that should have been joined now are, whatever the object.
- **A design can do arithmetic.** Any number in a model can now be written as a
  sum — a wall thickness set once and used everywhere, a radius worked out from
  a bore. The language is deliberately tiny: numbers, arithmetic, brackets and a
  few functions, with no way to reach anything outside itself.
- **A part that repeats is written once.** A ring of gear teeth, a row of fins, a
  grille or a bolt circle is one part plus how many times and about which axis.
  The app places every copy exactly and will not nudge a pattern out of true
  afterwards — if a pattern does not reach the body it says so and leaves it,
  rather than quietly bending a gear into something that is no longer round.

### Added

- **A model can have a hole.** Until now 3D Forge could only add material, so
  there was no mug with a bore, no pipe, no vent and no screw hole — every
  object it made was a solid lump. A part can now say that it cuts away instead
  of adding, or that it keeps only what it shares with what is already there.
- **Solidify.** One button fuses every part into a single body and cuts whatever
  was marked to be cut, then tells you what it made: the size, the volume in
  millilitres, and whether the result is watertight. That last one is reported
  only when no edge is open and none is folded — a print is not the place to
  find out. The solid is what gets exported, so a printing file is one closed
  body rather than the overlapping shells it was made from.
- **A printability report.** Fusing a model ends with one line before you
  export: the size, whether it is one solid, the thinnest wall and how much of
  it needs support — then each problem with the number it was measured against,
  so you can disagree with the limit rather than only the verdict. Nothing is
  ever refused; it tells you what is true and you decide.

### Removed

- **The built-in subject templates in 3D Forge.** 760 lines of hand-written
  geometry for a spoon, a knife, a sword, a table, a phone, a laptop, a drone, a
  chair, a house, a tower, a rover, a human body and a skeleton, which no button
  could reach: the only route in was a padding pass that had already been
  switched off. The sample model the Options menu loads is unaffected.

- **The notch notice says "HashCortX finished" and nothing else.** It used to
  carry the model that answered underneath it. That line is read at a glance,
  after the work is already over, so it offers nothing to act on while crowding
  the words being looked for — and it put a detail about the user's work into a
  file any process on the machine can read, for no benefit.
- **The notch app is called HashNotch, and its feed folder moved with it.** The
  notice is written to whichever folder is already on the machine, preferring
  `~/.hashnotch` and falling back to `~/.hashdisland`, so it lands where the
  installed copy is looking whichever version that is. Only when neither exists
  is the current one created.

- **Exported models are written by this app, and open clean.** Every export used
  to be handed to a general-purpose mesh exporter, so the bytes a person
  actually received were the one part nobody could check. All four printing and
  CAD formats are now written here, and every one of them is read back and
  measured before it ships.
  - **STL** for slicers, with the part's real size recorded in the file's
    header where a person can read it.
  - **OBJ** for everything else, stating its units in a comment — the format
    has no field for them — and keeping shared corners, so a file is about a
    third smaller for the same object.
  - **3MF**, new, and the only one of the four that carries its own unit as
    part of the format. A part opens at the size it was designed at in any
    program that reads it, with no scale to type in.
  - **STEP**, new: a solid a CAD program will edit rather than a surface it
    will only look at. Its faces are flat — a curve arrives as many flat sides
    — and the app says so on the control and again every time it writes one.
- **A part's own dimensions can be changed.** Until now a part could be moved,
  turned and stretched, and nothing else — its radius, its depth, its thickness
  could only be changed by asking a model to design the whole object again.
  Stretching is not the same thing: scaling a cylinder on two sides gives an
  oval prism, while changing its radius gives a wider cylinder. Selecting a part
  now lists the numbers that shape is actually made of, in millimetres, and
  changing one rebuilds just that part — it keeps its place, its turn and the
  selection, and the change can be undone like any other.
- **An imported model keeps its shape when you fuse it.** Every other shape the
  app makes is described by arithmetic, but an imported mesh is just a pile of
  triangles — so fusing one used to replace it with the box it sat inside, and
  importing a model and pressing Solidify gave you a crate. It is now measured
  from its own triangles. Two things imported files really do are handled and
  reported: a model wound inside out is turned the right way round, and a
  surface with a hole in it still gives distances but is flagged, because which
  side of an open surface you are on is a guess.
- **You can make a hole yourself.** The app has understood cuts for a while, but
  only a design could ask for one — a person looking at a cylinder sitting
  through a block had no way to say it was a bore, and making a hole meant
  asking a model to produce the whole object again. A selected part now says
  what it does to the material around it: adds, cuts away, or keeps only what
  overlaps. A part that cuts is drawn as an outline so it does not look like a
  lump, and exporting a model whose cuts have not been fused now warns that the
  file will hold them as solid material rather than as holes.
- **A mirrored pair stays a pair when you edit one half.** The app makes
  symmetry and then lost it at the first change: a part and its mirrored twin
  are two separate entries, so widening one fin left the other thin, and nothing
  said the symmetry had gone. Changing what a part *is* — its dimensions, what
  it does to the material — now follows to its twin. Changing where it *is* does
  not, since dragging one of a pair is something you are watching yourself do.
  The panel says which is which on any part that has a twin, and two halves that
  really should differ can be separated.
- **The parts list is the build order, and you can change it.** Parts are
  combined in the order they are listed — cutting a bore and then adding a boss
  gives a different object from adding the boss and cutting through it — and
  that order was invisible and fixed. Every part now shows its place in the
  order, can be moved earlier or later, and can be given a name of its own.
- **A mirrored part is no longer exported inside out.** Mirroring is done by
  turning a part's scale negative, which reverses the way its triangles face.
  Nothing looked wrong: the corners were in the right places and the model
  measured correctly, but half its surface faced inwards, which a slicer reads
  as a hole. Every symmetrical model exported before this had one half of it
  turned outside in.

### Fixed

- **Saved 3D models are kept in a file, and a save that fails now says so.** They
  were in the browser storage the app's window runs on, which has a quota a
  large model can exhaust and which is cleared along with website data — and
  when the write failed, the failure was thrown away, so the panel said the
  project was saved when nothing had been kept. They are now written to
  `~/.hashcortx/forge/projects.json`, replaced in one step so a failure part way
  through leaves the previous copy whole, and anything saved by an earlier
  version is carried across the first time the mode opens. If a save cannot
  happen, the run says so instead of claiming it did; and if the existing
  projects cannot be read at all, saving switches off rather than writing an
  empty list over them.
- **A part can be mirrored across whichever plane its two halves sit either side
  of.** Mirroring only ever worked across one, while the design prompt asks for
  objects to be laid out along whichever axis they rest on in life — so the
  commonest symmetry in the mode was one that could be described and not asked
  for, and a design that tried came back as the half it had built. A request may
  now name its plane, and a mirrored pair stays exactly opposite through the
  passes that close gaps between parts.
- **Asking for a smoother surface no longer makes a worse one.** Splitting a
  part into more triangles took the mesh apart in the process, so no two
  triangles shared a corner and the shading came out creased at every original
  vertex — the opposite of what was asked for — and any lettering on the part
  lost its placement entirely. The split now shares its new corners, keeps the
  part exactly the size and shape it was, and keeps the lettering.
- **An exported part is described as solid.** Every material written into a file
  carried an opacity a little under full, left over from an animation that no
  longer exists. It made no difference on screen and a real one in the file:
  anything else opening the model was told the object is not quite solid.

See the open items at the end of 2.5.0 for what is known and not finished.

---

## [2.5.0] — 2026-08-17

138 commits since 2.0.0. More stable and more capable than that release in every
area, and honest about what is still open — the list at the end is part of the
release, not an omission from it.

The theme of this release is **features that looked like they worked and did
not.** Most of what follows is not new functionality; it is functionality the app
already advertised, now actually happening. Where something was never reachable
in any shipped build, it says so.

### Things the app claimed to do and never did

- **Semantic search over your knowledge base had never run in any shipped
  build.** The embedding model was imported from a CDN, which then fetched
  weights from a host the content policy does not allow, and every call threw
  into an empty catch. **bge-small-en-v1.5 (MIT, BAAI) is now compiled into the
  binary** and runs natively in Rust — around a millisecond per passage.
  Retrieval fuses keyword and vector rankings by position (Reciprocal Rank
  Fusion) rather than comparing two scores that share no scale.
- **Every export in the app wrote nothing.** Seventeen download links and the
  Python sandbox's file writer. A download is a capability the host has to opt
  into, and this one never did, so the webview cancelled each one outright —
  raising no error, which is why every button looked like it worked. Saving now
  goes through the native dialog and a checked write.
- **The Python sandbox hung the agent for ever.** Its runtime fetch was refused
  by the content policy, and the loader then neither resolved nor rejected, so
  the first call hung and every later call awaited the same dead promise. It
  runs in about three seconds now and produces real `.docx`, `.xlsx` and `.pdf`
  files — the five pure-Python wheels are vendored rather than fetched.
- **3D Forge could not start.** three.js ships as two files and only one was
  vendored; the asset server answered the missing one with the app's own HTML,
  so the failure arrived as a misleading MIME error naming no file. glTF import
  and export were dead for the same reason.
- **The knowledge base never reached an ordinary chat turn.** Retrieval sat
  behind a condition that was always false, so the app reported injection as on
  and retrieved nothing. It worked in the preview pane, which is why the store
  itself always looked healthy.
- **Adding a document to the knowledge base kept half of it.** The reader
  advanced 1,200 characters and stored 600.
- **Every tool result was cut to 800 characters** — including the file the
  coding agent had just asked to read. This was the single largest reason the
  agent felt weak.
- **Coder's shell had been broken for two weeks.** Argument names are renamed
  across the Rust/JavaScript bridge, and three calls used the Rust spelling;
  required arguments meant the call was rejected outright. The agent could read
  and patch but never run anything.
- **Every call to Gemini with tools failed**, because the tools were handed over
  in another provider's shape. Failing over *to* Gemini could never work either.
- **Every image was labelled JPEG** in all four provider hand-offs. Anthropic
  validates that, so every screenshot sent to Claude — from chat as well — was
  refused, and read as a provider problem.
- **Coder's Reject button did nothing.** The file was written before the row
  appeared, and Reject only relabelled itself. It is Keep / Undo now, backed by
  real content captured before the change.
- **ERP never finished building.** Three modes sent an OpenAI-shaped body to
  Anthropic, which fails every call, and the failover then walked the whole
  provider list twice with no deadline.
- **The Export menu opened off the screen**, because an ancestor with a filter
  becomes the containing block for a fixed-position child. Once visible, its
  items still called nothing: the function behind them threw on a loader used as
  a getter, inside a promise nobody awaited.
- Web search, PubMed search and Google search each called a host the content
  policy did not grant.

### Security

Every item here was a boundary that looked enforced and was not. Full detail in
[SECURITY.md](SECURITY.md).

- **The shell never checked the command text against protected paths** — only the
  working directory. Reading a private key through `cat` succeeded while the
  file tool refused the identical path.
- **A command naming a credential *directory* was allowed** — only spellings with
  a filename after them were refused, so an archive or a copy of a whole key
  store went through.
- **Reads anywhere on disk were auto-approved with no dialog.** Reads are free
  inside the project and asked about outside it now.
- **The project boundary was a string comparison**, and a symlink is spelled
  exactly like a folder, so a link inside the project pointing anywhere on disk
  read as inside it. It is judged by where the path leads, resolved in Rust.
- **The recursive file tools followed links out of the project**, and one of them
  returns file contents, through a search that raises no dialog.
- **A shell command's working directory was neither properly checked nor shown**,
  though it decides what every relative path in the command means.
- **A model's reply could reach the network before anyone read it**: a markdown
  image became a request the moment the message was drawn. Remote images render
  as links, and the policy no longer permits a remote image host at all.
- **A move was approved once, for both paths joined into one string**, so a move
  out of the project read as a move within it. One request per real path now.
- **A session grant for one address covered every address**, because a path
  function was used on a URL.
- Web pages are fetched **in Rust**, over the connection that was checked —
  resolve, refuse anything not public, pin the connection to that address, then
  re-check every redirect by hand. This closes a resolve-then-refetch gap the
  old documentation described as a known limit.
- Command runs are bounded: a five-minute deadline, no inherited input, and a
  cap on captured output.
- The developer's own machine came out of the product — a LAN address that
  shipped as a built-in preset, and a client that posted every knowledge chunk
  to a server on it.
- Four registered native commands had no caller and are gone, including one that
  would have written a secret back into the Keychain.

### Added

- **An offline knowledge base**: import documents, and the agent retrieves from
  them locally. Nothing is sent anywhere to make it work.
- **Undo that outlives a restart.** Content captured before a change is written
  inside the denylisted directory, so the agent cannot erase its own undo
  history.
- **The coding agent reads PDFs, looks at images, and runs Python** that produces
  real documents.
- **Chat reads a link you paste**, with or without an agent selected. It used to
  answer from the address alone and invent the page.
- **A page is read in windows** rather than its first three paragraphs — measured
  on real documentation, 68% of the text where it used to show 14% and say
  nothing about the rest.
- **The memory map places facts by what they mean**, using the same bundled
  model, with a second view that groups by key name. It states which layout is
  live and how much of the difference between the facts a flat picture keeps.
- **A token usage log** at `~/.hashcortx/usage.jsonl` — timestamp, model id and
  counts, nothing else — so [HashMeterAi](https://github.com/Hash-7777/HashMeterAi)
  reports measured usage rather than an estimate.
- **A finished run lights up [Hash D Island](https://github.com/Hash-7777/Hash-D-Island)**
  if it is installed. Metadata only.
- **The agent is told which machine it is on**, so it stops suggesting macOS
  tools on Windows and Linux.
- **Windows and Linux support.** The shell is chosen in Rust rather than
  hardcoded, and the path denylist understands Windows paths in both slash
  directions. CI compiles and tests on all three systems.

### Changed

- **Coder is rebuilt around the run**: files left, run centre, saved chats right,
  panels that can be moved, hidden and remembered, and a real diff.
- **Settings is rebuilt around a section rail**, with a local-model walkthrough
  whose steps check themselves against the machine.
- **Chat is rebuilt around the message**, and agents are a choice inside a chat
  rather than a workspace of their own.
- **One visual identity.** Surfaces, lines, spacing, control heights, radii and
  the colours that carry meaning live in one file; a mode declares its accent and
  nothing else. Thirteen corner radii became five.
- **The app icon** fills its tile — the mark stood at about 65% of the height and
  now stands at 82% — with rounded corners and a neon edge. It is generated by a
  script from the artwork, so it is reproducible.
- **The structure was pulled apart**: `app.js` from 8,682 lines to 7,054, each
  mode into its own folder with its own markup and stylesheet, the settings panes,
  the memory store, the knowledge base and the map into files of their own.
- API keys are stored in the app's own local directory, not the OS Keychain. A
  Keychain item is bound to the binary's signature, so every unsigned rebuild
  re-prompted for every key. This is **weaker than Keychain storage** and
  documented as such; it goes back once the build is signed.

### Verification

- **1,376 source checks** where there were none, each loading the real code
  rather than a copy of it. **89 Rust tests**, up from 2.
- **A check that refuses a call to a name that does not exist.** One had been
  called twice in the app and defined nowhere, throwing silently and taking the
  next statement with it.
- **A sweep that clicks every control in every mode** in a real browser and
  reports what throws — `npm run sweep`. All seven modes are clean from a cold
  start.
- Checks that hold the pieces nothing else can see: that the content policy and
  the code agree about every host, that every element a script looks up exists,
  that no control exists which nothing touches, that hardcoded colours only ever
  decrease, and that the bridge between the shell and the modes carries only what
  is used.
- A pre-commit hook that refuses secrets, private addresses and local notes.

### Still open

Stated because a release that lists only its wins is not much use.

- **The build is unsigned and un-notarised.** Gatekeeper will refuse it on first
  open; the steps are in the README and they are not optional.
- **Linux and Windows are compiled and tested, not run.** CI proves they build
  and the tests pass. Nobody has opened the app on either.
- **ERP's repair path is fixed but unexercised.** Reaching it needs real provider
  keys and a live rate limit.
- **The regenerate diff is unreadable when a reply contains a table**, because it
  compares raw markdown.
- **The control sweep covers each mode from a cold start**, not states that need
  content — a generated ERP system, a run in flight, a model loaded in Forge.
- **`styles.css` is a second design system**, 1,425 lines in its own namespace,
  loaded last. It no longer collides with the shared tokens, and it has not been
  merged away.
- 3D Forge has not been confirmed on a real machine since three.js was vendored.

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
