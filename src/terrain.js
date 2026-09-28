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

// The cell the feet are in. Standing on a block lower than a full one
// (soul sand 0.875, a slab or a stair's low half 0.5, farmland and a path
// 0.9375) the feet are above that block's cell, and the floored position is
// the block itself, not the cell over it: mid-242-af-nether-3-fortress-5
// stood in a fortress's nether wart bed on soul sand at y 52.875 and every
// stance read its cell as the soul sand at 52 (note 618): its lines from
// the blaze were tested at points 0.9 below its body and called it out of
// sight while fireballs hit it, its walks to the cell it stood in never
// arrived, and the ground for the sword was sought a block too low. As the
// pathfinder takes its start: one up from a block the body rests on inside
// that block's own cell.
function feetCell(bot, p = bot.entity.position) {
  const c = p.floored(), dy = p.y - c.y;
  if (dy <= 1e-3 || typeof bot.blockAt !== 'function') return c;
  const b = bot.blockAt(c);
  if (!b || b.boundingBox !== 'block') return c;
  // Resting on one of its shapes lower than a full block (a stair's low
  // half, with its high half beside the feet, counts).
  return b.shapes?.some(s => s[4] < 1 && dy >= s[4] - 1e-3) ? c.offset(0, 1, 0) : c;
}

// The cell the body stands in, by the block it rests on. Crouched at an
// edge a player's middle hangs over the air, its box resting on the block
// beside: the cell under the floored feet is open and the floor is a
// neighbour's. mid-235-p-nether-3 stood so on its fortress approach, and
// every way from the cell under its middle failed at once, the span with
// "nothing solid underfoot" and the pathfinder with no route (note 533).
// The box counts where it touches, as the game lets it stand there.
function restingCell(bot, p = bot.entity?.position) {
  if (!p || typeof bot.blockAt !== 'function') return null;
  const solid = c => bot.blockAt(c)?.boundingBox === 'block';
  const y = Math.ceil(p.y - 1e-4) - 1;
  const feet = new Vec3(Math.floor(p.x), y + 1, Math.floor(p.z));
  if (solid(feet.offset(0, -1, 0))) return feet;
  const w = (bot.entity?.width ?? 0.6) / 2 + 0.001;
  const open = c => [0, 1].every(dy => { const b = bot.blockAt(c.offset(0, dy, 0)); return !!b && b.boundingBox === 'empty' && !/lava|fire/.test(b.name || ''); });
  const cells = [];
  for (let x = Math.floor(p.x - w); x <= Math.floor(p.x + w); x++) for (let z = Math.floor(p.z - w); z <= Math.floor(p.z + w); z++) {
    const c = new Vec3(x, y + 1, z);
    if (!c.equals(feet) && solid(c.offset(0, -1, 0)) && open(c)) cells.push(c);
  }
  return cells.sort((a, b) => Math.hypot(a.x + 0.5 - p.x, a.z + 0.5 - p.z) - Math.hypot(b.x + 0.5 - p.x, b.z + 0.5 - p.z))[0] || null;
}

// A floor that hurts a body standing on it, the game's rules: a magma block
// hurts one a half second (the hot floor) unless the body is crouched; a lit
// campfire one a half second, a lit soul campfire two, crouched or not. The
// game hurts by the block the body rests on, the nearest of those under its
// box (restingCell), not the one under its middle: mid-242-aa-nether-3 hung
// crouched over a hole into the lava with its box's edge on a magma block,
// the cell under its middle open, and stood up there (note 579).
const HOT_FLOOR = { magma_block: 1, campfire: 1, soul_campfire: 2 };
function hotFloor(block) {
  if (!block || !(block.name in HOT_FLOOR)) return false;
  if (block.name === 'magma_block') return true;
  const lit = block.getProperties?.().lit;
  return lit === undefined || lit === true || lit === 'true';
}
// The hot floor under the body now: { block, cell (the cell stood in), hurt
// (a time, before armour), crouchSafe } or null.
function hotUnderfoot(bot, p = bot.entity?.position) {
  const cell = restingCell(bot, p);
  if (!cell) return null;
  const block = bot.blockAt(cell.offset(0, -1, 0));
  if (!hotFloor(block)) return null;
  return { block, cell, hurt: HOT_FLOOR[block.name], crouchSafe: block.name === 'magma_block' };
}

