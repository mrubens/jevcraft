'use strict';
const { Vec3 } = require('vec3');
const { goals } = require('mineflayer-pathfinder');
const { reservedForConstruction } = require('./build-sites');
const { safeFromHostiles } = require('./danger');
const { surveyRoute } = require('./skills');
const { dryPassable: passable, dryBodySpace } = require('./terrain');
const { descendPillar } = require('./pillar-recovery');

const directions = [new Vec3(1, 0, 0), new Vec3(0, 0, 1), new Vec3(-1, 0, 0), new Vec3(0, 0, -1)];
const faces = [...directions, new Vec3(0, 1, 0), new Vec3(0, -1, 0)];
const natural = /^(stone|deepslate|granite|diorite|andesite|tuff|dirt|grass_block|gravel|sand)$|_ore$/;
const dangerous = block => !block || ['lava', 'water', 'fire', 'magma_block', 'powder_snow'].includes(block.name);
const falling = block => block && (['sand', 'red_sand', 'gravel'].includes(block.name) || block.name.endsWith('_concrete_powder'));

function safeExcavation(bot, p) {
  if (faces.some(f => dangerous(bot.blockAt(p.plus(f))))) return false;
  // Removing a support can drop an entire sand/gravel column and release
  // water that was not adjacent to the original dig cell.
  for (let height = 1; height <= 16; height++) {
    const above = p.offset(0, height, 0), block = bot.blockAt(above);
    if (dangerous(block)) return false;
    if (!falling(block)) return true;
    if (faces.some(f => dangerous(bot.blockAt(above.plus(f))))) return false;
  }
  return false;
}

function stairOptions(bot, goal, target) {
  const feet = bot.entity.position.floored();
  // An exit being dug by hand clears stone without a tool: slowly, and for
  // the way out rather than the drops. Nothing else digs without one.
  const byHand = !!goal.surfaceReturn?.byHand;
  const dy = Math.sign(target.y - feet.y);
  const heights = dy ? [dy, 0] : [0];
  const choices = [];
  for (const d of directions) for (const height of heights) {
    const destination = feet.plus(d).offset(0, height, 0);
    if (!safeFromHostiles(bot, destination.offset(0.5, 0, 0.5))) continue;
    const floor = bot.blockAt(destination.offset(0, -1, 0));
    if (dangerous(floor) || falling(floor) || floor.boundingBox !== 'block') continue;
    if (bot.pathfinder?.movements?.allowedPosition && !bot.pathfinder.movements.allowedPosition(destination)) continue;
    const clear = [];
    // A jump needs three blocks of headroom in the cell we leave. Inspect and
    // clear that ceiling first, but never drop sand/gravel onto our own head.
    if (height > 0 && !passable(bot.blockAt(feet.offset(0, 2, 0)))) {
      if (falling(bot.blockAt(feet.offset(0, 2, 0))) || falling(bot.blockAt(feet.offset(0, 3, 0)))) continue;
      clear.push(feet.offset(0, 2, 0));
    }
    for (let y = Math.max(feet.y + 1, destination.y + 1); y >= destination.y; y--) clear.push(new Vec3(destination.x, y, destination.z));
    const safe = clear.every(p => {
      const block = bot.blockAt(p);
      if (dangerous(block)) return false;
      if (passable(block)) return true;
      if (!natural.test(block.name) || !block.diggable || reservedForConstruction(goal, p)) return false;
      if (!safeExcavation(bot, p)) return false;
      return byHand || !block.harvestTools || bot.inventory.items().some(i => block.harvestTools[i.type]);
    });
    if (!safe) continue;
    const visits = goal.tunnel?.visited?.[`${destination}`] || 0;
    choices.push({ destination, clear, score: destination.distanceTo(target) + visits * 16 + (dy > 0 && height === 0 ? 4 : 0) });
  }
  return choices.sort((a, b) => a.score - b.score);
}

