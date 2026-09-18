'use strict';
const { setTimeout: delay } = require('node:timers/promises');

async function reconnect(connect, { signal, report = () => {}, initialDelay = 1000, maximumDelay = 30000 } = {}) {
  let failures = 0;
  while (!signal?.aborted) {
    const session = connect();
    const shutdown = () => session.shutdown();
    signal?.addEventListener('abort', shutdown, { once: true });
    if (signal?.aborted) shutdown();
    let ended;
    try { ended = await session.closed; }
    finally { signal?.removeEventListener('abort', shutdown); }
    if (signal?.aborted) return;
    if (ended.spawned && ended.uptimeMs >= 30000) failures = 0;
    const waitMs = Math.min(maximumDelay, initialDelay * 2 ** Math.min(failures++, 10));
    report({ ...ended, retryInMs: waitMs });
    try { await delay(waitMs, undefined, { signal }); }
    catch (err) { if (!signal?.aborted) throw err; }
  }
}

module.exports = { reconnect };