// Beside a drop: a neighbouring cell the body could be pushed into with no
// floor for three blocks under it, or lava under it. See survival.js flee.
const AROUND = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

// Whether a body standing in `feet` (the open cell over its floor) is in
// lava, as the game counts it (Entity.updateFluidHeightAndDoFluidPushing):
// its box, anywhere in the cell, against each lava cell's surface. A floor
// lower than a whole block puts the feet under the surface of the lava
// beside it: soul sand's top is at .875, a lava source's at .889 (its
// amount over nine; a whole block with lava over it). mid-235-p-nether-3-
// fortress-4 and mid-235-p-nether-4-fortress-3 both stepped off a soul sand
// ledge onto the lava sea's soul sand shore, level with the sea, and stood
// in the lava there: 3.5 to death burning, and 20 to 18.1 the first touch
// (note 580). A whole block at the sea's level holds the feet over it.
// `at` reads a block at {x, y, z}; unknown ground is no fact.
const LAVA_SOURCE_HEIGHT = 8 / 9;
function lavaSurface(b, above) {
  if (above && /^(flowing_)?lava$/.test(above.name || '')) return 1;
  const level = Number(b.getProperties?.().level ?? b.metadata ?? 0) || 0;
  return level >= 8 ? LAVA_SOURCE_HEIGHT : (8 - level) / 9;
}
function floorTop(b, y) {
  const shapes = Array.isArray(b?.shapes) ? b.shapes : null;
  return y + (shapes && shapes.length ? Math.max(...shapes.map(s => s[4])) : 1);
}
function standsInLava(at, feet, { height = 1.8 } = {}) {
  const floor = at({ x: feet.x, y: feet.y - 1, z: feet.z });
  if (!floor || floor.boundingBox !== 'block' || /lava/.test(floor.name || '')) return false;
  const top = floorTop(floor, feet.y - 1);
  for (const [dx, dz] of [[0, 0], ...AROUND]) {
    for (let y = Math.floor(top); y < top + height; y++) {
      const b = at({ x: feet.x + dx, y, z: feet.z + dz });
      if (!b || !/^(flowing_)?lava$/.test(b.name || '')) continue;
      if (y + lavaSurface(b, at({ x: feet.x + dx, y: y + 1, z: feet.z + dz })) > top + 0.001) return true;
    }
  }
  return false;
}
const inLavaAt = (bot, feet) => typeof bot?.blockAt === 'function' && standsInLava(p => bot.blockAt(new Vec3(p.x, p.y, p.z)), feet);

