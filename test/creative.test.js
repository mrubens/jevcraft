'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { takeCreativeItem } = require('../src/creative');
const { Task } = require('../src/skills');
const registry = require('minecraft-data')('26.1');
function setup() {
  const slots = new Map([[36, { name: 'pumpkin', count: 17 }]]);
  const bot = { game: { gameMode: 'creative' }, registry,
    inventory: { items: () => [...slots.values()], firstEmptyInventorySlot: () => Array.from({ length: 36 }, (_, i) => i + 9).find(i => !slots.has(i)) ?? null },
    creative: { setInventorySlot: async (slot, item) => { slots.set(slot, item); } } };
  return { bot, slots, task: new Task('test', 'creative inventory') };
}
test('Creative inventory preserves carried items and respects stack limits', async () => {
  const { bot, slots, task } = setup();
  await takeCreativeItem(bot, task, 'purple_concrete', 96);
  assert.equal(slots.get(36).count, 17);
  assert.deepEqual(bot.inventory.items().filter(i => i.name === 'purple_concrete').map(i => i.count), [64, 32]);
});
test('Creative access is impossible in survival and refuses unconfirmed inventory updates', async () => {
  const { bot, task } = setup();
  bot.game.gameMode = 'survival';
  await assert.rejects(takeCreativeItem(bot, task, 'diamond', 1), /only available in Creative/);
  bot.game.gameMode = 'creative';
  bot.creative.setInventorySlot = async () => {};
  await assert.rejects(takeCreativeItem(bot, task, 'diamond', 1), /Server did not confirm/);
});
test('Creative access stops without replacing inventory when no slots remain', async () => {
  const { bot, task } = setup();
  bot.inventory.firstEmptyInventorySlot = () => null;
  await assert.rejects(takeCreativeItem(bot, task, 'diamond', 1), /Inventory is full/);
});
