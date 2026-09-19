'use strict';
const { Vec3 } = require('vec3');
const { goals } = require('mineflayer-pathfinder');
const opposite = { north: 'south', south: 'north', east: 'west', west: 'east' };
const directions = [new Vec3(0, -1, 0), new Vec3(0, 1, 0), new Vec3(0, 0, -1), new Vec3(0, 0, 1), new Vec3(-1, 0, 0), new Vec3(1, 0, 0)];

// The design contract exposes just the states we can deliberately place.
// Minecraft derives stair corners from neighbors; the designer cannot force
// shape, waterlogging, power, or arbitrary registry state IDs.
function regionProperties(material, value) {
  if (value !== undefined && value !== null && (typeof value !== 'object' || Array.isArray(value))) throw new Error('invalid block properties');
  const properties = Object.fromEntries(Object.entries(value || {}).filter(([, v]) => v !== null));
  if (Object.keys(value || {}).some(k => !['facing', 'half'].includes(k))) throw new Error('unsupported block property');
  const stair = material.endsWith('_stairs'), slab = material.endsWith('_slab');
  if (!stair && !slab) {
    if (Object.keys(properties).length) throw new Error(`${material} does not support oriented properties`);
    return undefined;
  }
  if (!['top', 'bottom'].includes(properties.half)) throw new Error(`${material} needs half top or bottom`);
  if (stair && !Object.hasOwn(opposite, properties.facing)) throw new Error(`${material} needs a cardinal facing`);
  if (slab && properties.facing !== undefined) throw new Error('slabs do not have a facing');
  return stair ? { facing: properties.facing, half: properties.half, waterlogged: false } : { type: properties.half, waterlogged: false };
}

function matchesBuildBlock(block, cell) {
  if (!block || block.name !== cell.material) return false;
  const observed = block.getProperties?.() || {};
  return Object.entries(cell.properties || {}).every(([key, value]) => String(observed[key]) === String(value));
}

function placementGoal(bot, point, cell = {}) {
  const p = new Vec3(point.x, point.y, point.z), state = cell.properties || {};
  const half = state.half || state.type;
  // GoalPlaceBlock's facing means the face toward the player, opposite the
  // player's horizontal look direction used by Minecraft for stairs.
  const goal = new goals.GoalPlaceBlock(p, bot.world, { range: 4.25, facing: opposite[state.facing] });
  if (!half) return goal;
  goal.facesPos = [];
  for (const face of directions) {
    if (face.y && face.y !== (half === 'bottom' ? -1 : 1)) continue;
    const ref = p.plus(face), block = bot.blockAt(ref);
    if (!block) continue;
    // Clicking the exposed horizontal face of the same half slab would merge
    // it into a double slab instead of placing the requested neighboring cell.
    if (face.y && cell.material?.endsWith('_slab') && block.name === cell.material && block.getProperties?.().type !== 'double') continue;
    for (const shape of block.shapes || []) {
      let lo = shape[1], hi = shape[4];
      if (!face.y) { lo = Math.max(lo, half === 'top' ? .5 : 0); hi = Math.min(hi, half === 'bottom' ? .5 : 1); }
      if (hi <= lo) continue;
      const center = new Vec3((shape[0] + shape[3]) / 2, (lo + hi) / 2, (shape[2] + shape[5]) / 2);
      if (face.x) center.x = face.x > 0 ? shape[0] : shape[3];
      if (face.y) center.y = face.y > 0 ? shape[1] : shape[4];
      if (face.z) center.z = face.z > 0 ? shape[2] : shape[5];
      goal.facesPos.push([face, center.plus(ref), ref]);
    }
  }
  return goal;
}

module.exports = { regionProperties, matchesBuildBlock, placementGoal };
