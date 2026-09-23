'use strict';
// Enchanting: the table (a book, four obsidian, two diamonds), lapis, and
// the experience the run earns anyway from ore, smelting and mobs. Without
// bookshelves the table offers up to level eight: Sharpness or Protection
// or Power at I or II, which is a lot against a dragon and its endermen.
//
// What is enchanted first is what the End asks most of: the sword, the bow,
// then the armour from the chest down, then the pickaxe. Only iron and
// better (and the bow): a stone sword is replaced long before it matters.
// Of the three offers, the dearest the bot's level and lapis can pay for.
const { countOf } = require('./skills');
const { checkAir } = require('./vitals');
const { checkThreats } = require('./danger');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const ORDER = [/^(iron|diamond|netherite)_sword$/, /^bow$/, /^(iron|diamond|netherite)_chestplate$/, /^(iron|diamond|netherite)_leggings$/,
  /^(iron|diamond|netherite)_helmet$/, /^(iron|diamond|netherite)_boots$/, /^(iron|diamond|netherite)_pickaxe$/];
const ARMOUR_SLOT = { 5: 'head', 6: 'torso', 7: 'legs', 8: 'feet' };
const MIN_LEVEL = 5;
const level = bot => bot.experience?.level ?? 0;
// An item's enchantments as names and levels. In 26.1 the item's data
// comes as { enchantments: [{ id, level }] }, not the list older versions
// gave: read as a list, every enchanted sword looked plain.
const registry = require('minecraft-data')('26.1');
function enchantsOf(item) {
  const e = item?.enchants;
  if (Array.isArray(e)) return e.map(x => ({ name: String(x.name).replace(/^minecraft:/, ''), lvl: x.lvl ?? x.level }));
  if (Array.isArray(e?.enchantments)) return e.enchantments.map(x => ({ name: registry.enchantments[x.id]?.name || `#${x.id}`, lvl: x.level ?? x.lvl }));
  return [];
}
const enchanted = item => enchantsOf(item).length > 0;

// The gear still to enchant, first in line first: carried or worn.
function enchantable(bot) {
  const worn = [5, 6, 7, 8].map(slot => bot.inventory.slots?.[slot] && { item: bot.inventory.slots[slot], worn: ARMOUR_SLOT[slot] }).filter(Boolean);
  const pool = [...bot.inventory.items().map(item => ({ item })), ...worn].filter(({ item }) => !enchanted(item));
  const out = [];
  for (const pattern of ORDER) for (const entry of pool) if (pattern.test(entry.item.name) && !out.includes(entry)) out.push(entry);
  return out;
}

const tableNear = (bot, goal) => {
  const id = bot.registry?.blocksByName?.enchanting_table?.id;
  const seen = id !== undefined && typeof bot.findBlocks === 'function' && bot.findBlocks({ matching: [id], maxDistance: 48, count: 1 }).length > 0;
  return seen || countOf(bot, 'enchanting_table') > 0 || !!goal.enchanting?.table;
};

// Whether an enchant can be made now: a table carried, in view or
// remembered, lapis in hand, enough levels, and gear waiting.
function enchantReady(bot, goal) {
  return tableNear(bot, goal) && countOf(bot, 'lapis_lazuli') > 0 && level(bot) >= MIN_LEVEL && enchantable(bot).length > 0;
}

// The dearest of the table's three offers this level and lapis pay for.
function bestOffer(offers, { level: have, lapis }) {
  let best = -1;
  offers.forEach((offer, i) => { if (offer.level > 0 && offer.level <= have && lapis >= i + 1) best = i; });
  return best;
}

async function enchantStep(bot, task, goal, save, { workstation }) {
  task.check(); checkAir(bot); checkThreats(bot);
  const next = enchantable(bot)[0];
  if (!next) return false;
  const state = goal.enchanting ||= { done: [] };
  goal.step = { action: 'enchant', item: next.item.name, level: level(bot), lapis: countOf(bot, 'lapis_lazuli') }; save();
  const block = await workstation(bot, task, 'enchanting_table', goal);
  state.table = { x: block.position.x, y: block.position.y, z: block.position.z, dimension: String(bot.game?.dimension || 'overworld') }; save();
  // Worn armour comes off for the table and goes back on after.
  if (next.worn) { await bot.unequip(next.worn); await sleep(200); }
  const table = await bot.openEnchantmentTable(block);
  let chosen = -1, cost = 0;
  try {
    // By the window's own slot numbers: the pockets are numbered differently
    // inside the table's window than in bot.inventory.
    const item = table.items().find(i => i.name === next.item.name && !enchanted(i));
    const lapis = table.items().find(i => i.name === 'lapis_lazuli');
    if (!item || !lapis) throw new Error(`The ${next.item.name.replaceAll('_', ' ')} or the lapis is not in the pockets`);
    await table.putTargetItem(item);
    await table.putLapis(lapis);
    for (let waited = 0; waited < 3000 && !table.enchantments?.every(e => e.level >= 0); waited += 100) { task.check(); await sleep(100); }
    chosen = bestOffer(table.enchantments || [], { level: level(bot), lapis: lapis.count });
    if (chosen < 0) { state.unaffordableAt = { level: level(bot), at: new Date().toISOString() }; save(); }
    if (chosen >= 0) {
      cost = table.enchantments[chosen].level;
      await table.enchant(chosen);
    }
    await table.takeTargetItem();
  } finally {
    // The lapis back out, the window's view refreshed from the server, then
    // closed, then the pockets refreshed: closing copies the window's view
    // into the pockets, and a stale one lost the sword and the lapis to the
    // client's eyes in the first drill.
    try { if (table.slots?.[1]) await bot.putAway(1); } catch (_) { /* back on close */ }
    try { if (bot._syncWindow) await bot._syncWindow(table); } catch (_) { /* best effort */ }
    table.close();
    try { if (bot._syncWindow) await bot._syncWindow(bot.inventory); } catch (_) { /* best effort */ }
  }
  await sleep(200);
  if (chosen < 0) {
    // Nothing affordable at this level: the piece goes back on, and the next
    // try waits for more levels (enchantReady wants five).
    const back = next.worn && bot.inventory.items().find(i => i.name === next.item.name);
    if (back) await bot.equip(back, next.worn);
    return false;
  }
  const done = bot.inventory.items().find(i => i.name === next.item.name && enchanted(i));
  if (next.worn && done) await bot.equip(done, next.worn);
  const names = enchantsOf(done).map(e => `${e.name.replaceAll('_', ' ')} ${e.lvl}`);
  state.done.push({ item: next.item.name, at: new Date().toISOString(), cost, enchants: names }); save();
  bot.chat?.(`Enchanted my ${next.item.name.replaceAll('_', ' ')}${names.length ? `: ${names.join(', ')}` : ''}.`);
  return true;
}

module.exports = { enchantsOf, ORDER, MIN_LEVEL, enchantable, enchantReady, bestOffer, enchantStep, tableNear };
