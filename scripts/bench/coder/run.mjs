// ==============================================================
// The HashCoder benchmark: how well the coding agent does real work
//
//     node scripts/bench/coder/run.mjs --model qwen2.5-coder:7b
//     node scripts/bench/coder/run.mjs --model qwen2.5-coder:3b --task js-fix-range
//     node scripts/bench/coder/run.mjs --model qwen2.5-coder:7b --compare <earlier results.json>
//     node scripts/bench/coder/run.mjs --model qwen2.5-coder:7b --src <another copy of src/>
//     node scripts/bench/coder/run.mjs --self-test
//     node scripts/bench/coder/run.mjs --smoke
//
// NOT part of `npm run check`. It needs macOS, a real browser and a local
// model, and a full run takes the better part of an hour.
//
// WHY IT EXISTS. Every change to how the agent reads, edits, plans or checks
// its work is a guess until it is measured. This gives each change a number:
// how many of a fixed set of tasks the agent finishes correctly, and what it
// cost in minutes, steps, failed edits and tokens. A change to the agent ships
// when that number rises, or holds while the cost falls.
//
// WHAT RUNS. The real app: src/ is served over HTTP and opened in headless
// Chrome, the HashCoder panel is opened, a task is typed into it and Run is
// pressed. The model, the agent loop, the tools and the permission guard are
// the ones people use. Only the native side is replaced, by the stand-in
// below, and a permission question is answered the way a careful person
// would: commands and changes inside the project are allowed once, anything
// outside it and any web address is refused.
//
// THE TASKS live in tasks/<id>/: task.json (what the agent is asked, and how
// the result is judged), project/ (the files the agent is given), check/ (a
// hidden check the agent never sees, run on a copy of what it left) and
// solution/ (a reference answer, used only by --self-test). A task passes
// when its hidden check passes, it left alone every file it was told to, a
// question task changed nothing, and its answer names what it had to.
//
// NOTHING OUTSIDE ITS OWN FOLDER CAN BE TOUCHED. Everything a run creates is
// in one new temporary folder. Three walls keep it there:
//   · The stand-in for the native side answers file requests only for paths
//     that resolve, links followed, inside the task's project, and refuses
//     every native request it does not know.
//   · Every command, the agent's and the hidden checks', runs under macOS's
//     sandbox with a profile that allows writing only inside that folder,
//     reading nothing in the home folder or on other disks, and no network.
//     Commands run with a home folder and temporary folder of their own, and
//     none of this machine's environment settings beyond PATH.
//   · The browser reaches nothing but this server and the local model: every
//     other address goes to a proxy that does not exist.
// A command given no working folder runs in the task's project, as an
// agent's command does in the app.
//
// The folder is under /tmp unless --work names another. macOS's own temporary
// folder resolves under /private/var, where the app refuses to read or write
// anything, as it should, so a run there could not touch its own project.
//
// GENTLE ON THE MACHINE IT RUNS ON. A run keeps a local model and a browser
// busy, so it stops starting tasks once --budget minutes have gone (20 unless
// given; the tasks left are reported as not run) and rests --rest seconds
// between tasks (15 unless given). A model several gigabytes large on a
// machine without much more memory than that works it hard: use a small one.
//
// ENDING WHAT IT STARTS. Each task gets its own browser, started in its own
// process group and ended, with anything it started, before the task is
// judged, and on every way out of this process. Commands still running when a
// task ends are ended too. Local models are unloaded at the end. The
// temporary folder is removed unless --keep is given. Results are written to
// node_modules/.coder-bench/, which git ignores.
//
// --src serves another copy of the app's source instead of src/, so a run can
// measure a fixed version while the working copy changes.
//
// --smoke runs one task with a scripted stand-in for a model
// (scripted-model.mjs), whose answers are fixed, and checks the app's side of
// it: the agent is sent back to make a change it wrote into its reply, the
// edit lands, it is sent back to prove its change, and the person is told
// what was proven. It needs no real model and takes seconds.
// ==============================================================
import { createServer } from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { startScriptedModel, SCRIPTED_MODEL } from './scripted-model.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.join(here, '..', '..', '..');
const tasksDir = path.join(here, 'tasks');
const resultsDir = path.join(repo, 'node_modules', '.coder-bench');
const PREFIX = 'hashcortx-coder-bench-';

// ── Options ─────────────────────────────────────────────────────
const opt = { models: [], tasks: [], keep: false, selfTest: false, smoke: false, minutes: 10, budget: 20, rest: 15, work: null, out: null, compare: null, quiet: false, src: null, ollama: null };
{
  const argv = process.argv.slice(2);
  const next = (i) => {
    if (i + 1 >= argv.length) usage(`${argv[i]} needs a value`);
    return argv[i + 1];
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--model') opt.models.push(next(i++));
    else if (a === '--task') opt.tasks.push(next(i++));
    else if (a === '--minutes') opt.minutes = Number(next(i++));
    else if (a === '--budget') opt.budget = Number(next(i++));
    else if (a === '--rest') opt.rest = Number(next(i++));
    else if (a === '--work') opt.work = next(i++);
    else if (a === '--out') opt.out = next(i++);
    else if (a === '--compare') opt.compare = next(i++);
    else if (a === '--src') opt.src = next(i++);
    else if (a === '--ollama') opt.ollama = next(i++);
    else if (a === '--keep') opt.keep = true;
    else if (a === '--quiet') opt.quiet = true;
    else if (a === '--self-test') opt.selfTest = true;
    else if (a === '--smoke') opt.smoke = true;
    else usage(`unknown option ${a}`);
  }
  if (opt.smoke) { opt.models = [SCRIPTED_MODEL]; opt.tasks = ['js-fix-range']; opt.minutes = 3; opt.quiet = true; }
  if (!opt.selfTest && !opt.models.length) usage('name a model with --model');
  if (!(opt.minutes > 0)) usage('--minutes must be a positive number');
  if (!(opt.budget > 0)) usage('--budget must be a positive number of minutes');
  if (!(opt.rest >= 0)) usage('--rest must be zero or more seconds');
  for (const m of opt.models) {
    if (/^cloud:/.test(m)) usage('cloud models are not supported yet: the benchmark runs local models only');
  }
}

