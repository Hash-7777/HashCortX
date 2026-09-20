// ==============================================================
// Agent marks — checks
//
// Loads the REAL src/js/swarm/role-icons.js and the starter templates into a
// Node VM, and reads the Swarm for how a mark reaches the screen.
//
// The rule: an agent's mark is drawn from its role. Nothing types one, and
// nothing in the Swarm carries a picture as text.
//
// Run with: npm run check:swarm-role-icons
// ==============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const src = (...p) => readFileSync(join(root, 'src', ...p), 'utf8');
const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(src('js', 'swarm', 'role-icons.js'), sandbox, { filename: 'role-icons.js' });
vm.runInContext(src('data', 'swarm-templates.js'), sandbox, { filename: 'swarm-templates.js' });
const I = sandbox.window.HCSwarmRoleIcons;
const TEMPLATES = sandbox.window.HCSwarmTemplates.TEMPLATES;

let pass = 0;
let fail = 0;
function ok(label, cond, detail = '') {
  if (cond) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}
const PICTURE = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}]/u;

console.log('Every role has a mark, and it is drawn:');
{
  ok('the set covers every role the picker offers', I.ORDER.every((r) => !!I.ROLE_SVGS[r]));
  ok('each one is an SVG that takes the colour around it', I.ORDER.every((r) => /^<svg /.test(I.ROLE_SVGS[r]) && /stroke="currentColor"/.test(I.ROLE_SVGS[r])));
  ok('each one is sized, so it cannot arrive at the page\'s font size', I.ORDER.every((r) => /width="\d+"/.test(I.ROLE_SVGS[r])));
  ok('a role the app does not know still gets a mark', I.svgFor('quartermaster') === I.ROLE_SVGS.custom && I.svgFor('') === I.ROLE_SVGS.custom);
  ok('a role is read whatever its case and spacing', I.svgFor('  Coder ') === I.ROLE_SVGS.coder);
  ok('the person asking has one too', /^<svg /.test(I.YOU_SVG));
  ok('no mark is a picture typed as text', !PICTURE.test(JSON.stringify(I.ROLE_SVGS) + I.YOU_SVG));
}

console.log('\nNothing in the Swarm carries a typed picture:');
{
  ok('no starter team saves an icon', !JSON.stringify(TEMPLATES).includes('"icon"'));
  ok('and no starter team holds a picture at all', !PICTURE.test(JSON.stringify(TEMPLATES)));
  const mode = src('modes', 'agent-maker', 'mode.js');
  ok('the Swarm draws its marks from the shared set', /window\.HCSwarmRoleIcons\.ROLE_SVGS/.test(mode) && /window\.HCSwarmRoleIcons\.ORDER/.test(mode));
  ok('a new agent is given no icon to type', !/name: "New Agent", icon:/.test(mode));
  ok('the God Agent is not shown one in its schema', !/"icon":/.test(mode));
  ok('nothing in the Swarm is a picture typed as text', !PICTURE.test(mode), (mode.match(PICTURE) || [])[0]);
  const ws = src('js', 'swarm', 'workspace.js');
  ok('a run\'s conversation draws the mark for the role', /replaceChildren\(ICONS\(\)\.nodeFor\(t\.kind === 'you' \? 'you' : t\.role\)\)/.test(ws) && /replaceChildren\(ICONS\(\)\.nodeFor\(agent\.role\)\)/.test(ws));
  ok('the conversation still writes markup in only one place, for agent text', (ws.match(/\.innerHTML\s*=/g) || []).length === 1);
  ok('an agent\'s saved icon is no longer drawn', !/avatar\.textContent = (?:t|agent)\.icon/.test(ws));
  ok('the mark is sized in the stylesheet', /\.amk-ws-avatar svg \{[^}]*width/.test(src('modes', 'agent-maker', 'mode.css')));
}

console.log(`\n${pass} passed, ${fail} failed  (src/js/swarm/role-icons.js)`);
process.exit(fail ? 1 : 0);