// A floor that the next block changed beside it drops. Gravel, sand and the
// other blocks the game lets fall (FallingBlock) are generated resting on
// nothing, and stay so until a block beside them changes: each of the six
// cells round a block that falls, laid or dug, schedules its check, and
// with nothing that holds under it (air, fire, a liquid, a plant: isFree)
// it falls, and the column of them over it after it. Walking on it drops
// nothing; a block laid or dug beside the lowest of the column does.
// mid-243-af-nether-1 stood on the lava sea's gravel beach at (-232, 33,
// 56), the gravel under its feet resting on the sea, and the crossing laid
// its first block against that gravel's side: the gravel went into the
// lava, the body after it, 20 health to none (note 592). Standing on a
// whole block, standsInLava counted it dry, as it was.
const FALLS = /^(sand|red_sand|gravel|suspicious_sand|suspicious_gravel|[a-z_]*concrete_powder|anvil|chipped_anvil|damaged_anvil|dragon_egg)$/;
const holds = b => b.boundingBox === 'block' && !/lava|water/.test(b.name || '');
// The column of falling blocks the floor at `floor` is the top of, when it
// rests on nothing: { bottom, blocks, name, under, into, fall, damage } or
// null. `into` is where the body stood on it goes when it falls: 'lava' (the
// lava under the column, at any depth), 'water', 'ground' (a fall of `fall`
// blocks onto what holds, the column landed under it) or 'unknown'. `at`
// reads a block at {x, y, z}; unknown ground is no fact.
function hangingFloor(at, floor, { deepest = 48 } = {}) {
  const top = at(floor);
  if (!top || !FALLS.test(top.name || '')) return null;
  let bottom = { x: floor.x, y: floor.y, z: floor.z }, blocks = 1, under;
  for (;;) {
    under = at({ x: bottom.x, y: bottom.y - 1, z: bottom.z });
    if (!under) return null;
    if (FALLS.test(under.name || '')) { bottom = { x: bottom.x, y: bottom.y - 1, z: bottom.z }; if (++blocks > 64) return null; continue; }
    if (holds(under)) return null;
    break;
  }
  let into = 'unknown', fall = deepest;
  for (let dy = 1; dy <= deepest; dy++) {
    const c = at({ x: bottom.x, y: bottom.y - dy, z: bottom.z });
    if (!c) break;
    if (/lava/.test(c.name || '')) { into = 'lava'; fall = floor.y - (bottom.y - dy); break; }
    if (/water/.test(c.name || '')) { into = 'water'; fall = floor.y - (bottom.y - dy); break; }
    // The column comes down on what holds, and the body onto the column.
    if (holds(c)) { into = 'ground'; fall = floor.y - (bottom.y - dy) - blocks; break; }
  }
  return { bottom, blocks, name: top.name, under: under.name, into, fall, damage: into === 'ground' ? Math.max(0, fall - 3) : 0 };
}
const FACES = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, 0, 1], [0, 0, -1]];
// Whether laying or digging the block at `changed` drops the floor at
// `floor`: the hanging column's lowest block has it beside it (above or on
// a side; the cell under it is the empty one). -> hangingFloor's facts, or
// null.
function floorDrops(at, floor, changed) {
  const h = hangingFloor(at, floor);
  if (!h) return null;
  const b = h.bottom;
  return FACES.some(([dx, dy, dz]) => changed.x === b.x + dx && changed.y === b.y + dy && changed.z === b.z + dz) ? h : null;
}
// A drop that kills or maims: into lava, or a fall whose damage is half the
// health or more (note 545's measure).
const floorDropDeadly = (h, health = 20) => !!h && (h.into === 'lava' || h.into === 'unknown' || h.damage >= health / 2);
function floorDropSays(h, floor) {
  const what = String(h.name).replaceAll('_', ' ');
  const on = /lava/.test(h.under) ? 'lava' : /water/.test(h.under) ? 'water' : /fire/.test(h.under) ? 'fire' : 'open air';
  const goes = h.into === 'lava' ? 'into the lava' : h.into === 'ground' ? `${h.fall} blocks down${h.damage ? ` (${h.damage} damage)` : ''}` : h.into === 'water' ? 'into the water' : 'down';
  return `the ${what} underfoot at (${floor.x}, ${floor.y}, ${floor.z}) rests on ${on}: a block laid or dug beside ${h.blocks > 1 ? `the lowest of its ${h.blocks}` : 'it'} drops it, and the body with it, ${goes}`;
}
const atOf = bot => p => bot.blockAt(new Vec3(p.x, p.y, p.z));

// Where a body goes that falls down the column from `cell` (the first cell
// it falls through): { n (blocks fallen through), into: 'lava' | 'water' |
// 'ground' | 'unknown', landing (the cell it stands in on ground) }. Ground
// where the body stands in lava is lava (standsInLava, note 580). The
// whole fall, not the four blocks the walks had looked: on 25583 the fall
// past a step was seven blocks and on 25600 thirty-eight, both into the
// lava sea (note 600).
const LAVA_NAME = /^(flowing_)?lava$/;
function fallFrom(at, cell, { deepest = 64 } = {}) {
  for (let n = 0; n <= deepest; n++) {
    const c = { x: cell.x, y: cell.y - n, z: cell.z }, b = at(c);
    if (!b) return { n, into: 'unknown' };
    if (LAVA_NAME.test(b.name || '')) return { n, into: 'lava' };
    if (/water|bubble_column/.test(b.name || '')) return { n, into: 'water' };
    if (b.boundingBox === 'block') {
      const landing = { x: c.x, y: c.y + 1, z: c.z };
      return { n, into: standsInLava(at, landing) ? 'lava' : 'ground', landing };
    }
  }
  return { n: deepest, into: 'unknown' };
}

