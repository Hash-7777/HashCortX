# Changelog

All notable changes to HashCortx are recorded here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Added

- **HashCoder answers a greeting without reading its tools first, and sets
  aside a reply that is the tools written back.** A small or mid-sized model
  reads a request's instructions and tools before it writes a word, and
  they are most of what it reads, so on a modest computer even "hi" could
  wait a long time. A greeting, a thanks, or a one-line question about what
  HashCoder is (and nothing else: no file, no path, no code) is now sent to
  such a model without tools, without the project's map and with a one-line
  instruction. A small model given tools sometimes answers with the list of
  tool definitions as JSON in place of a reply; that is recognised, set
  aside, and the model is asked again without tools (`js/code/talk.js`).

- **A model that does not fit in the graphics memory is said so.** Ollama
  reports how much of a loaded model is in graphics memory. When some of it
  is and some is not, the note under the box a request is written in says
  how much runs on the processor and in main memory, that answers are slower
  and the computer is under more load, how fast the model has been writing
  here when that is known, and that a smaller model or a shorter conversation
  would fit. It is read after each run, since a model is listed only once it
  is loaded. A model wholly in graphics memory, one on a computer with none,
  and one in the cloud say nothing (`js/local-fit.js`).

- **You choose how much HashCoder may do without asking.** A menu beside the
  box a request is written in, with three choices. **Manual** asks before
  every change: a file written or edited, one moved or deleted, a command, a
  web page; reading the project stays free. It is the mode until another is
  chosen, so a first use asks before it changes anything. **Accept edits**
  is what HashCoder did before this menu: files in the project are written
  without a question, and a command, a deletion or a web page asks.
  **Auto** is Accept edits and a short, fixed list of commands that run
  without a question: reading and searching inside the project (`ls`, `cat`,
  `grep`, `rg`, `find` by name and the like), git's read-only commands, and
  the project's own test, lint, type check and build. It is a list and not
  the model's judgement: a command is a program and its arguments with no
  shell syntax, every argument must be one the program is known to take, a
  flag that runs another program or writes a file is not on the list, every
  place it names must really lead inside the project and not be a file of
  secrets, and a name that climbs out of the project asks. A check runs the
  project's code, which may be a test the agent wrote a moment ago, so it
  runs with the network closed (on macOS, in the sandbox; where nothing can
  close the network a check asks, and the native side refuses to start one
  it was told to keep offline). Auto asks again by itself once a file that
  says how checks run, or that git reads, has been changed in the run, after
  two attempts at a protected place, and after forty commands in a row with
  no question, and each command it let through is in the audit log. It is
  never restored when the app is reopened. Nothing a mode allows reaches
  what Rust refuses outright, and none applies outside a HashCoder run
  (`js/code/permissions.js`, `js/code/permission-bar.js`).

- **HashCoder is sent back when a page it wrote states details that
  nothing it read or was told says.** When a run changes a page or a text
  file, what it holds is read for the details a visitor takes as fact and
  could check: an address, a phone number, an email, a year it began, how
  long it has been open, opening hours, and a link to an account on a social
  network. Each is looked for in what the run was told or read: your own
  words, a page or a search it opened, a note it recalled, a connected
  system, and a file of the project it had not written itself. A file it
  wrote earlier is not a source, so a guess read back is not confirmed by
  being read. A detail found nowhere is sent back to the agent once, to find
  it, take it out, or say it is a guess; what is still unconfirmed when the
  run ends is said under the answer, together with any line of square
  brackets left on the page. When a picture was attached, what it shows
  cannot be searched, so only the brackets are held against the run
  (`js/code/facts.js`).

- **A picture attached in HashCoder is seen in the conversation.** The
  message it was sent with shows a small preview of each picture, which
  opens full size on a click and closes with Escape, instead of only naming
  the file. The previews are kept, newest first and within a fixed budget,
  when the conversation is saved, so they are there after the app is
  reopened; the picture sent to the model is still not kept. The box says so
  when the chosen model cannot read pictures, rather than sending one that is
  not seen (`js/code/attach.js`).

- **HashCoder can export a conversation with its trace, for finding what
  went wrong.** A button in the top bar, beside History, writes one markdown
  file: the facts of the run (the app, the platform, the project, the model
  and how HashCoder was set up for it), the trace with its times, and the
  conversation as the model was sent it, with the instructions, each
  request, each call with its arguments, each result, and each note the app
  added, told apart from what the person wrote. Results and instructions are
  folded, and nothing in a result can end its own block. Whatever is shaped
  like a key is replaced and counted before it is written; the contents of
  files the agent read are otherwise as they came back, so the file is for
  you and whoever you choose to show it to (`js/code/debug-export.js`).

- **A slow local model is not asked the extra question.** When a request
  does not say whether it needs a tool, an agent on a model on this computer
  first asks the model to decide, and again after each tool has run; each
  of those answers costs what writing it costs, which on a model that
  writes under ten tokens a second is seconds on every question. The app now
  remembers how fast each model writes here, from the counts Ollama sends
  with each reply, and for a model known to be that slow it answers at once
  when it cannot tell, and answers from the result once a tool has run. A
  tool the app has already chosen, or that a request must have, such as
  reading a connected system's records, is still decided as before, and a
  model not yet measured is not treated as slow (`js/local-speed.js`).

- **How long a local model stays loaded is a setting.** Settings, General,
  "Free a local model's memory after": Ollama's own setting, which is five
  minutes unless it was changed on the server, or 2 minutes, 5, 10, 30 or
  an hour. A model held after you stop using it is memory your other
  programs are waiting for, and a shorter time frees it sooner. A time that
  would hold a model for good, or unload it after every answer, is not
  offered, and nothing is sent until you choose one
  (`js/local-keep.js`).

- **A build that would close at once on its own computer is stopped, with
  the command that works.** The embedding runtime needs a processor with
  AVX2 and BMI2, and an app built with it closes without a window or a
  message on an older one. Building on such a processor now stops with a
  message that says so and names the build without the runtime. A build for
  another computer can go on by setting `HASHCORTX_ALLOW_ANY_CPU=1`.

- **A small project, shown whole.** A model on this computer under 15
  billion parameters is shown every text file of a small project as a
  conversation begins, read without asking like the map a larger model is
  given: up to 12 files and 8,000 characters for a model under 5 billion,
  20 and 16,000 for a larger one. A bigger project is not shown in part.

- **HashCoder sends back an answer that names a file that is not
  there.** Asked which file works out the tax, a small model searched once,
  found nothing, and answered with a file and a rate it made up. A search
  that finds nothing now says nothing is known yet and what to try, and an
  answer that names a file by its place in the project, where the project
  has none, is sent back once to find it.

- **What a request says to leave alone is left alone.** When a request
  says not to change the tests, or names a file to leave as it is,
  HashCoder refuses every write, deletion and move of those, saying what to
  change instead. A small model whose code failed a test had changed the
  test until it passed.

- **A finished site is held to a standard, not only to working.** The check
  of a site's files, with no model, now also finds content that starts
  hidden until a script shows it (search engines, link previews and a
  visitor whose script fails see nothing there), an animation that runs
  forever, a blur behind a bar that stays on screen, movement with no rule
  for a visitor who asked for less of it, and pictures with no width and
  height. HashCoder sends these back to the agent once with what will not
  work; the Agent Swarm lists them without asking for a repair.

- **HashCoder is told when an edit takes away something not asked
  about.** Each file an agent writes is compared with what it held before,
  with no model: a function, class or type gone from code, an id, section,
  table, form or footer gone from a page, a heading or picture gone from a
  Markdown file. One the request does not name, even by a word of its name,
  is said in the edit's answer with a request to put it back if it was not
  asked for; it never stops the edit. The second look and the checks
  against the request look for the same.

- **HashCoder starts with the project's latest commits.** When a
  conversation begins, the titles of the open project's latest commits,
  newest first, go to the model beside the project's notes: five for a
  small model, eight for a mid-sized one, ten for a larger one. They are
  read from git's own log in the project, with no command run; never who
  made a commit or their address.

- **HashCoder goes through a request ask by ask.** A request with three
  asks or more, joined by "also", semicolons, new lines or a list, is split
  into its asks with no model involved; the numbered list goes with the
  request, and before finishing the agent is sent back once to do what is
  missing and say, for each ask, done or not done and why. It follows
  "Prove changes before finishing". Whatever is left of the agent's plan
  when a run ends, or is stopped, is said under the answer.

- **HashCoder checks a website before calling it done.** When a run
  changes a page, a stylesheet or a script, the site's files are read the
  way a browser would, by the same check the Agent Swarm's work goes
  through, with no model involved: sections that can never appear, a menu
  that never opens, a page pointing at a file that is not there, an image
  from a host that no longer answers. What will not work is sent back to the
  agent once, before it finishes, under "Prove changes before finishing".

- **A map of the project's code for HashCoder's larger models.** As a
  conversation begins, a model on your computer of 15 billion parameters or
  more, or a cloud model, is given a short map of the open project: a line
  a file, naming the functions, classes and types it defines and a
  function's parameters, the files most used by other files first, cut to a
  fixed size, smaller for a model on your computer. It holds names only,
  never a value, and a name or path that looks like a key or holds an email
  address is left out. The project is read without a permission question:
  a file that would need one, hidden folders, folders of dependencies and
  build output, what the top .gitignore names and minified files are left
  out, and reading stops at fixed limits.

- **HashCoder can keep lessons about each project.** With "Keep lessons
  about each project" switched on in Settings (it starts off), a model on
  your computer of 15 billion parameters or more, or a cloud model, may
  save short lessons about the open project, such as how it is tested or a
  trap that cost time, and the next conversation on it starts with them.
  They are kept in HashCortx, never in the project, a dozen a project; a
  lesson that looks like a key or holds an email address is refused, and
  lessons a model on your computer kept never go to a cloud model. "Forget
  all lessons" removes every one.

- **A second look at HashCoder's larger changes.** After a change to more
  than one file, or of thirty lines or more, a model on your computer of 15
  billion parameters or more, or a cloud model, is asked once more as a
  reviewer that sees only your request, the changes and what was run to
  check them, none of the conversation. When it finds a problem, the agent
  is sent back once to fix it, or to say why the finding is wrong. It
  follows the "Prove changes before finishing" setting, is sent only to the
  model the run already uses, and a review that fails holds nothing up.

- **HashCoder notices when it keeps changing the same file.** When the
  agent has changed, or tried to change, one file four times with no check
  passing since, it is told to stop, read the file as it is and the last
  error in full, and make the one change that fixes the cause, or say what
  is in the way; again at eight. A check that passes starts every count
  again.

- **HashCoder says at once when an edit breaks a file.** After a change to
  a JavaScript, TypeScript, CSS, Python, Rust, Go or other C-like file, the
  text is read the way a parser starts to read it. When the file balanced
  before the change and its brackets or quotes do not after, the answer to
  the edit names the line and what is left open, so the model puts it right
  before it goes on. It is a note, never a refusal, and every source file in
  this repository reads as balanced by it.

- **HashCoder keeps a plan for a request with several parts.** Asked for
  three or more separate changes, a model on your computer of 5 billion
  parameters or more, or a cloud model, lists the steps first and marks
  each as it is done; you see the plan as a step in the run, with how many
  steps are done. While steps are open the plan is read back to the model
  at each step, and finishing with some still open sends it back once to do
  them, mark them done, or say why one cannot be done.

- **HashCoder knows the project from its first step.** When a conversation
  begins, the model is told what is in the project's top folder and given
  the project's notes for coding agents, its AGENTS.md or CLAUDE.md, with
  your first request: text from the project that it follows for how to
  build, test and write code there, and that cannot ask it for anything you
  did not. A line in the notes addressed to AI systems about something else
  is left out, as in any material a model reads. How much of each it is
  given follows the size of the model.

- **A model on your computer finishes what you asked.** Under 15 billion
  parameters, a model that changed files is sent back once before it
  finishes, with your request quoted, to check each thing it asked for and
  do what is missing; this follows the "Prove changes before finishing"
  setting. A model that tries to finish having changed nothing, when your
  request asks for a change, is sent back once to make it with its tools,
  and told to ask you only what the files and the tests cannot tell it; a
  question it still needs to ask, it asks again. A request that says to
  leave the files alone is answered as it is.

