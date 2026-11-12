// ==============================================================
// The run's ledger
//
// When a long conversation rolls, older requests leave what the model is
// sent. What a model most needs from them is not their words but what they
// left standing: an ask that is still open, a file the request said to leave
// as it is, the files changed, the checks run and whether they passed, the
// plan as it was last set. The ledger is that record, worked out from the
// messages alone, like everything in js/agent-context.js: the same
// conversation always gives the same ledger, and nothing is kept between
// turns.
//
// `from(messages, deps)` reads it; `note(ledger, { most })` writes it as plain
// text of about `most` characters. When the note is over that size, what was
// read goes first, then commands beyond the newest five, then details the
// sources gave, then asks already answered, then finished plan steps, then
// the newest commands. The requests, what the person added while it worked,
// an open ask, a limit, a changed file and an open plan step are never
// dropped: if they alone are over the size, the note is over the size.
//
// What it reads with, all existing code, handed in through `deps` or found
// on the page: the asks of a request (js/code/asks.js split), what a read
// showed (js/agent-context.js readShown), what a command made and what kind
// of check it is (js/code/verify.js madeBy, commandKind), the plan
// (js/code/plan.js fromCall), and the details the sources gave
// (js/code/facts.js evidenceOf, specifics). Without one of them, that part
// is left empty, never guessed.
//
// An ask is answered when the answer its request ended with says every one
// of its words of four letters or more, and it has two of them at least;
// otherwise it is open. A limit is a sentence of the request that begins
// "do not", "never", "keep", "leave", "only" or "must", or says "must not"
// or "should not".
//
// Pure: no DOM, no storage, no network. Published as window.HCRunLedger.
// Checked by scripts/checks/run-ledger.mjs.
// ==============================================================

