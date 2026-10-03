'use strict';
// A restart asked for from outside (a new build to run) waits for a quiet
// moment: killed mid-fight, a bot rejoined in the same fight a second later
// with nothing decided, or back in its boat, or on its span. Five of the
// midgame deaths of 2026-09-27 followed a restart by seconds (notes 338,
// 353, 357, 358, 361). The request is a file touched after the process
// began; the bot quits once nothing hostile is within sixteen blocks and it
// stands on dry ground, off any span or seat, or after fifteen minutes anyway.
// A bot that quits is started again by its port's supervisor
// (scripts/trials/supervisor.sh); with none running nothing does, and
// mid-242-bd stood down at minute 33 for three hours, judged "missing after
// 3 hours" on 33 minutes of play (note 640). So it quits only where a
// supervisor is watching its port, and says so when it stays.
const fs = require('fs');
const { execFileSync } = require('child_process');

// Fifteen minutes, and quiet means healed and out of a shooter's reach too
// (note 988): 25593 (2026-10-03 05:47:11Z), six rods banked and one wanted,
// quit for a new build at 11.2 health in the middle of leaving four blazes
// to heal, the nearest 19 blocks off and so "quiet"; back eight seconds
// later with nothing held it was shot at once and was dead in half a
// minute. With a build shipped every ten minutes or so the five minutes'
// wait ran out in most fights.
const WAIT_MS = 15 * 60000;
// Past the fifteen minutes it still waits for a calmer moment, and only
// past forty-five quits whatever (note 1002): in a long fight no moment is
// quiet by the rule above, the fifteen minutes ran out inside it, and 25589
// (2026-10-03 07:06:43Z) was quit at 3 health with a skeleton shooting it.
const LAST_MS = 45 * 60000, CALM_HEALTH = 10;
const QUIET_HEALTH = 16, SHOOTER_REACH = 48;
const SHOOTERS = /^(blaze|ghast|skeleton|stray|bogged|pillager|wither_skeleton|piglin|piglin_brute|hoglin)$/;

function quiet(bot) {
  const e = bot.entity;
  if (!e || !bot.isAlive) return false;
  if (e.onGround === false || e.isInWater || e.isInLava || bot.vehicle || bot._seatedIn != null || bot._spanning) return false;
  if ((bot.health ?? 20) < QUIET_HEALTH) return false;
  try {
    const danger = require('./danger');
    if (danger.hostileEntities(bot, 24).length) return false;
    if (danger.hostileEntities(bot, SHOOTER_REACH).some(x => SHOOTERS.test(x.name))) return false;
  } catch (_) { return false; }
  try { if (require('./combat-estimate').burnLeft(bot) > 0) return false; } catch (_) { /* not read: not held against it */ }
  return true;
}

// Calm enough once the wait has run long: nothing hostile within sixteen,
// on dry ground off any span or seat, ten health or more and not alight.
function calm(bot) {
  const e = bot.entity;
  if (!e || !bot.isAlive) return false;
  if (e.onGround === false || e.isInWater || e.isInLava || bot.vehicle || bot._seatedIn != null || bot._spanning) return false;
  if ((bot.health ?? 20) < CALM_HEALTH) return false;
  try { if (require('./danger').hostileEntities(bot, 16).length) return false; } catch (_) { return false; }
  try { if (require('./combat-estimate').burnLeft(bot) > 0) return false; } catch (_) { /* not read: not held against it */ }
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
    const waited = now() - askedAt;
    const why = quiet(bot) ? 'quiet now' : waited > LAST_MS ? 'forty-five minutes waited' : waited > WAIT_MS && calm(bot) ? 'fifteen minutes waited and calm now' : null;
    if (why) {
      clearInterval(timer);
      console.log(`[restart] asked for, and ${why}: quitting for the new build`);
      try { bot.quit('restart for a new build'); } catch (_) { /* gone already */ }
      setTimeout(exit, 500);
    }
  }, every);
  timer.unref?.();
  return () => clearInterval(timer);
}

module.exports = { watchRestartRequest, quiet, calm, supervised, WAIT_MS, LAST_MS };
