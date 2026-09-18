'use strict';
const { Vec3 } = require('vec3');

// Inspect loaded columns, ignoring tree canopies but not terrain, roofs or
// water. Two clear cave blocks are not evidence of a surface destination.
function surfaceObserver(bot) {
  const heights = new Map();
  const minimum = bot.game.minY ?? -64;
  const maximum = minimum + (bot.game.height ?? 384);
  return point => {
    const x = Math.floor(point.x), z = Math.floor(point.z), key = `${x},${z}`;
    if (!heights.has(key)) {
      let top = minimum - 1;
      for (let y = maximum - 1; y >= minimum; y--) {
        const block = bot.blockAt(new Vec3(x, y, z));
        if (!block) { top = Infinity; break; }
        if (/_leaves$|_log$|_wood$/.test(block.name)) continue;
        if (block.boundingBox === 'block' || ['water', 'lava', 'powder_snow'].includes(block.name)) { top = y; break; }
      }
      heights.set(key, top);
    }
    return point.y > heights.get(key);
  };
}

function surfaceMovement(bot) {
  const movements = bot.pathfinder.movements;
  const previous = { canDig: movements.canDig, allow1by1towers: movements.allow1by1towers,
    allowSprinting: movements.allowSprinting, scafoldingBlocks: movements.scafoldingBlocks,
    allowedPosition: movements.allowedPosition };
  const isSurface = surfaceObserver(bot);
  const start = bot.entity.position.floored();
  // Permit leaving a house or a tree's immediate cover without allowing a
  // downhill cave route. Every subsequent surface step remains constrained.
  const allowed = p => isSurface(p) || (Math.abs(p.x - start.x) <= 4 && Math.abs(p.z - start.z) <= 4 && p.y >= start.y);
  Object.assign(movements, { canDig: false, allow1by1towers: false, allowSprinting: false,
    scafoldingBlocks: [], allowedPosition: p => allowed(p) && (!previous.allowedPosition || previous.allowedPosition(p)) });
  return { isSurface, allowed, restore: () => Object.assign(movements, previous) };
}

module.exports = { surfaceObserver, surfaceMovement };
