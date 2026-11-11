// ==============================================================
// What looks like a secret
//
// Files that usually hold keys and passwords, told apart by their names:
// environment files, private keys and certificates, key stores, the files
// command-line tools keep sign-ins in, and files named as secrets or
// credentials. An example of one (.env.example, .sample, .template, .dist)
// is not one. The rule has one home, here, and every part of the app that
// needs it asks this file.
//
// Pure. Published as window.HCSecretShapes. Checked by scripts/checks/secret-shapes.mjs.
// ==============================================================
(function () {
  "use strict";

  /** A file that holds secrets by what it is called. */
  const SECRET_FILE = /(?:^|\/)(?:\.env(?:\.(?!example$|sample$|template$|dist$)[^/]*)?|[^/]*\.(?:pem|key|p12|pfx|keystore|kdbx)|id_(?:rsa|dsa|ecdsa|ed25519)[^/]*|\.netrc|\.pgpass|\.git-credentials|credentials(?:\.json)?|secrets?\.(?:json|ya?ml|toml))$/i;

  /** Whether the file at `path` is one that usually holds keys, written with either kind of slash. */
  const isSecretFile = (path) => !!path && SECRET_FILE.test(String(path).replace(/\\/g, "/"));

  window.HCSecretShapes = { SECRET_FILE, isSecretFile };
})();
