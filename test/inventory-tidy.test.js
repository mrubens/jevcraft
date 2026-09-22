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

test('crowded with nothing over the caps, spare gear goes: the best tool stays, armour no better than what is worn goes', async () => {
  const stacks = [
    { name: 'diamond_sword', count: 1 }, { name: 'iron_sword', count: 1 }, { name: 'diamond_pickaxe', count: 1 }, { name: 'diamond_pickaxe', count: 1 },
    { name: 'iron_pickaxe', count: 1 }, { name: 'shield', count: 1 }, { name: 'shield', count: 1 }, { name: 'iron_helmet', count: 1 },
    { name: 'diamond_boots', count: 1 }, { name: 'flint_and_steel', count: 1 }, { name: 'flint_and_steel', count: 1 }, { name: 'bucket', count: 2 },
  ];
  let free = 0; const tossed = [];
  const b = { registry, inventory: { items: () => stacks, emptySlotCount: () => free, slots: { 5: { name: 'iron_helmet' }, 8: { name: 'iron_boots' } } },
    tossStack: async item => { tossed.push(item.name); stacks.splice(stacks.indexOf(item), 1); free++; } };
  const { spares } = require('../src/inventory-tidy');
  assert.deepEqual(spares(b).map(i => i.name).sort(), ['flint_and_steel', 'iron_helmet', 'iron_pickaxe', 'iron_sword', 'shield'].sort());
  await tidyInventory(b, null);
  assert(!tossed.includes('diamond_sword') && !tossed.includes('diamond_boots') && !tossed.includes('bucket'));
  assert.equal(free >= 4, true, 'until there is room');
});

test('room for one more is a free slot or a stack with space', () => {
  const { roomFor } = require('../src/inventory-tidy');
  const b = bot({ chicken: 3, cobblestone: 64 }, 0);
  assert.equal(roomFor(b, 'chicken'), true);
  assert.equal(roomFor(b, 'beef'), false);
  b.inventory.emptySlotCount = () => 1;
  assert.equal(roomFor(b, 'beef'), true);
});

test('with every stack under its cap, room for food is made from the cheapest stack, smallest first, down to its floor', async () => {
  const { makeRoom } = require('../src/inventory-tidy');
  const stacks = [{ name: 'cobblestone', count: 64 }, { name: 'cobblestone', count: 62 }, { name: 'coal', count: 64 }, { name: 'netherrack', count: 3 },
    { name: 'netherrack', count: 64 }, { name: 'raw_iron', count: 12 }, { name: 'diamond_sword', count: 1 }];
  let free = 0; const tossed = [];
  const b = { registry, inventory: { items: () => stacks, emptySlotCount: () => free, slots: {} },
    toss: async () => { throw new Error('whole stacks only'); },
    tossStack: async item => { tossed.push(`${item.count} ${item.name}`); stacks.splice(stacks.indexOf(item), 1); free++; } };
  assert.equal(await makeRoom(b, null, 'mutton'), true);
  assert.deepEqual(tossed, ['3 netherrack'], 'one small stack of the cheapest thing, nothing more');
  free = 0;
  assert.equal(await makeRoom(b, null, 'mutton'), true);
  assert.deepEqual(tossed, ['3 netherrack', '62 cobblestone'], 'netherrack is at its floor, so the smaller cobblestone goes next');
  assert(stacks.some(s => s.name === 'coal') && stacks.some(s => s.name === 'raw_iron'));
});
