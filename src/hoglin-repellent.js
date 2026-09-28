// What a hoglin shuns, read from the 26.1.2 server jar, and the warped
// fungus set down as a stance (note 587).
//
// HoglinSpecificSensor looks for the nearest block in the hoglin_repellents
// tag (warped_fungus, potted_warped_fungus, nether_portal, respawn_anchor)
// within 8 blocks across and 4 up or down of the hoglin's own cell
// (BlockPos.findClosestMatch(pos, 8, 4)), about once a second (a sensor's
// scan); only a block counts, never an item held or carried. With one
// found, BecomePassiveIfMemoryPresent (first in both its idle and its fight
// activity) drops its attack target and pacifies it for 200 ticks, and
// again as soon as that ends while the block is still that near; idle, it
// walks off to 8 blocks from the block (SetWalkTargetAwayFrom.pos, speed
// 1.0). A hoglin struck loses the pacifying (wasHurtBy) and turns on the
// one that struck it, and the next tick near the block drops it again. A
// zoglin shuns nothing (Zoglin has no such sensor).
//
// A warped fungus stands only on what the supports_warped_fungus tag names:
// nylium, soul soil, mycelium and the vegetation ground (dirt, coarse and
// rooted dirt, grass, podzol, moss, mud, farmland), never netherrack, soul
// sand, blackstone or basalt.

const REPELLENTS = ['warped_fungus', 'potted_warped_fungus', 'nether_portal', 'respawn_anchor'];
const ACROSS = 8, UP_DOWN = 4, PACIFIED_SECONDS = 10, NOTICE_SECONDS = 1;
const REPELLED = new Set(['hoglin']);
const FUNGUS_GROUND = new Set(['crimson_nylium', 'warped_nylium', 'soul_soil', 'mycelium', 'dirt', 'coarse_dirt', 'rooted_dirt', 'grass_block', 'podzol',
  'moss_block', 'pale_moss_block', 'mud', 'muddy_mangrove_roots', 'farmland']);
// Ground a player carries and can lay to set the fungus on (farmland is
// not an item).
const GROUND_ITEMS = [...FUNGUS_GROUND].filter(n => n !== 'farmland');

