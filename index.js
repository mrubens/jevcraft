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
  // The event loop held: mid-226-a's record went silent for twenty-three
  // seconds on its way home, under water, and came back drowning with no
  // breath (2026-09-26). Any stall of two seconds or more is said, with
  // what the bot was doing, so the code that held it can be found.
  // And caught in the act (note 1587): a CPU profile kept rolling, the window of a stall written out with its hottest frames.
  // On only when asked (JEV_STALL_PROFILE=1, note 2596): the profile is stopped and read back on the main thread every
  // twenty seconds, and with the machine loaded that read held the loop itself. The full runs of 2026-10-30 16:4xZ
  // (load average 50 on sixteen cores) logged 54 stalls of 2 to 12.7 seconds in an hour, 34 of them led by the
  // profiler's own call ('self post node:inspector:115 11964 ms' on full-203, 16:43:56Z, the bot in water).
  const stallProfiler = process.env.JEV_STALL_PROFILE !== '1' ? null : require('./src/stall-profiler').startStallProfiler({ directory: path.join(__dirname, 'artifacts', 'stall-profiles') });
  let tickAt = Date.now();
  setInterval(() => {
    const lag = Date.now() - tickAt - 250;
    if (lag >= 1500) stallProfiler?.stalled(lag);
    if (lag >= 2000) {
      // The work's step beside the survival layer's, and the slow search that
      // ended in the hold where there was one (note 795: 655 of 2,818 holds
      // said neither, the survival goal not yet reported).
      const bot = global.__jevBot, goal = bot?._survivalGoal, slow = bot?._slowLast;
      const what = { lagMs: lag, step: goal?.step?.action, survival: goal?.survivalAction?.action, work: bot?._goal?.step?.action,
        ...(slow && slow.at >= Date.now() - lag - 1000 ? { slow: `${slow.what} ${slow.ms} ms (${slow.caller})` } : {}), at: new Date().toISOString() };
      console.log(`[lag] event loop held ${(lag / 1000).toFixed(1)}s ${JSON.stringify(what)}`);
      recorder?.record?.({ kind: 'lag', label: `event loop held ${(lag / 1000).toFixed(1)}s`, at: what.at, detail: what });
    }
    tickAt = Date.now();
  }, 250).unref();
  fs.mkdirSync(path.dirname(pidFile), { recursive: true }); fs.writeFileSync(pidFile, `${process.pid}\n`);
  process.once('exit', () => { try { if (fs.readFileSync(pidFile, 'utf8').trim() === String(process.pid)) fs.unlinkSync(pidFile); } catch (_) {} });
  try {
    await reconnect(() => createSession(config, client, { recorder }), {
      signal: shutdown.signal, report: event => console.log(JSON.stringify({ connection: event })),
    });
  } finally { await recorder?.close(); }
}
main().then(() => process.exit(0), err => { console.error(err); process.exit(1); });
