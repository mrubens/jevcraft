'use strict';
const { Vec3 } = require('vec3');

const travelHazards = new Set(['water', 'lava', 'bubble_column', 'seagrass', 'tall_seagrass', 'kelp', 'kelp_plant',
  'fire', 'soul_fire', 'powder_snow', 'sweet_berry_bush', 'cobweb']);
const damagingTerrain = new Set(['lava', 'fire', 'soul_fire', 'magma_block', 'cactus', 'campfire', 'soul_campfire',
  'sweet_berry_bush', 'wither_rose', 'powder_snow']);

// Movement needs collision-free, harmless space, which includes grass, leaf
// litter and other non-colliding plants. Placement still requires its own check.
function dryPassable(block) {
  return !!block && !travelHazards.has(block.name) &&
    (block.boundingBox === 'empty' || ['air', 'cave_air', 'void_air'].includes(block.name));
}

// Pathfinder returns exact standing heights after smoothing (for example
// farmland/dirt paths at y + 15/16). Flooring that point tests the supporting
// block as if it occupied the player's body and rejects valid dry routes.
function dryBodySpace(bot, point) {
  const bottom = point.y, top = bottom + 1.8;
  for (let y = Math.floor(bottom); y <= Math.floor(top - 1e-7); y++) {
    const block = bot.blockAt(new Vec3(Math.floor(point.x), y, Math.floor(point.z)));
    if (!block || travelHazards.has(block.name) || ['magma_block', 'cactus'].includes(block.name)) return false;
    if (dryPassable(block)) continue;
    if (!block.shapes?.length || block.shapes.some(shape => y + shape[4] > bottom + 1e-7 && y + shape[1] < top - 1e-7)) return false;
  }
  return true;
}

function supportCell(point) {
  return new Vec3(Math.floor(point.x), Math.ceil(point.y) - 1, Math.floor(point.z));
}

module.exports = { dryPassable, dryBodySpace, supportCell, damagingTerrain };
