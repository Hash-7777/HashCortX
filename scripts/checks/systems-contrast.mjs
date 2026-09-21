// ==============================================================
// A generated system can be read, in every trade and in both modes
//
// THE DEFECT, measured rather than described. A generated system drew itself
// in its industry's colours and nothing checked whether the words on it could
// be read. On white:
//
//   · the grey every quiet label used — a date, a field name, a count, the
//     second line of a card — was about 2.5 to one. Text needs 4.5.
//   · the status pills were fixed colours chosen for a dark background and
//     drawn on a light one. "In progress" was about 2.1 to one.
//   · the heading bar put white on whatever colour the industry had.
//
// So this does the arithmetic the app was not doing: it builds the theme for
// every trade the app knows, in light and in dark, and measures every colour a
// word is drawn in against the thing it is drawn on. Nothing here is a matter
// of taste — it is WCAG AA, 4.5 for text and 3 for large text and edges.
//
// Run with: npm run check:systems-contrast
// ==============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const sandbox = { window: {} };
vm.createContext(sandbox);
for (const f of ['spec.js', 'money.js', 'samples.js', 'domain.js', 'contrast.js', 'theme.js']) {
  vm.runInContext(readFileSync(join(root, 'src', 'js', 'systems', f), 'utf8'), sandbox, { filename: f });
}
const C = sandbox.window.HCSystemsContrast;
const T = sandbox.window.HCSystemsTheme;
const D = sandbox.window.HCSystemsDomain;

let pass = 0;
let fail = 0;
function ok(label, cond, detail = '') {
  if (cond) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}

console.log('The arithmetic is WCAG\'s, not ours:');
{
  ok('black on white is 21 to one', Math.round(C.ratio('#000000', '#ffffff')) === 21);
  ok('a colour against itself is 1', C.ratio('#3b82f6', '#3b82f6') === 1);
  ok('it does not care which way round they are', C.ratio('#000000', '#ffffff') === C.ratio('#ffffff', '#000000'));
  ok('white is the brightest there is', C.luminance('#ffffff') === 1);
  ok('and black the darkest', C.luminance('#000000') === 0);
  ok('the floors are AA: 4.5 for text', C.TEXT === 4.5);
  ok('and 3 for large text and edges', C.LARGE === 3);
}

console.log('\nA colour is moved only as far as it has to go:');
{
  ok('one that can already be read is not touched', C.readableOn('#db2777', '#ffffff') === '#db2777');
  ok('one that cannot is darkened on a light background', C.ratio(C.readableOn('#94a3b8', '#ffffff'), '#ffffff') >= 4.5);
  ok('and lightened on a dark one', C.ratio(C.readableOn('#334155', '#0b1220'), '#0b1220') >= 4.5);
  ok('it stops at the floor rather than going to black', C.ratio(C.readableOn('#10b981', '#ffffff'), '#ffffff') < 5.2);
  ok('a colour it cannot read is handed back as it came', C.readableOn('not a colour', '#ffffff') === 'not a colour');
  ok('and so is one on a background it cannot read', C.readableOn('#10b981', 'rgba(0,0,0,.5)') === '#10b981');
  // At the floor for text there is no background that black and white both
  // fail on, which is worth knowing rather than assuming. Ask for more than
  // AA on a mid-grey and there is: the better of the two is then used,
  // because as readable as it can be beats something arbitrary.
  const bothFail = C.ratio('#ffffff', '#7f7f7f') < 7 && C.ratio('#000000', '#7f7f7f') < 7;
  const mid = C.readableOn('#10b981', '#7f7f7f', 7);
  ok('where nothing can reach the floor asked for, the better of the two is used', bothFail && (mid === '#000000' || mid === '#ffffff'), mid);
  ok('and it is the better one, not just either', C.ratio(mid, '#7f7f7f') === Math.max(C.ratio('#000000', '#7f7f7f'), C.ratio('#ffffff', '#7f7f7f')));
  ok('and the one that reads better on a fill is picked', C.pickOn('#fbbf24') === '#0f172a' && C.pickOn('#1e293b') === '#ffffff');
}