function usage(why) {
  console.log(`${why}\n\n` +
    'node scripts/bench/coder/run.mjs --model <local model> [--model ...] [--task <id> ...]\n' +
    '                                 [--minutes <per task>] [--budget <minutes in all>] [--rest <seconds between tasks>]\n' +
    '                                 [--compare <results.json>] [--src <folder>] [--ollama <local url>]\n' +
    '                                 [--keep] [--work <folder>]\n' +
    'node scripts/bench/coder/run.mjs --self-test\n' +
    'node scripts/bench/coder/run.mjs --smoke');
  process.exit(2);
}

const srcDir = opt.src ? path.resolve(opt.src) : path.join(repo, 'src');
// The local model server, on this computer only: the browser reaches nothing else.
let OLLAMA = (opt.ollama || 'http://127.0.0.1:11434').replace(/\/+$/, '');
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(OLLAMA)) usage('--ollama must be a server on this computer, such as http://127.0.0.1:11434');
if (!fs.existsSync(path.join(srcDir, 'index.html'))) usage(`no app source at ${srcDir}`);

if (process.platform !== 'darwin' || !fs.existsSync('/usr/bin/sandbox-exec')) {
  console.log('The benchmark runs every command inside the macOS sandbox, so it needs macOS. Nothing was run.');
  process.exit(2);
}

// ── The tasks ───────────────────────────────────────────────────
const allTasks = fs.readdirSync(tasksDir, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => ({ id: e.name, dir: path.join(tasksDir, e.name), ...JSON.parse(fs.readFileSync(path.join(tasksDir, e.name, 'task.json'), 'utf8')) }))
  .sort((a, b) => a.id.localeCompare(b.id));
const tasks = opt.tasks.length ? allTasks.filter((t) => opt.tasks.includes(t.id)) : allTasks;
if (opt.tasks.length && tasks.length !== opt.tasks.length) {
  usage(`no task named ${opt.tasks.filter((id) => !allTasks.some((t) => t.id === id)).join(', ')}`);
}

// ── The run's own folder, and the sandbox around every command ──
const base = opt.work ? path.resolve(opt.work) : process.platform === 'darwin' ? '/tmp' : os.tmpdir();
fs.mkdirSync(base, { recursive: true });
const ROOT = fs.realpathSync(fs.mkdtempSync(path.join(base, PREFIX)));
if (/^\/private\/(var|etc)(\/|$)/i.test(ROOT)) {
  console.log(`The app refuses to read or write anything under ${ROOT.split('/').slice(0, 3).join('/')}, so a run there could not touch its project. Name another folder with --work.`);
  fs.rmSync(ROOT, { recursive: true, force: true });
  process.exit(2);
}
if (/["\\\n]/.test(ROOT)) {
  console.log(`The temporary folder's path has a character the sandbox profile cannot hold: ${ROOT}`);
  process.exit(2);
}
const HOME = path.join(ROOT, 'home');
const TMP = path.join(ROOT, 'tmp');
const APP_CWD = path.join(ROOT, 'app');
for (const d of [HOME, TMP, APP_CWD]) fs.mkdirSync(d, { recursive: true });

const PROFILE = path.join(ROOT, 'sandbox.sb');
fs.writeFileSync(PROFILE, [
  '(version 1)',
  '(allow default)',
  '(deny network*)',
  '(deny file-write* (subpath "/"))',
  `(allow file-write* (subpath "${ROOT}") (literal "/dev/null") (literal "/dev/zero") (literal "/dev/tty") (literal "/dev/dtracehelper") (regex #"^/dev/fd/"))`,
  `(deny file-read* (subpath "/Users") (subpath "/Volumes") (subpath "${os.homedir()}"))`,
  `(allow file-read* (subpath "${ROOT}"))`,
  '',
].join('\n'));

// Nothing from this machine's environment but where programs are.
const ENV = { PATH: process.env.PATH || '/usr/bin:/bin', HOME, TMPDIR: TMP + '/', LANG: 'en_US.UTF-8', NO_UPDATE_NOTIFIER: '1', npm_config_update_notifier: 'false', PYTHONDONTWRITEBYTECODE: '1' };

const STREAM_CAP = 512 * 1024;
const running = new Set();

function endGroup(child) {
  try { process.kill(-child.pid, 'SIGKILL'); } catch { try { child.kill('SIGKILL'); } catch {} }
}

/** Run one command inside the sandbox. Answers the way the app's shell_run does. */
function sandboxed(command, args, { cwd, timeoutMs = 300_000, key = null } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('/usr/bin/sandbox-exec', ['-f', PROFILE, String(command), ...args.map(String)], {
      cwd, env: ENV, detached: true, stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.key = key;
    running.add(child);
    const out = { stdout: '', stderr: '', truncated: false };
    const take = (name) => (chunk) => {
      if (out[name].length >= STREAM_CAP) { out.truncated = true; return; }
      out[name] += chunk.toString('utf8');
      if (out[name].length > STREAM_CAP) { out[name] = out[name].slice(0, STREAM_CAP); out.truncated = true; }
    };
    child.stdout.on('data', take('stdout'));
    child.stderr.on('data', take('stderr'));
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; endGroup(child); }, timeoutMs);
    child.on('error', (e) => { clearTimeout(timer); running.delete(child); reject(`Failed to start ${command}: ${e.message}`); });
    child.on('close', (code) => {
      clearTimeout(timer);
      running.delete(child);
      // The sandbox tool reports a program it could not start as its own
      // failure; the app reports it as the command failing to start.
      if (code === 71 && /execvp\(\) of '.*' failed/.test(out.stderr)) {
        reject(`Failed to run ${command}: No such file or directory (os error 2)`);
        return;
      }
      resolve({ stdout: out.stdout, stderr: out.stderr, code: code ?? -1, timedOut, truncated: out.truncated, stopped: !!child.stopped });
    });
  });
}

