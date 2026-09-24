const http = require('node:http');
const { settings } = require('./settings');
const { route } = require('./routes');

const { port, host } = settings();
http.createServer(route).listen(port, host, () => {
  console.log(`listening on http://${host}:${port}`);
});
