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
  assert.equal(dropped[0].name, 'cobblestone'); assert.equal(dropped[0].count, 744 - 64);
  assert(b.tossed.every(([name]) => !['iron_sword', 'coal', 'oak_log', 'stone_pickaxe'].includes(name)), 'tools, fuel and wood are kept');
});

test('the surplus table caps the junk a miner accumulates and keeps two of each workstation', () => {
  const b = bot({ cobblestone: 100, granite: 13, furnace: 7, crafting_table: 2, leaf_litter: 16, raw_copper: 32, diamond: 3 }, 0);
  const over = Object.fromEntries(surplus(b).map(s => [s.name, s.count]));
  assert.deepEqual(over, { cobblestone: 36, granite: 13, furnace: 5, raw_copper: 16 }, 'a stack of cobblestone is enough; leaf litter is fuel now');
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
  const b = { registry, game: { dimension: 'the_nether' }, inventory: { items: () => stacks, emptySlotCount: () => free, slots: {} },
    toss: async () => { throw new Error('whole stacks only'); },
    tossStack: async item => { tossed.push(`${item.count} ${item.name}`); stacks.splice(stacks.indexOf(item), 1); free++; } };
  assert.equal(await makeRoom(b, null, 'mutton'), true);
  assert.deepEqual(tossed, ['3 netherrack'], 'one small stack of the cheapest thing, nothing more');
  free = 0;
  assert.equal(await makeRoom(b, null, 'mutton'), true);
  assert.deepEqual(tossed, ['3 netherrack', '62 cobblestone'], 'netherrack is at its floor, so the smaller cobblestone goes next');
  assert(stacks.some(s => s.name === 'coal') && stacks.some(s => s.name === 'raw_iron'));
});

test('junk goes before a spare tool when room is made', async () => {
  const { makeRoom } = require('../src/inventory-tidy');
  const stacks = [{ name: 'nether_brick_fence', count: 46 }, { name: 'stone_pickaxe', count: 1 }, { name: 'diamond_pickaxe', count: 1 }];
  let free = 0; const tossed = [];
  const b = { registry, inventory: { items: () => stacks, emptySlotCount: () => free, slots: {} },
    tossStack: async item => { tossed.push(item.name); stacks.splice(stacks.indexOf(item), 1); free++; } };
  assert.equal(await makeRoom(b, null, 'raw_iron'), true);
  assert.deepEqual(tossed, ['nether_brick_fence']);
});

test('golden boots are the Nether gold, not spare boots, even with iron boots worn', async () => {
  const { spares } = require('../src/inventory-tidy');
  const stacks = [{ name: 'golden_boots', count: 1 }, { name: 'leather_boots', count: 1 }];
  const b = { registry, inventory: { items: () => stacks, emptySlotCount: () => 0, slots: { 8: { name: 'iron_boots' } } } };
  assert.deepEqual(spares(b).map(i => i.name), ['leather_boots']);
});

test('the second day audit pockets: nether wart, an egg and Overworld netherrack make room before cobblestone or ore', async () => {
  const { makeRoom } = require('../src/inventory-tidy');
  const stacks = [{ name: 'cobblestone', count: 64 }, { name: 'raw_iron', count: 64 }, { name: 'raw_iron', count: 3 }, { name: 'nether_wart', count: 64 },
    { name: 'lapis_lazuli', count: 64 }, { name: 'coal', count: 63 }, { name: 'netherrack', count: 51 }, { name: 'wheat_seeds', count: 32 }, { name: 'egg', count: 1 }];
  let free = 0; const tossed = [];
  const b = { registry, game: { dimension: 'overworld' }, inventory: { items: () => stacks, emptySlotCount: () => free, slots: {} },
    tossStack: async item => { tossed.push(item.name); stacks.splice(stacks.indexOf(item), 1); free++; } };
  for (let i = 0; i < 3; i++) { free = 0; assert.equal(await makeRoom(b, null, 'gold_ingot'), true); }
  assert.deepEqual(tossed, ['nether_wart', 'egg', 'netherrack']);
  b.game.dimension = 'the_nether';
  stacks.push({ name: 'netherrack', count: 40 });
  free = 0; await makeRoom(b, null, 'gold_ingot');
  assert.notEqual(tossed.at(-1), 'netherrack', 'in the Nether a stack of netherrack is kept for bridging');
});

