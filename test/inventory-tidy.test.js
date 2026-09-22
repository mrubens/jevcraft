'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { tidyInventory, surplus, crowded } = require('../src/inventory-tidy');
const registry = require('minecraft-data')('26.1');

function bot(items, free) {
  const stacks = Object.entries(items).map(([name, count]) => ({ name, count }));
  const tossed = [];
  return { registry, tossed, inventory: { items: () => stacks, emptySlotCount: () => free },
    toss: async (type, meta, count) => { const name = registry.items[type].name; tossed.push([name, count]); const s = stacks.find(i => i.name === name); s.count -= count; free += Math.ceil(count / 64); } };
}

test('with room to spare nothing is dropped; when crowded, surplus stone goes biggest first and stops once there is room', async () => {
  const b = bot({ cobblestone: 744, diorite: 128, andesite: 64, dirt: 83, furnace: 7, iron_sword: 1, coal: 1, oak_log: 9, stone_pickaxe: 1 }, 6);
  assert.equal(crowded(b), false);
  assert.deepEqual(await tidyInventory(b, null), []);
  b.inventory.emptySlotCount = () => 1;
  const dropped = await tidyInventory(b, null);
  assert.equal(dropped[0].name, 'cobblestone'); assert.equal(dropped[0].count, 744 - 192);
  assert(b.tossed.every(([name]) => !['iron_sword', 'coal', 'oak_log', 'stone_pickaxe'].includes(name)), 'tools, fuel and wood are kept');
});

test('the surplus table caps the junk a miner accumulates and keeps two of each workstation', () => {
  const b = bot({ cobblestone: 100, granite: 13, furnace: 7, crafting_table: 2, leaf_litter: 16, raw_copper: 32, diamond: 3 }, 0);
  const over = Object.fromEntries(surplus(b).map(s => [s.name, s.count]));
  assert.deepEqual(over, { granite: 13, furnace: 5, leaf_litter: 16, raw_copper: 16 });
});

test('force drops everything over the cap regardless of room', async () => {
  const b = bot({ cobblestone: 300, diorite: 10, cooked_beef: 4 }, 20);
  const dropped = await tidyInventory(b, null, { force: true });
  assert.deepEqual(dropped.map(d => d.name).sort(), ['cobblestone', 'diorite']);
});

test('what the work in hand is for is never surplus', async () => {
  const b = bot({ sand: 40, cobblestone: 300, granite: 10 }, 1);
  const dropped = await tidyInventory(b, null, { keep: new Set(['sand']) });
  assert(!dropped.some(d => d.name === 'sand'), 'get me sand keeps the sand');
  assert(dropped.some(d => d.name === 'cobblestone'));
});
