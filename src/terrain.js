'use strict';
const { Vec3 } = require('vec3');

// These plants contain source water despite having their own block IDs. Keep
// them distinct from waterlogged solids and bubble columns with vertical flow.
const swimmingBlocks = Object.freeze(['water', 'seagrass', 'tall_seagrass', 'kelp', 'kelp_plant']);
const swimmableWater = block => !!block && swimmingBlocks.includes(block.name);
const waterLevel = block => block?.name === 'water' ? Number(block.getProperties?.().level ?? block.metadata ?? 0) : 0;

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

const dryLeaf = block => !!block && /_leaves$/.test(block.name) &&
  ![true, 'true'].includes(block.getProperties?.().waterlogged);

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

// Beside a drop: a neighbouring cell the body could be pushed into with no
// floor for three blocks under it, or lava under it. See survival.js flee.
const AROUND = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
function dropAt(bot, c) {
  const b = bot.blockAt(c);
  if (!b || b.boundingBox === 'block') return false;
  for (let dy = 1; dy <= 3; dy++) {
    const under = bot.blockAt(c.offset(0, -dy, 0));
    if (!under) return false;
    if (under.name === 'lava') return true;
    if (under.boundingBox === 'block') return false;
  }
  return true;
}
const besideDrop = (bot, feet) => AROUND.some(([dx, dz]) => dropAt(bot, feet.offset(dx, 0, dz)));
// A drop within `radius` blocks along a clear line: where a hoglin's toss
// can carry the body, not only the next cell. The day audit's two Nether
// falls began two and three blocks from the edge. A wall in between stops
// the flight, so a drop behind one does not count.
function dropWithin(bot, feet, radius = 3) {
  const open = c => { const b = bot.blockAt(c), head = bot.blockAt(c.offset(0, 1, 0)); return !!b && b.boundingBox !== 'block' && (!head || head.boundingBox !== 'block'); };
  for (const [dx, dz] of AROUND) {
    for (let r = 1; r <= radius; r++) {
      const c = feet.offset(dx * r, 0, dz * r);
      if (dropAt(bot, c)) return true;
      if (!open(c)) break;
    }
  }
  return false;
}
// Mobs whose hit throws the body blocks, not a step.
const KNOCKBACK = new Set(['hoglin', 'zoglin', 'ravager', 'iron_golem', 'warden']);

// Lava anywhere the body is, as the game counts it: every cell the player's
// box touches, whatever the lava's level. The physics' own flag shrinks the
// box by a tenth at the sides and four tenths at each end, and the check
// here was the one cell at the middle of the feet: mid-83-b stood in the
// edge of a flow while making obsidian, lost two health every half second
// for three and a half seconds as "defend" and "step out of water", and
// left the lava at 2.7 health, too late (2026-09-25).
function bodyInLava(bot) {
  const p = bot.entity?.position;
  if (!p) return false;
  if (bot.entity.isInLava) return true;
  const w = (bot.entity.width ?? 0.6) / 2 - 0.001, h = bot.entity.height ?? 1.8;
  const cells = new Set();
  for (const x of [p.x - w, p.x + w]) for (const z of [p.z - w, p.z + w]) for (const y of [p.y + 0.001, p.y + h / 2, p.y + h - 0.001]) cells.add(`${Math.floor(x)},${Math.floor(y)},${Math.floor(z)}`);
  for (const key of cells) {
    const [x, y, z] = key.split(',').map(Number);
    if (/^(flowing_)?lava$/.test(bot.blockAt?.(new (require('vec3').Vec3)(x, y, z))?.name || '')) return true;
  }
  return false;
}

module.exports = { bodyInLava, besideDrop, dropWithin, KNOCKBACK, dropAt, dryPassable, dryLeaf, dryBodySpace, supportCell, damagingTerrain, swimmingBlocks, swimmableWater, waterLevel };