// The one check for a block dug near the body, whoever digs it (skills.js
// digGuardPlugin wraps bot.dig): whether digging `cell` opens the body
// standing at `pos` to lava. Lava beside or over the cell flows into it
// where the cell touches the body's space; the floor under the body dug
// out with nothing else holding it drops the body down the column, and a
// fall that ends in lava (at any depth, or on ground where it stands in
// lava) is refused; a block dug beside the lowest of a column of gravel or
// sand the body stands on, resting on lava, drops it and the body into the
// lava (note 592). Four of the fortress cohort's eight deaths of 2026-09-28
// were the bot's own dig or step into lava (note 600). -> the words, or null.
function digExposes(at, pos, cell, { health = 20, height = 1.8 } = {}) {
  if (!pos || !cell) return null;
  const floorY = Math.floor(pos.y - 0.01), feetY = floorY + 1, head = Math.floor(pos.y + height - 0.01);
  const cols = [];
  for (let x = Math.floor(pos.x - 0.3); x <= Math.floor(pos.x + 0.3); x++) for (let z = Math.floor(pos.z - 0.3); z <= Math.floor(pos.z + 0.3); z++) cols.push([x, z]);
  // Already in lava: a dig is a way out, as a move that starts in it is.
  if (cols.some(([x, z]) => { for (let y = feetY; y <= head; y++) if (LAVA_NAME.test(at({ x, y, z })?.name || '')) return true; return false; })) return null;
  const where = `(${cell.x}, ${cell.y}, ${cell.z})`;
  const near = cols.some(([x, z]) => Math.abs(cell.x - x) <= 1 && Math.abs(cell.z - z) <= 1) && cell.y >= floorY && cell.y <= head + 1;
  if (near) {
    // Any of its six neighbours, source or flowing: beside or over it the
    // lava flows in, under it the cell opened beside the body is a hole
    // onto lava.
    for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0], [0, -1, 0]]) {
      const n = at({ x: cell.x + dx, y: cell.y + dy, z: cell.z + dz });
      if (n && LAVA_NAME.test(n.name || '')) return dy < 0 ? `lava under ${where}: opened beside the body, it is a hole onto the lava` : `lava beside ${where} flows in, into the body's space`;
    }
  }
  // The floor under the body.
  const under = cols.some(([x, z]) => x === cell.x && z === cell.z) && cell.y === floorY;
  if (under) {
    const held = cols.some(([x, z]) => (x !== cell.x || z !== cell.z) && at({ x, y: floorY, z })?.boundingBox === 'block');
    if (!held) {
      const fall = fallFrom(at, { x: cell.x, y: cell.y - 1, z: cell.z });
      if (fall.into === 'lava') return `the floor under the body at ${where} dug out, it falls ${fall.n + 1} block${fall.n ? 's' : ''} into lava`;
    }
  }
  // A floor of gravel or sand resting on lava, dropped by the dig beside it.
  for (const [x, z] of cols) {
    const floor = { x, y: floorY, z };
    const h = floorDrops(at, floor, cell);
    if (h && (h.into === 'lava' || h.damage >= health)) return floorDropSays(h, floor);
  }
  return null;
}