function endCommands(key = null) {
  for (const child of running) {
    if (key && child.key !== key) continue;
    child.stopped = true;
    endGroup(child);
  }
}

// ── The native side, answered inside the task's project only ───
let current = null;   // the task being run: { ws, usage, audit, checkpoints }

/** A path, links followed as far as they exist, the way the app's guard resolves one. */
function resolved(p) {
  let cursor = p;
  const tail = [];
  for (;;) {
    try { return path.join(fs.realpathSync(cursor), ...tail.reverse()); }
    catch {
      const parent = path.dirname(cursor);
      if (parent === cursor) return p;
      tail.push(path.basename(cursor));
      cursor = parent;
    }
  }
}

function within(p, root) {
  const r = resolved(root);
  const x = resolved(p);
  return x === r || x.startsWith(r + path.sep);
}

/** The path, if it names somewhere inside the task's project; refused otherwise. */
function inProject(p) {
  const raw = String(p ?? '');
  if (!raw) throw 'A path is required.';
  if (raw.split(/[\\/]/).includes('..')) throw `Path traversal sequences (..) are not allowed: ${raw}`;
  const abs = path.isAbsolute(raw) ? raw : path.join(APP_CWD, raw);
  if (!current || !within(abs, current.ws)) throw `Outside the open project, so refused: ${raw}`;
  return abs;
}

const BINARY_EXTS = new Set('png jpg jpeg gif webp ico bmp tiff avif heic pdf doc docx xls xlsx ppt pptx odt ods zip tar gz bz2 xz 7z rar dmg pkg iso deb rpm exe dll so dylib bin class pyc wasm o a mp3 mp4 avi mov mkv wav flac aac ogg opus m4a m4v ttf otf woff woff2 eot db sqlite sqlite3'.split(' '));
const TEXT_EXTS = new Set('js ts jsx tsx rs py go java c cpp h hpp css scss sass html json toml yaml yml md txt sh bash zsh env gitignore lock vue svelte rb php'.split(' '));
const skipDir = (name) => name.startsWith('.') || name === 'node_modules' || name === 'target';

function walk(dir, depth, visit) {
  if (depth > 8) return;
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (skipDir(e.name.toLowerCase())) continue;
    if (!within(p, current.ws)) continue;   // a link leading out is not followed
    if (visit(p, e) === false) return;
    if (e.isDirectory()) walk(p, depth + 1, visit);
  }
}

function levenshtein(a, b) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return dp[a.length][b.length];
}

function fuzzyScore(q, name, stem) {
  if (name === q) return 0;
  if (name.startsWith(q)) return 1;
  if (name.includes(q)) return 2;
  let k = 0;
  for (const ch of name) if (ch === q[k]) k++;
  if (k >= q.length) return 3;
  const d = Math.min(levenshtein(q, stem), levenshtein(q, name));
  return d <= 1 ? 10 : d <= 2 ? 20 : d <= 3 ? 30 : 999;
}

function readFileAsTheAppDoes(p) {
  const name = path.basename(p);
  const ext = path.extname(p).slice(1).toLowerCase();
  const size = fs.statSync(p).size;
  if (BINARY_EXTS.has(ext)) return `[Binary file: "${name}" · ${ext} · ${Math.ceil(size / 1024)}KB] Not text-readable. Use shell_run to inspect: \`file "${p}"\`.`;
  if (size > 8_000_000) return `[File too large: ${name} is ${Math.floor(size / 1e6)}MB. Use shell_run with \`grep -n "pattern" "${p}"\`, \`head -200 "${p}"\`, or \`wc -l "${p}"\` to work with it in sections.]`;
  const raw = fs.readFileSync(p);
  const nulls = raw.reduce((n, b) => n + (b === 0 ? 1 : 0), 0);
  if (raw.length > 512 && nulls > raw.length / 50) return `[Binary file: "${name}" · ${Math.ceil(size / 1024)}KB — contains non-text data (detected ${nulls} null bytes).]`;
  const content = raw.toString('utf8');
  if (content.length > 100_000) {
    const shown = content.slice(0, 100_000);
    return `${shown}\n\n[TRUNCATED — showing first ${shown.split('\n').length} of ~${content.split('\n').length} lines ` +
      `(97KB shown of ${Math.ceil(size / 1024)}KB total). Use grep_code to search for specific symbols, or shell_run with ` +
      `\`grep -n "pattern" "${p}"\` to jump to specific lines.]`;
  }
  return content;
}

const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

