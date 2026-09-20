'use strict';
const { Vec3 } = require('vec3');
const { goals } = require('mineflayer-pathfinder');
const { surveyRoute } = require('./skills');
const { dryPassable, dryBodySpace, supportCell, damagingTerrain } = require('./terrain');

// A nearby mining stance or dropped item can sit behind a single dirt step.
// Survey a small passage, then let navigation break only the inspected cells.
// This is a fallback after ordinary walking, not permission to tunnel after loot.
async function openMiningPassage(bot, task, targets, { navigate, stopWhen, protect = [] } = {}) {
  task.check();
  const movement = bot.pathfinder.movements, origin = bot.entity.position.clone();
  if (!movement.canDig || !movement.safeToBreak || !dryBodySpace(bot, origin)) return false;
  const nearby = targets.filter(p => p.distanceTo(origin) <= 12).slice(0, 5);
  if (!nearby.length) return false;
  const protectedCells = new Set([...protect, ...nearby.map(supportCell)].map(p => `${p}`));
  const previous = Object.fromEntries(['allowedPosition', 'exclusionAreasBreak', 'scafoldingBlocks', 'allow1by1towers', 'allowParkour']
    .map(key => [key, movement[key]]));
  let approved;
  const permitted = block => !!block && block.position.distanceTo(origin) <= 12 &&
    !protectedCells.has(`${block.position}`) && !block.position.equals(supportCell(bot.entity.position)) &&
    !damagingTerrain.has(block.name) && ![true, 'true'].includes(block.getProperties?.().waterlogged) &&
    (!approved || approved.has(`${block.position}`));
  const clearable = block => permitted(block) && movement.safeToBreak(block);
  const allowed = point => {
    const p = new Vec3(point.x, point.y, point.z);
    if (p.distanceTo(origin) > 12 || p.y < origin.y - 3 ||
        previous.allowedPosition && !previous.allowedPosition(point)) return false;
    if (dryBodySpace(bot, p)) return true;
    for (let y = Math.floor(p.y); y < p.y + 1.8; y++) {
      const block = bot.blockAt(new Vec3(Math.floor(p.x), y, Math.floor(p.z)));
      if (!dryPassable(block) && !clearable(block)) return false;
    }
    return true;
  };
  Object.assign(movement, { allowedPosition: allowed, scafoldingBlocks: [], allow1by1towers: false, allowParkour: false,
    exclusionAreasBreak: [...(previous.exclusionAreasBreak || []), block => permitted(block) ? 0 : 100] });
  const deadline = Date.now() + 1500;
  try {
    for (const p of nearby) {
      task.check();
      if (stopWhen?.()) return false;
      if (Date.now() >= deadline) break;
      const destination = new goals.GoalBlock(p.x, p.y, p.z);
      const route = await surveyRoute(bot, task, movement, destination, Math.min(300, deadline - Date.now()));
      const path = route.path || [], breaks = new Map(path.flatMap(n => n.toBreak || []).map(q => {
        const b = bot.blockAt(new Vec3(q.x, q.y, q.z)); return [`${b?.position}`, b];
      }));
      if (route.status !== 'success' || path.length > 16 || !path.every(q => allowed(q) && !q.toPlace?.length) ||
          !breaks.size || breaks.size > 4 || ![...breaks.values()].every(clearable)) continue;
      approved = new Set(breaks.keys());
      await navigate(bot, task, destination, { timeoutMs: 12000, stallMs: 5000, stopWhen });
      return true;
    }
    return false;
  } finally {
    for (const [key, value] of Object.entries(previous)) if (value === undefined) delete movement[key]; else movement[key] = value;
  }
}

module.exports = { openMiningPassage };
