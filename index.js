'use strict';
require('./src/env').loadEnv();
const { TypeSafe } = require('./src/typesafe');
const { createSession } = require('./src/session');
const { reconnect } = require('./src/reconnect');

const config = {
  host: process.env.MC_HOST || 'localhost', port: Number(process.env.MC_PORT || 25565),
  username: process.env.MC_USERNAME || 'Jev', auth: process.env.MC_AUTH || 'offline',
  version: process.env.MC_VERSION || false,
};
const client = new TypeSafe();
const shutdown = new AbortController();
for (const event of ['SIGINT', 'SIGTERM']) process.once(event, () => shutdown.abort());
async function main() {
  let harness;
  if (process.env.JEV_DASHBOARD_PORT) {
    const path = require('node:path');
    harness = await require('./src/harness/server').startHarness({ port: Number(process.env.JEV_DASHBOARD_PORT),
      artifacts: path.join(__dirname, 'artifacts'), stateDirectory: path.join(__dirname, '.bot-state') });
    console.log(`[dashboard] ${harness.url}`);
  }
  try {
    await reconnect(() => createSession(config, client, { harness }), {
      signal: shutdown.signal, report: event => console.log(JSON.stringify({ connection: event })),
    });
  } finally { await harness?.close(); }
}
main().then(() => process.exit(0), err => { console.error(err); process.exit(1); });
