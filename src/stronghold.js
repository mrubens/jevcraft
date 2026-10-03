'use strict';
const { Vec3 } = require('vec3');
const { goals } = require('mineflayer-pathfinder');
const { throwEye, triangulate, horizontal } = require('./ender-eye');
const { surfaceMovement, surfaceReturnComplete } = require('./surface');
const { dryStanding, miningMovement } = require('./mining-access');
const { safeFromHostiles, checkThreats } = require('./danger');
const { checkAir } = require('./vitals');
const { surveyRoute, countOf } = require('./skills');
const { decide } = require('./decisions');
const blocked = message => Object.assign(new Error(message), { name: 'Blocked' });
const vector = p => new Vec3(p.x, p.y, p.z);
const frameOffsets = [];
for (let offset = -1; offset <= 1; offset++) frameOffsets.push(
  { x: -2, z: offset, facing: 'east' }, { x: 2, z: offset, facing: 'west' },
  { x: offset, z: -2, facing: 'south' }, { x: offset, z: 2, facing: 'north' });

// A stronghold spans a hundred blocks and more: in the rehearsal world the
// portal room was forty-five blocks sideways and seventy down from where the
// eyes pointed, ninety-seven in a line, one past the old ninety-six. Near the
// estimate the look reaches a whole stronghold.
function observedPortal(bot, { maxDistance = 96 } = {}) {
  const id = bot.registry.blocksByName.end_portal_frame?.id;
  if (id === undefined) return null;
  const seen = new Set();
  for (const p of bot.findBlocks({ matching: id, maxDistance, count: 48 })) {
    for (const offset of frameOffsets) {
      const center = p.offset(-offset.x, 0, -offset.z), key = `${center}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const portal = portalAt(bot, center);
      if (portal) return portal;
    }
  }
  return null;
}

function portalAt(bot, center) {
  const frames = frameOffsets.map(o => {
    const block = bot.blockAt(center.offset(o.x, 0, o.z));
    return block?.name === 'end_portal_frame' && block.getProperties().facing === o.facing
      ? { position: { ...block.position }, eye: block.getProperties().eye === true } : null;
  });
  return frames.every(Boolean) ? { center: { ...center }, frames, dimension: 'overworld', source: 'observed_end_portal_frame_ring' } : null;
}

function travelTarget(search, current) {
  const last = search.bearings.at(-1);
  if (!last) return null;
  if (last.descending) return { ...last.end, y: Math.floor(last.end.y), reason: 'Eye descended toward the nearby structure' };
  const estimate = triangulate(search.bearings);
  search.estimate = estimate;
  if (estimate) return { ...estimate, y: current.y, reason: 'Intersection of consistent observed Eye bearings' };
  if (!last.direction) return null;
  // A lateral baseline makes the next throw informative even when the first
  // ray points at a stronghold thousands of blocks away.
  const lateral = search.bearings.length === 1 ? 48 : 0;
  return { x: last.origin.x + last.direction.x * 160 - last.direction.z * lateral, y: current.y,
    z: last.origin.z + last.direction.z * 160 + last.direction.x * lateral, reason: 'Advance along the observed Eye bearing with a surveying baseline' };
}

async function recoverEye(bot, task, search, save, actions) {
  if (!search.pendingPickup) return false;
  const pending = search.pendingPickup;
  delete search.pendingPickup; save();
  const policy = miningMovement(bot), movement = bot.pathfinder.movements;
  const beforeMovement = { scafoldingBlocks: movement.scafoldingBlocks, allow1by1towers: movement.allow1by1towers };
  Object.assign(movement, { scafoldingBlocks: [], allow1by1towers: false });
  try {
    const deadline = Date.now() + 3000;
    do {
      task.check(); checkAir(bot); checkThreats(bot);
      const drops = Object.values(bot.entities).filter(e => e.getDroppedItem?.()?.name === 'ender_eye' &&
        e.position.distanceTo(vector(pending.end)) < 12 && e.position.distanceTo(bot.entity.position) < 24 && dryStanding(bot, e.position.floored()));
      for (const drop of drops.slice(0, 3)) {
        const p = drop.position.floored(), destination = new goals.GoalNear(p.x, p.y, p.z, 1);
        const route = await surveyRoute(bot, task, movement, destination, 300);
        if (route.status !== 'success' || !route.path.every(policy.allowed)) continue;
        const before = countOf(bot, 'ender_eye');
        await actions.navigate(bot, task, destination, { timeoutMs: 8000, stallMs: 2500, stopWhen: () => countOf(bot, 'ender_eye') > before });
        for (let n = 0; n < 10 && countOf(bot, 'ender_eye') <= before; n++) { task.check(); await new Promise(r => setTimeout(r, 50)); }
        const pickedUp = countOf(bot, 'ender_eye') - before;
        search.lastPickup = { at: new Date().toISOString(), pickedUp: Math.max(0, pickedUp) }; save();
        if (pickedUp > 0) return true;
      }
      await new Promise(r => setTimeout(r, 100));
    } while (Date.now() < deadline);
    return false;
  } finally { policy.restore(); Object.assign(movement, beforeMovement); }
}

const WATER_GAIN = 8, WALK_ON_MS = 3 * 60000;
async function walkBearing(bot, task, goal, save, target, actions, client) {
  const search = goal.strongholdSearch, surface = surfaceMovement(bot);
  try {
    const matching = ['grass_block', 'dirt', 'stone', 'sand', 'gravel', 'podzol', 'snow_block', 'granite', 'diorite', 'andesite']
      .map(name => bot.registry.blocksByName[name]?.id).filter(id => id !== undefined);
    const land = bot.findBlocks({ matching, maxDistance: 48, count: 192, useExtraInfo: b => {
      const p = b.position.offset(0, 1, 0);
      return horizontal(p, bot.entity.position) >= 4 && dryStanding(bot, p) && surface.isSurface(p) && safeFromHostiles(bot, p);
    } }).map(p => p.offset(0, 1, 0));
    const key = p => `${Math.floor(p.x / 8)},${Math.floor(p.z / 8)}`;
    const score = p => horizontal(p, target) + (search.visited[key(p)] || 0) * 24;
    land.sort((a, b) => score(a) - score(b));
    // No land in reach WATER_GAIN blocks nearer the place the Eyes point at
    // than the bot stands: water (or the like) lies across the way, and the
    // walk takes only dry ground. The boat, Jev's to choose with the swim it
    // saves (boats.js), else the swim across along the bearing
    // (exploration.js swimAcross), before any waypoint is asked (note 1122).
    // The rehearsal of 2026-10-03 (21:53 to 21:56Z), 1,500 blocks from its
    // stronghold, came to a shore 260 blocks on and walked the beach: the
    // waypoint's question six times in thirteen seconds, none good at half
    // of them, then "every way it had from here rests" twice a second.
    const hereNow = bot.entity.position, gain = land.length ? horizontal(hereNow, target) - Math.min(...land.map(p => horizontal(p, target))) : 0;
    if (gain < WATER_GAIN) {
      surface.restore();
      try {
        if (await require('./boats').boatTravelStep(bot, task, goal, save, vector({ x: target.x, y: hereNow.y, z: target.z }), { acquireStep: actions.acquireStep }, client)) { search.moves++; save(); return; }
        const heading = (Math.round(Math.atan2(target.z - hereNow.z, target.x - hereNow.x) / (Math.PI / 4)) + 8) % 8;
        if (await require('./exploration').swimAcross(bot, task, goal, save, heading)) { search.moves++; save(); return; }
      } catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; console.log(`[stronghold] the water across the bearing: ${String(err.message || err).slice(0, 200)}`); }
    }
    const seen = new Set(), tree = {};
    for (const p of land) {
      task.check(); checkAir(bot);
      if (seen.has(key(p))) continue;
      seen.add(key(p)); if (seen.size > 10) break;
      const destination = new goals.GoalBlock(p.x, p.y, p.z);
      const route = await surveyRoute(bot, task, bot.pathfinder.movements, destination, 450);
      if (route.status !== 'success' || !route.path.every(surface.allowed)) continue;
      // Keyed by the number its end was given when first offered (keys.js,
      // note 749).
      tree[`walk_${require('./decisions/keys').id(goal, 'stronghold_walk', p)}`] = { target: { x: p.x, y: p.y, z: p.z }, description: { action: 'Walk this surveyed surface route toward the Eye-indicated stronghold',
        destination: { ...p }, remainingDistanceToEstimatedTarget: horizontal(p, target), previousVisits: search.visited[key(p)] || 0 },
      run: async () => {
        if (!dryStanding(bot, p) || !safeFromHostiles(bot, p)) throw new Error('Stronghold waypoint changed before execution');
        search.visited[key(p)] = (search.visited[key(p)] || 0) + 1;
        goal.step = { action: 'follow_eye_bearing', destination: { ...p }, target }; save();
        await actions.navigate(bot, task, destination, { timeoutMs: 20000, stallMs: 5000 });
        search.moves++; save();
      } };
      if (Object.keys(tree).length >= 3) break;
    }
    if (!Object.keys(tree).length) {
      surface.restore();
      await actions.explore(bot, task, goal, save, 'stronghold approach', { surfaceOnly: true });
      search.moves++; save(); return;
    }
    // The walk toward the bearing, once answered, goes on by the nearest
    // waypoint to it for WALK_ON_MS without the question again (note 1122):
    // the waypoints are fifty blocks apart and all one walk, and a
    // stronghold a thousand blocks off was thirty askings of the same thing.
    if (search.walkOn > Date.now()) { await Object.values(tree)[0].run(); return; }
    const origin = bot.entity.position.clone(), dimension = bot.game.dimension;
    const decision = await decide('stronghold_waypoint', { client, bot, task, goal, save, tree, interrupt: () => checkThreats(bot),
      state: { request: goal.request, task: 'Follow observed Eyes of Ender', target,
        latestBearing: search.bearings.at(-1), estimatedTargetIsUnverified: true, health: bot.health, food: bot.food,
        // The time and the risk, as other walks say them (the decision audit).
        timeOfDay: bot.time?.timeOfDay, riskNow: (() => { try { return require('./risk').riskNow(bot); } catch (_) { return null; } })() },
      isFresh: () => bot.game.dimension === dimension && bot.entity.position.distanceTo(origin) < 1 });
    if (!decision.stale) { search.walkOn = Date.now() + WALK_ON_MS; save(); await decision.action.run(); }
  } finally { surface.restore(); }
}

async function findStronghold(bot, task, goal, save, actions, client) {
  task.check(); checkAir(bot); checkThreats(bot);
  if (String(bot.game.dimension).replace(/^minecraft:/, '') !== 'overworld') throw blocked('Stronghold search requires the Overworld');
  const search = goal.strongholdSearch ||= { bearings: [], throws: 0, moves: 0, visited: {} };
  const near = search.estimate && horizontal(bot.entity.position, search.estimate) < 96;
  const portal = observedPortal(bot, { maxDistance: near ? 160 : 96 });
  if (portal) {
    goal.endPortal = portal;
    goal.gameProgress.milestones.stronghold_located = { at: Date.now(), ...portal };
    goal.step = { action: 'stronghold_located', source: portal.source, center: portal.center }; save(); return;
  }
  if (search.throws >= 64 || search.moves >= 512) throw blocked('Stronghold search budget exhausted without observing an End portal; bearings and progress saved');
  if (search.pendingPickup) { await recoverEye(bot, task, search, save, actions); return; }
  const last = search.bearings.at(-1), target = travelTarget(search, bot.entity.position);
  if (last?.descending) {
    goal.step = { action: 'approach_indicated_stronghold', target, source: 'descending_eye', verifiedStronghold: false }; save();
    if (horizontal(bot.entity.position, target) < 8 && bot.entity.position.y <= target.y + 4) {
      await actions.explore(bot, task, goal, save, 'end_portal_frame', { surfaceOnly: false });
    } else await actions.tunnel(bot, task, goal, save, vector(target), 'stronghold');
    search.moves++; save(); return;
  }
  if (!surfaceReturnComplete(bot, goal)) { await actions.surfaceStep(bot, task, goal, save); return; }
  const sinceThrow = last ? horizontal(last.origin, bot.entity.position) : Infinity;
  const estimate = search.estimate;
  const throwAgain = !last || sinceThrow >= (estimate && horizontal(bot.entity.position, estimate) < 96 ? 24 : 96) ||
    (target && horizontal(bot.entity.position, target) < 12 && sinceThrow >= 12);
  if (throwAgain) {
    if (countOf(bot, 'ender_eye') <= 12) throw blocked('Stronghold search needs another spare Eye of Ender; preserving twelve for the portal');
    search.throws++; goal.step = { action: 'throw_ender_eye', attempt: search.throws }; save();
    const bearing = await throwEye(bot, task);
    search.bearings = [...search.bearings, bearing].slice(-32); search.pendingPickup = bearing;
    search.estimate = triangulate(search.bearings);
    bot.emit('stronghold_search', { kind: 'eye_bearing', bearing, estimate: search.estimate }); save(); return;
  }
  if (!target) throw blocked('Eye observation did not establish a usable stronghold direction');
  await walkBearing(bot, task, goal, save, target, actions, client);
}

module.exports = { observedPortal, portalAt, frameOffsets, travelTarget, findStronghold };
