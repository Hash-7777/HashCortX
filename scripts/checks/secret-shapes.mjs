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

console.log('\nOne home for the rule:');
{
  const perms = src('js', 'code', 'permissions.js');
  const boot = src('boot.js');
  ok('the command rules ask it, and keep no copy of their own', /window\.HCSecretShapes/.test(perms) && !/const SECRET_FILE = \//.test(perms));
  ok('it is loaded before the files that use it', boot.indexOf("'/js/secret-shapes.js'") > 0 && boot.indexOf("'/js/secret-shapes.js'") < boot.indexOf("'/js/code/permissions.js'"));
  ok('it is part of npm run check', /npm run check:secret-shapes/.test(readFileSync(join(here, '..', '..', 'package.json'), 'utf8')));
}

console.log(`\n${pass} passed, ${fail} failed  (src/js/secret-shapes.js)`);
process.exit(fail ? 1 : 0);