// What one touch of lava costs this body now: the lava's hits through the
// armour worn while it gets out (a second, two hits, at the least), then the
// fifteen seconds of fire lava sets, a point a second that armour does not
// stop, which only water puts out, and the Nether has none to pour (a water
// bucket boils away there). mid-235-p-nether-3-fortress-4 stepped into the
// lava sea's edge at 3.5 health on its way back to the portal, was out in a
// second at 1.6, and burned to death (note 580).
function lavaTouch(bot, health = bot?.health ?? 20) {
  const { afterArmour, armourOf, FIRE_SECONDS, BURN_PER_SECOND } = require('./combat-estimate');
  const worn = armourOf([5, 6, 7, 8].map(slot => bot?.inventory?.slots?.[slot]?.name).filter(Boolean));
  const r = n => Math.round(n * 10) / 10;
  const hit = r(afterArmour(4, worn));
  const nether = /nether/.test(String(bot?.game?.dimension || ''));
  const water = !nether && (bot?.inventory?.items?.() || []).some(i => i.name === 'water_bucket');
  const resistant = (() => { try { return require('./body').fireResistant?.(bot) || false; } catch (_) { return false; } })();
  const burn = water ? 0 : FIRE_SECONDS.lava * BURN_PER_SECOND;
  const least = resistant ? 0 : r(2 * hit + burn);
  return { hit, perSecond: r(2 * hit), burn, fireSeconds: FIRE_SECONDS.lava, least, water, nether, resistant, deadly: !resistant && least >= health };
}
function lavaTouchSays(bot, health = bot?.health ?? 20) {
  const t = lavaTouch(bot, health), hp = Math.round(health * 10) / 10;
  if (t.resistant) return 'Fire resistance is on the body: lava does not hurt while it lasts.';
  const out = t.water ? 'then burns until put out with the water bucket carried' : `then burns ${t.fireSeconds} seconds at a point a second that armour does not stop${t.nether ? ', with no water to put it out in the Nether' : ', no water carried to put it out'}`;
  return `One touch of lava costs about ${t.perSecond} a second in it through the armour worn (a second to get out at the least), ${out}: about ${t.least} at the least, ${t.deadly ? `more than the ${hp} health the bot has: a touch is death` : `of the ${hp} health the bot has`}.`;
}
// Water is no drop: a fall into it does not hurt, and open water on both
// sides is swimming, not a ledge. mid-231-f, swimming with a drowned, was
// held still and crouched as if on a span, sinking while it was hit
// (2026-09-27).
function dropAt(bot, c) {
  const b = bot.blockAt(c);
  if (!b || b.boundingBox === 'block' || /water/.test(b.name || '')) return false;
  for (let dy = 1; dy <= 3; dy++) {
    const under = bot.blockAt(c.offset(0, -dy, 0));
    if (!under) return false;
    if (under.name === 'lava') return true;
    if (/water/.test(under.name || '')) return false;
    // A step down onto ground where the body stands in lava is a drop
    // into it (note 580); level ground is the lava-beside rules'.
    if (under.boundingBox === 'block') return dy >= 2 && inLavaAt(bot, c.offset(0, 1 - dy, 0));
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
  // A swimmer is on no span: water holds it where it is, and the span's
  // answers (walls, a step off to firm ground) walked mid-202-n and
  // mid-241-l out of the water and down drops of thirty and thirteen
  // (notes 439, 459).
  if (bot.entity?.isInWater || /water|bubble_column/.test(bot.blockAt(feet)?.name || '')) return false;
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
  // The bot's own cell first: standing on the corner of a block over an
  // edge, the cell under its middle is the drop. mid-244-g stood so in a
  // ravine, told no drop was within three, and a spider's hit put it
  // twenty-two blocks down (2026-09-27).
  for (const [dx, dz] of [[0, 0], ...AROUND]) {
    for (let r = dx || dz ? 1 : 0; r <= (dx || dz ? radius : 0); r++) {
      const c = feet.offset(dx * r, 0, dz * r);
      if (dropAt(bot, c)) {
        let fall = 0, into = 'ground';
        for (let dy = 1; dy <= deepest; dy++) {
          const under = bot.blockAt(c.offset(0, -dy, 0));
          if (!under) { fall = deepest; into = 'unknown'; break; }
          if (under.name === 'lava') { fall = dy - 1; into = 'lava'; break; }
          if (under.name === 'water') { fall = dy - 1; into = 'water'; break; }
          if (under.boundingBox === 'block') { fall = dy - 1; if (inLavaAt(bot, c.offset(0, 1 - dy, 0))) into = 'lava'; break; }
          fall = dy;
        }
        const damage = into === 'water' ? 0 : Math.max(0, fall - 3);
        if (!worst || damage > worst.damage || (damage === worst.damage && r < worst.blocksAway)) worst = { blocksAway: r, fallBlocks: fall, into, damage, cell: { x: c.x, y: c.y, z: c.z } };
        break;
      }
      if (!open(c)) break;
    }
  }
  return worst;
}
// A body in lava is out only on ground it can reach swimming: the nearest
// block from where it lands whose top is at the lava's surface or a block
// under it, with room over it, looked for this far. mid-243-ad was thrown
// off its span by a ghast's fireball twenty-two blocks into the lava sea,
// told only "into lava" (and the state a fall of 19 damage, from 20 health:
// lava breaks a fall, and the fall does nothing); nothing stood within
// reach of where it came up, and it burned from 16.6 to none in four
// seconds swimming back toward the span (note 563).
const LAVA_SHORE_RADIUS = 12;
function lavaShore(bot, landing, radius = LAVA_SHORE_RADIUS) {
  let best = null;
  const room = b => !!b && b.boundingBox === 'empty' && !/lava/.test(b.name);
  for (let dx = -radius; dx <= radius; dx++) for (let dz = -radius; dz <= radius; dz++) {
    const d = Math.hypot(dx, dz);
    if (d > radius || (best && d >= best.blocks)) continue;
    for (const y of [landing.y, landing.y - 1]) {
      const b = bot.blockAt(new Vec3(landing.x + dx, y, landing.z + dz));
      if (b?.boundingBox !== 'block') continue;
      if (room(bot.blockAt(new Vec3(landing.x + dx, y + 1, landing.z + dz))) && room(bot.blockAt(new Vec3(landing.x + dx, y + 2, landing.z + dz)))) {
        best = { blocks: Math.round(d * 10) / 10, x: landing.x + dx, y: y + 1, z: landing.z + dz };
        break;
      }
    }
  }
  return best;
}
// What a fall into lava costs, for this body: the lava's four a half second
// through the armour worn (Entity.lavaHurt; its damage type does not bypass
// armour: mid-243-ad's iron took each 4 to 2.1), at roughly a block a second
// swimming (survival.js lavaWays, not measured), to the nearest ground out;
// none within reach, or more health than the bot has, is death. Fire
// resistance, or an enchanted golden apple to eat in it, takes the lava's
// harm away.
const LAVA_HIT = 4, LAVA_HITS_A_SECOND = 2, LAVA_SWIM_BLOCKS_A_SECOND = 1;
function lavaFate(bot, drop, health = bot?.health ?? 20) {
  if (!drop || drop.into !== 'lava' || !drop.cell || typeof bot?.blockAt !== 'function') return null;
  const round = n => Math.round(n * 10) / 10;
  const { afterArmour, armourOf } = require('./combat-estimate');
  const worn = armourOf([5, 6, 7, 8].map(slot => bot.inventory?.slots?.[slot]?.name).filter(Boolean));
  const perSecond = round(afterArmour(LAVA_HIT, worn) * LAVA_HITS_A_SECOND);
  const landing = { x: drop.cell.x, y: drop.cell.y - drop.fallBlocks - 1, z: drop.cell.z };
  let shore = null;
  try { shore = lavaShore(bot, landing); } catch (_) { shore = null; }
  const seconds = shore ? Math.max(0.5, round(shore.blocks / LAVA_SWIM_BLOCKS_A_SECOND)) : null;
  // And the fire lava sets, burning on once the body is out: fifteen
  // seconds at a point a second that armour does not stop, which only
  // water puts out and the Nether has none of (lavaTouch, note 580). It was
  // left out here: mid-242-bb-fortress-4 stood on its own span at the lava
  // sea's level, every stance saying a fireball's push into the lava beside
  // it was "about 6.1 health of the 20" (a second's swim back to the span);
  // the fireball put it in at 15.5 and it was dead three seconds later
  // (note 612).
  const touch = lavaTouch(bot, health);
  const takes = shore ? round(seconds * perSecond + touch.burn) : null;
  const apple = (bot.inventory?.items?.() || []).some(i => i.name === 'enchanted_golden_apple');
  const resistant = (() => { try { return require('./body').fireResistant?.(bot) || false; } catch (_) { return false; } })();
  const deadly = !resistant && !apple && (!shore || takes >= health);
  return { perSecond, shoreBlocks: shore ? shore.blocks : null, ...(shore ? { shore: { x: shore.x, y: shore.y, z: shore.z }, seconds, takes, inIt: round(seconds * perSecond), burn: touch.burn, fireSeconds: touch.fireSeconds, water: touch.water, nether: touch.nether } : {}), ...(apple ? { enchantedGoldenApple: true } : {}), ...(resistant ? { fireResistance: true } : {}), deadly };
}
function lavaFateSays(fate, fall, health = 20) {
  const hp = Math.round(health * 10) / 10;
  const burns = `the lava breaks the fall and burns about ${fate.perSecond} health a second through the armour worn`;
  if (fate.fireResistance) return `into lava ${fall} blocks down, where fire resistance on the body keeps the lava from hurting while it lasts`;
  const after = fate.burn ? `, then the fire it sets burns on ${fate.fireSeconds} seconds out of it at a point a second that armour does not stop${fate.nether ? ' (no water to put it out in the Nether)' : ' (no water carried to put it out)'}: about ${fate.takes} in all` : fate.water ? ', then the fire it sets is put out with the water bucket carried' : '';
  const out = fate.shoreBlocks != null
    ? `the nearest ground out of it from where the body comes up is about ${fate.shoreBlocks} block${fate.shoreBlocks === 1 ? '' : 's'} off, about ${fate.seconds} seconds swimming (not measured), about ${fate.inIt ?? fate.takes} health in it${after}${fate.takes >= health ? `, more than the ${hp} the bot has` : ` of the ${hp} the bot has`}`
    : `no ground out of it stands within ${LAVA_SHORE_RADIUS} blocks of where the body comes up`;
  const end = fate.enchantedGoldenApple ? ': the enchanted golden apple carried, eaten in the lava, is the one way to live through it' : fate.deadly ? ': death' : '';
  return `into lava ${fall ? `${fall} block${fall === 1 ? '' : 's'} down` : 'level with the feet'}; ${burns}, and ${out}${end}`;
}
// The drop within `radius`, as the stance question's state gives it: into
// lava, what the lava costs this body (lavaFate), not the fall's damage,
// which the lava takes away.
function dropFacts(bot, feet, radius = 3, health = bot?.health ?? 20) {
  const drop = dropNear(bot, feet, radius);
  if (!drop) return null;
  const { cell, ...facts } = drop;
  if (drop.into !== 'lava') return { ...facts, ...(drop.damage >= health ? { deadly: true } : {}) };
  const fate = lavaFate(bot, drop, health);
  if (!fate) return { ...facts, damage: 'the lava, not the fall' };
  return { ...facts, damage: fate.deadly ? 'death' : fate.takes ?? 0, lava: fate, ...(fate.deadly ? { deadly: true } : {}) };
}
// Said in a stance option: what the drop beside the bot costs a body
// knocked or stepped into it, at the health it has. With the bot, a drop
// into lava says what the lava costs from where the body comes up.
function dropNote(drop, health, bot = null) {
  if (!drop || (drop.into !== 'lava' && drop.damage < 1)) return '';
  const fate = drop.into === 'lava' && bot ? lavaFate(bot, drop, health ?? 20) : null;
  const end = drop.into === 'lava' ? (fate ? lavaFateSays(fate, drop.fallBlocks, health ?? 20) : 'into lava') : drop.damage >= (health ?? 20) ? `about ${drop.damage} health from the fall, more than the ${Math.round(health ?? 20)} the bot has` : `about ${drop.damage} of the bot's ${Math.round(health ?? 20)} health from the fall`;
  return ` ${drop.fallBlocks ? `A drop of ${drop.fallBlocks} block${drop.fallBlocks === 1 ? '' : 's'}` : 'Lava level with the feet'} is ${drop.blocksAway ? `${drop.blocksAway} block${drop.blocksAway === 1 ? '' : 's'} off` : 'under the bot, standing on the corner of a block over it'}: a hit's knockback or a step back over it is ${end}.`;
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

module.exports = { feetCell, fallFrom, digExposes, hangingFloor, floorDrops, floorDropDeadly, floorDropSays, atOf, standsInLava, lavaTouch, lavaTouchSays, hotFloor, hotUnderfoot, HOT_FLOOR, onSpan, holdOffEdge, edgeHeld, EDGE_REACH, dropNear, dropNote, dropFacts, lavaFate, lavaFateSays, lavaShore, LAVA_SHORE_RADIUS, bodyInLava, besideDrop, dropWithin, KNOCKBACK, dropAt, dryPassable, dryLeaf, dryBodySpace, supportCell, restingCell, damagingTerrain, swimmingBlocks, swimmableWater, waterLevel };