const NATIVE = {
  shell_platform: () => ({ os: 'macos', shell: 'sh', separator: '/', homeProbe: 'echo $HOME' }),
  'plugin:dialog|open': () => current.ws,
  fs_set_root: ({ path: p }) => inProject(p),
  fs_clear_root: () => null,
  fs_grant_path: ({ path: p }) => { inProject(p); return null; },
  fs_path_inside_root: ({ root, path: p }) => !!root && !!p && within(p, root) && within(p, current.ws),
  fs_read_file: ({ path: p }) => readFileAsTheAppDoes(inProject(p)),
  fs_read_base64: ({ path: p, maxBytes }) => {
    const abs = inProject(p);
    if (fs.statSync(abs).isDirectory()) throw `"${p}" is a directory, not a file.`;
    const cap = Math.min(maxBytes || 12_000_000, 25_000_000);
    if (fs.statSync(abs).size > cap) throw `"${p}" is over the limit for reading a file whole.`;
    const raw = fs.readFileSync(abs);
    return { base64: raw.toString('base64'), bytes: raw.length };
  },
  fs_write_file: ({ path: p, content }) => {
    const abs = inProject(p);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, String(content));
    return null;
  },
  fs_list_dir: ({ path: p }) => {
    const abs = inProject(p);
    return fs.readdirSync(abs, { withFileTypes: true }).map((e) => {
      const full = path.join(abs, e.name);
      const dir = e.isDirectory();
      return { name: e.name, path: full, is_dir: dir, size: dir ? 0 : fs.statSync(full).size };
    }).sort((a, b) => (b.is_dir - a.is_dir) || a.name.localeCompare(b.name));
  },
  fs_delete_file: ({ path: p }) => {
    const abs = inProject(p);
    if (fs.statSync(abs).isDirectory()) throw `Cannot delete a directory with fs_delete_file: ${p}`;
    fs.rmSync(abs);
    return null;
  },
  fs_move_file: ({ from, to }) => {
    const a = inProject(from);
    const b = inProject(to);
    if (!fs.existsSync(a)) throw `There is nothing at "${from}" to move.`;
    if (fs.statSync(a).isDirectory()) throw `"${from}" is a directory. This moves one file at a time.`;
    if (fs.existsSync(b)) throw `"${to}" already exists. Delete it first if replacing it is what you meant.`;
    fs.mkdirSync(path.dirname(b), { recursive: true });
    fs.renameSync(a, b);
    return null;
  },
  fs_search_files: ({ dir, pattern }) => {
    const q = String(pattern || '').toLowerCase();
    const out = [];
    walk(inProject(dir), 0, (p) => { if (path.basename(p).toLowerCase().includes(q)) out.push(p); return out.length < 200; });
    return out;
  },
  fs_fuzzy_find: ({ dir, query }) => {
    const q = String(query || '').toLowerCase();
    const out = [];
    walk(inProject(dir), 0, (p, e) => {
      if (e.isDirectory()) return true;
      const name = path.basename(p).toLowerCase();
      const score = fuzzyScore(q, name, path.parse(name).name);
      if (score < 999) out.push({ path: p, name, score });
      return out.length < 100;
    });
    return out.sort((a, b) => a.score - b.score).slice(0, 15);
  },
  fs_grep: ({ dir, pattern, fileExt }) => {
    const q = String(pattern || '').toLowerCase();
    const want = fileExt ? String(fileExt).toLowerCase() : null;
    const out = [];
    walk(inProject(dir), 0, (p, e) => {
      if (e.isDirectory()) return true;
      const ext = path.extname(p).slice(1).toLowerCase();
      if (want ? ext !== want : !TEXT_EXTS.has(ext)) return true;
      let lines;
      try { lines = fs.readFileSync(p, 'utf8').split(/\r?\n/); } catch { return true; }
      if (lines.length && lines[lines.length - 1] === '') lines.pop();
      lines.forEach((line, i) => {
        if (out.length >= 300 || !line.toLowerCase().includes(q)) return;
        const from = Math.max(0, i - 2);
        const context = lines.slice(from, Math.min(lines.length, i + 3))
          .map((l, j) => `${String(from + j + 1).padStart(4)} ${from + j === i ? '▶ ' : '  '}${l}`).join('\n');
        out.push({ path: p, line_no: i + 1, line, context });
      });
      return out.length < 300;
    });
    return out;
  },
  checkpoint_save: ({ path: p }) => {
    const abs = inProject(p);
    const id = crypto.randomUUID();
    const record = { id, path: p, abs, content: null, existed: fs.existsSync(abs), unrestorable: null, saved_at: new Date().toISOString(), after: null };
    if (record.existed) {
      const raw = fs.readFileSync(abs);
      try { record.content = new TextDecoder('utf-8', { fatal: true }).decode(raw); }
      catch { record.unrestorable = 'it is not UTF-8 text'; }
    }
    current.checkpoints.set(id, record);
    return record;
  },
  checkpoint_seal: ({ id }) => {
    const r = current.checkpoints.get(id);
    if (r) r.sealed = fs.existsSync(r.abs) ? sha(fs.readFileSync(r.abs)) : null;
    return null;
  },
  checkpoint_changed: ({ id }) => {
    const r = current.checkpoints.get(id);
    if (!r || r.sealed === undefined) return null;
    return (fs.existsSync(r.abs) ? sha(fs.readFileSync(r.abs)) : null) !== r.sealed;
  },
  checkpoint_read: ({ id }) => {
    const r = current.checkpoints.get(id);
    if (!r) throw 'No such checkpoint.';
    return r;
  },
  checkpoint_list: () => [...current.checkpoints.values()].map((r) => ({ id: r.id, path: r.path, existed: r.existed, unrestorable: r.unrestorable, saved_at: r.saved_at, bytes: (r.content || '').length })),
  checkpoint_drop: ({ id }) => { current.checkpoints.delete(id); return null; },
  shell_run: async ({ command, args, cwd, cancelKey }) => {
    const dir = cwd ? inProject(cwd) : current ? current.ws : APP_CWD;
    return sandboxed(command, Array.isArray(args) ? args : [], { cwd: dir, key: cancelKey || null });
  },
  shell_cancel: ({ cancelKey }) => { if (cancelKey) endCommands(cancelKey); return null; },
  usage_log_append: ({ record }) => { current.usage.push(record); return null; },
  audit_log_append: (args) => { current.audit.push(args); return null; },
  embed_available: () => false,
};

async function answerNative(cmd, args) {
  const fn = NATIVE[cmd];
  if (!fn) throw `Not available in the benchmark: ${cmd}`;
  if (!current) throw 'No task is running.';
  return fn(args || {});
}