async function tunnelStep(bot, task, goal, save, target, { dig, navigate }) {
  goal.tunnel ||= { entrance: { ...bot.entity.position.floored() }, steps: 0, visited: {} };
  const tunnel = goal.tunnel;
  // A spent budget is a shaft that has wandered, not a reason to stop: the
  // count outlived seven climbs of the dream run and then refused every
  // dig. Start a fresh shaft from here with a clean map of visited cells.
  if (tunnel.steps >= 512) {
    Object.assign(tunnel, { entrance: { ...bot.entity.position.floored() }, steps: 0, visited: {}, retreats: 0, retreatVisited: {}, rounds: (tunnel.rounds || 0) + 1 });
    delete tunnel.workPosition; save();
  }
  const choice = stairOptions(bot, goal, target)[0];
  if (!choice) {
    await retreatForTunnel(bot, task, goal, save, { navigate });
    return;
  }
  tunnel.target = { ...target };
  tunnel.visited[`${choice.destination}`] = (tunnel.visited[`${choice.destination}`] || 0) + 1;
  tunnel.steps++;
  goal.step = { action: 'tunnel', target: { ...target }, destination: { ...choice.destination }, steps: tunnel.steps };
  save();
  for (const p of choice.clear) {
    // Gravel can fall into a cleared headspace. Recheck it before entering.
    for (let tries = 0; !passable(bot.blockAt(p)); tries++) {
      task.check();
      if (tries >= 5) throw new Error('Falling blocks keep obstructing the staircase');
      if (!safeExcavation(bot, p)) throw new Error('Staircase excavation exposed a liquid or unstable wet ceiling');
      await dig(bot, task, p);
    }
  }
  const floor = bot.blockAt(choice.destination.offset(0, -1, 0));
  if (dangerous(floor) || floor.boundingBox !== 'block') throw new Error('Staircase footing changed during excavation');
  await navigate(bot, task, new goals.GoalBlock(choice.destination.x, choice.destination.y, choice.destination.z));
  tunnel.workPosition = { ...bot.entity.position.floored() };
  tunnel.dimension = bot.game?.dimension;
  save();
}

// Resource work survives food, tool and shelter interruptions. Each resource
// retains its own shaft; returning walks through existing space before any new
// excavation is allowed. An unreachable saved shaft has a bounded retry budget.
async function resourceTunnelStep(bot, task, goal, save, target, resource, actions) {
  const dimension = bot.game?.dimension || 'overworld', key = `${dimension}:${resource}`;
  goal.miningSites ||= {};
  const site = goal.miningSites[key] ||= { entrance: { ...bot.entity.position.floored() }, steps: 0, visited: {}, dimension, resource };
  goal.tunnel = site;
  const work = site.workPosition && new Vec3(site.workPosition.x, site.workPosition.y, site.workPosition.z);
  if (work && work.distanceTo(bot.entity.position) > 6 && !(site.rejoinBlockedUntil > Date.now())) {
    const movement = bot.pathfinder.movements;
    const previous = { canDig: movement.canDig, allow1by1towers: movement.allow1by1towers, scafoldingBlocks: movement.scafoldingBlocks };
    Object.assign(movement, { canDig: false, allow1by1towers: false, scafoldingBlocks: [] });
    try {
      task.check();
      const destination = new goals.GoalNear(work.x, work.y, work.z, 1);
      const route = await surveyRoute(bot, task, movement, destination, 1200);
      if (route.status !== 'success') throw new Error('No existing route to the saved mining worksite');
      goal.step = { action: 'return_to_mine', resource, destination: { ...work } }; save();
      await actions.navigate(bot, task, destination, { timeoutMs: 30000, stallMs: 5000 });
      site.rejoinFailures = 0; save(); return;
    } catch (err) {
      task.check();
      if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err;
      site.rejoinFailures = (site.rejoinFailures || 0) + 1;
      site.lastRejoinError = err.message;
      if (site.rejoinFailures >= 3) site.rejoinBlockedUntil = Date.now() + 120000;
      save(); throw err;
    } finally { Object.assign(movement, previous); }
  }
  await tunnelStep(bot, task, goal, save, target, actions);
}