- **HashCoder is set up for a mid-sized model on your computer.** A local
  model of 5 to 15 billion parameters, such as a 7B, is offered the tools a
  coding task needs, pictures, and photographs when it builds a site, with
  its steps written out, in place of all twenty tools and the full
  instructions; what it reads before each step is under half what a larger
  model is sent. Its steps include checking a changed JavaScript or Python
  file for mistakes when the project has no test, and it is told never to
  ask you for what the files or the tests can tell it. Like a small model,
  it is not asked to say a sentence before each step.

- **HashCoder can rename in one edit.** An edit whose passage appears more
  than once was refused, so renaming a function used twice in a file could
  not be done with it. An edit can now change every place its passage
  appears, and the refusal says so.

- **HashCoder finds real photographs for a site's subject.** A new
  find_photos tool searches Openverse for openly licensed photos, the way
  the Agent Swarm does and under the same "Find real photos for websites"
  setting, and hands HashCoder each photo's address and the credit its
  licence asks for. It is told to use them for any site that shows its
  subject, to credit each one on the page, and never to write an image
  address of its own; two image hosts it used to reach for no longer serve
  images, and it is told so.

- **Attach files and pictures to a HashCoder request.** The paperclip in the
  box, pasting, or dropping onto HashCoder attaches a screenshot, a picture,
  a PDF, or a Markdown, text or code file. A picture goes to the model as a
  picture, when the model can see pictures; a file goes as its text. Each
  attachment shows as a chip you can remove before running, and the
  conversation names what was attached. Pictures are not kept when a
  conversation is saved. A picture or file pasted or dropped while HashCoder
  is open no longer lands in the next chat message.

- **HashCoder makes a change it wrote into its reply.** Asked to change the
  project, a model sometimes answers with the new code and changes no file.
  HashCoder is then sent back once to make the change with its file tools, or
  to answer without changing anything if the request was only a question.
  Commands to type into a terminal, and a line or two of code, do not send it
  back.

- **HashCoder proves a change before it says it is done.** When it tries to
  finish after changing code, with no test passed since the change, it is sent
  back to run the project's own test, found from its package.json, Python
  setup, Cargo, Go module or Makefile: once, and twice at most. Every command
  it runs is recorded as the kind of check it is, whether it passed, and
  whether it covered the whole project or part of it. The last line of its
  answer says what was proven after the last change, worked out from that
  record rather than from its own words.

- **A benchmark for HashCoder.** `npm run bench:coder` gives HashCoder
  twenty small tasks, from fixing a bug a test exposes to building a page,
  and judges each with a hidden check it never sees. It runs the real app with
  a local model and reports what passed and what it cost, so changes to the
  agent can be measured. Its commands run in the macOS sandbox, inside a
  temporary folder, with no network. A run stops starting tasks after twenty
  minutes unless told otherwise and rests between them, and `--smoke` checks
  HashCoder's loop in seconds with a scripted stand-in for a model. Each
  task's steps are kept in short with its result, so a failure can be read,
  and a smoke run that fails prints them.

- **Agent Swarm agents can look things up in a connected system.** A run
  whose task names a connected system, or speaks of its records, offers
  its agents that system's reading tools, never one that changes records,
  since nobody may be watching a run to approve a change. They are offered
  only when every model the run uses may see that system's records, and
  the first read asks you. A run that read records keeps where it read
  them from: it is not run again, or answered in the Workspace, on a model
  the system keeps them from, across a restart too.

- **Finance can report from a connected system.** Name a connected system
  in a Finance request, such as "summarise the unpaid invoices in Company
  ERP", and its records are read with its reading tools, after you allow
  it, and go with the request as an attachment, the way a file does. The
  model lists the figures and the app does every sum, as with a file. A
  request that names a system this model may not read is told so rather
  than answered without the records, and a Finance conversation holding
  records a system keeps from cloud models is not sent to one, across a
  restart too.

- **Sign in to a connected system through the browser.** A system that has
  its users sign in on its own page no longer needs a key: leave the key
  empty, or choose "Sign in through the browser" under More options, and
  its sign-in page opens in your browser. HashCortX introduces itself to
  the system's sign-in server by its public client document on
  hashcortx.com when the server reads those, and otherwise registers
  itself as a native app with no secret. It uses PKCE,
  waits for the answer on a one-time address on this computer, and does
  not use an answer that names another server. The tokens stay with the
  app, out of the page's reach, are sent only to that system, and are
  renewed when they run out, if the server allows it. "Sign in again" on
  the connection starts a new sign-in.

- **HashCoder can work with a connected system.** When a task is about
  one, such as an issue or a pull request in a connected code host, the
  HashCoder is offered that system's tools the same way chat agents are:
  reading asks you once, and every change, such as opening a pull request,
  asks you each time and shows exactly what will be sent. Each tool tells
  the agent to use it rather than a shell command for that system. A HashCoder
  conversation that read a system's records is not sent to a model that
  system keeps them from, and runs with several agents are offered none of
  these tools. Tools are named in words, in its steps and on the
  permission bar, such as "ASK GitHub · Get issue".

- **Ready-made connections for Odoo, GitHub, Stripe and Supabase.**
  Settings → Connections offers them by name, and "Other system" for
  anything else. GitHub, Stripe and Supabase need only a key, and each is
  reached and signed in to the way its own documentation says; Odoo needs
  the address its MCP app shows as well. GitHub and Supabase connect
  through their own reading-only addresses unless you turn Reading only
  off. With a key and nothing else chosen, the key is tried as a bearer
  token and then in the key header most systems read, each only to the
  address you gave and the second only after the first was refused.
  Connecting is all or nothing: a refused key or an address that cannot be
  reached leaves nothing saved, and says what to check. How a system signs
  in is under More options, and tools are named in words.

- **The ERP agent can read a connected system.** Ask it about a connected
  system's records and it looks them up with that system's reading tools
  and answers from what came back. Ask it to bring records from one, such
  as "bring the customers from Company ERP", and it reads them, matches
  them to a table's fields by name, and shows you every record it would
  add, and what it leaves out and why, before anything is written; Undo
  takes them out again. It only ever reads a connected system and never
  changes one. When it brings records in, a filter you did not ask for is
  not used, a record already in the table is not added again, and the
  other system's record numbers are not copied over this system's own. An
  ERP holding records brought from a connected system is not sent to a
  model that system keeps its records from, and an answer read from one is
  left out, with the question that asked for it, of what such a model is
  shown.

- **Connect a business system, such as an ERP.** Settings → Connections
  takes a system's MCP address and how it signs in. Its tools then become
  available to agents: the ones that only read start switched on, the ones
  that change records start off, and you choose. Reading asks you once for
  each system; every create, change or delete asks you each time and shows
  exactly what it will send. The sign-in secret is kept by the app on this
  computer and never handed back to a page or a model, and it is only ever
  sent to the address it was given for, over https unless the system is on
  this computer. A system's records go only to models running on this
  computer unless you allow cloud models for that system. A tool the
  system later describes differently is switched off until you look at it
  again. Systems on both the current protocol and the older one are
  supported.

- **An Agent Swarm run whose agents did not all finish can be finished.**
  When an agent fails or runs out of time, the agents after it never run,
  and running the whole team again repeated everything that had worked. The
  result view now offers "Run the agents that did not finish": only those
  agents run again, with the ones that depend on them, on the same task and
  the same list of what is owed, while every answer that was given is kept
  and handed on. The button is shown only while something is left to do.

- **Models from other local model apps.** A model server on your computer
  other than Ollama — the kind other local model apps run, answering in the
  common chat format — is found on its usual port, and its models are
  offered in the model menu under "Other local apps", beside Ollama's, in
  the chat and in every mode. A server on another port can be named in
  Settings. Its replies are read the way Ollama's are, thinking included,
  and its models count as local: a local task is never handed to the cloud.
  The app reaches such a server only on this computer.

- **An ERP backup can be put back.** The ERP could write a full backup of a
  system as JSON and had no way to read one, so the file was insurance that
  could not be claimed. Import now offers "Restore a backup (JSON)": it says
  what the file holds, asks, and brings the system back as a new one beside
  what you already have — nothing you have is replaced, so a file opened by
  mistake costs a click rather than your work. The file it writes also carries
  more than it used to: without the screens down the side, a restored system
  would have come back as its tables plus a handful of empty ones it never had.
  Backups written before this still restore, with one screen per table.

- **The Agent Swarm asks before it builds something about you.** A task
  such as a portfolio, a CV or a site for your business is checked before the
  team starts, and the details only you can give — your name, your work, how
  to reach you — are asked for in a short set of questions. What you answer
  is given to every agent as fact; anything you leave blank is marked in the
  result for you to fill in, and the agents are told never to invent a real
  person or business. A task that needs nothing personal starts straight
  away, and Cancel stops the run before any agent starts.
- **SambaNova and NVIDIA work, and so does a Kimi Code key.** Their servers
  refuse any request from a web page, which is what every request inside the
  app is, so their models were hidden and a Kimi Code key could not be used.
  The app now sends their requests itself, to six fixed addresses written in
  Rust — a chat address and a model list for each. The page names a provider,
  never an address, so this does not widen what the page can reach. Their live
  model lists arrive the same way, with each model's limits where the provider
  gives them.
- **A Swarm run can be deleted.** The Result view has a Delete run button
  that asks first, removes the run with its conversation and every version
  of its files, and shows the newest run left. Runs were kept for good.
- **Every bundled library's version and licence is written down**, in
  `src/js/vendor/PROVENANCE.md`, together with the notices of the parts jsPDF
  carries inside it and which of the files have been compared with their
  published packages.

### Security

- **A task stays on the side you chose, this computer or the cloud.** When a
  model fails, the run moves to another model on the same side only: a local
  model to another local one, and now a cloud model to another cloud one,
  never to a model on this computer, so a cloud task can no longer start
  loading a model on your machine and slow it down. With none left on that
  side the run ends with the model's own error. The same holds for HashCoder's
  router, for a model replaced before a run starts, and for the Agent Swarm,
  3D Forge, the ERP and Virtual OS. A new Swarm team is designed only from the
  models on the side of the one you picked, and the picker for asking one of
  its agents for a change lists that agent's side only.
- **HashCoder asks before it searches the web.** The words it searches for are
  the model's choice and go to a search service. The question now shows the
  words and the host, Tavily when a key is set and otherwise DuckDuckGo, and
  asks about each separately if the first gives nothing. "Allow for session"
  covers the host. If you say no, nothing is sent and the model is told the
  search was refused, not that search is unavailable. Chat's own web search is
  unchanged.
- **HashCoder asks before it searches for photos.** The words it gives as a
  site's subject go to Openverse, a service you did not choose and it did.
  Each search now comes with a question showing the words and the host, as
  reading a web page does, and "allow for session" covers the host for the
  rest of the session. If you say no, nothing is sent and the model is told
  to draw the imagery instead. With the setting off or Local only on, nothing
  is asked and nothing is sent, as before.
- **The Windows safety list reads a command's switches, not its spelling.**
  A recursive delete that does not ask is refused in Command Prompt and in
  PowerShell wherever its switches stand and however they are shortened, one
  command of a line at a time. Also refused: mirroring or purging a folder
  with `robocopy`, evaluating text with `iex` or `Invoke-Expression`, text
  piped into `cmd`, `powershell` or `pwsh`, a PowerShell started with an
  encoded command, downloads by `certutil` and `bitsadmin`, creating a
  scheduled task, and .NET's delete of a folder or file. Ordinary work runs
  as before. These are refused in the native code whatever is answered to a
  permission question.

- **The page reader and the check of a web address refuse an address that is
  not on the public internet, however it is written.** An IPv4 address
  carried inside an IPv6 one (NAT64, 6to4, Teredo or the mapped form) is
  judged as the IPv4 address it stands for, the documentation and
  discard-only IPv6 ranges are refused, and so are the IPv4 ranges reserved
  for protocols and for benchmarking. The page's own check, the only one in
  a plain browser build, applies the same rules before any request.