console.log('\nEvery trade the app knows, light and dark, can be read:');
{
  const trades = Object.keys(D.DOMAIN_CONFIG);
  ok(`there are ${trades.length} of them to check`, trades.length >= 10);
  let worst = { ratio: 99, where: '' };
  const failures = [];
  for (const domain of trades) {
    for (const mode of ['light', 'dark']) {
      const spec = { domain, description: domain, theme: { ...(D.DOMAIN_CONFIG[domain].theme || {}), mode, radius: 10, font: 'sans' } };
      const v = Object.fromEntries(T.themeVars(spec).split(';').map((x) => {
        const at = x.indexOf(':');
        return [x.slice(0, at), x.slice(at + 1)];
      }));
      const card = v['--sys-card-bg'];
      const pairs = [
        ['--sys-app-text', card], ['--sys-app-sub', card], ['--sys-app-muted', card],
        ['--sys-primary-ink', card],
        ['--sys-nav-text', v['--sys-nav-bg']],
        ['--sys-ok', v['--sys-ok-bg']], ['--sys-warn', v['--sys-warn-bg']],
        ['--sys-bad', v['--sys-bad-bg']], ['--sys-idle', v['--sys-idle-bg']],
        // The pill a state the app has no name for gets, which is most of
        // them: "Low stock", "Out of stock", "Coming soon".
        ['--sys-primary-on-tint', v['--sys-primary-tint']],
        ['--sys-accent-on-tint', v['--sys-accent-tint']],
      ];
      for (const [name, on] of pairs) {
        const r = C.ratio(v[name], on);
        if (r < worst.ratio) worst = { ratio: r, where: `${domain}/${mode} ${name} ${v[name]} on ${on}` };
        if (r < C.TEXT) failures.push(`${domain}/${mode} ${name} ${v[name]} on ${on} = ${r.toFixed(2)}`);
      }
    }
  }
  ok('every colour a word is drawn in reaches the floor for text', failures.length === 0, failures.slice(0, 4).join(' · '));
  ok(`and the closest any of them comes is ${worst.ratio.toFixed(2)}`, worst.ratio >= C.TEXT, worst.where);
}

console.log('\nA system still looks like itself:');
{
  // Readable does not mean grey. A theme whose colours already read is left
  // alone, and one that does not is moved rather than replaced.
  const spec = { domain: 'retail', description: 'a book shop', theme: { primary: '#db2777', accent: '#f472b6', mode: 'light', radius: 10, font: 'sans' } };
  const v = Object.fromEntries(T.themeVars(spec).split(';').map((x) => { const at = x.indexOf(':'); return [x.slice(0, at), x.slice(at + 1)]; }));
  ok('the industry\'s own colour is still what it draws in', v['--sys-primary'] === '#db2777');
  // The shade for words is darker than the fill, because a link sits on a
  // selected row as often as on a plain one — but it is a darker shade of
  // that colour, not a grey standing in for it.
  ok('the shade for words is still that colour, not a grey', (() => {
    const fill = C.rgbOf(v['--sys-primary']);
    const inked = C.rgbOf(v['--sys-primary-ink']);
    const spread = Math.max(...fill) - Math.min(...fill);
    return spread - (Math.max(...inked) - Math.min(...inked)) < spread * 0.5;
  })(), v['--sys-primary-ink']);
  ok('and it reads on the card and on a wash of itself alike',
    C.ratio(v['--sys-primary-ink'], v['--sys-card-bg']) >= C.TEXT && C.ratio(v['--sys-primary-ink'], v['--sys-primary-tint']) >= C.TEXT);
  const pale = { domain: 'retail', description: 'x', theme: { primary: '#fbbf24', accent: '#fde68a', mode: 'light', radius: 10, font: 'sans' } };
  const p = Object.fromEntries(T.themeVars(pale).split(';').map((x) => { const at = x.indexOf(':'); return [x.slice(0, at), x.slice(at + 1)]; }));
  ok('a pale one keeps its fill', p['--sys-primary'] === '#fbbf24');
  ok('but its words are darkened to be read', p['--sys-primary-ink'] !== '#fbbf24' && C.ratio(p['--sys-primary-ink'], p['--sys-card-bg']) >= C.TEXT);
  ok('and the heading bar puts dark on it, not white', C.ratio(p['--sys-nav-text'], p['--sys-nav-bg']) >= C.TEXT);
}

