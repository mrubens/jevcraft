'use strict';
const { Vec3 } = require('vec3');
const { goals } = require('mineflayer-pathfinder');
const { surveyRoute } = require('./skills');
const { safeFromHostiles } = require('./danger');
const { dryPassable: clear, dryLeaf, dryBodySpace, supportCell, damagingTerrain } = require('./terrain');

const wet = new Set(['water', 'lava', 'bubble_column', 'seagrass', 'tall_seagrass', 'kelp', 'kelp_plant']);
const solid = block => block?.boundingBox === 'block' && !['magma_block', 'cactus'].includes(block.name);

function dryStanding(bot, point) {
  const support = supportCell(point);
  return dryBodySpace(bot, point) && solid(bot.blockAt(support));
}

function miningReach(bot, point, blockPosition) {
  const feet = point.floored();
  if (feet.x === blockPosition.x && feet.z === blockPosition.z && blockPosition.y < point.y) return false;
  const eye = point.offset(0, 1.62, 0), aim = blockPosition.offset(0.5, 0.5, 0.5), direction = aim.minus(eye);
  if (direction.norm() > 4.5) return false;
  const hit = bot.world?.raycast?.(eye, direction.unit(), direction.norm());
  return !hit || hit.position?.equals(blockPosition) || eye.distanceTo(hit.intersect || hit.position) >= direction.norm() - 0.25;
}

function dryMiningPositions(bot, blockPosition, limit = 12) {
  const positions = [], seen = new Set(), current = bot.entity.position;
  const add = point => {
    const p = point.floored(), key = `${p}`;
    if (seen.has(key)) return;
    seen.add(key);
    const standing = p.offset(0.5, 0, 0.5);
    if (dryStanding(bot, p) && miningReach(bot, standing, blockPosition) && safeFromHostiles(bot, standing)) positions.push(p);
  };
  add(current);
  for (let distance = 1; distance <= 3 && positions.length < limit; distance++) {
    for (const [dx, dz] of [[distance, 0], [-distance, 0], [0, distance], [0, -distance]]) {
      for (const dy of [0, 1, -1, 2, 3]) {
        add(blockPosition.offset(dx, dy, dz));
        if (positions.length >= limit) break;
      }
      if (positions.length >= limit) break;
    }
  }
  return positions.sort((a, b) => a.distanceTo(current) - b.distanceTo(current));
}

function miningMovement(bot) {
  const movement = bot.pathfinder.movements;
  const previous = { canDig: movement.canDig, allowedPosition: movement.allowedPosition };
  const start = bot.entity.position.floored(), wetStart = wet.has(bot.blockAt(start.offset(0, 1, 0))?.name);
  const allowed = point => {
    const feet = new Vec3(point.x, point.y, point.z), head = feet.offset(0, 1, 0);
    const wading = ['water', 'bubble_column'].includes(bot.blockAt(feet)?.name);
    const breathable = dryBodySpace(bot, feet) || (wading && clear(bot.blockAt(head)));
    const exitingWater = wetStart && feet.y >= start.y && feet.distanceTo(start) <= 8 &&
      [feet, head].every(q => clear(bot.blockAt(q)) || ['water', 'bubble_column'].includes(bot.blockAt(q)?.name));
    return (breathable || exitingWater) && (!previous.allowedPosition || previous.allowedPosition(point));
  };
  Object.assign(movement, { canDig: false, allowedPosition: allowed });
  return { allowed, restore: () => Object.assign(movement, previous) };
}

async function approachDryMining(bot, task, p, { navigate, dig }) {
  if (dryStanding(bot, bot.entity.position) && miningReach(bot, bot.entity.position, p) && bot.canDigBlock(bot.blockAt(p))) return;
  const movement = bot.pathfinder.movements, policy = miningMovement(bot);
  try {
    for (const target of dryMiningPositions(bot, p).slice(0, 8)) {
      task.check();
      const destination = new goals.GoalBlock(target.x, target.y, target.z);
      const route = await surveyRoute(bot, task, movement, destination, 300);
      if (route.status !== 'success' || !(route.path || []).every(policy.allowed)) continue;
      await navigate(bot, task, destination, { timeoutMs: 15000, stallMs: 4000 });
      if (!dryStanding(bot, bot.entity.position) || !miningReach(bot, bot.entity.position, p)) throw new Error('Dry mining access changed during the approach');
      return;
    }
  } finally { policy.restore(); }
  if (await approachFoliageMining(bot, task, p, navigate, dig)) return;
  throw new Error(`No reachable dry standing position for mining at ${p}`);
}

// A covered resource can have no already-clear mining stance. Keep nearby
// observed candidates for a bounded leaf-only survey instead of discarding
// them before approachDryMining has a chance to open that stance.
function foliageMiningCandidate(bot, p) {
  const movement = bot.pathfinder.movements;
  if (movement.canDig !== true || p.distanceTo(bot.entity.position) > 12 || p.equals(supportCell(bot.entity.position))) return false;
  return [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]].some(d => {
    const leaf = bot.blockAt(p.offset(...d));
    return dryLeaf(leaf) && !movement.blocksCantBreak?.has(leaf.type) &&
      (movement.exclusionAreasBreak || []).reduce((cost, rule) => cost + rule(leaf), 0) < 100;
  });
}

