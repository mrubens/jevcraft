'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { takeCreativeItem, clearCreativeInventory } = require('../src/creative');
const { Task } = require('../src/skills');
const registry = require('minecraft-data')('26.1');
function setup() {
  const slots = new Map([[36, { name: 'pumpkin', count: 17 }]]);
  const bot = { game: { gameMode: 'creative' }, registry,
    inventory: { items: () => [...slots.values()].filter(Boolean), get slots() { return Object.fromEntries([...slots].filter(([, item]) => item)); },
      firstEmptyInventorySlot: () => Array.from({ length: 36 }, (_, i) => i + 9).find(i => !slots.get(i)) ?? null },
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
test('full Creative pockets are cleared of what the work does not need, never of what it does', async () => {
  // Thirty-five oddments and a stack of the build's own concrete: the next
  // material has to fit, the concrete has to stay.
  const { bot, slots, task } = setup();
  const oddments = Object.keys(registry.itemsByName).filter(n => !['red_concrete', 'pink_concrete', 'air'].includes(n)).slice(0, 35);
  for (let i = 0; i < 36; i++) slots.set(i + 9, i === 0 ? { name: 'red_concrete', count: 64 } : { name: oddments[i - 1], count: 1 });
  await takeCreativeItem(bot, task, 'pink_concrete', 1, { keep: new Set(['red_concrete']) });
  const names = bot.inventory.items().map(i => i.name).sort();
  assert.deepEqual(names, ['pink_concrete', 'red_concrete']);
  // When every slot holds something the work needs, nothing is deleted.
  const needed = setup();
  for (let i = 0; i < 36; i++) needed.slots.set(i + 9, { name: 'red_concrete', count: 64 });
  await assert.rejects(takeCreativeItem(needed.bot, needed.task, 'diamond', 1, { keep: new Set(['red_concrete']) }), /Inventory is full/);
  assert.equal(needed.bot.inventory.items().length, 36);
  // Worn armour is never touched, and it is Creative only.
  const worn = setup(); worn.slots.set(6, { name: 'iron_chestplate', count: 1 });
  await clearCreativeInventory(worn.bot, worn.task);
  assert.deepEqual(worn.bot.inventory.items().map(i => i.name), ['iron_chestplate']);
  worn.bot.game.gameMode = 'survival';
  await assert.rejects(clearCreativeInventory(worn.bot, worn.task), /only available in Creative/);
});
test('a Creative step takes its count on top of carried stock, so a chest reserved for delivery can be joined by a chest to store it in', async () => {
  const { bot, slots, task } = setup();
  slots.set(37, { name: 'chest', count: 1 });
  const { catalogPlan } = require('../src/work');
  const creative = { ...bot, entity: { position: { distanceTo: () => 0 } } };
  // One chest is carried but reserved for the player; the plan sees none.
  const plan = catalogPlan(creative, 'chest', 1, { chest: 0 });
  assert.equal(plan.length, 1); assert.equal(plan[0].action, 'creative_inventory'); assert.equal(plan[0].count, 1);
  await takeCreativeItem(bot, task, plan[0].item, plan[0].count);
  assert.equal(bot.inventory.items().filter(i => i.name === 'chest').reduce((n, i) => n + i.count, 0), 2);
  assert.deepEqual(catalogPlan(creative, 'chest', 1, { chest: 1 }), [], 'enough carried means no step');
});
