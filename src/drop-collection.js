'use strict';
// The key-press helper, by its module: collectNearbyDrops takes a `move`
// option (the pathfinder's navigate) that shadowed it, and the straight walk
// at a drop handed a motion spec to the pathfinder as its goal, which
// crashed the process (2026-09-23, four times).
const motion = require('./motion');
const { Vec3 } = require('vec3');
const { goals } = require('mineflayer-pathfinder');
const { navigate, surveyRoute, countOf } = require('./skills');
const { miningMovement, dryStanding } = require('./mining-access');
const { damagingTerrain, supportCell } = require('./terrain');
const { safeFromHostiles } = require('./danger');
const { checkAir } = require('./vitals');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const failures = new WeakMap();
const key = (bot, entity) => `${bot.game?.dimension}:${entity.uuid || entity.id}:${entity.position.floored()}`;

// Entity IDs are connection-local. Retry a blocked stack after it moves, or
// after a short cooldown; neither persist stale IDs nor let one stack monopolize work.
function nearbyDrops(bot, item, origin, radius) {
  const failed = failures.get(bot);
  if (failed) for (const [id, until] of failed) if (until <= Date.now()) failed.delete(id);
  return Object.values(bot.entities || {}).filter(e => e.isValid !== false && e.position &&
    e.getDroppedItem?.()?.name === item && e.position.distanceTo(origin) <= radius &&
    !failed?.has(key(bot, e)) && safeFromHostiles(bot, e.position))
    .sort((a, b) => a.position.distanceTo(bot.entity.position) - b.position.distanceTo(bot.entity.position)).slice(0, 8);
}

function pickupPositions(bot, drop) {
  const positions = [], p = drop.position.floored();
  for (const [dx, dz] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]]) {
    for (let dy = 0; dy >= -2; dy--) {
      const floor = bot.blockAt(p.offset(dx, dy, dz));
      if (floor?.boundingBox !== 'block' || damagingTerrain.has(floor.name)) continue;
      const height = floor.shapes?.length ? Math.max(...floor.shapes.map(shape => shape[4])) : 1;
      const standing = new Vec3(p.x + dx + .5, p.y + dy + height, p.z + dz + .5);
      if (Math.hypot(standing.x - drop.position.x, standing.z - drop.position.z) > 1.25 ||
          drop.position.y < standing.y - .1 || drop.position.y > standing.y + 1.8) continue;
      if (dryStanding(bot, standing) && safeFromHostiles(bot, standing)) positions.push(standing);
    }
  }
  return positions.sort((a, b) => a.distanceTo(drop.position) - b.distanceTo(drop.position));
}

// A hot floor the straight walk at a drop would bring the body to rest on:
// the walk is crouched, which a magma block does not hurt, but it ends
// where the keys are let go. mid-242-aa-nether-3 walked so at a netherrack
// it had dug, onto a magma block at the edge of a hole into the lava, was
// held there by the crouch, and stood up on it (note 579). Read along the
// line as the game reads the floor (the nearest block under the box), up
// to where the floor ends: a crouched body stops at an edge.
function hotOnTheWay(bot, to, from = bot.entity.position) {
  const { restingCell, hotFloor } = require('./terrain');
  const steps = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.z - from.z) / 0.25));
  for (let i = 0; i <= steps; i++) {
    const p = new Vec3(from.x + (to.x - from.x) * i / steps, from.y, from.z + (to.z - from.z) * i / steps);
    const cell = restingCell(bot, p);
    if (!cell) return null;
    const floor = bot.blockAt(cell.offset(0, -1, 0));
    if (hotFloor(floor)) return { name: floor.name, x: floor.position?.x ?? cell.x, y: cell.y - 1, z: floor.position?.z ?? cell.z };
  }
  return null;
}