// The repellent block within a hoglin's sensing box, or null. Looked up at
// most every half second a hoglin: the danger list asks many times a tick.
const CACHE_MS = 500;
function repellentNear(bot, entity) {
  if (!entity?.position || typeof bot?.findBlocks !== 'function' || !bot.registry?.blocksByName) return null;
  const cache = bot._repellentCache ||= new Map();
  const cell = entity.position.floored(), key = `${entity.id}:${cell}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.block;
  const ids = REPELLENTS.map(n => bot.registry.blocksByName[n]?.id).filter(id => id !== undefined);
  let block = null;
  try {
    const found = bot.findBlocks({ point: cell, matching: ids, maxDistance: Math.ceil(Math.hypot(ACROSS, ACROSS, UP_DOWN)) + 1, count: 32 });
    const inBox = found.filter(p => Math.abs(p.x - cell.x) <= ACROSS && Math.abs(p.z - cell.z) <= ACROSS && Math.abs(p.y - cell.y) <= UP_DOWN)
      .sort((a, b) => a.distanceTo(cell) - b.distanceTo(cell))[0];
    if (inBox) block = { name: bot.blockAt?.(inBox)?.name || 'warped_fungus', at: { x: inBox.x, y: inBox.y, z: inBox.z } };
  } catch (_) { block = null; }
  if (cache.size > 64) cache.clear();
  cache.set(key, { at: Date.now(), block });
  return block;
}
// A hoglin kept off by a block near it: it attacks nothing while that
// block is within its box.
const pacified = (bot, entity) => REPELLED.has(entity?.name) && !!repellentNear(bot, entity);

// Where a warped fungus can go from here: a cell the bot reaches, open,
// with no body in it and not in the bot's own column, on ground that takes
// it (one block); or, with ground carried, a cell on firm floor for that
// ground and the fungus on top (two). The nearest first, the one block
// before the two.
const REACH = 4.5;
function fungusPlan(bot) {
  const pos = bot?.entity?.position;
  if (!pos || typeof bot.blockAt !== 'function') return null;
  const fungus = bot.inventory?.items?.().find(i => i.name === 'warped_fungus');
  if (!fungus) return null;
  const ground = GROUND_ITEMS.map(n => bot.inventory.items().find(i => i.name === n)).find(Boolean) || null;
  const feet = pos.floored(), eye = pos.offset(0, bot.entity.eyeHeight || 1.62, 0);
  const open = p => { const b = bot.blockAt(p); return !!b && b.boundingBox === 'empty' && !/water|lava|fire|portal/.test(b.name) && (b.name === 'air' || b.name === 'cave_air' || b.name === 'void_air'); };
  const { bodyIn } = require('./work');
  const bodies = Object.values(bot.entities || {}).filter(e => e.position && e.isValid !== false && e !== bot.entity);
  const free = p => !bodies.some(e => bodyIn(e, p)) && !bodyIn({ ...bot.entity, width: 0.6, height: 1.8 }, p) && !(p.x === feet.x && p.z === feet.z);
  const reach = p => eye.distanceTo(p.offset(0.5, 0.5, 0.5)) <= REACH;
  const ones = [], twos = [];
  for (let dy = -1; dy <= 1; dy++) for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
    const p = feet.offset(dx, dy, dz);
    if (!open(p) || !free(p) || !reach(p)) continue;
    const under = bot.blockAt(p.offset(0, -1, 0));
    if (under && FUNGUS_GROUND.has(under.name)) ones.push({ cells: [{ at: p, item: 'warped_fungus' }], on: under.name, cell: p });
    else if (ground && under?.boundingBox === 'block' && open(p.offset(0, 1, 0)) && free(p.offset(0, 1, 0)) && reach(p.offset(0, 1, 0)))
      twos.push({ cells: [{ at: p, item: ground.name }, { at: p.offset(0, 1, 0), item: 'warped_fungus' }], on: ground.name, laid: true, cell: p.offset(0, 1, 0) });
  }
  const near = (a, b) => a.cell.distanceTo(pos) - b.cell.distanceTo(pos);
  const plan = ones.sort(near)[0] || twos.sort(near)[0] || null;
  if (plan) return { ...plan, carried: fungus.count };
  return { carried: fungus.count, none: ground ? 'no open cell within reach on ground or on a floor to lay ground on' : `no open cell within reach on ground a warped fungus takes (${[...new Set([...FUNGUS_GROUND].map(n => n.replaceAll('_', ' ')))].slice(0, 6).join(', ')} and the like), and none of that ground carried to lay` };
}

// The rule in words, said with the option.
function ruleSays() {
  return ` A hoglin shuns a warped fungus set down as a block: within ${ACROSS} blocks of it across and ${UP_DOWN} up or down, a hoglin drops its target and attacks nothing for ${PACIFIED_SECONDS} seconds, again as soon as that ends while it is still that near, and walks off to ${ACROSS} blocks from it; it notices about a second after it is set down or after it comes that near. Struck, a hoglin turns on the bot for a moment and is calmed again at once while the fungus is that near. Held in the hand or carried, a warped fungus does nothing: only the block counts (a nether portal's blocks and a respawn anchor do the same). It keeps off nothing else: not a zoglin, a piglin or anything else. A warped fungus stands only on nylium, soul soil, mycelium, dirt, grass, podzol, moss, mud or farmland, not on netherrack, soul sand, blackstone or basalt.`;
}

module.exports = { REPELLENTS, ACROSS, UP_DOWN, PACIFIED_SECONDS, NOTICE_SECONDS, REPELLED, FUNGUS_GROUND, GROUND_ITEMS, repellentNear, pacified, fungusPlan, ruleSays };