(function () {
  'use strict';

  /** About how long the note is for each model size (hashcoder.js sizeOf). */
  const MOST = { small: 900, mid: 1600, full: 3000 };
  const NEWEST_READS = 20;
  const NEWEST_COMMANDS = 5;
  const MOST_LIMITS = 8;
  const MOST_DETAILS = 12;

  const empty = () => ({ requests: [], changed: [], ran: [], plan: [], read: [], confirmed: [], added: [] });
  const APP_NOTE = /^Note from HashCortx?,? not from the person/i;
  const squash = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  const cut = (s, n) => { const t = squash(s); return t.length > n ? `${t.slice(0, n)}…` : t; };
  const isRequest = (m) => !!m && m.role === 'user' && !m.opened && !m.note && !m.added
    && typeof m.content === 'string' && !APP_NOTE.test(m.content);

  const argsOf = (c) => {
    const fn = (c && c.function) || c || {};
    const a = fn.arguments;
    if (a && typeof a === 'object') return a;
    try { return JSON.parse(a || '{}') || {}; } catch { return {}; }
  };
  const nameOf = (c) => (c && ((c.function && c.function.name) || c.name)) || '';
  const parsed = (text) => { try { const v = JSON.parse(text); return v && typeof v === 'object' ? v : null; } catch { return null; } };

  /** Whether a tool's result says it did not do what was asked. */
  function failed(content) {
    const text = String(content == null ? '' : content).trim();
    const v = parsed(text);
    if (v) return v.ok === false || (v.error != null && v.ok !== true);
    return /^(?:error\b|refused\b|permission denied|denied\b|blocked\b)/i.test(text);
  }

  const STOP = new Set(['with', 'that', 'this', 'they', 'them', 'there', 'then', 'than', 'from', 'into', 'onto', 'have', 'been', 'will', 'your', 'what', 'when', 'where', 'which', 'also', 'just', 'please', 'make', 'sure', 'each', 'every', 'some', 'more', 'only', 'very', 'should', 'would', 'could', 'want', 'need', 'like']);
  const wordsOf = (text) => String(text || '').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 4 && !STOP.has(w));

  function answeredBy(ask, answer) {
    const words = [...new Set(wordsOf(ask))];
    if (words.length < 2 || !answer) return false;
    const said = new Set(wordsOf(answer));
    return words.every((w) => said.has(w));
  }

  const LIMIT = /^(?:please\s+)?(?:do not|don't|dont|never|keep|leave|only|must)\b|\b(?:must not|should not|mustn't|shouldn't)\b/i;
  function limitsOf(text) {
    const out = [];
    for (const line of String(text || '').split(/\r?\n/)) {
      for (const s of line.split(/(?<=[.!?])\s+/)) {
        const sentence = squash(s.replace(/^(?:[-*•·]|\d{1,2}[.)])\s*/, ''));
        if (sentence && LIMIT.test(sentence)) out.push(cut(sentence, 200));
      }
    }
    return out;
  }

  const KIND = { test: 'test', lint: 'lint', typecheck: 'types', build: 'build' };
  const base = (p) => String(p || '').split(/[\\/]/).pop().toLowerCase().replace(/\.exe$/, '');
  function howMade(command, args) {
    let prog = base(command);
    if (prog === 'git') prog = String((args || [])[0] || '');
    if (/^(?:rm|rmdir|del|erase|rd)$/.test(prog)) return 'deleted';
    if (/^(?:mv|move|ren|rename)$/.test(prog)) return 'moved';
    return 'made';
  }

  const lookup = (deps) => {
    const w = typeof window !== 'undefined' ? window : {};
    const pick = (name, owner, fn) => (typeof deps[name] === 'function' ? deps[name] : owner && typeof owner[fn] === 'function' ? owner[fn].bind(owner) : null);
    return {
      split: pick('split', w.HCCodeAsks, 'split'),
      readShown: pick('readShown', w.HCAgentContext, 'readShown'),
      madeBy: pick('madeBy', w.HCCodeVerify, 'madeBy'),
      commandKind: pick('commandKind', w.HCCodeVerify, 'commandKind'),
      fromCall: pick('fromCall', w.HCCodePlan, 'fromCall'),
      evidenceOf: pick('evidenceOf', w.HCCodeFacts, 'evidenceOf'),
      specifics: pick('specifics', w.HCCodeFacts, 'specifics'),
    };
  };

  /** The ledger of `messages`. */
  function from(messages, deps) {
    const list = Array.isArray(messages) ? messages : [];
    const d = lookup(deps && typeof deps === 'object' ? deps : {});
    const led = empty();
    const calls = new Map();
    const changed = new Map();
    const reads = new Map();
    let changes = 0;
    let current = null;
    const ran = [];

    const askAll = (req, text) => {
      if (!d.split) return;
      for (const a of d.split(text) || []) req.asks.push({ n: req.asks.length + 1, text: String(a), state: 'open' });
    };
    const change = (path, how, extra) => {
      const p = String(path || '').trim();
      if (!p) return;
      changes++;
      const was = changed.get(p);
      if (was) { was.times++; was.how = how; if (extra) Object.assign(was, extra); }
      else changed.set(p, Object.assign({ path: p, how, times: 1 }, extra || {}));
    };
    const close = () => {
      if (!current) return;
      for (const a of current.asks) if (answeredBy(a.text, current.answer)) a.state = 'answered';
    };

    for (const m of list) {
      if (!m || m.role === 'system') continue;
      if (m.role === 'user') {
        if (isRequest(m)) {
          close();
          current = { n: led.requests.length + 1, text: cut(m.content, 300), asks: [], limits: [], answer: '' };
          led.requests.push(current);
          askAll(current, m.content);
          current.limits.push(...limitsOf(m.content));
        } else if (m.added && typeof m.content === 'string') {
          led.added.push({ text: cut(m.content, 200), kind: typeof m.kind === 'string' && m.kind ? m.kind : 'add' });
          if (current) { askAll(current, m.content); current.limits.push(...limitsOf(m.content)); }
        }
        continue;
      }
      if (m.role === 'assistant') {
        if (Array.isArray(m.tool_calls) && m.tool_calls.length) {
          for (const c of m.tool_calls) if (c && c.id) calls.set(c.id, { name: nameOf(c), args: argsOf(c) });
        } else if (current && typeof m.content === 'string' && m.content.trim()) current.answer = m.content;
        continue;
      }
      if (m.role !== 'tool') continue;
      const asked = calls.get(m.tool_call_id) || { name: m.name || '', args: {} };
      const name = m.name || asked.name;
      const a = asked.args || {};
      const content = typeof m.content === 'string' ? m.content : '';
      if (name === 'read_file') {
        const shown = d.readShown ? d.readShown(name, content) : '';
        const w = /lines (\d+)-(\d+)/.exec(shown);
        if (shown && a.path) { reads.delete(String(a.path)); reads.set(String(a.path), w ? `${w[1]}-${w[2]}` : 'all'); }
      } else if (name === 'write_file' || name === 'patch_file' || name === 'delete_file') {
        if (!failed(content)) change(a.path, name === 'delete_file' ? 'deleted' : name === 'patch_file' || a.replace_whole ? 'edited' : 'made');
      } else if (name === 'move_file') {
        if (!failed(content)) change(a.to, 'moved', { from: String(a.from || '') });
      } else if (name === 'shell_run') {
        const r = parsed(content);
        if (!r || typeof r.code !== 'number') continue;   // refused, or never started: nothing ran
        const args = Array.isArray(a.args) ? a.args.map(String) : [];
        const kind = d.commandKind ? d.commandKind(a.command, args) : null;
        const passed = r.code === 0 && !r.timedOut && !r.stopped;
        ran.push({ command: cut([a.command, ...args].filter((x) => x != null && x !== '').join(' '), 120), kind: KIND[kind] || 'other', passed, at: changes });
        if (passed && d.madeBy) for (const p of d.madeBy(a.command, args) || []) change(p, howMade(a.command, args));
      } else if (name === 'update_plan') {
        if (failed(content) || !d.fromCall) continue;
        const plan = d.fromCall(a);
        if (plan && Array.isArray(plan.steps)) led.plan = plan.steps.map((s) => ({ text: s.step, state: s.status === 'done' ? 'done' : s.status === 'doing' ? 'doing' : 'open' }));
      }
    }
    close();

    led.requests = led.requests.map(({ answer, ...r }) => Object.assign(r, { limits: [...new Set(r.limits)].slice(0, MOST_LIMITS) }));
    led.changed = [...changed.values()];
    led.ran = ran.map(({ at, ...r }) => Object.assign(r, { afterLastChange: at === changes }));
    led.read = [...reads.entries()].slice(-NEWEST_READS).map(([path, lines]) => ({ path, lines }));
    if (d.evidenceOf && d.specifics) {
      const ev = d.evidenceOf(list);
      led.confirmed = [...new Set((d.specifics(ev && ev.text) || []).map((s) => String(s.shown)).filter(Boolean))].slice(0, MOST_DETAILS);
    }
    return led;
  }

  // ── The note ────────────────────────────────────────────────────────────

  function write(led) {
    const out = [];
    if (led.requests.length) {
      out.push('Requests:');
      for (const r of led.requests) {
        out.push(`${r.n}. "${r.text}"`);
        for (const a of r.asks) out.push(`   [${a.state}] ${a.n}. ${a.text}`);
        if (r.limits.length) out.push(`   Limits: ${r.limits.join(' ')}`);
      }
    }
    if (led.added.length) out.push(`Added while it worked: ${led.added.map((x) => `"${x.text}"`).join('; ')}`);
    if (led.changed.length) {
      out.push(`Changed: ${led.changed.map((c) => `${c.path} (${c.how}${c.how === 'moved' && c.from ? ` from ${c.from}` : ''}${c.times > 1 ? `, ${c.times} times` : ''})`).join('; ')}`);
    }
    if (led.ran.length) out.push(`Commands: ${led.ran.map((r) => `${r.command} (${r.kind}, ${r.passed ? 'passed' : 'failed'}${r.afterLastChange ? ', after the last change' : ''})`).join('; ')}`);
    if (led.plan.length) out.push(`Plan: ${led.plan.map((s) => `[${s.state}] ${s.text}`).join('; ')}`);
    if (led.confirmed.length) out.push(`From the sources: ${led.confirmed.join('; ')}`);
    if (led.read.length) out.push(`Read: ${led.read.map((r) => `${r.path} (${r.lines === 'all' ? 'all' : `lines ${r.lines}`})`).join('; ')}`);
    return out.join('\n');
  }

  /** What gives way, in order, while the note is over its size. */
  const STAGES = [
    (l) => { l.read = []; },
    (l) => { l.ran = l.ran.slice(-NEWEST_COMMANDS); },
    (l) => { l.confirmed = []; },
    (l) => { l.requests = l.requests.map((r) => Object.assign({}, r, { asks: r.asks.filter((a) => a.state !== 'answered') })); },
    (l) => { l.plan = l.plan.filter((s) => s.state !== 'done'); },
    (l) => { l.ran = []; },
  ];

  /** The ledger as plain text, of about `most` characters (see the header). */
  function note(ledger, { most = MOST.full } = {}) {
    if (!ledger || typeof ledger !== 'object') return '';
    const l = Object.assign(empty(), ledger);
    for (const k of Object.keys(empty())) l[k] = Array.isArray(l[k]) ? l[k].slice() : [];
    let text = write(l);
    for (const stage of STAGES) {
      if (text.length <= most) break;
      stage(l);
      text = write(l);
    }
    return text;
  }

  window.HCRunLedger = { MOST, from, note };
})();