console.log('\nThe screens read the measured colours, not fixed ones:');
{
  const css = readFileSync(join(root, 'src', 'modes', 'systems', 'mode.css'), 'utf8');
  const pills = css.slice(css.indexOf('.sys-pill[data-status'), css.indexOf('.sys-detail-list'));
  ok('a state pill takes its colour from the theme', /var\(--sys-ok\)/.test(pills) && /var\(--sys-warn\)/.test(pills) && /var\(--sys-bad\)/.test(pills) && /var\(--sys-idle\)/.test(pills));
  ok('and no second copy of those colours is kept here', !/var\(--sys-(?:ok|warn|bad|idle), *#/.test(css));
  ok('and its fill and its edge too', /var\(--sys-ok-bg,/.test(pills) && /var\(--sys-ok-line,/.test(pills));
  ok('none of them is a fixed colour any more', !/color:\s*#(10b981|f59e0b|ef4444|94a3b8)\b/.test(pills));
  const base = css.slice(css.indexOf('.sys-pill {'), css.indexOf('.sys-pill[data-status'));
  ok('a state with no name of its own is measured too', /var\(--sys-primary-on-tint/.test(base) && /var\(--sys-primary-tint/.test(base));
  ok('and its wash is a colour, not a see-through one that cannot be measured', !/background: var\(--sys-primary-fade/.test(base.split('color:')[0]));
  ok('a word drawn in the industry colour uses the shade that reads', /var\(--sys-primary-ink/.test(css));
  // Nothing draws a word in the accent on a plain card, so there is no shade
  // for that and none is emitted. On a wash of it there is, and that is used.
  ok('and nothing carries a shade the screens never draw in', !/--sys-accent-ink/.test(readFileSync(join(root, 'src', 'js', 'systems', 'theme.js'), 'utf8')));
  ok('and the heading bar its own', !/\.sys-topnav-tab\.active \{ color: #fff;/.test(css));
  ok('the trend beside a figure is a state, not the accent', /\.sys-kpi-trend\.up[^}]*var\(--sys-ok/.test(css) && /\.sys-kpi-trend\.down[^}]*var\(--sys-bad/.test(css));
}

console.log('\nA module\'s own colour is read in a shade that reads:');
{
  // Each module has its own colour, and it was written straight into a dozen
  // styles: an amber module put amber initials on an amber wash, an amber
  // figure on white and white on an amber button — all about two to one.
  const PALETTE = ['#6366f1', '#10b981', '#f59e0b', '#3b82f6', '#ec4899', '#14b8a6', '#8b5cf6', '#f97316', '#06b6d4', '#84cc16'];
  const bad = [];
  for (const domain of Object.keys(D.DOMAIN_CONFIG)) {
    for (const mode of ['light', 'dark']) {
      const spec = { domain, theme: { mode } };
      const ground = T.surfacesOf(spec);
      for (const colour of PALETTE) {
        const sh = T.shadesOf(colour, spec);
        const checks = [
          ['initials on its wash', sh.onWash, sh.wash],
          ['a figure on a solid card', sh.onCard, ground.card],
          ['a figure on a flat card', sh.onCard, ground.flat],
          ['a label on a filled button', sh.onFill, sh.fill],
        ];
        for (const [what, fg, bg] of checks) if (C.ratio(fg, bg) < C.TEXT) bad.push(`${domain}/${mode} ${colour} ${what} ${C.ratio(fg, bg).toFixed(2)}`);
      }
    }
  }
  ok('in every trade, both modes, all ten module colours', bad.length === 0, bad.slice(0, 3).join(' · '));
  ok('the colour itself still fills what it filled', T.shadesOf('#f59e0b', { domain: 'retail', theme: {} }).fill === '#f59e0b');
  const mode = readFileSync(join(root, 'src', 'modes', 'systems', 'mode.js'), 'utf8');
  ok('no module colour is written straight in as the colour of a word', !/style="[^"]*(?:^|;)color:\$\{(?:color|accent)\}/.test(mode));
  ok('nor as a see-through wash under one', !/background:\$\{(?:color|accent)\}18/.test(mode));
  const shells = readFileSync(join(root, 'src', 'js', 'systems', 'shells.js'), 'utf8');
  ok('a nav button filled with it carries its own readable label colour', /--mod-ink:/.test(shells) && /color: var\(--mod-ink/.test(readFileSync(join(root, 'src', 'modes', 'systems', 'mode.css'), 'utf8')));
}

console.log('\nThe module you are on is the easiest one to read, not the hardest:');
{
  // A white wash over the heading colour marked the current module, which
  // lightens the ground under light words.
  for (const domain of Object.keys(D.DOMAIN_CONFIG)) {
    const v = Object.fromEntries(T.themeVars({ domain, theme: { ...(D.DOMAIN_CONFIG[domain].theme || {}), mode: 'light' } }).split(';').map((x) => { const at = x.indexOf(':'); return [x.slice(0, at), x.slice(at + 1)]; }));
    if (C.ratio(v['--sys-nav-text'], v['--sys-nav-active-bg']) < C.ratio(v['--sys-nav-text'], v['--sys-nav-bg'])) {
      ok(`${domain}: the current module reads better than the rest`, false);
    }
  }
  ok('in every trade the current module reads at least as well as the bar', true);
}

console.log('\nIt loads before the file that uses it:');
{
  const boot = readFileSync(join(root, 'src', 'boot.js'), 'utf8');
  const standalone = readFileSync(join(root, 'src', 'js', 'systems', 'export-app.js'), 'utf8');
  ok('in the app', boot.indexOf('/js/systems/contrast.js') < boot.indexOf('/js/systems/theme.js'));
  ok('and in an exported system, which carries its own colours', standalone.indexOf('/js/systems/contrast.js') < standalone.indexOf('/js/systems/theme.js'));
  const src = readFileSync(join(root, 'src', 'js', 'systems', 'contrast.js'), 'utf8');
  ok('it reads no page of its own', !/document\.|localStorage|fetch\(/.test(src));
  ok('and the theme degrades rather than breaking without it', /const C = window\.HCSystemsContrast;/.test(readFileSync(join(root, 'src', 'js', 'systems', 'theme.js'), 'utf8')));
}

console.log(`\n${pass} passed, ${fail} failed  (src/js/systems/contrast.js)`);
process.exit(fail ? 1 : 0);
