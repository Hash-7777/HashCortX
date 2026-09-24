const path = require('node:path');
const defaults = require(path.join(__dirname, '..', 'config', 'default.json'));

// The server settings: the defaults, with PORT from the environment if it is set.
function settings() {
  return { ...defaults, port: Number(process.env.PORT) || defaults.port };
}

module.exports = { settings };