// A drop of more than three blocks on the straight line to `to` or within
// `past` blocks beyond it, at the bot's level: the jumping walk at a drop
// above goes uncrouched, and a jump carries the body on past where it was
// aimed. 25592 (2026-10-03 19:08:14Z), mining netherrack on a ledge twenty
// blocks over the lava sea at 20 health, jumped at a block's drop lying a
// step up and went on over the ledge's edge into the lava (note 1102).
// -> { x, y, z, fall } of the first such column, or null.
function edgeOnTheWay(bot, to, { from = bot.entity.position, past = 2 } = {}) {
  const flat = Math.hypot(to.x - from.x, to.z - from.z);
  if (flat < 1e-3) return null;
  const ux = (to.x - from.x) / flat, uz = (to.z - from.z) / flat, feet = Math.floor(from.y);
  const solid = (x, y, z) => bot.blockAt(new Vec3(x, y, z))?.boundingBox === 'block';
  for (let d = 0.5; d <= flat + past; d += 0.5) {
    const x = Math.floor(from.x + ux * d), z = Math.floor(from.z + uz * d);
    if (x === Math.floor(from.x) && z === Math.floor(from.z)) continue;
    // A wall across the way stops the body there: nothing past it counts.
    if (solid(x, feet + 1, z) && solid(x, feet + 2, z)) return null;
    let floored = false;
    for (let y = feet + 1; y >= feet - 4; y--) if (solid(x, y, z)) { floored = true; break; }
    if (!floored) return { x, y: feet, z, fall: 4 };
  }
  return null;
}

class PickupGoal extends goals.GoalBlock {
  constructor(point) { super(point.x, point.y, point.z); this.standingY = point.y; }
  // The graph uses integer cells; smoothing uses the surface height. Accept
  // both representations of the same slab/path floor, not the floor beneath it.
  isEnd(node) { return node.x === this.x && node.z === this.z && Math.abs(node.y - this.standingY) < 1; }
}

