'use strict';
const { Vec3 } = require('vec3');
const { goals } = require('mineflayer-pathfinder');
const { surveyRoute } = require('./skills');
const { safeFromHostiles } = require('./danger');
const { dryPassable: clear } = require('./terrain');

const wet = new Set(['water', 'lava', 'bubble_column', 'seagrass', 'tall_seagrass', 'kelp', 'kelp_plant']);
const solid = block => block?.boundingBox === 'block' && !['magma_block', 'cactus'].includes(block.name);

function dryStanding(bot, point) {
  const p = point.floored();
  return clear(bot.blockAt(p)) && clear(bot.blockAt(p.offset(0, 1, 0))) && solid(bot.blockAt(p.offset(0, -1, 0)));
}

function miningReach(bot, point, blockPosition) {
  const feet = point.floored();
  if (feet.x === blockPosition.x && feet.z === blockPosition.z && blockPosition.y < feet.y) return false;
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
    const breathable = clear(bot.blockAt(head)) && (clear(bot.blockAt(feet)) || wading);
    const exitingWater = wetStart && feet.y >= start.y && feet.distanceTo(start) <= 8 &&
      [feet, head].every(q => clear(bot.blockAt(q)) || ['water', 'bubble_column'].includes(bot.blockAt(q)?.name));
    return (breathable || exitingWater) && (!previous.allowedPosition || previous.allowedPosition(point));
  };
  Object.assign(movement, { canDig: false, allowedPosition: allowed });
  return { allowed, restore: () => Object.assign(movement, previous) };
}

async function approachDryMining(bot, task, p, { navigate }) {
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
    throw new Error(`No reachable dry standing position for mining at ${p}`);
  } finally { policy.restore(); }
}

module.exports = { dryStanding, miningReach, dryMiningPositions, approachDryMining, miningMovement };
