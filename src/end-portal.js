'use strict';
const { Vec3 } = require('vec3');
const { goals } = require('mineflayer-pathfinder');
const { portalAt } = require('./stronghold');
const { dimension, observeProgress } = require('./game-progress');
const { countOf, surveyRoute } = require('./skills');
const { dryMiningPositions, dryStanding, miningReach, miningMovement } = require('./mining-access');
const { dryPassable } = require('./terrain');
const { checkAir } = require('./vitals');
const { checkThreats, safeFromHostiles } = require('./danger');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const vector = p => new Vec3(p.x, p.y, p.z);
const blocked = message => Object.assign(new Error(message), { name: 'Blocked' });

function activePortal(bot, center) {
  for (let x = -1; x <= 1; x++) for (let z = -1; z <= 1; z++) {
    if (bot.blockAt(center.offset(x, 0, z))?.name !== 'end_portal') return false;
  }
  return true;
}

async function enterEnd(bot, task, goal, save, actions, { confirmationMs = 3000, entryMs = 12000 } = {}) {
  const check = () => {
    task.check(); checkAir(bot); checkThreats(bot);
    if (bot.health < 12 || bot.isAlive === false) throw blocked('End portal work interrupted by low health');
  };
  check();
  if (bot.game.gameMode !== 'survival') throw blocked('End portal entry requires Survival mode');
  if (dimension(bot) === 'end') { observeProgress(bot, goal); save(); return; }
  if (dimension(bot) !== 'overworld' || !goal.endPortal?.center) throw blocked('End entry requires an observed Overworld portal ring');
  const center = vector(goal.endPortal.center), portal = portalAt(bot, center);
  if (!portal) throw blocked('The saved End portal ring is not fully visible or has changed');
  goal.endPortal = { ...goal.endPortal, ...portal, neededEyes: portal.frames.filter(f => !f.eye).length }; save();
  // Persist the real requirement so the progression controller can replenish
  // supplies through its ordinary Overworld/Nether dependency chain.
  if (countOf(bot, 'ender_eye') < goal.endPortal.neededEyes) return;
  const movement = bot.pathfinder.movements, policy = miningMovement(bot);
  const previous = { allowedPosition: movement.allowedPosition, scafoldingBlocks: movement.scafoldingBlocks, allow1by1towers: movement.allow1by1towers };
  const outside = p => Math.abs(Math.floor(p.x) - center.x) > 1 || Math.abs(Math.floor(p.z) - center.z) > 1;
  movement.allowedPosition = p => outside(p) && policy.allowed(p);
  movement.scafoldingBlocks = []; movement.allow1by1towers = false;
  const approach = async positions => {
    // Unfilled frames are only 13/16 of a block high. An integer GoalBlock
    // atop one can appear reached to the planner but fail after real landing.
    // Interact from ordinary surrounding footing instead of using frame tops.
    for (const p of positions.filter(p => outside(p) && bot.blockAt(p.offset(0, -1, 0))?.name !== 'end_portal_frame').slice(0, 12)) {
      check();
      const destination = new goals.GoalBlock(p.x, p.y, p.z);
      const route = await surveyRoute(bot, task, movement, destination, 400);
      if (route.status !== 'success' || !route.path.every(movement.allowedPosition)) continue;
      await actions.navigate(bot, task, destination, { timeoutMs: 15000, stallMs: 4000 });
      check();
      if (dimension(bot) !== 'overworld') throw blocked('Dimension changed before verified portal entry');
      if (dryStanding(bot, bot.entity.position) && outside(bot.entity.position)) return;
    }
    throw blocked('No observed dry route to the outside of the End portal');
  };
  try {
    const missing = portal.frames.filter(f => !f.eye).sort((a, b) => vector(a.position).distanceTo(bot.entity.position) - vector(b.position).distanceTo(bot.entity.position));
    if (missing.length) {
      const position = vector(missing[0].position);
      if (!outside(bot.entity.position) || !dryStanding(bot, bot.entity.position) || !miningReach(bot, bot.entity.position, position)) {
        await approach(dryMiningPositions(bot, position, 24));
      }
      check();
      const fresh = portalAt(bot, center), frame = bot.blockAt(position);
      if (!fresh || frame.getProperties().eye || !miningReach(bot, bot.entity.position, position)) throw blocked('End portal frame changed or is out of interaction reach');
      const before = countOf(bot, 'ender_eye'), item = bot.inventory.items().find(i => i.name === 'ender_eye');
      if (!item || before < missing.length) throw blocked('End portal Eye supply changed before insertion');
      bot.pathfinder.setGoal(null); bot.clearControlStates(); await bot.equip(item, 'hand'); check();
      if (bot.heldItem?.name !== 'ender_eye') throw blocked('Eye of Ender was not equipped');
      goal.step = { action: 'insert_portal_eye', position: { ...position }, remainingFrames: missing.length }; save();
      await bot.activateBlock(frame, new Vec3(0, 1, 0));
      const deadline = Date.now() + confirmationMs;
      while (Date.now() < deadline) {
        check();
        if (bot.blockAt(position)?.getProperties?.().eye === true && countOf(bot, 'ender_eye') === before - 1) {
          const verified = portalAt(bot, center);
          if (!verified) throw blocked('End portal ring changed after insertion');
          goal.endPortal = { ...goal.endPortal, ...verified, neededEyes: verified.frames.filter(f => !f.eye).length };
          goal.endPortal.insertions ||= [];
          goal.endPortal.insertions.push({ at: Date.now(), position: { ...position }, consumed: 1 }); save(); return;
        }
        await sleep(50);
      }
      throw blocked('End portal Eye insertion lacks both frame and inventory confirmation');
    }
    if (!activePortal(bot, center)) throw blocked('Filled frames have not produced nine observed active End portal blocks');
    // Approach a cardinal edge. The final short crossing intentionally enters
    // verified portal cells; the general pathfinder cannot treat a lava-backed
    // portal interior as ordinary dry walking terrain.
    const edges = [];
    for (const [dx, dz] of [[3, 0], [-3, 0], [0, 3], [0, -3]]) for (const dy of [0, 1]) {
      const p = center.offset(dx, dy, dz), frame = center.offset(dx / 3 * 2, 0, dz / 3 * 2);
      if (dryStanding(bot, p) && safeFromHostiles(bot, p) && [1, 2, 3].every(y => dryPassable(bot.blockAt(frame.offset(0, y, 0))))) edges.push(p);
    }
    edges.sort((a, b) => a.distanceTo(bot.entity.position) - b.distanceTo(bot.entity.position));
    await approach(edges);
    bot.pathfinder.setGoal(null); bot.clearControlStates();
    goal.endPortal.activeVerifiedAt = Date.now(); goal.step = { action: 'enter_end_portal', center: { ...center } }; save();
    const deadline = Date.now() + entryMs;
    let contacted = false;
    while (dimension(bot) === 'overworld' && Date.now() < deadline) {
      check();
      if (!activePortal(bot, center)) throw blocked('End portal changed during entry');
      const p = bot.entity.position, target = center.offset(.5, 1.62, .5), distance = Math.hypot(target.x - p.x, target.z - p.z);
      if (!contacted && !outside(p) && p.y <= center.y + .75) {
        contacted = true; goal.step = { action: 'await_end_transition', center: { ...center } }; save();
      }
      // Client physics can keep falling through the portal while the server
      // generates End chunks and sends the respawn packet. Stop steering and
      // await that packet within the same deadline; contact is not success.
      if (contacted) { bot.clearControlStates(); await sleep(50); continue; }
      if (p.y < center.y - .5 || distance > 5) throw blocked('Moved away from the verified portal crossing');
      await bot.lookAt(target, true);
      bot.setControlState('jump', outside(p) && distance > 1.6);
      bot.setControlState('forward', distance > .25);
      await sleep(50);
    }
    task.check();
    if (dimension(bot) !== 'end' || bot.health <= 0 || bot.isAlive === false) throw blocked('No living End dimension transition confirmed');
    bot.clearControlStates(); observeProgress(bot, goal); save();
  } finally {
    bot.pathfinder.setGoal(null); bot.clearControlStates(); bot.deactivateItem();
    Object.assign(movement, previous); policy.restore();
  }
}

module.exports = { activePortal, enterEnd };