test('sixteen building blocks are never thrown away to make room', async () => {
  const { makeRoom } = require('../src/inventory-tidy');
  const stacks = [{ name: 'dirt', count: 10 }, { name: 'cobblestone', count: 8 }, { name: 'nether_wart', count: 64 }];
  let free = 0; const tossed = [];
  const b = { registry, game: { dimension: 'overworld' }, inventory: { items: () => stacks, emptySlotCount: () => free, slots: {} },
    tossStack: async item => { tossed.push(item.name); stacks.splice(stacks.indexOf(item), 1); free++; } };
  await makeRoom(b, null, 'gold_ingot');
  assert.deepEqual(tossed, ['nether_wart']);
  free = 0;
  await makeRoom(b, null, 'raw_iron');
  assert(!tossed.includes('dirt') && !tossed.includes('cobblestone'), 'eighteen blocks, the reserve is sixteen: none goes');
});

test('short of the block reserve by day, the bot tops it up: cobblestone with a pickaxe, netherrack in the Nether', async () => {
  const { maintainBlocks } = require('../src/work');
  const got = [];
  const bot = { game: { gameMode: 'survival', dimension: 'overworld' }, time: { timeOfDay: 3000 }, entity: { isInWater: false, position: { x: 0, y: 64, z: 0 } },
    registry, inventory: { items: () => [{ name: 'stone_pickaxe', count: 1 }, { name: 'dirt', count: 4 }, { name: 'oak_log', count: 4 }] } };
  const goal = { kind: 'win' };
  // acquireStep is the real planner; stand it in by watching the step the upkeep records.
  await maintainBlocks(bot, { check() {} }, goal, () => {}).catch(() => {});
  assert.equal(goal.step.action, 'block_reserve'); assert.equal(goal.step.item, 'cobblestone'); assert.equal(goal.step.have, 4);
  bot.game.dimension = 'the_nether';
  delete goal.survival; delete goal.step; delete goal.attempts;
  await maintainBlocks(bot, { check() {} }, goal, () => {}).catch(() => {});
  assert.equal(goal.step.item, 'netherrack');
});

test('short of blocks with Jev asked, now or later is its choice; "carry on" holds five minutes', async () => {
  const { upkeepStep } = require('../src/work');
  const asked = [];
  const client = { systemOne: async ({ questions }) => { asked.push(Object.keys(questions.branch_0.criteria).sort()); return { answers: { branch_0: { choice: 'carry_on', confidence: 0.7 } } }; } };
  const bot = { game: { gameMode: 'survival', dimension: 'overworld' }, time: { timeOfDay: 3000 }, entity: { isInWater: false, position: new (require('vec3').Vec3)(0, 64, 0) },
    registry, inventory: { items: () => [{ name: 'stone_pickaxe', count: 1 }, { name: 'dirt', count: 4 }, { name: 'oak_log', count: 4 }] }, health: 20, food: 20 };
  const goal = { kind: 'win', step: { action: 'mine', block: 'iron_ore' } };
  assert.equal(await upkeepStep(bot, { check() {} }, goal, () => {}, client), false, 'carried on');
  assert.deepEqual(asked[0], ['block_reserve', 'carry_on']);
  assert.equal(goal.step.block, 'iron_ore', 'the work step is kept');
  assert.equal(await upkeepStep(bot, { check() {} }, goal, () => {}, client), false);
  assert.equal(asked.length, 1, 'held: not asked again within five minutes');
});

test('more of a vein than the step asked for is Jev\'s call; without Jev it is taken', async () => {
  const { moreOfSource } = require('../src/work');
  const bot = { inventory: { items: () => [{ name: 'raw_iron', count: 3 }] } };
  const step = { action: 'mine', block: 'iron_ore', drops: 'raw_iron', count: 3 };
  assert.equal(await moreOfSource(bot, { check() {} }, {}, () => {}, step, { block: 'iron_ore' }, 32), true, 'no Jev: taken');
  let told;
  const task = { check() {}, opportunityClient: { systemOne: async ({ questions }) => { told = questions.branch_0.criteria.take_more; return { answers: { branch_0: { choice: 'enough', confidence: 0.6 } } }; } } };
  assert.equal(await moreOfSource(bot, task, {}, () => {}, step, { block: 'iron_ore' }, 32), false, 'Jev said enough');
  assert.match(told, /until 32 raw iron are carried \(3 now\)/);
});