// ── The page: the real app, with a stand-in for its native side ──
const shim = () => `<script>
try { if (!localStorage.getItem('atelier')) localStorage.setItem('atelier', JSON.stringify({ host: ${JSON.stringify(OLLAMA)} })); } catch {}
window.__TAURI_INTERNALS__ = {
  invoke: async (cmd, args) => {
    const res = await fetch('/__bench/invoke', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cmd, args: args || {} }) });
    const out = await res.json();
    if (!out.ok) throw out.error;
    return out.value;
  },
};
</script>`;

// Drives one task in the page: opens the panel, picks the model and the
// project, types the task, answers permission questions, and reports back.
const DRIVER = `<script>
(function () {
  let shellReady = false;
  document.addEventListener('hashcortx:shell-ready', () => { shellReady = true; });
  const post = (url, body) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const say = (msg) => post('/__bench/event', { msg: String(msg) }).catch(() => {});
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  async function until(test, ms, what) {
    const end = Date.now() + ms;
    for (;;) {
      try { const v = test(); if (v) return v; } catch {}
      if (Date.now() > end) throw new Error('timed out waiting for ' + what);
      await wait(200);
    }
  }
  const $ = (id) => document.getElementById(id);
  const shown = (el) => !!el && el.style.display !== 'none' && el.offsetParent !== null;
  const result = { asks: [], pageErrors: [] };
  window.addEventListener('error', (e) => result.pageErrors.push(String(e.message).slice(0, 300)));

  function answerPermission(job) {
    const bar = $('hc-perm-bar');
    if (!bar || !bar.classList.contains('open') || bar.classList.contains('working')) return;
    const action = String(bar.dataset.action || $('hc-perm-action')?.textContent || '').toLowerCase();
    const target = String($('hc-perm-target')?.title || '');
    const inside = target === job.ws || target.startsWith(job.ws + '/');
    const answer = action === 'shell' || (action !== 'fetch' && inside) ? 'allow' : 'deny';
    result.asks.push({ action, target: target.slice(0, 300), answer });
    $(answer === 'allow' ? 'hc-perm-once' : 'hc-perm-deny')?.click();
  }

  (async () => {
    const job = await (await fetch('/__bench/job')).json();
    let answering = null;
    try {
      await until(() => shellReady || window.CoderMode, 90000, 'the app to start');
      document.getElementById('intro-screen')?.remove();
      const app = $('mainApp');
      if (app) { app.style.visibility = 'visible'; app.style.opacity = '1'; app.style.pointerEvents = 'auto'; }
      await until(() => [...document.querySelectorAll('#model option')].some((o) => o.value === job.model), 90000, 'the model list');
      const main = $('model');
      main.value = job.model;
      main.dispatchEvent(new Event('change', { bubbles: true }));
      // The tab answers once the app has finished starting; ask again until it does.
      for (let tries = 0; !shown($('cdrTaskInput')); tries++) {
        if (tries === 6) throw new Error('timed out waiting for the HashCoder panel');
        $('tabCode').click();
        try { await until(() => shown($('cdrTaskInput')), 10000, 'the HashCoder panel'); } catch {}
      }
      const picker = $('cdrModelPicker');
      if (picker && [...picker.options].some((o) => o.value === job.model)) {
        picker.value = job.model;
        picker.dispatchEvent(new Event('change', { bubbles: true }));
      }
      $('cdrLeftAddFolderBtn').click();
      await until(() => ($('cdrProjectSub')?.title || '') === job.ws, 30000, 'the project to open');
      answering = setInterval(() => answerPermission(job), 150);
      say('running');
      const input = $('cdrTaskInput');
      input.value = job.prompt;
      const t0 = performance.now();
      $('cdrRunBtn').click();
      await wait(1000);
      try {
        await until(() => !shown($('cdrStopBtn')) && shown($('cdrRunBtn')), job.minutes * 60000, 'the run to finish');
      } catch {
        result.timedOut = true;
        $('cdrStopBtn')?.click();
        await wait(3000);
      }
      result.seconds = Math.round((performance.now() - t0) / 100) / 10;
      const state = JSON.parse(localStorage.getItem('hashui_coder_state') || '{}');
      result.history = Array.isArray(state.chatHistory) ? state.chatHistory : [];
      const bubbles = [...document.querySelectorAll('#cdrMessages .cdr-msg.assistant')];
      result.lastBubble = bubbles.length ? String(bubbles[bubbles.length - 1].innerText || '').slice(-4000) : '';
    } catch (e) {
      result.failed = String((e && e.message) || e);
    } finally {
      if (answering) clearInterval(answering);
    }
    await post('/__bench/result', result);
  })();
})();
</script>`;

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2', '.wasm': 'application/wasm', '.whl': 'application/octet-stream',
};

let job = null;
let onResult = null;

function readBody(req) {
  return new Promise((resolve) => {
    const parts = [];
    req.on('data', (c) => parts.push(c));
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(parts).toString('utf8') || '{}')); } catch { resolve({}); } });
  });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const json = (value) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(value)); };
  if (url.pathname === '/__bench/job') return json(job || {});
  if (url.pathname === '/__bench/invoke') {
    const { cmd, args } = await readBody(req);
    try { return json({ ok: true, value: (await answerNative(cmd, args)) ?? null }); }
    catch (e) { return json({ ok: false, error: String(e?.message || e) }); }
  }
  if (url.pathname === '/__bench/event') {
    const { msg } = await readBody(req);
    if (!opt.quiet && msg !== 'running') console.log(`      ${msg}`);
    return json({ ok: true });
  }
  if (url.pathname === '/__bench/result') {
    const result = await readBody(req);
    json({ ok: true });
    onResult?.(result);
    return;
  }
  if (url.pathname === '/' || url.pathname === '/index.html') {
    res.setHeader('content-type', 'text/html');
    res.end(fs.readFileSync(path.join(srcDir, 'index.html'), 'utf8').replace('<head>', '<head>' + shim()).replace('</body>', DRIVER + '</body>'));
    return;
  }
  const file = path.join(srcDir, path.normalize(decodeURIComponent(url.pathname)));
  if (!file.startsWith(srcDir + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.statusCode = 404; res.end('not here'); return; }
  res.setHeader('content-type', MIME[path.extname(file)] || 'application/octet-stream');
  res.end(fs.readFileSync(file));
});