- **The desktop side's libraries are up to date with their fixes.** Three
  libraries it is built with, among them the XML reader under the one that
  reads property-list files, are updated to the versions their published
  advisories name as fixed.
- **Stop answers what a HashCoder run left waiting.** A permission question
  still open when you press Stop, and any queued behind it, is answered no,
  so pressing Allow afterwards starts nothing. The no is not remembered for
  the session.

- **A command HashCoder runs without naming a folder starts in the folder you
  opened.** The app fills the folder in, and Rust does the same on its own
  side.

- **A HashCoder task on a model on this computer stays on it.** When that model
  cannot answer, the run stops with its error; only a task on a cloud model
  moves on to another provider you have configured, as in every other mode.

- **What a model reads is kept apart from what it is asked.** Pages linked
  in a chat, passages from your notes, what an agent looks up, and tool
  results given to a local agent are handed to the model as reference
  material, each source in its own marked block, with a line saying it is
  text to read and not instructions. A sentence in that material addressed
  to AI systems is left out before the model reads it, with a note in its
  place; your notes and the pages themselves are unchanged.
- **Python written by a model runs in a sealed worker.** It cannot reach the
  app's saved keys, its native commands or the network, and a run that goes
  on too long is stopped without stopping the app.
- **The page's security policy is narrower.** The one CDN it allows is limited
  to the Python runtime's own files, and plugins, frames, form submission and
  base-address changes are refused.
- **Plugins the app never used are gone**, and the page may call only the
  plugin features it uses: window placement, opening a link, and the open and
  save dialogs.
- **The app window shows the app and nothing else.** Any attempt to take it
  to another address is refused.
- **Colours and ids in a generated report or business system are checked**
  before they are drawn.
- **PDFs are opened with the reader's code generation switched off**, on
  every path that opens one.
- **The file and shell blocklist is stricter.** It matches a path however it
  is written and judges it by where it really leads.
- **HashCoder asks before a change Undo cannot take back.** Writing inside the
  project needs no permission because Undo can restore the file; replacing a
  file it cannot restore — binary, too large to keep a copy of, not UTF-8 —
  now asks first and says why, and deleting one says so in the question.
- **HashCoder draws a reply the way chat does.** HTML in a reply is shown as
  text rather than built, and links and images follow the same rules as in
  chat and the Agent Swarm.
- **The sanitiser is DOMPurify 3.4.15**, the newest 3.4 release, with the
  upstream security fixes published since 3.4.2. Its two licence texts now
  ship beside it.
- **The PDF library is jsPDF 4.2.1**, the newest release, with the upstream
  security fixes published since 2.5.1. PDF export in chat, HashCoder and Finance
  uses it unchanged.
- **The diagram library is Mermaid 11.17.2**, the newest 11.x release, with
  the upstream security fixes published since the version it replaces. Its
  source, checksum and licence are recorded in `src/js/vendor/PROVENANCE.md`.
- **The app's own logs are bounded.** Every audit entry is one line of
  limited length, the audit log rolls over to `audit.log.1` past 8 MB, and
  its viewer loads only the newest part. Usage records and HashNotch notices
  that are far larger than real ones are refused.
- **Places that start a program on their own are refused**: login agents and
  daemons, autostart folders, the Windows Startup folder and a shell's
  start-up files, plus `crontab` and `at` in the shell. So are browser cookies
  and profiles, mail and messages, and more credential files.
- **A task given to a local model stays local.** When a model fails in the
  Agent Swarm, 3D Forge, the ERP or Virtual OS, a task on an Ollama model is
  handed only to another Ollama model, never to a cloud provider; with none
  left, the run stops with the error. Virtual OS's worker, which it picks
  itself, is a local model too when the job is on one.
- **On macOS, the agent's commands run inside the system sandbox.** They
  cannot read or write keys, credentials, keychains, browser and mail data,
  the shell's start-up files or the app's own data, or add anything that
  starts at login, however the command is written. Without the sandbox tool
  they are refused. Commands you type in the terminal are not affected. Git
  over SSH and similar tools that need those files are left to you.
- **Cloud AI requests are capped.** At most 30 in any minute and 6 running at
  once, across the whole app; one over the cap is refused with a message
  saying which was reached. Local models, model lists and web search are not
  counted.
- **The app's own folder is private to your account.** On macOS and Linux,
  `~/.hashcortx` — Undo's copies of your files, the audit log, the usage log
  and saved 3D Forge projects — is readable by your account only, and is set
  that way at every launch.
- **An agent's command starts without your secrets.** Environment settings
  named like a key, token, secret or password, and `DATABASE_URL`, are left
  out of every command the agent runs. Commands you type in the terminal
  keep them.
- **Agents are told that what a tool returns is not an instruction.** The
  HashCoder, chat's agents, the Agent Swarm's agents and Virtual OS's chat agent
  treat a file, a web page, a search result or a command's output as material
  for your task, and say so when it asks for something else. This is guidance to the model, not a
  filter; the permission dialogs still decide what runs.

### Changed

- **HashCoder's past conversations are called Sessions, and a launch starts a
  new one.** The clock-only History button is now a button that says Sessions,
  beside New chat, and the panel it opens is named the same. Opening HashCortX
  starts a new conversation; the last one is kept in Sessions and the project
  stays open. Going out of HashCoder and coming back in the same launch leaves
  the conversation as it was.

