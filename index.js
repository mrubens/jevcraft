'use strict';
require('./src/env').loadEnv();
const { TypeSafe } = require('./src/typesafe');
const { createSession } = require('./src/session');
const { reconnect } = require('./src/reconnect');

const config = {
  host: process.env.MC_HOST || 'localhost', port: Number(process.env.MC_PORT || 25565),
  username: process.env.MC_USERNAME || 'JevBot', auth: process.env.MC_AUTH || 'offline',
  version: process.env.MC_VERSION || false,
};
const client = new TypeSafe();
const shutdown = new AbortController();
for (const event of ['SIGINT', 'SIGTERM']) process.once(event, () => shutdown.abort());
reconnect(() => createSession(config, client), {
  signal: shutdown.signal,
  report: event => console.log(JSON.stringify({ connection: event })),
}).then(() => process.exit(0), err => { console.error(err); process.exit(1); });