// ── The browser: one per task, ended on every way out ──────────
const CHROME = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
].find((p) => fs.existsSync(p));
let chrome = null;

function stopBrowser() {
  if (!chrome) return;
  endGroup(chrome);
  chrome = null;
}

process.on('exit', () => { stopBrowser(); endCommands(); });
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => { stopBrowser(); endCommands(); process.exit(130); });
}

function startBrowser(port, profile) {
  chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--disable-background-networking', '--disable-sync', '--mute-audio',
    `--user-data-dir=${profile}`,
    // Nothing but this server and the local model.
    '--proxy-server=127.0.0.1:9', '--proxy-bypass-list=127.0.0.1;localhost',
    `http://127.0.0.1:${port}/`,
  ], { detached: true, stdio: 'ignore' });
}

// ── Judging what the agent left ────────────────────────────────
const IGNORED = new Set(['.DS_Store', '__pycache__', 'node_modules', '.bench-check']);

function filesOf(dir, rel = '') {
  const out = new Map();
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (IGNORED.has(e.name) || e.name.endsWith('.pyc')) continue;
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) for (const [k, v] of filesOf(path.join(dir, e.name), r)) out.set(k, v);
    else out.set(r, sha(fs.readFileSync(path.join(dir, e.name))));
  }
  return out;
}

async function judge(task, ws, answer) {
  const notes = [];
  const fixture = path.join(task.dir, 'project');
  for (const rel of task.keep || []) {
    const was = path.join(fixture, rel);
    const now = path.join(ws, rel);
    if (!fs.existsSync(now) || sha(fs.readFileSync(was)) !== sha(fs.readFileSync(now))) notes.push(`changed ${rel}, which it was told to leave alone`);
  }
  if (task.unchanged) {
    const before = filesOf(fixture);
    const after = filesOf(ws);
    const differ = [...new Set([...before.keys(), ...after.keys()])].filter((k) => before.get(k) !== after.get(k));
    if (differ.length) notes.push(`changed files in a task that asked for none: ${differ.slice(0, 4).join(', ')}`);
  }
  for (const pattern of task.answer || []) {
    if (!new RegExp(pattern, 'i').test(answer || '')) notes.push(`the answer does not say /${pattern}/`);
  }
  if (task.check) {
    const dir = fs.mkdtempSync(path.join(ROOT, 'check-'));
    fs.cpSync(ws, dir, { recursive: true });
    fs.cpSync(path.join(task.dir, 'check'), path.join(dir, '.bench-check'), { recursive: true });
    let r;
    try { r = await sandboxed(task.check[0], task.check.slice(1), { cwd: dir, timeoutMs: 120_000 }); }
    catch (e) { r = { code: -1, stderr: String(e) }; }
    if (r.code !== 0) {
      // The assertion and what it compared, not the stack.
      const lines = (r.stderr || r.stdout || '').split('\n').map((l) => l.trim()).filter(Boolean)
        .filter((l) => !/^(at |node:|\^+$|throw |\}|\{$|code:|generatedMessage|operator|actual:|expected:|diff:)/.test(l));
      const at = lines.findIndex((l) => /Error/.test(l));
      const why = (at >= 0 ? lines.slice(at, at + 3) : lines.slice(-2)).join(' | ');
      notes.push(`hidden check failed${r.timedOut ? ' (timed out)' : ''}: ${why.slice(0, 240) || 'exit ' + r.code}`);
    }
  }
  return { pass: notes.length === 0, notes };
}

const EDIT_TOOLS = new Set(['patch_file', 'write_file', 'edit_file']);

/** Steps, tool calls and failures, read from the conversation the app saved. */
function measure(history) {
  const nameOf = new Map();
  const m = { steps: 0, calls: 0, failedCalls: 0, failedEdits: 0, looseEdits: 0, byTool: {} };
  for (const msg of history || []) {
    if (msg.role === 'assistant') {
      m.steps++;
      for (const c of msg.tool_calls || []) {
        const name = c.function?.name || c.name || '?';
        nameOf.set(c.id, name);
        m.calls++;
        m.byTool[name] = (m.byTool[name] || 0) + 1;
      }
    }
    if (msg.role === 'tool') {
      let failed = false;
      let loose = false;
      try { const r = JSON.parse(msg.content); failed = !!r?.error; loose = !!r?.matched; } catch {}
      // An edit that landed only once its passage was looked for loosely.
      if (loose && EDIT_TOOLS.has(msg.name || nameOf.get(msg.tool_call_id))) m.looseEdits++;
      if (failed) {
        m.failedCalls++;
        if (EDIT_TOOLS.has(msg.name || nameOf.get(msg.tool_call_id))) m.failedEdits++;
      }
    }
  }
  return m;
}

function finalAnswer(result) {
  const history = result.history || [];
  for (let i = history.length - 1; i >= 0; i--) {
    const msg = history[i];
    if (msg.role === 'user') break;
    if (msg.role === 'assistant' && !(msg.tool_calls || []).length && msg.content) return String(msg.content);
  }
  return result.lastBubble || '';
}