- **Settings read shorter and sit in order.** Each setting's help now stands
  on its own line under its name, in plain words, with no dash in front of it
  and a capital letter to start. The long explanations (what "Prove changes
  before finishing" checks, how project lessons are kept) are one click away
  under "What gets checked" and "How lessons are kept", with nothing taken out
  of them; the details check is now listed there too. A checkbox lines up with
  the first line of its text and not with the middle of a paragraph. The
  connection form's hints read the same way, and its "Key" label is as heavy
  as the others. The Local model page and the HashCoder tab say less, and
  HashCoder's Permissions section now points to the menu beside Run, where
  Manual, Accept edits and Auto are chosen.

- **The sign that HashCoder is working says what it is doing, and for how
  long the request has taken.** The turning ring and the shimmering
  "Thinking" are gone. A small mesh of dots, five across and three down on
  faint hairlines, moves beside a label that follows what has happened: it
  thinks (more slowly once the model's own thinking arrives), writes when
  its words arrive, chooses the next step while a call is written, and after
  a step it says what it is reading ("Studying app.js", "Reading the output
  of npm test", "Reading the search results", "Working out what went wrong"
  after a failed step), or that it is checking its work. Each has a movement
  of its own: a wave crossing the mesh, a light sweeping along it, quicker,
  drawn to the centre, rings from the centre. The clock beside it counts from
  the moment the request was sent until the answer, not from each step. The
  dots move by transform and opacity alone, stand still for someone who asked
  for less motion, and are not among the decorations that rest after a minute
  without a mouse, since they report state. A second look at the changes,
  which is a model call with nothing else on the screen, shows the line too
  (`js/code/live.js`).

- **The HashCoder benchmark can run each task more than once.** One run of
  one task says little: a small model that passes a task once may fail it
  the next time with nothing changed, so a change that moves a result by one
  task may be noise. `--runs 2` runs the whole set twice, in the order given
  and then again, and reports passes out of runs for each task, how many
  tasks passed every run, none, or some (the noise a change has to beat),
  and, against an earlier results file, per run, so a task run twice sets
  beside one run once. A run that never reached the agent is left out of
  every count. The scripted smoke run now reads what the app told the agent
  from the trail, since the steps that send it back are folded into one
  count in what a person sees (`scripts/bench/coder/tally.mjs`).

- **A small model is told to write paths from the project folder, and is
  held to a lower temperature.** A model under about fifteen billion
  parameters copies a long path from the top of the disk wrongly, a letter or
  a word dropped, and then reads nothing; "src/app.js" it gets right, and the
  app already writes it out in full before a tool runs. The instructions now
  say to write paths from the project folder, and the tools offered to a
  small or mid-sized model describe each place that way. The temperature the
  agent asks for is also held by the size of the model: at most 0.1 for a
  small one, 0.2 for a mid-sized one and 0.35 for a larger one, with the
  setting as a ceiling and never a wish for more, so a model that copies
  text exactly, writes arguments in a fixed shape and reports what it ran is
  not sampling widely while it does. A setting below the ceiling is obeyed.
  Larger models are told what they were told before.

- **A command the safety list refuses says which one.** The message named
  only the program ("cmd"), which did not say what was refused. It now gives
  the command line, cut to 160 characters, and says no permission can
  override it.

- **A chat with a model on this computer is given the window it needs, and
  no more.** The window a model reads a conversation into is memory it holds
  for as long as it stays loaded. Files attached to a short request, or a
  long memory setting, used to raise it to 16,384 or 8,192 whatever the
  request held; it is now sized from the request alone, in the same steps,
  and a model already loaded with a window that fits keeps it.

- **Decorative motion rests when nobody is using the window.** After a
  minute without a mouse, key or touch, the drone rotors, the circuit
  backdrop and the whole launch screen pause, and any touch starts them
  again. The launch screen waits for a click for as long as it is left, and
  with its motion running it kept the processor and the graphics chip
  working the whole time. What reports progress is never paused
  (`js/power.js`).

- **A model reading in circles is told to stop reading.** After two steps
  that changed nothing, HashCoder told the model to read the file an error
  points to, the very thing it was repeating; it now says that what it read
  is above, and to make the change.

- **"Not done" is not an ending.** A model on this computer that answers
  a request for a change by saying part of it is not done is sent back
  once to do it, or to say why it cannot be done.

- **A small model's tests are run for it.** Told to run the project's
  tests after a change, a model under 5 billion parameters often answered
  that they had passed, without running them. HashCoder now runs the test
  itself then, through the same permission as any command, and the model
  goes on from the real result; its word is not kept. An empty answer from
  a model on this computer is checked like any other.

- **An edit copied with stray spaces still lands.** A small model put
  spaces of its own into the passage it was replacing, `getUsr  }` for
  `getUsr }`, and every edit missed. `patch_file` now also finds a passage
  that differs from the file only in the spaces inside its lines, when it
  is there once, and makes the change with the file's own spacing kept.

- **Photo searches look for the thing itself.** HashCoder's photo tool and
  the Agent Swarm's photo searches now ask for what the site shows or
  sells, "quadcopter drone" for a shop that sells drones, and never for
  pictures taken with it, such as "drone photography", which found
  landscapes for a product page.

- **HashCoder says what it checked on a site, and what it could not.** A
  site is read the way a browser would each time the agent would finish,
  and the line under the answer says what the last reading found and that
  the page was not seen on screen: "Read as a browser would: nothing found
  to fix. Not seen on screen." A run that changed only pages and
  stylesheets said nothing at all, and one with a script said only that no
  test ran.

- **New chat says so.** HashCoder's bar starts a new conversation with a
  button that reads "New chat" where a bare plus was; the conversation it
  replaces is kept in History, as before.

- **A HashCoder run reads as a few short lines.** Each step is one line on
  a dashed rail, its file named from the project's folder, with a dot that
  fills when the step is done and turns red when it failed; a file written
  and its Keep and Undo are one line, not two. When the run ends its steps
  fold to one line, such as "12 steps", that opens them again, and the
  changes it made are gathered under the answer with Keep and Undo. The one
  sign of work is the line under the steps: a turning ring and its label in
  a moving light, with the time. The bar says Running and stays still, and
  copy, reply and regen wait for the answer.

- **On Anthropic models, HashCoder's requests are read from the provider's
  cache.** Each request marks where its reusable start ends, after the
  instructions and at its last block, so the provider reads everything
  before the new part from its cache at a fraction of the price. Only
  HashCoder, which sends its conversation again at every step, asks for it:
  a one-off request pays nothing to store what nothing would read.

- **HashCoder shows a model what fits it.** How much tool output a model is
  shown whole, and how many results it keeps, now follows its size: a small
  model on your computer the least, a large cloud model as much as before.
  A command's output longer than that is given to the model as its first
  lines, every line that reports a failure or an error with the lines
  around it, and its last lines, saying how many were left out; the
  terminal still shows all of it.

- **Each HashCoder step starts where the last one did.** A model reads a
  request from the start, and a provider, or a model on your computer, can
  reuse the work of reading everything up to the first thing that changed.
  HashCoder's instructions now stay the same from one request to the next:
  the file open, remembered facts and the bar a site is held to go with the
  request they belong to. Older tool output is set aside in steps, several
  results at once, instead of one more at every turn, so between those steps
  each request is the last one with more on the end. On a model on your
  computer, a long run spends a small fraction of the time it did reading
  its requests.

- **Tokens served from a provider's cache are counted apart.** In agent
  runs, tokens a provider reports as read from its cache, or stored in it,
  go in fields of their own in the usage log instead of being counted as
  ordinary input, so HashMeterAi prices them apart. Anthropic, OpenAI and
  the providers that follow its format, DeepSeek and Gemini each report them
  their own way, and each is read.

- **Changes left from a last HashCoder session are listed by file.** A run
  that edited two files eighteen times listed eighteen rows. Each file is now
  one row saying how many changes it holds; Undo takes it back to how it was
  before the first of them, and Keep keeps them all.

- **A site HashCoder builds is held to the bar the Agent Swarm's are.**
  Asked to build a site, HashCoder is told what the finished site must
  have: real content for the request, a visual identity chosen for the
  subject with its own colours, fonts and spacing, a wordmark or drawn logo,
  a first screen that says what the site is, everything clickable working,
  motion that helps, and photographs of the subject found with find_photos
  and credited. Its old advice to use placeholder photographs is gone.

- **HashCoder shows what it is doing while it works.** A line under its
  reply says whether it is thinking or writing and for how long, in place of
  three dots. The model's words appear as it writes them, from a model on
  this computer and from every cloud provider, and a tool call being written
  shows as the next step being chosen.
  Larger models say in a sentence what they are about to do before each
  step, and that sentence stays in the reply above the step, including when
  the conversation is opened again. A model on your computer under 15
  billion parameters is not asked to, since a sentence before a call often
  takes the place of the call.

- **HashCoder changes the part of a file it was asked to, not the whole
  file.** Rewriting an existing file of 30 lines or more whole, and changing
  more than a fifth of it, is refused unless HashCoder says the whole file
  is meant to be replaced; it is told to change the part it means with
  patch_file instead, so the rest stays exactly as it was. A rewrite that
  leaves the rest untouched still goes through.

- **The Coder panel is redesigned as HashCoder.** One bar holds the project,
  the model, how full its window is, and new conversation, history, terminal,
  Settings and leave. History and the execution trace open over the
  conversation, and the terminal is hidden until you ask for it. What is used
  less often moved to a new HashCoder section in Settings: the audit log, the
  trace, export, how many agents work at once, resetting permissions and the
  knowledge base switch, with whether the terminal opens with the panel and
  whether a change is proven before finishing. A local model under 7B is
  named as small under the box you type in. The panel is drawn in the app's
  shared colours, so it follows the theme.

- **A small local model gets the tools a coding task needs and a short set of
  steps.** Below five billion parameters HashCoder offers nine tools instead
  of twenty, and a few lines of steps in place of its full instructions.
  Such a model still often stops early or skips steps.

- **HashCoder's edits land more often, and it reads long files by lines.** An
  edit finds its passage even when the model copied it with the indentation
  off, spaces left at the ends of lines, or the line numbers of a numbered
  read, and still only where it appears once. Several edits to one file are
  made together or not at all. An edit that finds nothing shows the lines most
  like it, numbered, so the next try can copy them. A file over 400 lines is
  read 200 numbered lines at a time, with a range when one is asked for. A
  JSON file that an edit would leave unreadable is not written; a settings
  file whose tools take comments, such as tsconfig.json, is read as they
  read it.

- **The Agent Swarm fits its team to the task and to your computer.** A
  short piece of writing or a question is handed to one writer: no model is
  asked to design a team, nothing is asked of you first, and the answer is
  what the run owes. Other tasks get a team sized to how much work they are,
  and a team designed larger than that is cut down to it, keeping the agent
  that delivers. A team on local models is kept to a few agents, which run
  one after another, each given five minutes, since one computer answers one
  request at a time. The questions before a run are asked only when a task
  is about you, and fewer for a small task. The agent that delivers is
  handed every piece and told that its answer is what you receive, so its
  answer is now the result whatever the aggregation, instead of being
  written once more by another model; voting and best of n still choose
  between answers.

- **Finance adds up your figures itself, and your edits reach the whole
  report.** A report used to be numbers the model wrote separately — the cards,
  each chart and the table — with nothing joining them, so a total could
  disagree with the lines it was the total of, and a figure corrected by hand
  changed that one cell and nothing else. The model now lists the figures it
  reads and does no sums; the app works out every total, card and chart from
  that list, and the table is the list. Change a figure, add one or remove one
  and the cards and charts follow as you type. A measure that is not a sum,
  such as a debt-to-income ratio, can still come from the model and is marked
  as its estimate. If the chosen model cannot answer, the report goes to
  another. Reports saved before this open as they were.

- **Each agent is told which part is its own.** Every agent used to be handed
  the same list of everything the team owed, with nothing saying which of it
  was theirs — so the agent meant for the stylesheet spent its answer writing
  a page it was not there for, and ran out of room before reaching the
  stylesheet. Each deliverable now goes to exactly one agent, chosen for how
  well it suits the piece, and each agent is told what it writes, what the
  others are writing, and to refer to theirs by name instead of writing them
  again. The agent that delivers is told the opposite on purpose: it receives
  every piece, has to make them agree, and puts right anything that arrives
  wrong.
- **An input that had to be shortened says so.** An agent given the first few
  thousand characters of a longer answer received it looking complete, so half
  a file read as a file that ends there — and the rest got written from
  guesswork. It now says where it was cut, how much there was, and who wrote
  it.
- **The ERP's import dialog no longer offers a file picker that does nothing.**
  A second file input sat under the CSV drop zone offering to select a JSON
  file, for an import that does not exist. It carried the same id as the CSV
  one, and two elements with one id means the app can only ever find whichever
  comes first. It is gone, and a check now refuses any two file inputs that
  share an id.
- **3MF and STEP files are saved as what they are.** Two of the 3D Forge's five
  export formats were missing from the table of file kinds, so each was written
  as a stream of bytes of no particular kind and the save dialog had no name for
  it. Every format the app writes is now checked against that table.
- **The model lists no longer offer models that are gone.** The list shown
  before a provider has been asked had rotted again: seven of the eight free
  OpenRouter models in it no longer existed, so a first run offered eight and
  seven of them failed the moment they were used. They are replaced with models
  checked against OpenRouter's live catalogue. The Anthropic entries named an
  older family of models, written in a dated form those ids no longer use, and
  now name the current ones. SambaNova's and NVIDIA's were checked and were
  already correct.
- **A model reads your task and decides what the team owes.** Before the team
  is built, one short call works out the deliverables for the request in front
  of it, the same way the app already asks you for details only you can give.
  A campaign comes back as its positioning, the copy for each channel, the
  calendar and how it is measured — the work itself, rather than one document
  describing it. The call cannot stop a run: if no model answers in time, or
  answers something that cannot be read, the app works the list out itself and
  the run carries on, and the trace says which of the two it used.
- **A team's deliverables come from your task, not from a category.** Every
  request used to be sorted into one of eight kinds, and each kind had a fixed
  list of outputs written into the app. So every build — a shop, a game, a
  dashboard, a portfolio — was given the same three files, and every build was
  told to wire a working cart whether or not one had been asked for. A
  portfolio fits that shape, which is why it came out well; a shop does not.
  What a team owes is now worked out from the request itself: a shop gets its
  catalogue and its cart as their own files, a game gets its loop, a blog gets
  its entries, and a landing page gets none of them. The bar each result is
  held to is assembled the same way, so nothing is marked against a feature it
  was never asked for.
- **A saved team run on a different task works out what it owes again.** A
  team kept its deliverables from the request it was designed for, so running
  it on something else carried the first request's outputs into the second.
  Every run now works from a copy and decides what it owes from the task in
  front of it, and the trace says what that is before the team starts.
- **A shop, a storefront and a browser game are recognised as builds.** The
  rules that tell a team the exact file names, make each agent write its files
  whole, and set the bar, only applied to a task whose words included
  "website", "portfolio" or "dashboard". An online shop, a storefront with a
  cart and a game in the browser matched none of them and so were given no
  rules at all — every agent picked its own file names and its own idea of
  finished. A run is now judged by what it owes as well as by what it is
  called.
- **The room a team has follows what it is making.** Every build passed at
  most six thousand characters between agents, which is less than one page of
  a shop, so the agent assembling the files received them cut short and wrote
  its own from memory. The limit now grows with the number of files.

- **A trace now counts from the run, not from when you opened the app.** Every
  trace kept its own start time in a variable set the moment its code loaded,
  so a run begun an hour later had its first line stamped an hour in. The
  HashCoder, the Agent Swarm, Finance, the Virtual OS, the 3D Forge and the ERP
  all take their zero from a run clock that is reset where a run begins, and
  a clock that has not been started begins at the first line it stamps — so a
  stamp can no longer be a measure of how long the app has been open.
- **No mark in the app is an emoji.** The cross that takes a file or image
  off the composer is drawn like the icons beside it; the privacy question,
  the CV audit and the medical summary no longer put warning signs and
  ticks into what you read, and the CV audit is told to say "good", "needs
  improvement" and "critical issue" in words instead of emoji; the Virtual
  OS lists files and folders and states its rules in plain text. A check
  now reads every text file in the project — the app, the checks, the Rust,
  the build config, the hooks and the docs — and fails on a picture typed as
  text, in what the app shows and in what it asks a model to write. The three
  places one is kept are the file that strips them out of exported text and
  the two checks that prove that works, each named with its reason. Marks are
  drawn as SVGs on the colour around them; where no mark is needed, the word
  is used. A `commit-msg` hook holds the same rule for commit messages.
- **Every agent in the Agent Swarm is marked by a drawn icon.** An agent
  carried an icon typed as an emoji, saved by the starter teams and shown
  beside every turn in a run's conversation, so a workspace of line art had
  colour pictures in it. The mark is now drawn from the agent's role, from
  the same set the canvas, the role picker and the template list already
  used, and no team saves a typed one.
- **Every trace counts time like a stopwatch.** Trace lines in HashCoder, the
  Agent Swarm, 3D Forge, the ERP, Finance and Virtual OS were stamped in
  seconds only, so a long run read in the thousands. They now show seconds
  under a minute, then minutes and seconds, then hours, and so does the
  Swarm's "Done in" for each agent.

### Fixed

- **The permission bar is flat, and nothing spins after you allow.** Once an
  action was allowed, the bar reported it running by turning its shield
  round in place. The shield now stays still and a short line runs along
  the bar's top edge while the action runs. The bar itself is drawn from
  the theme: a flat surface on a hairline, the request as one sentence
  ("Allow HashCortX to write index.html") with the action in the accent, or
  in the danger colour for a command or a deletion, Deny and Allow for
  session as quiet outlined buttons, and Allow once filled in the accent.
  Its own fixed blue tints, gradients and blur are gone.

- **A new HashCoder conversation starts with no files from the last one.**
  Every change still waiting to be kept or undone was drawn into the
  conversation a launch starts, and New chat left the files the last
  conversation changed in the file panel's Session files. Each conversation
  now keeps which changes it made, and opening it again from Sessions shows
  those still waiting, with Keep and Undo; a conversation saved before this
  shows those saved before it was put away. A new conversation, and one
  opened from Sessions, list only the files they change
  (`platform/tauri/undo.js` ofSession).

- **HashCoder follows an answer only while you are at the end of it.** The
  conversation was moved to its last line on every frame of an answer, and
  the whole answer was drawn again each frame, so scrolling up to read
  something was pulled back down and the panel stuttered. It now follows
  only while the reader is at the end: scrolling up, by the wheel, a key or
  a finger, lets go at once, and scrolling back to the end follows again. A
  request just sent is always shown. The words of an answer being written
  are drawn at a bounded rate rather than on every frame
  (`js/code/follow.js`, `js/code/live.js`).

- **HashCoder is told that what the app remembers about you is not page
  content.** The few remembered facts sent with a request were marked only
  as context not to recite, so a model asked to replace a blank on a page
  could fill it with a name remembered from another conversation. They are
  now marked as being about the person, to understand the request, and not
  to be written into a file or a page unless the request asks; and the
  note that sends a page back for its details says that only what the
  person gave in this conversation, or a page the agent opened, counts as a
  source. This is an instruction to the model, not a filter on what it
  writes (`js/code/context.js`, `js/code/verify.js`).

- **HashCoder's debugging export says what the run was, whenever it is
  made.** The export read the model, the set-up and the temperature from
  what was picked at the moment of exporting, and its trace lived only in
  memory. An export made after the app was reopened, or from a session
  opened again, named whichever model was picked since and showed no
  trace. Each run's facts (the model that answered, the one chosen when
  the run moved off it, the set-up, the temperature it was really sent)
  and its trace are now kept with the conversation and its session, and
  the export uses them. What the app added to a request (the checklist,
  the site brief, what memory held) is shown with the request, folded,
  since it was sent with it (`js/code/debug-export.js`).

- **A model on this computer that writes its plan with the steps in it gets
  the steps run.** A mid-sized local model asked to build something often
  answered with a plan in words, each step a json block holding a whole
  tool call, and often closed each call with one bracket too many. Neither
  was read as a call, so the plan was shown as the answer and no file was
  made. A call with a closing bracket written once too often is now read as
  the call it closes. A plan whose steps are json blocks is read when each
  block names a tool that was offered and fills every argument that tool
  must have; the steps are read in order, the reading stops at the first
  step left with a blank to fill in, and only the first runs, since the
  rest were written before any result came back. An example among words,
  shown with its arguments empty or left out, is still an example
  (`js/tool-text.js`).

- **The pickers in the Swarm result's composer stand above each other.** Who a
  message goes to and which model answers sat on one line, and a long model
  name pushed the second one out of the conversation column. They are now two
  rows, each as wide as the column, and a longer name is cut with an ellipsis.

- **An error says what failed above why, and its close mark is centred.** The
  heading and the message sat side by side, so a long message wrapped in a
  narrow column beside a wide heading, and the close button held a typed
  multiplication sign that sat below the middle of its box. The heading is now
  above the message, the box is flat, and the mark is drawn and centred. The
  same drawn mark replaces the typed one on the Swarm result, the blueprint,
  project and file removers, the active agent chip and the two Systems dialogs.
- **The Swarm result keeps room for the conversation on a short window.** Below
  900 pixels the header, the conversation and the files shared the height, and
  on a laptop the conversation was left a few lines tall. Each half now keeps
  a usable height and the result scrolls.

- **A patch whose changes are all in its list of edits is made.** A model
  sometimes puts every change in the list and repeats the first one's passage
  at the top without its replacement, or leaves the top empty, and the call
  was refused for want of a replacement although every change was there. The
  changes are now taken from the list, in order. A passage at the top with no
  replacement that the list does not hold is still refused, since what to
  put there is not said (`js/code/patch.js`).

- **A list a tool returns no longer breaks a Gemini conversation.** Gemini
  takes a tool's result as one object, and a result that is a list (a
  folder's contents) or a bare value was sent as it was, so the request was
  refused, and since the result stays in the conversation every turn after
  it was refused too. A list is now sent under `result`, other values the
  same way, and text that is not JSON under `text` (`js/agent-shape.js`).

- **Two free models that no longer exist are not offered.** The list a new
  person sees before any provider has been asked still held two OpenRouter
  models that OpenRouter had removed, so a first call could fail. They are
  replaced with two that its catalogue lists today as free and able to call
  tools: Gemma 4 26B, which also reads pictures, and Laguna S 2.1
  (`data/cloud-models.js`).

- **A window that starts hidden is shown even when the page cannot start.**
  The window is created hidden and the page shows it once it has put it in
  place, so a script that failed to load, or a crash before the page ran,
  left no window at all, which looked like an app that did not open. The
  page's own failure screen now asks for the window, and the native side
  shows it after ten seconds if nothing has.

- **The content policy no longer blocks the app's own channel to its native
  side.** `ipc:` and `http://ipc.localhost` were in the default sources but
  not in the one that governs connections, which replaces it, so every
  launch of a built app logged a policy error and fell back to a slower
  path for every call. Both are now allowed to connect, and the check that
  pins the policy knows them as the runtime's own.

- **A local model app that refuses HashCortx is no longer reported as
  being off.** On Windows the app's page comes from `http://tauri.localhost`,
  which Ollama refuses until it is allowed. A browser hides the status of an
  answer the server did not allow, so the refusal arrived as "Failed to
  fetch", and the footer read "Local host offline" while Ollama was running,
  with the message that says what to do never shown. When a request to the
  model app fails with no answer, a second request that asks for none is
  made: it succeeds only when something is listening, which tells a refusal
  from an app that is off. The footer then says the host refused HashCortx,
  and the message gives the setting to change.

- **The page reader trusts the certificates the computer trusts.** The
  reader HashCoder and the chat use to open a web page after a search now
  judges a certificate with the roots the system trusts, in place of a fixed
  list of its own, so a page whose certificate chain ends in a root the
  system has is read, including on a network that inspects HTTPS. An
  expired or self-signed certificate is still refused. Requests that carry a
  key keep the fixed list.

- **The window opens where a person can reach it, and where it was left.**
  The first window could be taller than the screen's usable area, with its
  title bar above the top edge, because the size was capped without
  counting the title bar and frame. A saved position is now checked, so one
  saved on a monitor that is no longer plugged in, or read while the window
  was minimized, no longer puts the window where nothing can show it. A
  maximized window is remembered, and the position is saved when the window
  moves or is resized, not by a poll that ran only while it had focus. The
  window opens centered, a little smaller than the screen, on a first
  launch; remembers its size, position, whether it was maximized and the
  ordinary size it returns to; and is centered again when its saved position
  would leave the title bar out of reach on every screen. States saved by
  earlier versions are read once and repaired. The placement is one function
  of numbers (`planWindow` in `main.js`), which its check runs against a
  laptop, a large monitor, a Retina screen, two monitors, a monitor that has
  gone and scattered states.

- **A finished run's step count matches the one its stop message gives.**
  The line a finished run folds to left out the changes the run made, which
  are gathered under the answer with Keep and Undo, while the message that
  says a run stopped counted them. The line now counts them too, so the two
  agree and the changes are still shown below it (`js/code/steps.js`).

- **Text can be copied from HashCoder and from every conversation in the
  app.** The app is built like a native one, where nothing can be selected
  unless it is opted in, and only the main chat's messages had been. The
  messages, steps and errors in HashCoder, and the conversations in Virtual
  OS, Finance, the ERP and the Agent Swarm, can now be selected, and the
  right-click menu opens on them. Buttons and a step's heading are still not
  selected by dragging across them, and the rest of the app is as it was
  (`scripts/checks/selectable.mjs`).

- **HashCoder tells you what the model you chose said, not what the last
  one it tried said.** When a model could not answer, HashCoder tried every
  provider you had a key for and then reported the last failure, so a
  person who chose Gemini was shown Cerebras's empty account, and one who
  chose Nemotron was shown a quota for a model they had never picked. It now
  uses the routing the chat's agents use: the model you chose is asked
  first, a model the provider says is gone, including one it calls
  discontinued, is moved off at once and not asked again for two weeks, and
  the picker stops offering it. Every move is said in the conversation and
  the trace. When nothing can answer, the message begins with your model and
  what it said. A model that cannot read pictures is not tried while a
  picture is being sent, and when one is chosen that cannot, the message
  says so in plain words (`js/code/router.js`).

- **A long message in HashCoder's top bar no longer runs under the
  buttons.** The status is cut with an ellipsis at the edge of its place,
  the model picker and the buttons keep theirs, and the whole message is
  the status's title.

- **HashCortx says when Ollama refuses it.** On Windows the app's page
  comes from `http://tauri.localhost`, an address Ollama does not answer
  by default: it answered 403, and the app said only "Local host offline".
  It now says the local model app is running and refused this app, and
  how to allow it with `OLLAMA_ORIGINS`; the README says so for Windows.

- **Three checks run on Windows.** The benchmark's cloud check imported a
  module by a `C:\` path, which is not an address a module can be loaded
  from; the PDF check turned its folder's address into a path that does
  not exist on Windows; and the content policy check compared file names
  written with backslashes against ones written with forward slashes.

- **A Windows checkout passes the checks.** Git for Windows checks text
  files out with CRLF line endings by default, and fourteen checks that
  read the source as text failed on a fresh clone. The repository now
  keeps LF in every text file on every system (`.gitattributes`); the
  benchmark's task about a file with Windows line endings keeps its own.

- **A file is never written as the chat's own markers.** A small model
  wrote `<tool_response>` as the whole of a file it had just read, and the
  file's code was gone until Undo. A write whose text is nothing but such
  markers is refused, saying what to write instead.

- **HashCoder runs the calls a small model writes and then talks past.**
  A model on this computer that writes its tool call as text often goes on
  to write the result it expects, such as a test run that passed, and the
  call was dropped with it; the call now runs and the made-up result is
  dropped. A call whose arguments break JSON because a file's text went in
  as it is, quotes and new lines unescaped, is read argument by argument: a
  3B model wrote most whole files that way, and none of them were saved.

- **HashCoder finds the files a model names from the project's folder.**
  A path written as `src/app.js` or `./src/app.js` was read from wherever
  the app was started, and refused as outside the project: a 3B model
  wrote every path that way and read nothing. It is now written out from
  the open project before the tool runs, and judged like any other path. A
  path refused just outside the project, as when a model copies the
  project's long folder name with a word missing, is answered with the
  same place inside it.

- **A request's checklist leaves out what only describes the problem.**
  "npm test fails in this project" was listed as an ask to do, beside the
  real ones, and a request of one ask went through HashCoder's checklist. A
  part of a request now counts as an ask when it starts with what to do
  ("fix the menu", "do not touch the tests"), says what is wanted, or asks
  a question; a sentence about the situation is left out, whatever verbs it
  holds as nouns.

- **HashCoder reads a long project file whole at the start.** A project's
  `AGENTS.md` or `package.json` of more than 400 lines was read the way the
  model reads a file, a first window of numbered lines, so the notes came
  with line numbers in them and the project's test command could be missed.
  They are now read whole, with no permission question.

- **HashCoder's bar has no X.** It sat where a close button for the
  conversation would, and took you to chat instead. HashCoder is left with
  the exit button at the top right of the window, as every mode is, or with
  Cmd/Ctrl+Shift+C, which now goes back to the tab HashCoder was opened
  from; it went to chat every time.

- **The check of a finished site finds sections that can never appear.**
  A script that hides elements by setting their style directly, then
  switches a class on to show them, leaves them hidden for good, since a
  style set directly wins over any class; the Agent Swarm's check of the
  work now names it as something that will not work. The same check no
  longer calls a script cut off because a comment in it holds an
  apostrophe, and a file that does not parse is named with its line.

- **HashCoder no longer stops a finished run as if it were stuck.** Reading
  back a file it had just changed, marking a step of its plan done,
  searching the same folder for other words, or reading another part of a
  long file was counted as a step that changed nothing, so an agent checking
  its own work was stopped and told it was repeating itself. All of these
  now count as progress; the same read or search made again still does not.
  An agent whose plan is done, or whose change is made, is told to finish;
  and if it is stopped after making changes, the message says the changes
  are there to keep or undo rather than blaming it.

- **HashCoder's Symbols list reads each file whole.** A file of more than
  400 lines was read the way the model reads it, a first window of numbered
  lines, so the list missed most of what a long file defined, gave line
  numbers one out, and found nothing at all in a long Python, Go, Ruby, C or
  C++ file; it also listed every constant and variable in a JavaScript file.
  It now lists the functions, classes and types each file in the project's
  top folder defines, with a function's parameters by name, in JavaScript,
  TypeScript, Python, Rust, Go, Java, C#, Kotlin, Swift, C, C++, Ruby and
  PHP. A file that would need a permission question is left out rather than
  asked about.

- **An ERP is built for the right kind of business more often.** Short words
  were found inside longer ones, so a lawn-care company was set up as a law
  practice, "event management" as a jewellers and a candle maker "with three
  kinds" as a human resources office; a consulting firm or a building
  contractor was taken for a law firm, a coworking space for a gym, and a
  clinic that takes bookings for a hotel. A courier that delivers to shops
  is a carrier, a jewellery or diamond shop and a machine shop are shops of
  their own kind, and a bakery serves food.

- **A tool that answered with a failure is not counted as done.** In chat,
  a tool that said it failed rather than stopping with an error was marked
  with a tick and recorded as a success: a memory save that saved nothing
  could be reported as "Saved that to memory", and a refused read from a
  connected system counted as records the conversation held, keeping it
  from cloud models for no reason. Such a tool is now marked and recorded as
  failed.

- **A saved HashCoder conversation says what was checked.** The line under
  each answer saying which check passed after the last change, or that none
  did, was drawn only while the run happened; opened again from History or
  after a restart, the answer came without it, although Settings says it is
  given either way. It is now kept with the answer.

- **A mode that cannot open says so plainly.** Its message was headed
  "Request failed", as if something had been asked of a model, and a
  computer without 3D graphics was shown the graphics library's own error
  for 3D Forge. It is now headed "Could not open" and says that 3D Forge
  needs 3D graphics, and what may help. Settings that could not be saved are
  headed so too.

- **HashCoder notices when it goes round in circles.** A command it had
  already run, run again the same way, counted as progress, so an agent
  that ran the same failing test over and over was never stopped. Such a
  step now counts as nothing done: after two of them HashCoder is told to do
  something different, such as reading the file the error names, and it
  stops as before if it keeps repeating itself.

- **HashCoder keeps your request in view however often it is sent back.**
  When a long conversation was shortened for the model, HashCoder's own
  notes sending the agent back before finishing were counted as requests,
  and after three of them your request and the first steps were left out
  of what the model saw. The notes are marked as HashCoder's and no longer
  count.

- **A test that could not run is not a failed test.** A command that
  found no test script in the project, or no program by that name, was
  read as a test that failed after HashCoder's change, and it was sent back
  to fix a failure its change never caused. Such a command now proves
  nothing either way. When HashCoder is sent back to run a test, it is given
  the exact call that runs it, and after a failure it is told to make the
  fix rather than describe it.

- **HashCoder's search by file name says how each file matched.** It gave
  each match a number, 0 for the exact name, and a model read that 0 as no
  match and said the file did not exist. Each file now comes with how its
  name matches, in words; a search that finds nothing says it looks at names
  only and which tool looks inside files; and reading a path where there is
  no file says how to find the one meant.

- **A quote a model escapes in a call is written as a quote.** A call
  written as text with its single quotes escaped kept the backslash, so a
  file HashCoder wrote had one before every quote and would not run.

- **A call a local model writes after its words is made.** A model that
  says what it is about to do and then writes the call as plain text on the
  lines after it had the call shown as its answer, and the step never ran.
  Calls on the last lines of a reply are now read when nothing but calls
  follows them; an example among the words is still left alone.

- **A model on your computer sees its own steps.** Several local models'
  templates show a past turn as either its words or its tool calls, never
  both, and the words won: a model that said what it was about to do before
  a step then saw its steps as sentences followed by results, answered with
  a sentence too, and stopped with nothing done. A step now goes back to a
  local model as its calls alone; what was said stays in the conversation,
  where you read it.

- **A dropdown's arrow stays where it is under the pointer.** Hovering a
  dropdown drawn in the app's own style cleared its arrow, which slid away
  and vanished, in Settings and everywhere else the style is used. Only
  the colour changes now.

- **HashCoder works the same after you leave it and come back.** Opening it
  again wired every button again, so History and the terminal button toggled
  twice and seemed to do nothing, the conversation was drawn again without
  its steps, and changes from the run just made were listed as left over
  from a previous session. It is set up once now, and opening it again
  leaves it as it was.
- **A saved HashCoder conversation opens as it ran.** Opened from History or
  after a restart, it shows each step taken and each time the agent was sent
  back, and only its real answer: a reply it was sent back from is no longer
  shown as one.

- **A HashCoder run with a picture in it works on OpenAI-style providers.**
  Once a picture was in the conversation, such as one opened with
  view_image, every tool call and its result were sent without what ties
  them together, and OpenAI, Groq, OpenRouter and the like refused the
  request. They now keep it.

- **HashCoder can run `npm` and its kind on Windows.** `npm`, `npx`, `yarn`
  and `pnpm` are batch files on Windows, and a command naming one without its
  extension was not found. The batch file of that name is now found on the
  search path, in the order Windows uses, and started through cmd with its
  arguments escaped.

- **HashCoder's questions open above it.** Resetting permissions, renaming
  or deleting a saved chat, confirming an Undo and the export notices opened
  their question beneath the HashCoder panel, where it could not be seen or
  answered, so the action never finished. The app's shared dialogs now sit
  above every workspace.

- **A command line HashCoder writes as one program is read as its words.**
  `npm test` given as the program to run is split into the program and its
  arguments, quotes kept. A line that needs a shell to mean what it says, with
  a pipe, a redirect, a wildcard or a variable, is refused with what to do
  instead, rather than failing as a program that does not exist. On Windows
  a backslash is read as part of a path.

- **HashCoder keeps your request in view on a long task.** Once a task passed
  about nine steps, the oldest messages were folded into a count, and the
  first to go was the request itself, so the agent carried on without knowing
  what it had been asked. The request is never folded away now. What gives way
  is the output of tools the agent has already acted on: the newest results
  stay whole, older ones become a line saying what they were, and pictures and
  whole files sent long ago are not sent again.

- **A small local model's tool calls are read when it writes several in a
  row.** A model that set out its next steps as calls, one per line, had them
  shown as its answer and none of them ran, including when its answer was
  cut off partway through the last one. When every call written whole names
  a tool the model was offered, the first of them runs, and the model writes
  the next knowing what it returned. A list of calls that ends in a line of
  words, such as the model saying how it went, is read as the calls. A call
  followed by an empty code fence is read, and a backslash JSON does not allow, such as the `\s` of a
  pattern in an edit, is kept as the model wrote it.

- **An ERP counts in the currency of its place unless you name another.**
  The agent's model could fill in a currency nobody mentioned, and it
  outweighed the one the app works out from where the business is, so a
  business in Cairo was built counting in dollars. A currency is now used
  only when your words name it, by its code, its name or a sign only it
  goes by; otherwise the place decides.

- **An ERP keeps one table for one thing.** When a model's design named a
  table one way in its list of tables and another on the screen that shows
  it, such as "customers" and "customer", the system was built with both:
  the model's table with its records, and an empty one filled with
  stand-ins, which was the one on screen. Tables whose names differ only as
  singular and plural are now made one, keeping the fields and records of
  both, and every screen and link points at it.

- **A food wholesaler's ERP is built for a wholesaler.** "Food" anywhere in
  a description meant a restaurant, so a wholesaler that sells to
  restaurants and shops was built with a menu, dining tables and waiters.
  The ERP now knows wholesale and distribution businesses, food or
  otherwise, including one described only as selling or supplying to
  restaurants, shops or other businesses: orders that move from received
  to delivered, products by the pack, customers with payment terms and
  credit, deliveries and suppliers.

- **An agent says when the tool a request needs is switched off.** A model
  asked for something only a switched-off tool of a connected system does,
  such as opening a pull request, knew of no way to do it, and tried a shell
  command or told you to ask an administrator. In chat and HashCoder, a
  system's switched-off tools are now offered in their place as tools that
  send nothing, described in the app's words, up to six of them, those
  closest to the request first. Calling one tells the model the tool is
  switched off and that you can switch it on in Settings → Connections.

- **"Run the agents that did not finish" shows only when some did not.**
  In the Swarm Workspace it stayed on screen after every run, offering to
  run none, because a style every button shares outweighed the attribute
  that hides it. Every Workspace button now stays hidden when it is hidden.

- **A landing page for a business called a shop is not planned as an online
  store.** The Agent Swarm read "shop" or "store" anywhere in a request as
  selling online, so "a landing page for a neighbourhood coffee shop" was
  given a product catalogue to fill; with no products to put in it, the team
  handed back an empty skeleton. "Shop" or "store" alone now means selling
  only when the request is not a page that presents a business — a landing
  page, a home page, a one-page site, a portfolio or a brochure. Words about
  selling, such as an online store, products, a menu or buying, still mean it
  on any page.

- **What an Agent Swarm run owes is what you asked for.** A plan for a
  piece of writing, a plan or an analysis now names the parts of one answer,
  not separate files: a team that wrote a launch plan as one document was
  otherwise found to owe four missing files and sent back to write them. No
  run owes a picture file, which an agent cannot write, and a build's
  documents are Markdown unless you asked for another format. The questions
  you left unanswered before a run no longer decide what kind of task it is:
  a skipped question that mentioned a website made a social media plan a
  website build.

- **An Agent Swarm agent's answer has to be the work.** An answer that is
  only a call to a tool, written out as text, is not taken as the agent's
  part: the same model is asked once for the work itself, then another model
  is tried. An answer that asks you for the details you left unanswered is
  asked once for the work too, and the agents are told that you will not be
  asked again: one delivered those questions as the team's result. An
  agent's time limit is reported as the one it was given.

- **Agent Swarm agents read what is remembered about you and leave it as
  it is.** Only you, and the chat when you tell it something, add to it. The
  agent that delivers a result puts together what it was handed and searches
  for nothing.

- **Changing an ERP system's design takes seconds, and changes only what you
  asked.** A design change was made by having the model write the whole
  system out again — every screen, table and field — to change one thing,
  which took many minutes on a small local model, could run out of time on
  a cloud one, and let the model alter things nobody asked about. A change
  is now a short list of edits: add, rename, change or remove a field or a
  table, add, rename, re-show or remove a screen, rename the system, or
  change its layout, typeface, density, surfaces or corners. The app makes
  each edit itself and shows the list before anything changes. A request
  that says plainly how the system should look, or how a screen should show
  its table, is read by the app without a model. A new field starts empty
  on the records you have; nothing is invented for them. Nothing is removed
  unless you ask for it, and an edit the model gets wrong is sent back to it
  once with the reason.

- **A small model can no longer keep an answer going without end.** An
  answer held to a fixed shape — an agent's decision, the ERP's replies and
  designs — can only end when that shape is closed, and a small model can
  keep adding to a list until it runs out of room, which looked like the app
  hanging. Such an answer now has a length limit on every local model. Any
  other answer from a local model now stops where the model's room to read
  and write runs out: before, a small model repeating itself wrote on until
  it was stopped, and an Agent Swarm agent spent its whole five minutes that
  way.

- **One local model no longer waits behind another.** Every request to a
  model on your computer asked for it to stay loaded for good. When another
  model was needed and there was not room for both, the one held could not
  be let go, and the request to the other waited until it was given up on.
  A model now stays loaded for as long as your local model server keeps any
  model — five minutes unless you set it otherwise — and is loaded again
  while you type your next message. It also no longer holds memory after
  you close HashCortX.

- **A local model that thinks answers a tool question in seconds.** Asked
  to read back what a tool had found, a thinking model deliberated over the
  agent's whole set of instructions first, which could take well over a
  minute for "what day is it". It is now asked not to think when deciding
  on a tool or reading back a result, and still thinks before an answer
  that needs no tool.

- **The time in another city, and the days between two dates, are worked
  out by the app.** The date tool gave only the time where your computer is,
  so a model asked for the time in Tokyo did the time-zone arithmetic
  itself and could get the day wrong. The tool now takes a place or a time
  zone and gives the date, time and day there. The calculator also counts
  the days between two dates exactly, where a model had to add up the
  months itself.

- **What the app remembers about you is what you said.** Saying you are a
  developer was remembered as the first two letters of the word, a place of
  work after "at" was lost with it, and "I'm a bit tired" became a job.
  Asking what the app remembers was itself saved as something to remember,
  a note repeated a fact already read out of it, and remarks such as "I
  don't understand this error" were kept as habits. Each of these now reads
  correctly, and the memory tool no longer shows models example labels that
  they copied onto unrelated facts. Facts saved before this are left as they
  are; they can be edited or removed in Settings, under Memory.

- **A local agent uses its tools when it should, and its answer streams in.**
  A small local model offered tools had to decide whether a request needed
  one and write the call at the same time, and it decided badly: it answered
  questions about recent events from what it was trained on, did sums in its
  head and got them wrong, and said it had noted things without saving them.
  A local agent now takes its turn in steps. When a request plainly needs a
  tool — a web address to read, code to run, anything current, the time, a
  sum — or plainly needs none, such as writing or explaining, the app takes
  that first step itself; otherwise the model decides, and only that, in an
  answer held to a fixed shape. The app runs the tool, and the model answers
  from the result, with that answer appearing as it is written instead of
  after it is finished. Tested with 3B to 7B local models on everyday
  requests, the right step was chosen far more often than before.

- **Every local model works as an agent, including ones that cannot take
  tools.** A model whose server says it cannot take tools was refused by
  the agents, and the chat fell back to guessing what to look up for it.
  Such a model is now told its tools in words, with one way to call them,
  and its calls are read from its answer, so it searches, calculates and
  runs code like any other. A model made only for search is listed but not
  offered for chat, and a picture sent to a model that cannot see is
  refused in plain words naming the model, instead of a technical error.

- **The calculator gives large whole numbers exactly.** It worked in the
  numbers every script uses, which round whole numbers past about nine
  thousand million million, and handed back the rounded figure as the
  answer. A sum made only of whole numbers — powers and factorials included
  — is now worked out exactly at any size, and a result that had to be
  rounded says so.

- **A local model's tool call runs, whichever family the model comes from.**
  Each family of local models writes a tool call its own way, and the app
  read only three of them, so a call written any other way was shown to you
  as the answer and the tool never ran. Every common way is read now,
  including a call the model left unfinished, and only for tools the agent
  was given; an answer that merely shows an example call is left alone.

- **A local model answers without reloading first.** Ollama loads a model
  again whenever a request asks for a different amount of room, and the
  app's own requests asked for different amounts, so a model was often
  reloaded between one message and the next — one to three seconds before
  the first word. A request now uses the room the model is already loaded
  with whenever that holds it, and the model is loaded while you are still
  typing, so it is ready when you press send.

- **A local model that thinks is no longer silent.** A model that thinks
  before it answers showed three dots for as long as it thought, often many
  seconds, and its thinking was then thrown away. The thinking now appears
  as it arrives and stays folded above the answer, with how long it took;
  cloud models that think are shown the same way. Every request to a local
  model goes through one connection now, which also stops on a failure the
  model server reports part-way through a reply instead of taking half an
  answer for a whole one.

- **A Swarm team designed on a small model runs.** A small model wrote a
  provider's name where each agent's model belongs, the app kept it, and
  every agent then failed asking your local server for a model called
  "openrouter". Every model the team designer assigns is now one it was
  offered: a provider's name becomes that provider's model, and anything
  else becomes the model the team was designed on.

- **3D Forge no longer calls a broken design finished.** A small model's
  design could come back as outline shapes with no outline, which the app
  drew as thin slivers, or as copies stacked on one another, or as parts
  mostly floating free, and the run still said "Forge complete". An outline
  shape with no outline is now the nearest real shape its sizes describe, and
  said so; a design that does not hold together is asked for once more with
  the reasons, the better of the two is kept, and a run that still fails says
  so instead of "complete". The design call now says what each shape needs,
  and a local model is held to answering in JSON, so a 4B model built a
  recognisable mug where it had built slivers.

- **The ERP agent never says a change happened when it did not.** A small
  model answered "Customer added successfully" with nothing done. What the
  agent says as it acts is now the app's own words, a change it claims but
  did not ask for is carried out or corrected, and a business name or place
  you never gave is asked for instead of made up. Adding a field or a screen
  goes to the design, not to the records. A request for "all" of something
  covers all of them, and the question before a change says what will
  happen, with the values, rather than reading as if it already had. A change
  to the design is now shown and asked about first, as a change to records
  is. A table or field a model names in another form ("customers" for
  "customer") is found. The ERP no longer takes "gemini" for "mini", so a job
  too large for one provider reaches one that can hold it, and a change is
  routed by the size of what it sends.

- **3D Forge no longer calls Gemini Pro a small model.** Its ranking found
  "mini" inside "gemini", marked every Gemini model down and told you Gemini
  Pro rarely places a shape.

- **Provider error messages no longer show your account's own identifiers.**
  A provider's refusal can name the organization or project a limit belongs
  to; the app showed that on screen and kept it in saved runs. It is now
  taken out, and what the limit was is kept.

- **Local models read the whole request.** Ollama reads a request into a
  window of fixed size and silently drops the start of anything longer, and
  the start is the instructions. The app gave local models a fixed window, or
  none at all in several modes, while an ERP request alone could be four times
  longer, so a small model answered without knowing what was asked of it.
  Every request to a local model is now given room for all of it and its
  answer, within what the model supports; one that cannot fit is refused in
  words instead of cut. Where the app needs a structured answer, a local
  model can now be held to it.

- **You can see what an agent's code actually printed.** A small local model
  ran its Python correctly and then wrote a different number in its answer,
  and nothing on screen showed the real one. What each run printed is now kept
  under the reply, folded, as the app received it. A tool call a small model
  writes at the start of its reply, before it explains, is now carried out
  rather than shown as the answer.

- **Chats are titled by what you asked.** A chat started from one of the
  starter buttons was titled with the button's instructions, so every "Look
  it up" chat was called "Look this up…"; the title is now your own question.
  The list of chats names each one's model the way the model menu does,
  rather than by its internal id.

- **A Swarm team stays on the models it was designed on.** A team designed on
  a cloud model could be given a local one, which loaded it on your machine
  in the middle of the run; the designer is now offered models on its own
  side only. The questions asked before a run, and the summary written after
  it, used whatever model the chat had open rather than the team's own. Every
  Gemini model, Pro included, was marked down on large tasks, because "mini"
  was found inside "gemini". The team you had open is open again when you
  come back, where Run used to ask you to select one beside the list, and the
  God Agent starts from the task you already typed. An agent whose model
  declined the task ("I can't comply with that request") had the refusal
  handed on to the team as its work; it now goes to another model, as an
  empty answer does.

- **The Virtual OS agent does what it says it did.** Asked for files, a
  small model would write them into its reply and say it had created them,
  and nothing was created; they are now put in the workspace and the reply
  says where. A model that reaches for a real tool call where the agent is
  told to write one out had its whole answer refused by the provider; the
  call it made is now read back and carried out, and an empty answer is
  taken to the next model instead of ending the turn with nothing on screen.
  The worker that writes a project stays on the side the job started on, so
  a job given to a cloud model is no longer handed to a local one, and a
  model's size is read from its name: a local 7B model counted as the
  strongest worker there was, and every Gemini model, Pro included, counted
  as small and was never asked.

- **The 3D Forge no longer treats its own mark as your model.** The void opens
  on the HashCortx mark so it is not an empty black rectangle, and three parts
  of the mode knew to step around it while the rest did not: Export wrote that
  mark to a file under its own name, Improve offered to correct it, and the
  header counted its two pieces as your parts. There is now one answer to
  whether a model is there, and everything asks it — Export says there is
  nothing yet and what to do instead, Improve stays off, and the header reads
  "Describe a model to begin".
- **Two 3D Forge buttons had their mark sitting below the middle.** Reset
  camera and Back were drawn 28 pixels tall but kept the app's general button
  padding, which left 8 pixels of room inside them for a 15 pixel mark — too
  little for it to fit, so it hung low. Both now sit on their centre line, and
  `npm run align` measures every button in every mode so it cannot happen
  again unnoticed.
- **The Forge says when no model is set up.** Pressing Generate with no
  provider key and no local model ended the run on "all Forge planner routes
  failed", which reads as models having been asked and having refused. It now
  says that no model is set up yet, and where to fix it.
- **A model is chosen by how it answers, not only by its name.** The name
  says how big a model is, and bigger read as better, so a free giant model
  was handed the most important roles in a team and then sat in its
  provider's queue for the whole time limit while everyone waited. The app
  now remembers how long each model's answers take and when one runs out of
  time, and picks among models that answer first, strongest first within
  those. A model that ran out of time on its last job is not asked first
  again until it answers something; a free model of 200 billion parameters
  or more waits its turn until it has answered once. The trace says when a
  model was passed over.
- **An Agent Swarm team's result comes from the agent that finishes the
  work.** A team whose planner had the supervisor role had the planner chosen
  to deliver: the first agent to run was told to write the whole finished
  site with nothing to write it from, its answer became the result, and the
  agent built to finish was told to write only its own part. The deliverer
  is now the last agent that finishes, planners stay planners, and a team
  saved the old way hands its result to an agent nothing else waits on.
- **An Agent Swarm agent that gives an empty answer is no longer counted as
  done.** Its answer came back as a placeholder, the run reported no
  failures, and the agent's part of the work was simply missing — for the
  agent that finishes a site, the whole site. An empty answer now moves the
  agent to another model like any other failure.
- **An Agent Swarm agent that runs out of time stops its request.** The run
  moved to the next model but left the slow request running, still spending
  the account's quota and holding one of the app's places for requests,
  which turned one slow model into rate limits for the agents after it. The
  request is now cancelled when its time is up.
- **A request too large for a model is no longer taken for a busy or spent
  account.** A refusal saying a request was larger than a model takes on
  this account was retried on the same model two seconds later and then
  reported as an account out of quota, which shut every other model on that
  account out of the run. It now moves straight to a model that can hold the
  request, the account's other models included, and the trace says why.
- **3D Forge places parts written as arithmetic where they were written.**
  The design may give a position, a turn or a size as a sum, but the first
  step a design passed through read those as plain numbers, so every part
  placed by a sum landed on the centre of the model. Sums are now worked out
  before anything else reads the design, and one that cannot be worked out is
  named in the trace.
- **3D Forge builds the same object whatever unit the design is written in.**
  Several steps judged a design by fixed numbers before bringing it to size,
  so a design in millimetres — which is how models tend to write one — had
  every part pulled to within 12 mm of the centre and a chair arrived as a
  cross of stacked parts. Rounded joins did not resize with the model, small
  parts of a design in small units were dropped as too small to draw, and
  picking out the main object and centring it ran on the design before its
  arithmetic was worked out. Every design now takes one path to the scene,
  every limit is measured against the design's own parts, and a mirrored
  model is never centred off its own centre line.
- **3D Forge says everything it changed while building a model.** The run
  reported a part too far from the body and a part with no size, and said
  nothing when it pulled in a part placed far away, could not make a repeat,
  made no mirror copy of a part already on the mirror line, or left out a
  part whose size was not a number. Each of those now has its own line in the
  trace, naming the parts.
- **3D Forge asks for every length in millimetres.** Its design instructions
  asked for the object's size in millimetres, showed example sizes around
  one, told the design to build at whatever scale suited it and to keep
  positions between -3 and 3, so each design picked its own unit. They now
  ask for every length in millimetres at the object's real size, offer no
  role that another rule forbids, and the repair step no longer asks for
  colours the design is told not to give.
- **Improve this model works in millimetres and keeps pairs matched.** It
  showed the correcting model a plan in the scene's internal numbers and
  merged the answer in as it came, so a correction written in millimetres
  landed at the wrong size, and a change to one wing of a mirrored pair
  left the other wing as it was. The plan is now shown and read back in
  millimetres, a change to either side of a pair is made to both, and
  removing one side removes the pair.
- **3D Forge's Properties panel shows a part's real size.** A part's
  dimensions were shown without the scale the part is built at, so a model
  designed in millimetres showed a leg many metres long, typing a size cut it
  to a ceiling, and its scale read as zero. Dimensions now show and accept
  real millimetres, and scale reads 1 for a part that is not stretched,
  including the mirror copy of a pair.
- **3D Forge opens on its mark instead of a dark view.** The first time a new
  build opens the Forge, its 3D view can take a second to start, and the
  view stayed dark for all of it; the mark then appeared at once, because
  its fade ran out while its picture was still loading. The mark now shows
  and fades in straight away, and the 3D mark takes over when its picture
  is ready, using the image already loaded.
- **The Agent Swarm's topology and aggregation menus mean something.** They
  listed values nothing else used, so both went blank as soon as a starter
  template was loaded, and an aggregation picked from the menu was one the
  run did not recognise, so it quietly used synthesis. Both menus now list
  the values the templates, the God Agent and the run use, and a blueprint
  saved with an older value still shows it.
- **HashCoder's answers read top to bottom again.** The rule meant to put a small
  marker beside the reply also applied to the whole answer, so the steps of
  a run and the reply sat side by side in one squeezed row, and a reply with
  several paragraphs or a list did the same. Steps now stack, and the reply
  flows with its marker in the margin.
- **A file the agent saves is replaced whole or not at all.** The new
  contents are written beside the old file and swapped in one step, keeping
  its permissions, so a crash or a full disk mid-save leaves the old file
  intact instead of half-written.
- **Undo asks before it overwrites edits made since.** Undoing an agent's
  change put the old file back even when the file had been edited after
  that change, wiping those edits without a word. Undo now notices and asks
  first; a no leaves the file as it is.
- **Rewriting a whole Windows file keeps its line endings.** write_file over
  a file that used CRLF on every line saved the new text with LF, changing
  every line. It now keeps CRLF and tells the agent so; text that already
  carries CR, and a file that mixed the two, are saved as written.
- **Stop ends the commands a HashCoder run started.** Pressing Stop left a
  running command going until it finished or reached its five-minute limit,
  and the run waited on it. Stop now ends each command of that run, and ending
  a command, by Stop or its time limit, ends what it started too. Commands you
  type in the terminal are not touched.
- **The message after a stopped HashCoder run works.** A run stopped or ended by
  an error between a tool call and its result left a conversation the
  providers refuse, so the next message failed. The unfinished turn is now
  closed, and what already ran is kept.
- **HashCoder's Keep and Undo rows match what happened.** A write the agent was
  refused or that failed still got a row, which picked up the file's
  previous change, so its Undo reversed that earlier change. A move now gets
  its two rows, and the new end of a move is not offered as undoable when the
  file it came from cannot be restored, since undoing it would delete the
  only copy.
- **The agent's edits leave the rest of a file alone.** patch_file wrote back
  the copy read_file shows, which stops at 100,000 characters, so editing a
  longer file cut it short; it inserted `$$`, `$&` and similar as
  instructions rather than text; and on a file with Windows line endings it
  rewrote every line ending. It now edits the file's real contents, inserts
  text exactly as written and keeps line endings, and it refuses a binary
  file or one that is not UTF-8 rather than damage it.
- **A quotation in a reply is shown as one**, in chat, HashCoder and the Agent
  Swarm. Every line starting with > was shown as plain text.
- **Deleting asks first again.** Deleting a saved HashCoder chat, a Finance
  session or a 3D Forge project, and revoking HashCoder's session permissions,
  used the page's own confirm(). In the desktop app that answers yes before
  anyone can reply and shows no question, so each went ahead at once. Renaming
  a HashCoder chat used prompt(), which on macOS returns nothing, so it never
  renamed. All of them now ask in the app's own dialog and wait for the
  answer, and a check fails if a page dialog is used again.
- **Every Finance chart has an element of its own.** A chart the model gave
  no id, or an id another chart already had, shared an element with it, so
  its PNG button and its picture in the PDF showed the other chart. Such a
  chart is now numbered, and a saved report keeps the ids it was given.
- **Finance's exports save a file.** Its PDF, JSON, CSV and chart-image
  buttons saved through a download link, which the desktop app refuses, so
  nothing was written. They now open the save dialog like every other export,
  and a save that fails says so on Finance's status line and in its trace. A
  check now fails if any code saves through a download link again.
- **The agents' calculate tool works in the released app.** It reads the
  arithmetic with the app's own expression reader instead of running it.
- **A link in a reply opens in your browser.** It did nothing inside the app.
- **The window stays responsive while a slow task runs.** Shell commands,
  page reads, project searches, exports and loading the embedding model run
  off the window's main thread.
- **A Moonshot platform key no longer starts every request with two
  failures.** Two of the four hosts the app tried first have no API at all, so
  each request failed twice before reaching a real one. They are gone from the
  list and from the page's connect-src.
- **The app's own description says what it does.** It claimed more privacy
  than the app has: it said nothing leaves the machine and that keys are in
  the Keychain. It now says requests go to the service you chose, as
  docs/SECURITY.md does. The README's network and offline answers are
  corrected the same way.
- **The knowledge base's privacy statement is exact.** It said what you index
  never crosses a network boundary. Indexing and searching do stay on your
  computer, but the passages a search finds go into the request to the model
  you are using, so with a cloud model they reach its provider. The README and
  docs/SECURITY.md now say so.

### Removed

- **HashCoder's "Agents working at once" setting.** Splitting a task
  between agents that write at the same time had them make conflicting
  choices about the same code. It is gone, and a second look at larger
  changes takes its place.

- **Five packages the app never loads.** The project's package list named
  the file, shell, store, notification and dialog plugins' JavaScript
  packages, which the app does not use: it reaches the dialogs through the
  desktop side directly and has no build step that could load them. They
  were installed for everyone who set the project up, and are gone.
- **Code nothing called.** Ten functions across chat, HashCoder, Finance, the ERP
  and the Virtual OS that no part of the app reached, and the drag path the
  Virtual OS desktop icons stopped using when they moved to a pointer drag.
  Nothing a person can do changes.
- **Styling for things the app no longer has.** 191 CSS rules and 49
  selectors that matched nothing — an old system-stats bar, a startup meter,
  a project row and similar leftovers — are gone. The computed style of every
  element in every workspace is unchanged.
- **Virtual OS's Agent OS loop.** It ran only behind a switch that nothing in
  the app ever turned on, so it could not be reached. Virtual OS's chat agent
  keeps the same tools and is unchanged.

## [2.6.0] — 2026-09-01

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

- **HashCortx runs on Windows, and there is a Windows download.** It had always
  compiled and passed its tests there, but nobody had launched it — the README
  said so. It has now been built and run on a Windows 10 machine. The release
  carries the installer from that build, so Windows no longer means building
  from source first. That installer is the one made without local embeddings,
  which is what runs on a processor of any age: it searches the knowledge base
  by keyword rather than by meaning, and says so rather than quietly returning
  weaker results. Building with the default features gives the full app on a
  processor with AVX2, and the README says how.

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
- **A model can be hollowed out.** Fusing a model can leave a wall of a stated
  thickness and take out the middle — a real wall the geometry has, rather than
  the lattice a slicer fills a solid part with. The object stays exactly the
  size it was; the wall goes inwards. The report says a hollow part is one solid
  with a space inside it, where it used to call it two separate pieces and warn
  it would come off the bed in two.
- **The app says which of your models can do geometry, before you run.**
  Designing a part is not chatting, and plenty of models that write well hand
  back a pile of disconnected boxes. The Agents panel now says how many of your
  models should manage it, which is the best of them, and why — and says plainly
  that it is judging from the model's name rather than from trying it.
- **A run that stops looks stopped.** A failed run used to leave three stages lit
  in the working colour, one reading "failed" and two reading "blocked" — honest
  words, misleading picture. The stage that failed now looks failed, the ones
  after it read "not started", and the run says whether what is on screen is the
  new object or the one that was already there.
- **A generated model remembers what it was asked for**, which model answered,
  and under what settings — kept with the model, so it survives closing and
  reopening the project. It does not offer to make the thing again, because a
  language model asked the same question twice does not answer the same way.
- **Reordering a part is instant.** It used to rebuild every part in the model,
  which took about two seconds on a model of two dozen and threw away what you
  had selected.
- **A part you exported can be opened again.** Forge writes STL, OBJ, 3MF and
  STEP and could open only a scene file, so exporting a part and wanting it back
  was a dead end. All four now open. A file's numbers are millimetres while the
  scene works at its own scale, so the part is brought to that scale with its
  real size remembered beside it — it comes back the size it went out. It is
  centred as it arrives, and it sets the model's size only when it is the whole
  model, so adding a part to an existing design does not restate that design's
  size.
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

- **The app can be built to start on a processor without AVX2.** The prebuilt
  ONNX Runtime that runs the embedding model is compiled for x86-64 processors
  with AVX2 and BMI2, and it is linked statically, so its start-up code runs
  before `main()`. On anything older than Intel Haswell or AMD Excavator the
  process was killed while it was still loading: no window, no message, a
  double-click that appeared to do nothing. Leaving the feature unused in the
  interface could not have avoided it, because nothing of ours had run yet.
  Local embeddings are now a Cargo feature, on by default and unchanged for
  everyone whose machine can run them; `--no-default-features` builds an app
  that starts on any x86-64 machine, ranks the knowledge base by keyword, and
  reports `embed_available` as false so the interface can say so instead of
  quietly returning weaker results. The processor requirement, and the failure
  it causes when it is not met, are now written in the README.

- **When a model fails, the app no longer falls back to a worse one than it
  should.** Candidates were ranked by name, and the family name was read before
  the variant — so `gpt-4o-mini` was ranked alongside `gpt-4o`, and
  `gemini-2.5-flash-lite` alongside `gemini-2.5-flash`. A failover would reach
  for the small, cheap version ahead of a genuinely large model, and the answer
  came back worse for no visible reason. Newer models such as GPT-5 were also
  unrecognised and tried last. The model you picked yourself is still always
  tried first.
- **Attaching a lot of files no longer sends far more than intended.** Each
  attachment gets a share of a character allowance, with a minimum so a share
  never becomes too small to be useful — but past about fifteen files that
  minimum won and the total went well beyond the allowance, six times over at a
  hundred files. That is a refused request on some models and a larger bill on
  all of them. Fewer files are sent now instead of a bigger message, and the
  ones left out are named so the model can tell you if the answer depended on
  them.
- **Money written the way an accountant writes it is read correctly.** In
  Finance, a debit in brackets — `(500)`, which is how every ledger and bank
  export writes one — was read as *positive* five hundred, so money going out
  could be counted as money coming in. Figures written `1.234,56` rather than
  `1,234.56` were also read a thousand times too small. Both are read properly
  now.
- **A file path written with a double slash no longer grows an extra folder.**
  In the Virtual OS, a path like `src//main.js` — which is what you get when two
  pieces of a path are joined together — created a folder called "untitled"
  between the two halves, and a path of nothing but slashes became a file called
  that.
- **A generated business system no longer arrives missing fields it needs.** The
  records the app falls back on when a model is unavailable — staff, products, a
  restaurant table, a hotel room, an appointment, a patient, a housekeeping job
  — were missing either a date or an amount, which are the two things the app
  itself insists every record has. Each now carries the one it was missing: a
  start date on an employee, a seating time on a table, a fee on an appointment,
  a balance on a patient.
- **A software or startup system is named as one.** Describing a SaaS business
  was recognised, and then furnished as a nameless generic business, because
  that industry had a finance profile but no configuration. It now has its own
  modules and its own name.
- **Dates in a generated business system are no longer a day early.** If your
  computer's clock is set east of Greenwich — Cairo, Athens, Dubai, Delhi,
  Tokyo — every due date, invoice date and delivery date the ERP mode produced
  came out one day earlier than it should have. It was correct in London and
  wrong almost everywhere else, and it looked deliberate rather than broken.

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
