// ==============================================================
// What looks like a secret — checks
//
// Loads the real src/js/secret-shapes.js and holds which files are told
// apart as ones that usually hold keys, in both directions: each kind that
// must be, and the look-alikes that must not be, so an ordinary file is
// never held up by mistake.
//
// Run with: npm run check:secret-shapes
// ==============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const src = (...p) => readFileSync(join(here, '..', '..', 'src', ...p), 'utf8');
const sandbox = { console };
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(src('js', 'secret-shapes.js'), sandbox, { filename: 'secret-shapes.js' });
const K = sandbox.HCSecretShapes;

let pass = 0, fail = 0;
function ok(label, cond, detail = '') {
  if (cond === true) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}

console.log('\nFiles that usually hold keys:');
{
  const secret = ['.env', '.env.local', '.env.production', 'app/config/.env', 'server.pem', 'keys/private.key', 'id_rsa', 'id_ed25519', 'cert.p12', 'cert.pfx', 'store.keystore', 'vault.kdbx',
    '.netrc', '.pgpass', '.git-credentials', 'credentials', 'credentials.json', 'secrets.yaml', 'secret.yml', 'config/secrets.toml', 'secrets.json'];
  const missed = secret.filter((p) => K.isSecretFile(p) !== true);
  ok('each kind is told apart, at the top of a project or deep in it', missed.length === 0, missed.join(', '));
  ok('...written with either kind of slash, or in capitals', K.isSecretFile('C:\\work\\shop\\.env') === true && K.isSecretFile('C:\\work\\shop\\keys\\Server.PEM') === true && K.isSecretFile('/work/shop/.ENV') === true);
}

console.log('\nFiles that only look like it:');
{
  const plain = ['.env.example', '.env.sample', '.env.template', '.env.dist', 'config/.env.example', 'env.js', 'environment.ts', 'keys.js', 'monkey.js', 'credentials.md', 'credentials-helper.js',
    'secrets-guide.md', 'README.md', 'src/app.js', 'config.json', 'package.json', 'id_card.png', 'docs/keyboard.md'];
  const held = plain.filter((p) => K.isSecretFile(p) !== false);
  ok('none of them is held up', held.length === 0, held.join(', '));
  ok('nothing at all is not one', K.isSecretFile('') === false && K.isSecretFile(null) === false && K.isSecretFile(undefined) === false);
}