// ── Self-test: every check fails on the untouched project and passes on the reference ──
async function selfTest() {
  let wrong = 0;
  for (const task of tasks) {
    const untouched = fs.mkdtempSync(path.join(ROOT, 'self-'));
    fs.cpSync(path.join(task.dir, 'project'), untouched, { recursive: true });
    const solved = fs.mkdtempSync(path.join(ROOT, 'self-'));
    fs.cpSync(path.join(task.dir, 'project'), solved, { recursive: true });
    const answerFile = path.join(task.dir, 'solution', 'answer.txt');
    fs.cpSync(path.join(task.dir, 'solution'), solved, { recursive: true, filter: (p) => p !== answerFile });
    const answer = fs.existsSync(answerFile) ? fs.readFileSync(answerFile, 'utf8') : '';
    const before = await judge(task, untouched, '');
    const after = await judge(task, solved, answer);
    const ok = !before.pass && after.pass;
    if (!ok) wrong++;
    console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${task.id.padEnd(22)}${before.pass ? '  passes untouched' : ''}${after.pass ? '' : '  reference fails: ' + after.notes.join('; ')}`);
  }
  console.log(`\n${tasks.length - wrong} of ${tasks.length} tasks judge correctly`);
  return wrong ? 1 : 0;
}

// ── A run ───────────────────────────────────────────────────────
function gitState() {
  if (opt.src) return { commit: 'source at ' + srcDir, changedSource: false };
  const head = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: repo, encoding: 'utf8' }).stdout.trim();
  const dirty = spawnSync('git', ['status', '--porcelain', '--', 'src'], { cwd: repo, encoding: 'utf8' }).stdout.trim() !== '';
  return { commit: head || 'unknown', changedSource: dirty };
}

async function localModels() {
  try {
    const res = await fetch(`${OLLAMA}/api/tags`);
    return ((await res.json()).models || []).map((m) => m.name);
  } catch {
    return null;
  }
}

async function runTask(port, model, task, n) {
  const ws = path.join(ROOT, 'runs', `r${n}`, 'project');
  fs.mkdirSync(path.dirname(ws), { recursive: true });
  fs.cpSync(path.join(task.dir, 'project'), ws, { recursive: true });
  current = { ws: fs.realpathSync(ws), usage: [], audit: [], checkpoints: new Map() };
  job = { model, ws: current.ws, prompt: task.prompt, minutes: task.minutes || opt.minutes };
  const profile = path.join(ROOT, 'runs', `r${n}`, 'browser');
  const result = await new Promise((resolve) => {
    const limit = setTimeout(() => resolve({ failed: 'the page never reported back' }), (job.minutes * 60 + 180) * 1000);
    onResult = (r) => { clearTimeout(limit); resolve(r); };
    startBrowser(port, profile);
  });
  onResult = null;
  stopBrowser();
  endCommands();
  const answer = finalAnswer(result);
  const verdict = result.failed ? { pass: false, notes: [`the run did not complete: ${result.failed}`] } : await judge(task, current.ws, answer);
  const usage = current.usage.reduce((t, u) => ({ input: t.input + (Number(u.input_tokens) || 0), output: t.output + (Number(u.output_tokens) || 0) }), { input: 0, output: 0 });
  const record = {
    task: task.id, kind: task.kind, model, pass: verdict.pass, notes: verdict.notes, notRun: !!result.failed && result.seconds == null,
    seconds: result.seconds ?? null, timedOut: !!result.timedOut, tokens: usage,
    asks: result.asks || [], pageErrors: result.pageErrors || [], ...measure(result.history), answer: answer.slice(0, 1500),
    shown: String(result.lastBubble || '').slice(-1500),
  };
  current = null;
  job = null;
  return record;
}

const fmt = (n) => Number(n || 0).toLocaleString('en-US');

function printTable(model, rows) {
  console.log(`\nHashCoder benchmark · ${model}`);
  console.log('  task                    result  min    steps  tools  failed  edits failed  tokens in / out');
  for (const r of rows) {
    console.log(`  ${r.task.padEnd(24)}${(r.notRun ? 'not run' : r.pass ? 'pass' : 'FAIL').padEnd(8)}${String(r.seconds == null ? '-' : (r.seconds / 60).toFixed(1)).padEnd(7)}` +
      `${String(r.steps).padEnd(7)}${String(r.calls).padEnd(7)}${String(r.failedCalls).padEnd(8)}${String(r.failedEdits).padEnd(14)}${fmt(r.tokens.input)} / ${fmt(r.tokens.output)}`);
  }
  const passed = rows.filter((r) => r.pass).length;
  const notRun = rows.filter((r) => r.notRun).length;
  const minutes = rows.reduce((t, r) => t + (r.seconds || 0), 0) / 60;
  const tokIn = rows.reduce((t, r) => t + r.tokens.input, 0);
  const tokOut = rows.reduce((t, r) => t + r.tokens.output, 0);
  console.log(`  passed ${passed} of ${rows.length}${notRun ? ` (${notRun} did not run)` : ''} · ${minutes.toFixed(1)} min · ${fmt(tokIn)} tokens in, ${fmt(tokOut)} out · ` +
    `${rows.reduce((t, r) => t + r.failedEdits, 0)} failed edits`);
}

function printComparison(rows, earlierFile) {
  let earlier;
  try { earlier = JSON.parse(fs.readFileSync(earlierFile, 'utf8')); } catch (e) { console.log(`\nCould not read ${earlierFile} to compare: ${e.message}`); return; }
  for (const model of new Set(rows.map((r) => r.model))) {
    const now = rows.filter((r) => r.model === model);
    const then = new Map((earlier.runs || []).filter((r) => r.model === model).map((r) => [r.task, r]));
    // Only tasks that ran both times: one that never reached the agent says nothing.
    const ran = (r) => r && !r.notRun && !(r.notes || []).some((note) => /^the run did not complete/.test(note));
    const shared = now.filter((r) => ran(r) && ran(then.get(r.task)));
    if (!shared.length) { console.log(`\nNothing to compare for ${model} in ${earlierFile}.`); continue; }
    const sum = (list, f) => list.reduce((t, r) => t + f(r), 0);
    const was = shared.map((r) => then.get(r.task));
    console.log(`\nAgainst ${earlier.commit || 'the earlier run'} · ${model} · ${shared.length} tasks in both`);
    console.log(`  passed ${sum(was, (r) => (r.pass ? 1 : 0))} then, ${sum(shared, (r) => (r.pass ? 1 : 0))} now`);
    console.log(`  minutes ${(sum(was, (r) => r.seconds || 0) / 60).toFixed(1)} then, ${(sum(shared, (r) => r.seconds || 0) / 60).toFixed(1)} now`);
    console.log(`  tokens in ${fmt(sum(was, (r) => r.tokens.input))} then, ${fmt(sum(shared, (r) => r.tokens.input))} now`);
    console.log(`  failed edits ${sum(was, (r) => r.failedEdits)} then, ${sum(shared, (r) => r.failedEdits)} now`);
    for (const r of shared) {
      const t = then.get(r.task);
      if (t.pass !== r.pass) console.log(`  ${r.task}: ${t.pass ? 'passed' : 'failed'} then, ${r.pass ? 'passes' : 'fails'} now`);
    }
  }
}

async function main() {
  if (opt.selfTest) return selfTest();
  if (!CHROME) { console.log('No Chrome or Chromium found. The benchmark drives the real app in a browser.'); return 2; }
  if (opt.smoke) {
    const scripted = await startScriptedModel();
    OLLAMA = scripted.url;
    try { return await smoke(); } finally { await scripted.close(); }
  }
  const have = await localModels();
  if (!have) { console.log(`No local model server answered at ${OLLAMA}. Start it and try again.`); return 2; }
  const missing = opt.models.filter((m) => !have.includes(m));
  if (missing.length) { console.log(`Not installed locally: ${missing.join(', ')}. Installed: ${have.join(', ') || 'none'}.`); return 2; }

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const started = new Date();
  const state = gitState();
  console.log(`HashCoder benchmark · ${tasks.length} task${tasks.length === 1 ? '' : 's'} · ${opt.models.join(', ')} · ${state.commit}${state.changedSource ? ' with uncommitted changes to src/' : ''}`);
  console.log(`Working in ${ROOT}`);
  const rows = [];
  let n = 0;
  const stopAt = Date.now() + opt.budget * 60_000;
  for (const model of opt.models) {
    for (const task of tasks) {
      if (Date.now() > stopAt) {
        rows.push({ task: task.id, kind: task.kind, model, pass: false, notRun: true, notes: ['the time budget for this run was used up'], seconds: null, tokens: { input: 0, output: 0 }, asks: [], pageErrors: [], steps: 0, calls: 0, failedCalls: 0, failedEdits: 0, looseEdits: 0, byTool: {}, answer: '', shown: '' });
        continue;
      }
      if (n > 0 && opt.rest) await new Promise((r) => setTimeout(r, opt.rest * 1000));
      n++;
      process.stdout.write(`  ${model}  ${task.id} ... `);
      let row = await runTask(port, model, task, n);
      // A run that never reached the agent says nothing about it: try once more.
      if (row.notRun) { n++; row = await runTask(port, model, task, n); }
      rows.push(row);
      console.log(`${row.notRun ? 'NOT RUN' : row.pass ? 'pass' : 'FAIL'}${row.seconds != null ? ` in ${(row.seconds / 60).toFixed(1)} min` : ''}${row.pass ? '' : ' · ' + row.notes.join('; ')}`);
    }
    // Unload the model, so the machine gets its memory back.
    try { await fetch(`${OLLAMA}/api/generate`, { method: 'POST', body: JSON.stringify({ model, keep_alive: 0 }) }); } catch {}
  }
  server.close();

  for (const model of opt.models) printTable(model, rows.filter((r) => r.model === model));
  const report = { started: started.toISOString(), ...state, minutesPerTask: opt.minutes, models: opt.models, runs: rows };
  fs.mkdirSync(resultsDir, { recursive: true });
  const out = opt.out ? path.resolve(opt.out) : path.join(resultsDir, `results-${started.toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(out, JSON.stringify(report, null, 2));
  console.log(`\nResults: ${out}`);
  if (opt.compare) printComparison(rows, opt.compare);
  return 0;
}

/** One scripted task, and what the app must have done in it. */
async function smoke() {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const row = await runTask(server.address().port, SCRIPTED_MODEL, tasks[0], 1);
  server.close();
  const wrong = [
    [!row.pass, `the task did not pass: ${row.notes.join('; ')}`],
    [!/Sent back to make the change in the files/.test(row.shown), 'the agent was not sent back to make the change it wrote into its reply'],
    [row.failedEdits > 0, 'an edit failed'],
    [row.looseEdits < 1, 'the edit written without the file\'s indentation did not land by adjusting it'],
    [!/Sent back to run the tests/.test(row.shown), 'the agent was not sent back to prove its change'],
    [!/Checked after the last change: npm test passed/.test(row.shown), 'the person was not told what was proven'],
    [row.pageErrors.length > 0, `the page threw: ${row.pageErrors.join('; ')}`],
  ].filter(([bad]) => bad).map(([, why]) => why);
  console.log(wrong.length ? `Smoke run FAILED:\n  ${wrong.join('\n  ')}` : 'Smoke run passed: the agent was sent back to make the change it wrote into its reply, the edit landed with its indentation adjusted, it was sent back to prove it, and the person was told what was proven.');
  return wrong.length ? 1 : 0;
}

let code = 1;
try {
  code = await main();
} finally {
  stopBrowser();
  endCommands();
  if (opt.keep) console.log(`Kept ${ROOT}`);
  else if (path.basename(ROOT).startsWith(PREFIX)) fs.rmSync(ROOT, { recursive: true, force: true });
}
process.exit(code);
