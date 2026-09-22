'use strict';
// Pockets full is a quiet way to stall: iron ore mined and never picked up,
// a crafting grid that spills its contents on the ground, seven furnaces
// nobody asked for. The dream run reached that state with twelve stacks of
// cobblestone and a stack each of the granites. A miner keeps a few stacks
// of stone for shelters and tools and lets the rest lie. Everything not in
// the table below is kept: tools, food, ores, ingots, wood, the rare stuff.
// Wheat seeds are kept up to a stack: clearing grass is how the home plot
// gets planted, and tossing them was how the plot stayed bare.
const SURPLUS = Object.freeze({
  cobblestone: 192, cobbled_deepslate: 64, dirt: 32, gravel: 16, sand: 0, red_sand: 0,
  diorite: 0, andesite: 0, granite: 0, tuff: 0, calcite: 0, netherrack: 128,
  leaf_litter: 0, short_grass: 0, seagrass: 0, kelp: 0, wheat_seeds: 32, raw_copper: 16, copper_ingot: 16,
  furnace: 2, crafting_table: 2, snowball: 0, ice: 0, clay_ball: 0, flint: 8,
});
const FREE_SLOTS = 4;

// `keep` is what the work in hand is for: "get me 64 sand" with full
// pockets mined the sand, dropped it as surplus, and mined it again.
function surplus(bot, keep = new Set()) {
  const counts = {};
  for (const item of bot.inventory.items()) counts[item.name] = (counts[item.name] || 0) + item.count;
  return Object.entries(counts).filter(([name, count]) => name in SURPLUS && !keep.has(name) && count > SURPLUS[name])
    .map(([name, count]) => ({ name, count: count - SURPLUS[name] }));
}

function crowded(bot) {
  const free = bot.inventory.emptySlotCount?.();
  return Number.isInteger(free) ? free < FREE_SLOTS : false;
}

// Drop what is over the cap, biggest surplus first, until the pockets have
// room again. Returns what was dropped so the caller can say so once.
async function tidyInventory(bot, task, { force = false, away = null, keep } = {}) {
  if (!force && !crowded(bot)) return [];
  // A stack dropped at the feet is picked straight back up. Throw it behind,
  // away from where the work is heading, so it lands out of reach.
  if (away && typeof bot.lookAt === 'function') {
    const here = bot.entity.position;
    const d = { x: here.x - away.x, z: here.z - away.z };
    const norm = Math.hypot(d.x, d.z) || 1;
    try { await bot.lookAt(here.offset(d.x / norm * 4, 2.2, d.z / norm * 4), true); } catch (_) {}
  }
  const dropped = [];
  for (const { name, count } of surplus(bot, keep).sort((a, b) => b.count - a.count)) {
    task?.check?.();
    const type = bot.registry?.itemsByName?.[name]?.id;
    if (type === undefined) continue;
    try { await bot.toss(type, null, count); dropped.push({ name, count }); }
    catch (err) { task?.check?.(); break; }
    if (!force && !crowded(bot)) break;
  }
  return dropped;
}

module.exports = { tidyInventory, surplus, crowded, SURPLUS, FREE_SLOTS };
