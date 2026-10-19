// ==============================================================
// A command line that narrows its output, run without a shell
//
// shell_run starts one program with its arguments; there is no shell to read
// a pipe or a redirect. Models of every size still write the line they would
// type, `top -l 1 | head -30`, `ioreg -l | grep -i gpu`, and a refusal cost
// them a step each time. So a line whose pipes lead only to filters that
// narrow text (grep, head, tail, wc, sort, uniq) is run as its first program,
// and the filters are applied here, to what it printed. `2>/dev/null` drops
// what it printed as errors and `2>&1` keeps it with the rest. Anything else
// a shell would be needed for is still refused, as before.
//
// No filter is a program: nothing here is started, and nothing reaches the
// disk or the network. The result says what was applied.
//
// Pure: takes strings and records, returns strings and records.
//
// Loaded before the Coder mode and published as window.HCCodePipe.
// Checked by scripts/checks/code-pipe.mjs.
// ==============================================================

(function () {
  'use strict';

  /** Words of a filter as written, quotes honoured, or null for anything a shell would read. */
  function wordsOf(text) {
    const words = [];
    let word = null, quote = null;
    for (const ch of String(text)) {
      if (quote) { if (ch === quote) quote = null; else word += ch; continue; }
      if (ch === '"' || ch === "'") { quote = ch; word = word ?? ''; continue; }
      if (/\s/.test(ch)) { if (word != null) { words.push(word); word = null; } continue; }
      if ('&;<>`$(){}'.includes(ch)) return null;
      word = (word ?? '') + ch;
    }
    if (quote) return null;
    if (word != null) words.push(word);
    return words;
  }

  /** The parts of a line between pipes outside quotes, or null for `||`. */
  function partsOf(line) {
    const parts = [];
    let at = 0, quote = null;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (quote) { if (ch === quote) quote = null; continue; }
      if (ch === '"' || ch === "'") { quote = ch; continue; }
      if (ch !== '|') continue;
      if (line[i + 1] === '|') return null;
      parts.push(line.slice(at, i).trim());
      at = i + 1;
    }
    parts.push(line.slice(at).trim());
    return parts;
  }

  /** A basic grep pattern as a JavaScript one: `\|`, `\(` and the rest are the operators, the bare characters are text. */
  function fromBasic(p) {
    let out = '';
    for (let i = 0; i < p.length; i++) {
      const ch = p[i];
      if (ch === '\\' && '|(){}+?'.includes(p[i + 1] || '')) { out += p[++i]; continue; }
      if (ch === '\\') { out += ch + (p[++i] ?? ''); continue; }
      out += '|(){}+?'.includes(ch) ? `\\${ch}` : ch;
    }
    return out;
  }

  const count = (w) => (/^\d+$/.test(w) ? Number(w) : NaN);

  /** One filter as a function from lines to lines, or null for one this does not apply. */
  function filterOf(words) {
    const [prog, ...args] = words;
    if (prog === 'grep' || prog === 'egrep' || prog === 'fgrep') {
      let flags = prog === 'egrep' ? 'E' : prog === 'fgrep' ? 'F' : '';
      const rest = [];
      for (let i = 0; i < args.length; i++) {
        if (!rest.length && /^-[ivEFncw]+$/.test(args[i])) flags += args[i].slice(1);
        else if (args[i] === '-e' && i + 1 < args.length) rest.push(args[++i]);
        else rest.push(args[i]);
      }
      if (rest.length !== 1) return null;
      let source = flags.includes('F') ? rest[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : flags.includes('E') ? rest[0] : fromBasic(rest[0]);
      if (flags.includes('w')) source = `(?<![\\w])(?:${source})(?![\\w])`;
      let re;
      try { re = new RegExp(source, flags.includes('i') ? 'iu' : 'u'); } catch { return null; }
      return (lines) => {
        const kept = lines.map((l, n) => [l, n + 1]).filter(([l]) => re.test(l) !== flags.includes('v'));
        if (flags.includes('c')) return [String(kept.length)];
        return kept.map(([l, n]) => (flags.includes('n') ? `${n}:${l}` : l));
      };
    }
    if (prog === 'head' || prog === 'tail') {
      let n = 10;
      if (args.length === 1 && /^-\d+$/.test(args[0])) n = count(args[0].slice(1));
      else if (args.length === 1 && /^-n\d+$/.test(args[0])) n = count(args[0].slice(2));
      else if (args.length === 2 && args[0] === '-n') n = count(args[1]);
      else if (args.length) return null;
      if (!(n >= 0)) return null;
      return (lines) => (prog === 'head' ? lines.slice(0, n) : n ? lines.slice(-n) : []);
    }
    if (prog === 'wc') {
      if (args.length > 1 || (args.length && !/^-[lwc]$/.test(args[0]))) return null;
      return (lines) => {
        const text = lines.join('\n') + (lines.length ? '\n' : '');
        const sizes = { l: lines.length, w: (text.match(/\S+/g) || []).length, c: new TextEncoder().encode(text).length };
        return [args.length ? String(sizes[args[0][1]]) : `${sizes.l} ${sizes.w} ${sizes.c}`];
      };
    }
    if (prog === 'sort') {
      const flags = args.join('').replace(/-/g, '');
      if (args.some((a) => !/^-[rnuf]+$/.test(a))) return null;
      return (lines) => {
        const key = (l) => (flags.includes('f') ? l.toLowerCase() : l);
        const out = [...lines].sort((a, b) => (flags.includes('n') ? (parseFloat(a) || 0) - (parseFloat(b) || 0) || key(a).localeCompare(key(b)) : key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
        if (flags.includes('r')) out.reverse();
        return flags.includes('u') ? out.filter((l, i) => !i || key(l) !== key(out[i - 1])) : out;
      };
    }
    if (prog === 'uniq') {
      if (args.length > 1 || (args.length && args[0] !== '-c')) return null;
      return (lines) => {
        const runs = [];
        for (const l of lines) { if (runs.length && runs[runs.length - 1][0] === l) runs[runs.length - 1][1]++; else runs.push([l, 1]); }
        return runs.map(([l, n]) => (args.length ? `${String(n).padStart(7)} ${l}` : l));
      };
    }
    return null;
  }

  /**
   * A line run as its first program with its output narrowed here: `{ head,
   * filters, stderr, shown }`, `head` the program's own line, `stderr`
   * 'keep', 'drop' or 'merge', `shown` the filters as written. Null when the
   * line has no pipe or redirect to read, or needs a shell for one.
   */
  function split(line, { windows = false } = {}) {
    const text = String(line || '').trim();
    if (!/[|]|2>/.test(text)) return null;
    let stderr = 'keep';
    const quiet = windows ? /\s+2>\s*nul\b/gi : /\s+2>\s*\/dev\/null\b/g;
    const plain = text.replace(quiet, () => { stderr = 'drop'; return ''; }).replace(/\s+2>&1\b/g, () => { if (stderr === 'keep') stderr = 'merge'; return ''; });
    const parts = partsOf(plain);
    if (!parts || !parts[0] || /[<>]/.test(parts[0])) return null;
    const filters = [];
    for (const part of parts.slice(1)) {
      const words = wordsOf(part);
      const fn = words && words.length ? filterOf(words) : null;
      if (!fn) return null;
      filters.push(fn);
    }
    if (!filters.length && stderr === 'keep') return null;
    return { head: parts[0], filters, stderr, shown: parts.slice(1).map((p) => `| ${p}`).join(' ') };
  }

  /** What the program printed, with the filters applied and a line saying so. */
  function apply(result, pipe) {
    if (!result || typeof result !== 'object' || !pipe) return result;
    const err = String(result.stderr || '');
    let text = String(result.stdout || '') + (pipe.stderr === 'merge' && err ? (result.stdout ? '\n' : '') + err : '');
    let lines = text.split('\n');
    if (lines.length && lines[lines.length - 1] === '') lines.pop();
    for (const fn of pipe.filters) lines = fn(lines);
    text = lines.length ? `${lines.join('\n')}\n` : '';
    const done = [pipe.shown, pipe.stderr === 'drop' ? '2>/dev/null' : pipe.stderr === 'merge' ? '2>&1' : ''].filter(Boolean).join(' ');
    return Object.assign({}, result, {
      stdout: text,
      stderr: pipe.stderr === 'keep' ? err : '',
      note: `shell_run has no shell: it ran ${pipe.head} and applied ${done} to its output itself.`,
    });
  }

  window.HCCodePipe = { split, apply };
})();
