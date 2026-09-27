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
// On a one-wide span over a drop: a drop on both sides of the feet, along
// x or along z, or a span being laid (bridging.js marks it). No reflex
// swings at a mob or turns to one there: mid-215-e's swing at a hoglin
// behind it turned it about on its span and the crossing walked it off the
// far end into the lava sea (note 273), and mid-242-c went in a second
// after its fortress came into view (note 264). Crouched and still, a
// player cannot walk off an edge; swinging and turning, it can.
function onSpan(bot, feet = bot.entity?.position?.floored?.()) {
  if (bot._spanning) return true;
  if (!feet || typeof bot.blockAt !== 'function') return false;
  const drop = (dx, dz) => dropAt(bot, feet.offset(dx, 0, dz));
  return (drop(1, 0) && drop(-1, 0)) || (drop(0, 1) && drop(0, -1));
}
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
// The deepest drop within `radius` along a clear line, measured: how far
// off, how far the fall is (to the first solid block, or to lava or water),
// and what it costs. "A drop within three blocks" was all Jev was told when
// mid-100-d fought a skeleton two blocks from a twenty-one-block shaft; the
// arrow's knockback put it down the shaft from 18.6 health to 0.6.
function dropNear(bot, feet, radius = 3, deepest = 48) {
  const open = c => { const b = bot.blockAt(c), head = bot.blockAt(c.offset(0, 1, 0)); return !!b && b.boundingBox !== 'block' && (!head || head.boundingBox !== 'block'); };
  let worst = null;
  for (const [dx, dz] of AROUND) {
    for (let r = 1; r <= radius; r++) {
      const c = feet.offset(dx * r, 0, dz * r);
      if (dropAt(bot, c)) {
        let fall = 0, into = 'ground';
        for (let dy = 1; dy <= deepest; dy++) {
          const under = bot.blockAt(c.offset(0, -dy, 0));
          if (!under) { fall = deepest; into = 'unknown'; break; }
          if (under.name === 'lava') { fall = dy - 1; into = 'lava'; break; }
          if (under.name === 'water') { fall = dy - 1; into = 'water'; break; }
          if (under.boundingBox === 'block') { fall = dy - 1; break; }
          fall = dy;
        }
        const damage = into === 'water' ? 0 : Math.max(0, fall - 3);
        if (!worst || damage > worst.damage || (damage === worst.damage && r < worst.blocksAway)) worst = { blocksAway: r, fallBlocks: fall, into, damage };
        break;
      }
      if (!open(c)) break;
    }
  }
  return worst;
}
// Said in a stance option: what the drop beside the bot costs a body
// knocked or stepped into it, at the health it has.
function dropNote(drop, health) {
  if (!drop || (drop.into !== 'lava' && drop.damage < 1)) return '';
  const end = drop.into === 'lava' ? 'into lava' : drop.damage >= (health ?? 20) ? `about ${drop.damage} health from the fall, more than the ${Math.round(health ?? 20)} the bot has` : `about ${drop.damage} of the bot's ${Math.round(health ?? 20)} health from the fall`;
  return ` A drop of ${drop.fallBlocks} blocks is ${drop.blocksAway} block${drop.blocksAway === 1 ? '' : 's'} off: a hit's knockback or a step back over it is ${end}.`;
}

// A step back from an edge that holds. mid-227-b stepped back from a
// ledge over the lava sea with three magma cubes about, and the fortress
// leg's next route walked it back along the same ledge; a push put it
// fifty-five blocks down into the lava (note 248, 2026-09-26). The cells it
// left, and those beside the drop within the step back's own reach of
// them, are kept out of routes while any of the mobs it stepped back from
// is still about (movement.js).
const EDGE_REACH = 2;
function holdOffEdge(bot, feet, mobs = []) {
  const cells = [];
  for (let dx = -EDGE_REACH; dx <= EDGE_REACH; dx++) for (let dz = -EDGE_REACH; dz <= EDGE_REACH; dz++) {
    const c = feet.offset(dx, 0, dz);
    if ((dx === 0 && dz === 0) || besideDrop(bot, c)) cells.push({ x: c.x, y: c.y, z: c.z });
  }
  bot._edgeHold = { cells, mobs: mobs.map(m => m.id).filter(id => id !== undefined), at: Date.now() };
  return bot._edgeHold;
}
// Whether a cell is one held off, given the hostile mobs about now. The hold
// ends when none of the mobs it was made for is about.
function edgeHeld(bot, p, hostiles = []) {
  const hold = bot._edgeHold;
  if (!hold) return false;
  if (!hostiles.some(e => hold.mobs.includes(e.id) && e.isValid !== false)) { delete bot._edgeHold; return false; }
  return hold.cells.some(c => c.x === p.x && c.y === p.y && c.z === p.z);
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

module.exports = { onSpan, holdOffEdge, edgeHeld, EDGE_REACH, dropNear, dropNote, bodyInLava, besideDrop, dropWithin, KNOCKBACK, dropAt, dryPassable, dryLeaf, dryBodySpace, supportCell, damagingTerrain, swimmingBlocks, swimmableWater, waterLevel };
