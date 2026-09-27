'use strict';
// A restart asked for from outside (a new build to run) waits for a quiet
// moment: killed mid-fight, a bot rejoined in the same fight a second later
// with nothing decided, or back in its boat, or on its span. Five of the
// midgame deaths of 2026-09-27 followed a restart by seconds (notes 338,
// 353, 357, 358, 361). The request is a file touched after the process
// began; the bot quits once nothing hostile is within sixteen blocks and it
// stands on dry ground, off any span or seat, or after five minutes anyway.
const fs = require('fs');

const WAIT_MS = 5 * 60000;

function quiet(bot) {
  const e = bot.entity;
  if (!e || !bot.isAlive) return false;
  if (e.onGround === false || e.isInWater || e.isInLava || bot.vehicle || bot._seatedIn != null || bot._spanning) return false;
  try { if (require('./danger').hostileEntities(bot, 16).length) return false; } catch (_) { return false; }
  return true;
}

function watchRestartRequest(bot, file, { startedAt = Date.now(), every = 2000, exit = () => process.exit(0), now = () => Date.now() } = {}) {
  let askedAt = null;
  const timer = setInterval(() => {
    let mtime = 0;
    try { mtime = fs.statSync(file).mtimeMs; } catch (_) { return; }
    if (mtime <= startedAt) return;
    askedAt ??= now();
    if (quiet(bot) || now() - askedAt > WAIT_MS) {
      clearInterval(timer);
      console.log(`[restart] asked for, and ${quiet(bot) ? 'quiet now' : 'five minutes waited'}: quitting for the new build`);
      try { bot.quit('restart for a new build'); } catch (_) { /* gone already */ }
      setTimeout(exit, 500);
    }
  }, every);
  timer.unref?.();
  return () => clearInterval(timer);
}

module.exports = { watchRestartRequest, quiet, WAIT_MS };
