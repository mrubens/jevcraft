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
  const path = require('node:path');
  const label = `${config.host}-${config.port}-${config.username}`;
  // The flight recording the audits read; JEV_FLIGHT=0 turns it off.
  const recorder = process.env.JEV_FLIGHT === '0' ? null
    : require('./src/recorder').startRecorder({ directory: path.join(__dirname, '.bot-state', 'flight'), label });
  // Which process is this bot: scripts stop a bot by its pid file.
  const pidFile = path.join(__dirname, '.bot-state', 'pids', `${label.replace(/[^\w.-]/g, '_')}.pid`);
  const fs = require('node:fs');
  fs.mkdirSync(path.dirname(pidFile), { recursive: true }); fs.writeFileSync(pidFile, `${process.pid}\n`);
  process.once('exit', () => { try { if (fs.readFileSync(pidFile, 'utf8').trim() === String(process.pid)) fs.unlinkSync(pidFile); } catch (_) {} });
  try {
    await reconnect(() => createSession(config, client, { recorder }), {
      signal: shutdown.signal, report: event => console.log(JSON.stringify({ connection: event })),
    });
  } finally { await recorder?.close(); }
}
main().then(() => process.exit(0), err => { console.error(err); process.exit(1); });