// A wet or blocked shaft is not permission to dig through liquids. Walk back
// through existing space to a dry landing and choose another approach next.
async function retreatForTunnel(bot, task, goal, save, { navigate }) {
  const start = bot.entity.position.floored(), tunnel = goal.tunnel;
  if ((tunnel.retreats || 0) >= 24) { const err = new Error('No dry underground approach after 24 retreats'); err.name = 'Blocked'; throw err; }
  const dry = p => dryBodySpace(bot, p);
  const wetStart = [start, start.offset(0, 1, 0)].some(p => bot.blockAt(p)?.name === 'water');
  const movement = bot.pathfinder.movements;
  const previous = { canDig: movement.canDig, allow1by1towers: movement.allow1by1towers,
    scafoldingBlocks: movement.scafoldingBlocks, allowedPosition: movement.allowedPosition };
  const allowed = p => p.y >= start.y - 2 && (dry(p) || (wetStart && p.y >= start.y && start.distanceTo(new Vec3(p.x, p.y, p.z)) <= 8 &&
    [0, 1].every(dy => ['water', 'air', 'cave_air'].includes(bot.blockAt(new Vec3(p.x, p.y + dy, p.z))?.name)))) &&
    (!previous.allowedPosition || previous.allowedPosition(p));
  Object.assign(movement, { canDig: false, allow1by1towers: false, scafoldingBlocks: [], allowedPosition: allowed });
  try {
    const matching = bot.registry.blocksArray.filter(b => natural.test(b.name) && !['sand', 'gravel'].includes(b.name)).map(b => b.id);
    const candidates = bot.findBlocks({ matching, maxDistance: 16, count: 128, useExtraInfo: b => {
      const p = b.position.offset(0, 1, 0);
      return p.y >= start.y - 2 && p.y <= start.y + 8 && !p.equals(start) && dry(p) && safeFromHostiles(bot, p);
    } }).map(p => p.offset(0, 1, 0));
    // Retreat should first retrace the inspected staircase. Penalizing visited
    // steps hid a one-block escape behind twelve unreachable unexplored areas.
    // Repeated retreats to the same cell still lose priority and remain bounded.
    const cost = p => p.distanceTo(start) - (tunnel.visited?.[`${p}`] ? 16 : 0) + (tunnel.retreatVisited?.[`${p}`] || 0) * 16;
    candidates.sort((a, b) => cost(a) - cost(b));
    const checked = new Set();
    for (const p of candidates) {
      task.check();
      const area = `${Math.floor(p.x / 3)},${Math.floor(p.y / 3)},${Math.floor(p.z / 3)}`;
      if (checked.has(area)) continue;
      checked.add(area); if (checked.size > 12) break;
      const destination = new goals.GoalBlock(p.x, p.y, p.z);
      const route = await surveyRoute(bot, task, movement, destination, 500);
      if (route.status !== 'success' || !(route.path || []).every(allowed)) continue;
      tunnel.retreats = (tunnel.retreats || 0) + 1;
      tunnel.retreatVisited ||= {}; tunnel.retreatVisited[`${p}`] = (tunnel.retreatVisited[`${p}`] || 0) + 1;
      goal.step = { action: 'retreat_from_tunnel', from: { ...start }, destination: { ...p }, retreats: tunnel.retreats };
      save();
      await navigate(bot, task, destination, { timeoutMs: 15000, stallMs: 4000 });
      if (!dry(bot.entity.position.floored())) throw new Error('Tunnel retreat landing changed before arrival');
      save(); return;
    }
    if (await descendPillar(bot, task, goal, save)) return;
    throw new Error('No existing dry route away from the blocked staircase');
  } finally { Object.assign(movement, previous); }
}

module.exports = { stairOptions, tunnelStep, resourceTunnelStep, retreatForTunnel, safeExcavation };
