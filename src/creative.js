'use strict';
const { countOf } = require('./skills');

async function takeCreativeItem(bot, task, name, count) {
  if (bot.game.gameMode !== 'creative') throw new Error('Creative inventory is only available in Creative mode');
  const definition = bot.registry.itemsByName[name];
  if (!definition || !Number.isInteger(count) || count < 1 || count > 2304) throw new Error('Invalid Creative item request');
  const Item = require('prismarine-item')(bot.registry);
  while (countOf(bot, name) < count) {
    task.check();
    if (bot.game.gameMode !== 'creative') throw new Error('Game mode changed while using Creative inventory');
    const slot = bot.inventory.firstEmptyInventorySlot();
    if (slot === null || slot < 9 || slot > 44) throw new Error('Inventory is full; make room before taking more items');
    const before = countOf(bot, name);
    const amount = Math.min(definition.stackSize, count - before);
    await bot.creative.setInventorySlot(slot, new Item(definition.id, amount));
    if (bot._syncWindow) await bot._syncWindow(bot.inventory);
    if (countOf(bot, name) !== before + amount) throw new Error(`Server did not confirm Creative inventory update for ${name}`);
  }
}

module.exports = { takeCreativeItem };