async function approachFoliageMining(bot, task, p, navigate, dig) {
  task.check();
  if (!foliageMiningCandidate(bot, p)) return false;
  const movement = bot.pathfinder.movements, origin = bot.entity.position.clone();
  const previous = Object.fromEntries(['allowedPosition', 'exclusionAreasBreak', 'scafoldingBlocks', 'allow1by1towers', 'allowParkour']
    .map(key => [key, movement[key]]));
  const allowed = point => {
    const feet = new Vec3(point.x, point.y, point.z), support = supportCell(feet);
    if (feet.distanceTo(origin) > 12 || support.equals(p) || !solid(bot.blockAt(support)) ||
        previous.allowedPosition && !previous.allowedPosition(point)) return false;
    if (dryBodySpace(bot, feet)) return true;
    for (let y = Math.floor(feet.y); y < feet.y + 1.8; y++) {
      const block = bot.blockAt(new Vec3(Math.floor(feet.x), y, Math.floor(feet.z)));
      if (!clear(block) && !dryLeaf(block)) return false;
    }
    return true;
  };
  Object.assign(movement, { allowedPosition: allowed, scafoldingBlocks: [], allow1by1towers: false, allowParkour: false,
    exclusionAreasBreak: [...(previous.exclusionAreasBreak || []), block => dryLeaf(block) ? 0 : 100] });
  try {
    const destination = new goals.GoalGetToBlock(p.x, p.y, p.z);
    const route = await surveyRoute(bot, task, movement, destination, 700), path = route.path || [];
    if (route.status !== 'success' || path.length > 16 || !path.every(q => allowed(q) && !q.toPlace?.length)) return false;
    const breaks = path.flatMap(q => q.toBreak || []);
    if (new Set(breaks.map(q => `${q.x},${q.y},${q.z}`)).size > 8 ||
        !breaks.every(q => dryLeaf(bot.blockAt(new Vec3(q.x, q.y, q.z))))) return false;
    await navigate(bot, task, destination, { timeoutMs: 15000, stallMs: 4000 });
    // Arrival can be at the near edge of a stance, leaving the eye ray behind
    // an overhanging leaf even after body space is clear. Clear only those
    // observed leaf obstructions, never the requested block or our footing.
    for (let cleared = 0; dig && cleared < 3 && dryStanding(bot, bot.entity.position) &&
        !miningReach(bot, bot.entity.position, p); cleared++) {
      task.check();
      const eye = bot.entity.position.offset(0, 1.62, 0), direction = p.offset(.5, .5, .5).minus(eye);
      if (direction.norm() > 4.5) break;
      const hit = bot.world?.raycast?.(eye, direction.unit(), direction.norm());
      const leaf = hit?.position && bot.blockAt(hit.position);
      if (!dryLeaf(leaf) || leaf.position.equals(supportCell(bot.entity.position)) || !bot.canDigBlock(leaf) ||
          !movement.safeToBreak?.(leaf)) break;
      await dig(bot, task, leaf.position, { requireDrops: false });
    }
    if (!dryStanding(bot, bot.entity.position) || !miningReach(bot, bot.entity.position, p))
      throw new Error('Foliage mining access changed during the approach');
    // The drop can land toward the far side of this cell. Open its leaf
    // headroom while we can see it, so pickup can enter the mined cell without
    // relaxing the collector's no-excavation policy or relying on drop jitter.
    const floor = bot.blockAt(p.offset(0, -1, 0)), head = bot.blockAt(p.offset(0, 1, 0));
    if (dig && solid(floor) && !damagingTerrain.has(floor.name) && dryLeaf(head) &&
        miningReach(bot, bot.entity.position, head.position) && bot.canDigBlock(head) && movement.safeToBreak?.(head)) {
      task.check(); await dig(bot, task, head.position, { requireDrops: false });
    }
    return true;
  } finally {
    for (const [key, value] of Object.entries(previous)) if (value === undefined) delete movement[key]; else movement[key] = value;
  }
}

// Ore depth is a search hint, not the depth of a block already observed nearby.
// A short dry walk does not need the supplies for an underground expedition.
async function reachableLocalMine(bot, task, candidates) {
  task.check();
  if (candidates.some(p => dryStanding(bot, bot.entity.position) && miningReach(bot, bot.entity.position, p) && bot.canDigBlock(bot.blockAt(p)))) return true;
  const movement = bot.pathfinder.movements, policy = miningMovement(bot);
  const previous = { allow1by1towers: movement.allow1by1towers, scafoldingBlocks: movement.scafoldingBlocks };
  Object.assign(movement, { allow1by1towers: false, scafoldingBlocks: [] });
  const origin = bot.entity.position.clone(), minimumY = origin.y - 8, deadline = Date.now() + 1500;
  try {
    for (const p of candidates.filter(p => p.distanceTo(origin) <= 16 && p.y >= minimumY).slice(0, 4)) {
      for (const target of dryMiningPositions(bot, p).slice(0, 3)) {
        task.check();
        if (Date.now() >= deadline) return false;
        const route = await surveyRoute(bot, task, movement, new goals.GoalBlock(target.x, target.y, target.z), Math.min(250, deadline - Date.now()));
        if (route.status === 'success' && (route.path || []).length <= 32 &&
            (route.path || []).every(q => q.y >= minimumY && policy.allowed(q) && !q.toBreak?.length && !q.toPlace?.length)) return true;
      }
    }
    return false;
  } finally {
    policy.restore();
    for (const [key, value] of Object.entries(previous)) if (value === undefined) delete movement[key]; else movement[key] = value;
  }
}

module.exports = { dryStanding, miningReach, dryMiningPositions, foliageMiningCandidate, approachDryMining, miningMovement, reachableLocalMine };
