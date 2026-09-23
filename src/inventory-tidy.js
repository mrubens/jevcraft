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

// Spare gear, when stone alone does not make room: pockets holding two
// swords, two diamond pickaxes, three shields and a second helmet, leggings
// and boots had no slot for raw chicken, and chicken after chicken was
// killed and left lying at the bot's feet. The best of each tool is kept (and
// one spare pickaxe, the tool a long dig wears out); armour no better than
// what is worn goes, and so does a second of the rest.
const TIERS = ['wooden', 'leather', 'golden', 'stone', 'chainmail', 'iron', 'diamond', 'netherite'];
const tier = name => TIERS.findIndex(t => name.startsWith(`${t}_`));
const TOOL = /_(sword|pickaxe|axe|shovel|hoe)$/, ARMOUR = /_(helmet|chestplate|leggings|boots)$/;
const SINGLES = new Set(['flint_and_steel', 'shears', 'fishing_rod', 'shield', 'bow', 'crossbow']);
const WORN = { helmet: 5, chestplate: 6, leggings: 7, boots: 8 };
function spares(bot, keep = new Set()) {
  const items = bot.inventory.items().filter(i => !keep.has(i.name));
  const out = [];
  const byKind = {};
  for (const item of items) {
    const kind = TOOL.test(item.name) ? item.name.match(TOOL)[1] : ARMOUR.test(item.name) ? item.name.match(ARMOUR)[1] : SINGLES.has(item.name) ? item.name : null;
    if (kind) (byKind[kind] ||= []).push(item);
  }
  for (const [kind, list] of Object.entries(byKind)) {
    list.sort((a, b) => tier(b.name) - tier(a.name));
    if (kind in WORN) {
      const worn = bot.inventory.slots?.[WORN[kind]];
      const keepOne = worn ? list.filter(i => tier(i.name) > tier(worn.name)).slice(0, 1) : list.slice(0, 1);
      out.push(...list.filter(i => !keepOne.includes(i)));
    } else out.push(...list.slice(kind === 'pickaxe' ? 2 : 1));
  }
  // The weakest first.
  return out.sort((a, b) => tier(a.name) - tier(b.name));
}

// Room for one more of `name`: a free slot or a stack with space in it.
function roomFor(bot, name) {
  if ((bot.inventory.emptySlotCount?.() ?? 1) > 0) return true;
  return bot.inventory.items().some(i => i.name === name && i.count < (i.stackSize || 64));
}

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
  if (crowded(bot)) for (const item of spares(bot, keep)) {
    task?.check?.();
    try { await (bot.tossStack ? bot.tossStack(item) : bot.toss(item.type, null, item.count)); dropped.push({ name: item.name, count: item.count }); }
    catch (err) { task?.check?.(); break; }
    if (!crowded(bot)) break;
  }
  return dropped;
}

// Room for something wanted, now. Everything under its cap is still
// cheaper than food or ore: with 190 cobblestone, 104 coal and 67
// netherrack, all under their caps, the tidy found nothing to drop and four
// hundred hunts in a row were refused for want of one slot. Stacks go in
// this order, the smallest first, down to the floor each keeps.
const EXPENDABLE = [
  ['dirt', 0], ['gravel', 0], [/_sapling$/, 0], ['nether_brick_fence', 0], ['leaf_litter', 0], ['short_grass', 0],
  ['netherrack', 32], ['cobbled_deepslate', 0], ['cobblestone', 64], ['soul_sand', 0], ['nether_bricks', 0], ['wheat_seeds', 8],
];
async function makeRoom(bot, task, name, { keep = new Set(), away = null } = {}) {
  if (roomFor(bot, name)) return true;
  // Junk before tools: with forty-six nether brick fences in the pockets the
  // tidy threw out the stone pickaxe first, and the ladder, counting the
  // worn diamond pickaxes as spent, made another and threw it out again.
  for (const [match, floor] of EXPENDABLE) {
    if (roomFor(bot, name)) return true;
    const test = typeof match === 'string' ? n => n === match : n => match.test(n);
    const stacks = bot.inventory.items().filter(i => test(i.name) && i.name !== name && !keep.has(i.name)).sort((a, b) => a.count - b.count);
    let total = stacks.reduce((n, i) => n + i.count, 0);
    for (const stack of stacks) {
      if (roomFor(bot, name) || total - stack.count < floor) break;
      task?.check?.();
      try { await (bot.tossStack ? bot.tossStack(stack) : bot.toss(stack.type, null, stack.count)); total -= stack.count; }
      catch (err) { task?.check?.(); break; }
    }
  }
  if (!roomFor(bot, name)) await tidyInventory(bot, task, { force: true, keep: new Set([...keep, name]), away });
  return roomFor(bot, name);
}

module.exports = { makeRoom, tidyInventory, surplus, spares, roomFor, crowded, SURPLUS, FREE_SLOTS };
