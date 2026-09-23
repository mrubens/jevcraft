'use strict';
const { countOf } = require('./skills');

// Take `count` MORE of an item, on top of whatever is carried. The planner
// already subtracted the carried stock, including stock reserved for a
// delivery, when it sized the step. Treating the count as a total instead
// meant that "craft me a chest" in Creative could never fetch the second
// chest to store the first one in: one chest was carried, one was the
// target, and nothing was ever taken.
// In Creative every item is free, so pockets are made room in by deleting
// what the work does not need rather than dropping it: Jev sat at "my
// pockets are full" for a thousand attempts with one each of thirty-five
// oddments, and a dropped stack litters the players' world. Worn armour
// (slots 5 to 8) is left alone. Returns what was cleared.
async function clearCreativeInventory(bot, task, keep = new Set()) {
  if (bot.game.gameMode !== 'creative') throw new Error('Creative inventory is only available in Creative mode');
  const cleared = [];
  for (let slot = 9; slot <= 44; slot++) {
    const item = bot.inventory.slots[slot];
    if (!item || keep.has(item.name)) continue;
    task?.check?.();
    await bot.creative.setInventorySlot(slot, null);
    cleared.push({ name: item.name, count: item.count });
  }
  if (cleared.length && bot._syncWindow) await bot._syncWindow(bot.inventory);
  return cleared;
}

async function takeCreativeItem(bot, task, name, count, { keep = new Set() } = {}) {
  if (bot.game.gameMode !== 'creative') throw new Error('Creative inventory is only available in Creative mode');
  const definition = bot.registry.itemsByName[name];
  if (!definition || !Number.isInteger(count) || count < 1 || count > 2304) throw new Error('Invalid Creative item request');
  const Item = require('prismarine-item')(bot.registry);
  const target = countOf(bot, name) + count;
  while (countOf(bot, name) < target) {
    task.check();
    if (bot.game.gameMode !== 'creative') throw new Error('Game mode changed while using Creative inventory');
    const free = () => { const slot = bot.inventory.firstEmptyInventorySlot(); return slot === null || slot < 9 || slot > 44 ? null : slot; };
    if (free() === null) await clearCreativeInventory(bot, task, new Set([...keep, name]));
    const slot = free();
    if (slot === null) throw new Error('Inventory is full; make room before taking more items');
    const before = countOf(bot, name);
    const amount = Math.min(definition.stackSize, target - before);
    await bot.creative.setInventorySlot(slot, new Item(definition.id, amount));
    if (bot._syncWindow) await bot._syncWindow(bot.inventory);
    if (countOf(bot, name) !== before + amount) throw new Error(`Server did not confirm Creative inventory update for ${name}`);
  }
}

module.exports = { takeCreativeItem, clearCreativeInventory };