console.log('\nText shaped like a key:');
{
  // Each key is written in two pieces and joined here, so this file holds no
  // key-shaped string of its own: the commit hook would refuse it otherwise.
  const k = (a, b) => a + b;
  const hook = readFileSync(join(here, '..', '..', '.githooks', 'pre-commit'), 'utf8');
  const hookShapes = [...hook.matchAll(/^check_pattern '([^']+)'/gm)].map((m) => new RegExp(m[1]));
  const byHook = (t) => hookShapes.some((re) => re.test(t));
  ok('there is one list of shapes, and a value written after a name that says it is secret', Array.isArray(K.SHAPES) && K.SHAPES.length > 0 && typeof K.NAMED.test === 'function');
  // A sample of each shape, in the list's order; the ones the commit hook does not know are named with the reason.
  const samples = [k('sk-', 'proj-abc123DEF456ghi789JKL012mno'), k('sk_', 'live_abc123DEF456ghi789JKL012'), k('gsk_', 'abc123DEF456ghi789JKL012mno345PQR678'),
    k('AIza', 'SyABC123def456GHI789jkl012MNO345pqr'), k('xai-', 'abc123DEF456ghi789JKL012mno'), k('hf_', 'abc123DEF456ghi789JKL012'), k('csk-', 'abc123DEF456ghi789JKL012'),
    k('fw_', 'abc123DEF456ghi789JKL012'), k('nvapi-', 'abc123DEF456ghi789JKL012'), k('tvly-', 'abc123DEF456ghi789'), k('ghp_', 'abc123DEF456ghi789JKL012mno345PQR'),
    k('github_pat_', '11ABCDEFG0abc123DEF456ghi789'), k('AKIA', 'ABCDEFGHIJKLMNOP'), k('xoxb-', '123456789012-abcdefABCDEF'),
    k('-----BEGIN ', 'RSA PRIVATE KEY-----\nabc\n-----END RSA PRIVATE KEY-----'), k('Bearer ', 'abc123DEF456ghi789JKL012mno'), k('BEGIN ', 'OPENSSH PRIVATE KEY')];
  const PAGE_ONLY = {
    1: 'a payment service\'s live and test keys: never a key this app is given, kept from a model all the same',
    11: 'a code host\'s fine-grained tokens: the hook catches the older shapes of the same host',
    15: 'a header line carrying a token, as a command prints it: a value, not a key shape a file is committed with',
  };
  ok('there is a sample for each shape', samples.length === K.SHAPES.length, `${samples.length} samples, ${K.SHAPES.length} shapes`);
  const own = samples.map((t, i) => (new RegExp(K.SHAPES[i].source, K.SHAPES[i].flags.replace('g', '')).test(t) ? '' : i)).filter((x) => x !== '');
  ok('each sample is caught by its own shape', own.length === 0, own.join(', '));
  const notHook = samples.map((t, i) => i).filter((i) => !byHook(samples[i]) && !PAGE_ONLY[i]);
  ok('the commit hook catches each of them too, but those named with their reason', notHook.length === 0, notHook.join(', '));
  const stale = Object.keys(PAGE_ONLY).filter((i) => byHook(samples[i]));
  ok('...and a shape named as the page\'s own is one the hook really does not catch', stale.length === 0, stale.join(', '));
  const scan = readFileSync(join(here, 'secret-scan.mjs'), 'utf8');
  const examples = [...scan.matchAll(/k\('([^']*)', '([^']*)'\)/g)].map((m) => m[1] + m[2]).filter((t) => byHook(t));
  const missed = examples.filter((t) => !K.looksLikeKey(t));
  ok('every key the repository\'s own scan is proven against is caught here', examples.length >= 12 && missed.length === 0, `${examples.length} examples, missed: ${missed.map((t) => t.slice(0, 6)).join(', ')}`);
  const r = K.redact(`key ${samples[0]} and ${k('token = ', 'abc123DEF456ghi789')} end`);
  ok('a key is replaced and counted, and so is a value after a name that says it is secret', r.count === 2 && !r.text.includes('abc123DEF456') && r.text.startsWith('key [redacted: looked like a key]') && r.text.includes('token = [redacted: looked like a key]'), JSON.stringify(r));
  ok('the mark can say how long it was', K.redact(samples[2], (m) => `[${m.length} characters]`).text === `[${samples[2].length} characters]`);
  const plain = 'task-management and risk-assessment, desk-booking, ask-for-permission';
  ok('ordinary words are not keys', K.looksLikeKey(plain) === false && K.redact(plain).text === plain && K.redact(plain).count === 0);
}

console.log('\nOne home for the rule:');
{
  const perms = src('js', 'code', 'permissions.js');
  const boot = src('boot.js');
  ok('the command rules ask it, and keep no copy of their own', /window\.HCSecretShapes/.test(perms) && !/const SECRET_FILE = \//.test(perms));
  const debug = src('js', 'code', 'debug-export.js'), lessons = src('js', 'code', 'lessons.js');
  ok('the debug export and the lessons ask it for key shapes, and keep no copy of their own', /window\.HCSecretShapes/.test(debug) && !/const SHAPES = \[/.test(debug) && /window\.HCSecretShapes/.test(lessons) && !/const SECRET = \//.test(lessons));
  const at = boot.indexOf("'/js/secret-shapes.js'");
  ok('it is loaded before the files that use it', at > 0 && ['permissions.js', 'lessons.js', 'debug-export.js'].every((f) => at < boot.indexOf(`'/js/code/${f}'`)));
  ok('it is part of npm run check', /npm run check:secret-shapes/.test(readFileSync(join(here, '..', '..', 'package.json'), 'utf8')));
}

console.log(`\n${pass} passed, ${fail} failed  (src/js/secret-shapes.js)`);
process.exit(fail ? 1 : 0);
