'use strict';
// A restart asked for from outside (a new build to run) waits for a quiet
// moment: killed mid-fight, a bot rejoined in the same fight a second later
// with nothing decided, or back in its boat, or on its span. Five of the
// midgame deaths of 2026-09-27 followed a restart by seconds (notes 338,
// 353, 357, 358, 361). The request is a file touched after the process
// began; the bot quits once nothing hostile is within sixteen blocks and it
// stands on dry ground, off any span or seat, or after five minutes anyway.
// A bot that quits is started again by its port's supervisor
// (scripts/trials/supervisor.sh); with none running nothing does, and
// mid-242-bd stood down at minute 33 for three hours, judged "missing after
// 3 hours" on 33 minutes of play (note 640). So it quits only where a
// supervisor is watching its port, and says so when it stays.
const fs = require('fs');
const { execFileSync } = require('child_process');

const WAIT_MS = 5 * 60000;

function quiet(bot) {
  const e = bot.entity;
  if (!e || !bot.isAlive) return false;
  if (e.onGround === false || e.isInWater || e.isInLava || bot.vehicle || bot._seatedIn != null || bot._spanning) return false;
  try { if (require('./danger').hostileEntities(bot, 16).length) return false; } catch (_) { return false; }
  return true;
}

// Is a supervisor running for this port? (Asked of the process list, as
// retry.sh does; anything that cannot be asked counts as none.)
function supervised(port) {
  if (!Number.isInteger(Number(port)) || !port) return false;
  try { return execFileSync('pgrep', ['-f', `supervisor.sh ${Number(port)}$`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim().length > 0; } catch (_) { return false; }
}

function watchRestartRequest(bot, file, { startedAt = Date.now(), every = 2000, exit = () => process.exit(0), now = () => Date.now(), port = null, watched = supervised, say = m => console.log(m) } = {}) {
  let askedAt = null, saidUnwatched = false, checkedAt = -Infinity, isWatched = false;
  const timer = setInterval(() => {
    let mtime = 0;
    try { mtime = fs.statSync(file).mtimeMs; } catch (_) { return; }
    if (mtime <= startedAt) return;
    askedAt ??= now();
    // The process list is asked every fifteen seconds, not every look.
    if (now() - checkedAt >= 15000) { isWatched = watched(port); checkedAt = now(); }
    if (!isWatched) {
      if (!saidUnwatched) say(`[restart] asked for, but no supervisor is watching port ${port}: staying up on this build (sh scripts/trials/supervisor.sh ${port} starts one, and the restart follows)`);
      saidUnwatched = true;
      askedAt = now();
      return;
    }
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

module.exports = { watchRestartRequest, quiet, supervised, WAIT_MS };
