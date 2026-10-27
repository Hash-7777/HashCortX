// ==============================================================
// HashCoder checks its work by code, never by looking at it
//
// A run that has changed a site or an app proves it with the project's
// tests, a build, a syntax or lint check, and the app's own reading of what
// was written. Opening the page in a browser, launching the app, serving a
// folder to look at it, or taking a picture of the screen proves nothing a
// model can read back, costs steps and minutes, and asks the person for
// permissions a coding run has no need of: screen recording, control of
// another app, a port left open.
//
// refusal() reads the program a shell_run call would start, through the
// launchers that only start another one (npx, npm exec, python -m, cmd /c and
// the like), and says why it is not run when what it starts is a screenshot
// tool, a browser or a program that drives one, something that opens a file
// or an app with whatever the system chooses, or a server started to look at
// the result. It is asked before the guard, so no question is put to the
// person for a command that will not run. Every other command is left to the
// guard as before.
//
// Pure: takes the program and its arguments, returns a string.
//
// Loaded before the Coder mode and published as window.HCCodeByCode.
// Checked by scripts/checks/code-by-code.mjs.
// ==============================================================

(function () {
  'use strict';

  /** Programs that take a picture of the screen. */
  const PICTURES = new Set(['screencapture', 'screenshot', 'gnome-screenshot', 'scrot', 'grim', 'maim', 'spectacle',
    'flameshot', 'snippingtool', 'xwd', 'shot-scraper', 'pageres', 'capture-website', 'wkhtmltoimage', 'webkit2png', 'cutycapt']);

  /** Browsers, and programs that drive one. */
  const BROWSERS = new Set(['chrome', 'google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'firefox',
    'safari', 'msedge', 'microsoft-edge', 'brave', 'brave-browser', 'opera', 'vivaldi', 'playwright', 'puppeteer',
    'selenium', 'chromedriver', 'geckodriver', 'safaridriver', 'msedgedriver', 'lighthouse', 'cypress']);

  /** Programs that open a file, a page or an app with whatever the system chooses, or drive another app. */
  const OPENERS = new Set(['open', 'xdg-open', 'gio', 'wslview', 'sensible-browser', 'x-www-browser', 'www-browser',
    'explorer', 'start', 'start-process', 'invoke-item', 'osascript']);

  /** Servers started to look at what was made. */
  const SERVERS = new Set(['http-server', 'live-server', 'serve', 'browser-sync', 'webpack-dev-server', 'electron']);

  /** Tools whose first word picks a server that runs until stopped. */
  const SERVED_BY = { vite: ['', 'dev', 'serve', 'preview'], next: ['dev', 'start'], nuxt: ['dev', 'preview'], astro: ['dev', 'preview'],
    ng: ['serve'], webpack: ['serve'], tauri: ['dev'], flutter: ['run'] };

  /** Package scripts that start the app or serve it, by their usual names. */
  const SERVE_SCRIPTS = new Set(['dev', 'serve', 'preview', 'start']);

  /** Python modules that serve a folder or open a browser. */
  const PY_MODULES = new Set(['http.server', 'simplehttpserver', 'webbrowser', 'playwright', 'selenium']);

  /** Programs that only start the program named after them. */
  const LAUNCHERS = new Set(['npx', 'bunx', 'pnpx']);
  const PACKAGE_MANAGERS = new Set(['npm', 'pnpm', 'yarn', 'bun']);

  /** A program's bare name: no folder, no ending a system adds, lower case. */
  const nameOf = (program) => String(program || '').trim().replace(/^["']|["']$/g, '').split(/[\\/]/).pop()
    .toLowerCase().replace(/\.(?:exe|cmd|bat|ps1|app)$/, '');

  const flagless = (words) => words.filter((w) => !String(w).startsWith('-'));

  /** The words from the first that is not a flag. */
  const fromProgram = (words) => { const at = words.findIndex((w) => !String(w).startsWith('-')); return at < 0 ? [] : words.slice(at); };

  /**
   * The words of the command that is actually started, with launchers taken
   * off: `npx playwright screenshot` is `playwright screenshot`, `cmd /c start
   * index.html` is `start index.html`.
   */
  function startedOf(program, args) {
    let words = [String(program || ''), ...(Array.isArray(args) ? args.map(String) : [])].filter((w) => w !== '');
    for (let step = 0; step < 4 && words.length; step++) {
      const name = nameOf(words[0]);
      if (LAUNCHERS.has(name)) { words = fromProgram(words.slice(1)); continue; }
      if (PACKAGE_MANAGERS.has(name) && /^(?:exec|x|dlx)$/i.test(words[1] || '')) { words = fromProgram(words.slice(2)); continue; }
      if (name === 'cmd' && words.some((w) => /^\/c$/i.test(w))) { words = words.slice(words.findIndex((w) => /^\/c$/i.test(w)) + 1); continue; }
      if ((name === 'powershell' || name === 'pwsh') && words.some((w) => /^-(?:c|command)$/i.test(w))) {
        words = words.slice(words.findIndex((w) => /^-(?:c|command)$/i.test(w)) + 1).join(' ').trim().split(/\s+/);
        continue;
      }
      break;
    }
    return words;
  }

  /** What the command would start, when it is one HashCoder does not run: 'picture', 'browser', 'open' or 'serve'; '' otherwise. */
  function kindOf(program, args) {
    const words = startedOf(program, args);
    if (!words.length) return '';
    const name = nameOf(words[0]);
    const rest = words.slice(1).map((w) => String(w).toLowerCase());
    if (PICTURES.has(name)) return 'picture';
    if (/\.app\//i.test(String(words[0])) || BROWSERS.has(name)) return 'browser';
    if (name === 'xcrun' && rest.includes('simctl')) return 'open';
    if (name === 'gio') return rest[0] === 'open' ? 'open' : '';
    if (OPENERS.has(name)) return 'open';
    if (SERVERS.has(name)) return 'serve';
    if (name === 'php') return words.includes('-S') ? 'serve' : '';   // -s, lower case, prints a file's source
    if (name === 'cargo' && flagless(rest)[0] === 'tauri') return flagless(rest)[1] === 'dev' ? 'serve' : '';
    if (Object.prototype.hasOwnProperty.call(SERVED_BY, name)) return SERVED_BY[name].includes(flagless(rest)[0] || '') ? 'serve' : '';
    if (/^python[\d.]*$|^py$/.test(name)) {
      const at = rest.indexOf('-m');
      const mod = at >= 0 ? rest[at + 1] : '';
      if (mod && PY_MODULES.has(mod)) return mod === 'http.server' || mod === 'simplehttpserver' ? 'serve' : 'browser';
      return '';
    }
    if (PACKAGE_MANAGERS.has(name)) {
      const plain = flagless(rest);
      const named = plain[0] === 'run' || plain[0] === 'run-script', script = named ? plain[1] : plain[0];
      if (script === 'tauri') return plain[named ? 2 : 1] === 'dev' ? 'serve' : '';   // the desktop app's own runner, started to look at it
      return script && SERVE_SCRIPTS.has(script) && (plain[0] === 'run' || plain[0] === 'run-script' || script === 'start' || name !== 'npm') ? 'serve' : '';
    }
    return '';
  }

  const WHY = {
    picture: 'takes a picture of the screen',
    browser: 'opens or drives a browser',
    open: 'opens a file, a page or an app to look at',
    serve: 'starts the app or a server to look at it',
  };

  /** How a run checks its work instead, said with every refusal. */
  const INSTEAD = 'HashCoder checks work by code alone: run the project\'s test or build, check a file you changed with a syntax check ' +
    '(command "node", args ["--check", its path], or command "python3", args ["-m", "py_compile", its path]), or read the files again. ' +
    'Nothing is opened, served or looked at on screen; the app reads a site you changed itself when the run finishes.';

  /**
   * Why this command is not run, or '' when it may go to the guard. `program`
   * and `args` are as shell_run would start them.
   */
  function refusal(program, args) {
    const kind = kindOf(program, args);
    if (!kind) return '';
    return `Not run: ${[program, ...(Array.isArray(args) ? args : [])].join(' ').trim()} ${WHY[kind]}. ${INSTEAD}`;
  }

  window.HCCodeByCode = { refusal, kindOf, startedOf, INSTEAD };
})();
