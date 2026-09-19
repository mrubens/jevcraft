'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const registry = require('prismarine-registry')('26.1');
const { Task } = require('../src/skills');
const { prepareEndSupplies } = require('../src/end-supplies');
function fixture() {
  const slots = [], items = ['iron_sword', 'iron_pickaxe', 'bow', 'arrow', 'cobblestone', 'cooked_beef', 'water_bucket'].map(name => ({ name,
    count: ({ arrow: 192, cobblestone: 64, cooked_beef: 8 })[name] || 1, durabilityUsed: 0 }));
  for (const [slot, name] of [[5, 'iron_helmet'], [6, 'iron_chestplate'], [7, 'iron_leggings'], [8, 'iron_boots'], [45, 'shield']]) slots[slot] = { name, count: 1, durabilityUsed: 0 };
  const bot = { registry, health: 20, food: 20, oxygenLevel: 20, inventory: { slots, items: () => items }, heldItem: items[0] };
  return { bot, items, goal: {}, task: new Task('End supplies') };
}
test('End preparation acquires a new bow when worn and requires real arrow, bridge and food reserves', async () => {
  for (const missing of ['bow', 'arrow', 'cobblestone', 'water_bucket', 'cooked_beef', null]) {
    const { bot, items, goal, task } = fixture(); const calls = [];
    const item = items.find(i => i.name === missing);
    if (missing === 'bow') item.durabilityUsed = registry.itemsByName.bow.maxDurability - 1;
    else if (item) item.count--;
    const ready = await prepareEndSupplies(bot, task, goal, () => {}, { acquireStep: async (b, t, name, count) => calls.push({ name, count }) });
    assert.equal(ready, missing === null);
    if (missing === 'bow') assert.deepEqual(calls, [{ name: 'bow', count: 2 }]);
    if (missing === 'arrow') assert.deepEqual(calls, [{ name: 'arrow', count: 192 }]);
    if (missing === 'cobblestone') assert.deepEqual(calls, [{ name: 'cobblestone', count: 64 }]);
    if (missing === 'water_bucket') assert.deepEqual(calls, [{ name: 'water_bucket', count: 1 }]);
    if (missing === 'cooked_beef') { assert.deepEqual(calls, []); assert.equal(goal.preparingEnd, true); }
    if (!missing) assert.equal(goal.preparingEnd, undefined);
  }
});
