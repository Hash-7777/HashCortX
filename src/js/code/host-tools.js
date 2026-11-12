// ==============================================================
// Which programs this computer has, said to the model in one line
//
// A model was told the system (platform, shell, separator: hashcoder.js
// platformLine) and not which programs were installed, so it found out by
// running one and reading the error, a step each time, most often on Windows
// where `rg`, `make` and `python3` are seldom there. Once a session the app
// asks which of a fixed list of names are installed (src-tauri/src/commands/
// host.rs which_programs: found as files on the search path, nothing run,
// names only, never a path), and says it after the platform line:
//
//   small models, and light mode   nothing: they are given no shell
//   mid-sized models               "Programs here: git, node, npm, python."
//   large and cloud models         the same, and which of the ones models
//                                  most often assume are not here
//
// The line is the same for the whole session, so it costs nothing in a
// cached prompt. line is pure; ask reaches the native side.
// Published as window.HCCodeHostTools. Checked by scripts/checks/host-tools.mjs.
// ==============================================================

(function () {
  'use strict';

  /** The names asked about, in the order they are said (host.rs NAMES). */
  const NAMES = ['git', 'node', 'npm', 'pnpm', 'yarn', 'bun', 'python', 'python3', 'py', 'pip', 'uv', 'cargo',
    'rustc', 'go', 'dotnet', 'java', 'rg', 'pwsh', 'powershell', 'wsl', 'winget', 'make', 'cmake', 'docker'];
  /** The programs models most often assume are there: the ones said to be missing, when they are. */
  const ASSUMED = ['git', 'node', 'npm', 'python', 'python3', 'pip', 'rg', 'make'];

  /** The line for the model, from the names found (null: not known yet, so nothing said). */
  function line(found, size) {
    if (!Array.isArray(found) || size === 'small' || size === 'light') return '';
    const here = NAMES.filter((n) => found.includes(n));
    const missing = size === 'mid' ? [] : ASSUMED.filter((n) => !here.includes(n));
    if (!here.length && !missing.length) return '';
    return `\n${here.length ? `Programs here: ${here.join(', ')}.` : 'None of the usual programs was found here.'}${missing.length ? ` Not here: ${missing.join(', ')}.` : ''}`;
  }

  /** Ask once which of NAMES are installed: the names found, or null when it cannot be told. */
  async function ask() {
    const HC = window.HC;
    if (!HC || typeof HC.invoke !== 'function' || HC.isTauri === false) return null;
    try {
      const r = await HC.invoke('which_programs', { names: NAMES });
      return Array.isArray(r) ? r.filter((n) => NAMES.includes(n)) : null;
    } catch { return null; }
  }

  window.HCCodeHostTools = { NAMES, ASSUMED, line, ask };
})();