async function collectNearbyDrops(bot, task, item, { before = countOf(bot, item), origin = bot.entity.position.clone(),
  radius = 16, timeoutMs = 6500, waitForSpawnMs = 0, onTarget = () => {}, move = navigate, allowExcavation = false } = {}) {
  task.check(); checkAir(bot);
  const gained = () => countOf(bot, item) > before;
  if (gained()) return true;
  if (!waitForSpawnMs && !nearbyDrops(bot, item, origin, radius).length) return false;
  const deadline = Date.now() + timeoutMs, spawnDeadline = Date.now() + waitForSpawnMs;
  const movement = bot.pathfinder.movements, policy = miningMovement(bot), start = bot.entity.position.clone();
  const previous = { allow1by1towers: movement.allow1by1towers, scafoldingBlocks: movement.scafoldingBlocks,
    allowParkour: movement.allowParkour, maxDropDown: movement.maxDropDown };
  const allowed = point => {
    const p = new Vec3(point.x, point.y, point.z);
    return p.distanceTo(start) <= radius + 1 && p.y >= start.y - 8 && policy.allowed(point) &&
      !damagingTerrain.has(bot.blockAt(supportCell(p))?.name) && safeFromHostiles(bot, p);
  };
  Object.assign(movement, { allow1by1towers: false, scafoldingBlocks: [], allowParkour: false,
    maxDropDown: Math.min(previous.maxDropDown ?? 2, 2), allowedPosition: allowed });
  const attempted = new Set();
  let seen = false, passageTried = false;
  try {
    while (Date.now() < deadline && !gained()) {
      task.check(); checkAir(bot);
      const drops = nearbyDrops(bot, item, origin, radius);
      seen ||= drops.length > 0;
      if (!drops.length && (seen || Date.now() >= spawnDeadline)) break;
      for (const drop of drops) {
        for (const point of pickupPositions(bot, drop).slice(0, 5)) {
          task.check();
          if (Date.now() >= deadline || gained()) break;
          const attempt = `${key(bot, drop)}:${point}`;
          if (attempted.has(attempt) || !allowed(point)) continue;
          attempted.add(attempt);
          const target = new PickupGoal(point), observed = drop.position.clone();
          const changed = () => bot.entities[drop.id] !== drop || drop.isValid === false || drop.position.distanceTo(observed) > .65;
          const route = await surveyRoute(bot, task, movement, target, Math.min(250, deadline - Date.now()));
          if (changed() || route.status !== 'success' || (route.path || []).length > 32 ||
              !(route.path || []).every(p => allowed(p) && !p.toBreak?.length && !p.toPlace?.some(p => !p.useOne))) continue;
          onTarget({ item, position: { ...drop.position.floored() } });
          try {
            await move(bot, task, target, { timeoutMs: Math.min(4000, deadline - Date.now()), stallMs: 1500,
              stopWhen: () => gained() || changed() });
          } catch (error) {
            task.check(); if (['NeedsAir', 'NeedsSafety'].includes(error.name)) throw error;
          }
          // Arrival or entity disappearance is not proof that we received it.
          const pickupDeadline = Math.min(deadline, Date.now() + 450);
          while (!gained() && !changed() && Date.now() < pickupDeadline) { task.check(); await sleep(50); }
          if (gained() || changed()) break;
        }
        if (gained()) break;
      }
      if (!gained() && allowExcavation && !passageTried) {
        const targets = drops.flatMap(drop => pickupPositions(bot, drop));
        if (targets.length) {
          passageTried = true;
          const pickupPolicy = { canDig: movement.canDig, allowedPosition: movement.allowedPosition, ...Object.fromEntries(Object.keys(previous).map(k => [k, movement[k]])) };
          // Remove only this collector's restrictions. The caller's no-dig and
          // construction boundaries still apply to the fallback survey.
          policy.restore(); Object.assign(movement, previous);
          const observed = drops.map(drop => ({ drop, position: drop.position.clone() }));
          const changed = () => observed.every(({ drop, position }) => bot.entities[drop.id] !== drop ||
            drop.isValid === false || drop.position.distanceTo(position) > .65);
          try {
            await require('./mining-passage').openMiningPassage(bot, task, targets, { navigate: move,
              stopWhen: () => gained() || changed() });
            const pickupDeadline = Date.now() + 450;
            while (!gained() && !changed() && Date.now() < pickupDeadline) { task.check(); checkAir(bot); await sleep(50); }
          } catch (error) {
            task.check(); if (['NeedsAir', 'NeedsSafety'].includes(error.name)) throw error;
          } finally { Object.assign(movement, pickupPolicy); }
        }
      }
      if (!gained()) await sleep(Math.max(0, Math.min(100, deadline - Date.now())));
    }
    task.check();
    // A drop within arm's reach that no routed pickup spot could claim: walk
    // straight at it. Pickup is proximity, not a path. Four raw iron lay a
    // block from the bot while the router turned every spot down.
    if (!gained() && typeof bot.setControlState === 'function') {
      for (const drop of nearbyDrops(bot, item, origin, radius).filter(d => d.position.distanceTo(bot.entity.position) <= 3.5).slice(0, 3)) {
        task.check(); checkAir(bot);
        const hot = hotOnTheWay(bot, drop.position);
        if (hot) { console.log(`[drops] the straight walk at the ${item.replaceAll('_', ' ')} would stand on the ${hot.name.replaceAll('_', ' ')} at (${hot.x}, ${hot.y}, ${hot.z}); not walked`); continue; }
        // Crouched: a drop lying past an edge (a rod off a fortress roof) is
        // not worth the fall the walk straight at it would be. A sneaking
        // player cannot walk off an edge, so the walk is slower and longer.
        const up = drop.position.y > bot.entity.position.y + 0.6;
        const edge = up ? edgeOnTheWay(bot, drop.position) : null;
        if (edge) { console.log(`[drops] the jump at the ${item.replaceAll('_', ' ')} a step up goes on over a drop of four blocks or more at (${edge.x}, ${edge.y}, ${edge.z}); not jumped at`); continue; }
        try {
          await motion.move(bot, task, { label: 'walk_to_drop', keys: up ? ['forward', 'jump'] : ['forward'], sneak: !up,
            why: up ? 'jumping up to a drop above: a step up, not over an edge' : undefined,
            look: drop.position.offset(0, 0.2, 0), maxMs: up ? 900 : 2500, tick: 50, until: gained });
        } catch (_) { task.check(); }
        if (gained()) break;
      }
    }
    if (!gained()) {
      let failed = failures.get(bot);
      if (!failed) failures.set(bot, failed = new Map());
      for (const drop of nearbyDrops(bot, item, origin, radius)) failed.set(key(bot, drop), Date.now() + 30000);
      while (failed.size > 64) failed.delete(failed.keys().next().value);
    }
    return gained();
  } finally {
    policy.restore();
    for (const [name, value] of Object.entries(previous)) if (value === undefined) delete movement[name]; else movement[name] = value;
  }
}

module.exports = { collectNearbyDrops, pickupPositions, hotOnTheWay, edgeOnTheWay };
