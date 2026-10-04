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

// A cave through the portal room can take its floor: in the rehearsal
// world the ring hung over open air with the silverfish stairs the only
// footing, out of reach of the far frames. Then the footing is laid: any
// open cell beside the frame and outside the ring, within reach of it,
// is a place to stand once a block is put under it.
function bridgeFootings(bot, frame, outside) {
  const out = [];
  for (let dx = -3; dx <= 3; dx++) for (let dz = -3; dz <= 3; dz++) for (const dy of [0, 1]) {
    const p = frame.offset(dx, dy, dz), below = bot.blockAt(p.offset(0, -1, 0));
    if (!outside(p) || !dryPassable(bot.blockAt(p)) || !dryPassable(bot.blockAt(p.offset(0, 1, 0)))) continue;
    if (!below || below.name === 'end_portal_frame' || /lava|water/.test(below.name)) continue;
    if (!miningReach(bot, p.offset(.5, 0, .5), frame)) continue;
    out.push(p);
  }
  const here = bot.entity.position;
  return out.sort((a, b) => a.distanceTo(here) - b.distanceTo(here));
}

function activePortal(bot, center) {
  for (let x = -1; x <= 1; x++) for (let z = -1; z <= 1; z++) {
    if (bot.blockAt(center.offset(x, 0, z))?.name !== 'end_portal') return false;
  }
  return true;
}

// The way to the ring: over the ground while it is more than this far off and the bot at this height or over, a leg of this many blocks at a time.
const SURFACE_FIRST = 48, SURFACE_Y = 50, LEG = 48, UNDER_FAR = 96;
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
  // Far from the ring, or the ring out of view: the way to it first, a walk
  // where one is found and the stair dug toward it where none is (note
  // 1161). The ring is seen from as far as 160 blocks (stronghold.js), the
  // kit is made up wherever the bot then is, and the step began by asking
  // the ring to be in view: from the surface over a stronghold it ended
  // "not fully visible" at every pass. 25594 (2026-10-04 02:27Z) saw its
  // ring at (604, -37, 1540) from (778, 85, 1660), 210 blocks off and 122
  // under it.
  const here = bot.entity.position, flat = Math.hypot(here.x - (center.x + .5), here.z - (center.z + .5)), down = here.y - center.y;
  if ((flat > 8 || Math.abs(down) > 6 || !portal) && (flat > 4 || Math.abs(down) > 4) && actions.tunnel) {
    const beside = center.offset(3, 1, 0);
    goal.step = { action: 'go_to_end_portal', target: { x: center.x, y: center.y, z: center.z }, blocksOff: Math.round(flat), blocksUnder: Math.round(down) }; save();
    const near = new goals.GoalNear(beside.x, beside.y, beside.z, 2);
    const route = await surveyRoute(bot, task, bot.pathfinder.movements, near, 600);
    if (route.status === 'success') { await actions.navigate(bot, task, near, { timeoutMs: 60000, stallMs: 8000 }); return; }
    // Far off across the ground and still up on it, the walk over the
    // surface comes first, a leg at a time toward the place over the ring,
    // and the stair is dug from there (note 1168): a stair dug from where
    // the bot stood ran level through the rock the whole way. 25594
    // (2026-10-04 03:58 to 04:07Z), 620 blocks from its ring, went down to
    // y -36 in seven minutes and on toward it through deepslate at fourteen
    // blocks a minute, its pickaxe wearing out on the way.
    // Far off and under the ground, up to the surface first (note 1170):
    // the level way through the rock crosses the caves of the deep, their
    // mobs and their lava, at a pickaxe's pace. 25594 (2026-10-04 04:07 to
    // 04:13Z), 460 blocks from its ring at y -36, its iron pickaxe worn out
    // and a stone one in hand, broke into a cave of skeletons and made six
    // blocks in three minutes.
    if (flat > UNDER_FAR && here.y < SURFACE_Y && actions.surfaceStep) {
      let up = false; try { up = require('./surface').surfaceReturnComplete(bot, goal); } catch (_) { up = false; }
      if (!up) { goal.step = { ...goal.step, way: 'up to the surface first' }; save(); await actions.surfaceStep(bot, task, goal, save); return; }
    }
    if (flat > SURFACE_FIRST && (here.y >= SURFACE_Y || (flat > UNDER_FAR && actions.surfaceStep))) {
      const d = Math.min(LEG, flat - 8), k = d / flat;
      const leg = new goals.GoalNearXZ(Math.round(here.x + (center.x + .5 - here.x) * k), Math.round(here.z + (center.z + .5 - here.z) * k), 4);
      goal.step = { ...goal.step, way: 'surface', leg: { x: leg.x, z: leg.z } }; save();
      const from = here.clone();
      try { await actions.navigate(bot, task, leg, { timeoutMs: 45000, stallMs: 8000 }); }
      catch (err) { task.check(); if (['Cancelled', 'NeedsAir', 'NeedsSafety'].includes(err.name)) throw err; }
      if (bot.entity.position.distanceTo(from) >= 8) return;
    }
    await actions.tunnel(bot, task, goal, save, beside, 'end_portal');
    return;
  }
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
  const approach = async (positions, { scaffold = false, reach = null } = {}) => {
    // Blocks are laid only for a floor that is not there, and then stacked
    // too: the recorded rehearsal fell into the cave under the ring after
    // nine eyes, and with no pillaring there was no way back up to it.
    movement.scafoldingBlocks = scaffold ? previous.scafoldingBlocks : [];
    movement.allow1by1towers = scaffold ? previous.allow1by1towers !== false : false;
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
      // Arrived means within reach of the frame too: the second recorded
      // rehearsal stopped on its bridge a block past arm's length and gave
      // the portal up with three frames empty.
      if (dryStanding(bot, bot.entity.position) && outside(bot.entity.position) && (!reach || miningReach(bot, bot.entity.position, reach))) return;
    }
    throw blocked('No observed dry route to the outside of the End portal');
  };
  try {
    const missing = portal.frames.filter(f => !f.eye).sort((a, b) => vector(a.position).distanceTo(bot.entity.position) - vector(b.position).distanceTo(bot.entity.position));
    if (missing.length) {
      const position = vector(missing[0].position);
      if (!outside(bot.entity.position) || !dryStanding(bot, bot.entity.position) || !miningReach(bot, bot.entity.position, position)) {
        // Standing room that is there first; footing laid when none of it
        // can be walked to.
        try { await approach(dryMiningPositions(bot, position, 24), { reach: position }); }
        catch (err) { if (!/No observed dry route/.test(err.message)) throw err; await approach(bridgeFootings(bot, position, outside), { scaffold: true, reach: position }); }
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
    // Round a floorless ring to its one edge with standing room: pushed to
    // the far side by the stairs' silverfish, the rehearsal bot had no way
    // back to the only walkable edge but a bridge.
    try { await approach(edges); }
    catch (err) { if (!/No observed dry route/.test(err.message)) throw err; await approach(edges, { scaffold: true }); }
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

module.exports = { activePortal, enterEnd, bridgeFootings };
