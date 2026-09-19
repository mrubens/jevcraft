'use strict';
const { Vec3 } = require('vec3');
const { countOf } = require('./skills');
const { fillWaterBucket } = require('./water');
const { dryStanding } = require('./mining-access');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const down = new Vec3(0, -1, 0);

function fallDanger(bot) {
  const e = bot.entity;
  if (!e || e.onGround !== false || e.isInWater || e.isInLava || !e.velocity) return false;
  if (e.velocity.y > .6) return true;
  if (e.velocity.y >= -.2) return false;
  const hit = bot.world.raycast(e.position.offset(0, .1, 0), down, 4);
  return !hit || e.velocity.y < -.9;
}

// Physics emits this tick after prediction and before the position packet.
// Use the previous transmitted position for server reach/aim, and the current
// predicted landing column for the destination. No distant water placement,
// client-only fluid or position edits are used.
function clutchTarget(bot, serverPosition) {
  const feet = bot.entity.position, eye = serverPosition.offset(0, 1.62, 0);
  const hit = bot.world.raycast(feet.offset(0, 1.62, 0), down, 5);
  if (!hit?.position) return null;
  const support = bot.blockAt(hit.position), p = hit.position.offset(0, 1, 0);
  if (support?.boundingBox !== 'block' || ['magma_block', 'cactus'].includes(support.name) ||
    !['air', 'cave_air', 'void_air'].includes(bot.blockAt(p)?.name)) return null;
  const aim = new Vec3(feet.x, p.y - .001, feet.z), delta = aim.minus(eye);
  if (delta.norm() > 4.5 || feet.y < p.y - .1) return null;
  const sight = bot.world.raycast(eye, delta.unit(), delta.norm() + .01);
  if (!sight?.position?.equals(hit.position)) return null;
  return { position: p, yaw: Math.atan2(-delta.x, -delta.z), pitch: Math.atan2(delta.y, Math.hypot(delta.x, delta.z)) };
}

async function recoverFall(bot, task, goal, save, { timeoutMs = 12000, refill = true } = {}) {
  task.check();
  if (!fallDanger(bot)) return false;
  const dimension = bot.game.dimension, initialHealth = bot.health;
  const water = bot.inventory.items().find(i => i.name === 'water_bucket');
  if (!water) throw Object.assign(new Error('Airborne after knockback without a carried water bucket'), { name: 'Blocked' });
  if (String(dimension).includes('nether')) throw new Error('Water cannot protect a landing in the Nether');
  const before = countOf(bot, 'water_bucket'), emptyBefore = countOf(bot, 'bucket');
  bot.pathfinder.setGoal(null); bot.clearControlStates(); bot.stopDigging?.();
  const previousInterrupt = task.interruptCheck; task.interruptCheck = undefined;
  let previous = bot.entity.position.clone(), used, failure, wetSince = 0, dryLanding;
  const check = () => {
    task.check();
    if (bot.game.dimension !== dimension || bot.health <= 0 || bot.isAlive === false) throw new Error('Fall recovery interrupted by dimension change or death');
  };
  const tick = () => {
    try {
      check();
      if (!used && bot.heldItem?.name === 'water_bucket' && bot.entity.velocity.y < 0) {
        const target = clutchTarget(bot, previous);
        if (target) {
          // Forced look updates the rotation carried in use_item immediately.
          // Send once, before this tick's movement packet; a repeated click
          // could pick the just-placed water back up with the now-empty bucket.
          bot.look(target.yaw, target.pitch, true).catch(err => { failure = err; });
          bot.activateItem(); used = { at: Date.now(), position: target.position, serverPosition: previous.clone() };
        }
      }
    } catch (err) { failure = err; }
    previous = bot.entity.position.clone();
  };
  try {
    await bot.equip(water, 'hand'); check();
    goal.step = { action: 'protect_fall_with_water', from: { ...bot.entity.position }, velocity: { ...bot.entity.velocity } }; save();
    bot.on('physicsTick', tick);
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      check(); if (failure) throw failure;
      const converted = countOf(bot, 'water_bucket') === before - 1 && countOf(bot, 'bucket') === emptyBefore + 1;
      const inPlacedWater = used && bot.blockAt(used.position)?.name === 'water' &&
        bot.blockAt(bot.entity.position.floored())?.name === 'water' && Math.abs(bot.entity.velocity.y) < .3;
      if (converted && inPlacedWater) {
        wetSince ||= Date.now();
        if (Date.now() - wetSince >= 250) {
          const evidence = { at: Date.now(), source: { ...used.position }, landing: { ...bot.entity.position }, initialHealth,
            health: bot.health, waterConsumed: 1, sourceConfirmed: true };
          goal.fallRecoveries ||= []; goal.fallRecoveries.push(evidence); goal.fallRecoveries = goal.fallRecoveries.slice(-20); save();
          bot.emit('fall_recovery', evidence);
          if (refill) {
            await fillWaterBucket(bot, task, used.position, { guard: check });
            evidence.bucketRecovered = true; save();
          }
          return true;
        }
      } else wetSince = 0;
      if (bot.entity.onGround && Math.abs(bot.entity.velocity.y) < .1 && dryStanding(bot, bot.entity.position)) {
        if (!dryLanding || dryLanding.position.distanceTo(bot.entity.position) > .3) dryLanding = { at: Date.now(), position: bot.entity.position.clone() };
        if (Date.now() - dryLanding.at >= 150) {
          // Horizontal knockback can carry the player past the placed water.
          // A real dry landing ends the airborne emergency; it does not prove
          // that water protected the fall. Recover the spent bucket if the
          // observed source is still reachable instead of waiting for water
          // immersion that cannot occur while standing still on dry ground.
          const evidence = { at: Date.now(), landing: { ...bot.entity.position }, initialHealth, health: bot.health,
            outcome: 'stable_dry_landing', waterProtectionConfirmed: false, attemptedWater: !!used,
            source: used && { ...used.position }, waterConsumed: converted ? 1 : 0 };
          goal.lastFallLanding = evidence; save(); bot.emit('fall_recovery', evidence);
          if (refill && converted && used) {
            await fillWaterBucket(bot, task, used.position, { guard: check });
            evidence.bucketRecovered = true; save();
          }
          return false;
        }
      } else dryLanding = undefined;
      await sleep(10);
    }
    throw new Error('No living landing in server-confirmed placed water within the fall-recovery deadline');
  } finally {
    bot.removeListener('physicsTick', tick); bot.deactivateItem(); bot.clearControlStates(); task.interruptCheck = previousInterrupt;
  }
}
module.exports = { fallDanger, clutchTarget, recoverFall };
