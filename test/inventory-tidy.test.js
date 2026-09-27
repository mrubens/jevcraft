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
  assert.equal(dropped[0].name, 'cobblestone'); assert.equal(dropped[0].count, 744 - 128);
  assert(b.tossed.every(([name]) => !['iron_sword', 'coal', 'oak_log', 'stone_pickaxe'].includes(name)), 'tools, fuel and wood are kept');
});

test('the surplus table caps the junk a miner accumulates and keeps two of each workstation', () => {
  const b = bot({ cobblestone: 160, granite: 13, furnace: 7, crafting_table: 2, leaf_litter: 16, raw_copper: 32, diamond: 3 }, 0);
  const over = Object.fromEntries(surplus(b).map(s => [s.name, s.count]));
  assert.deepEqual(over, { cobblestone: 32, granite: 13, furnace: 5, raw_copper: 16 }, 'two stacks of cobblestone are enough (the Nether crossing); leaf litter is fuel now');
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
  assert.deepEqual(tossed, ['62 cobblestone'], 'in the Nether, cobblestone past its one stack, the smaller stack, nothing more');
  free = 0;
  assert.equal(await makeRoom(b, null, 'mutton'), false, 'every stack at its floor now: past them it is Jev\'s choice, not the order\'s');
  assert.deepEqual(tossed, ['62 cobblestone']);
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
    registry, inventory: { items: () => [{ name: 'stone_pickaxe', count: 1 }, { name: 'dirt', count: 4 }, { name: 'oak_log', count: 8 }] } };
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
    registry, inventory: { items: () => [{ name: 'stone_pickaxe', count: 1 }, { name: 'dirt', count: 4 }, { name: 'oak_log', count: 8 }] }, health: 20, food: 20 };
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

test('full pockets: which stack goes is Jev\'s, told what each is; "none" goes without', async () => {
  const { makeRoom } = require('../src/inventory-tidy');
  let items = [{ name: 'stone_pickaxe', count: 1, type: 1 }, { name: 'dirt', count: 20, type: 2 }, { name: 'cobblestone', count: 10, type: 3 }];
  const tossed = [];
  const bot = { registry, inventory: { items: () => items, emptySlotCount: () => (items.length < 3 ? 1 : 0) }, entity: { position: { x: 0, y: 64, z: 0 } },
    tossStack: async stack => { tossed.push(stack.name); items = items.filter(i => i !== stack); } };
  let offered;
  // Two questions, asked together: drop anything (branch_0), and which stack (branch_1).
  const pick = choice => ({ check() {}, opportunityClient: { systemOne: async ({ questions }) => { offered = { ...questions.branch_0.criteria, ...questions.branch_1.criteria }; return { answers: { branch_0: { choice: choice === 'none' ? 'none' : 'drop', confidence: 0.6 }, branch_1: { choice: choice === 'none' ? 'drop_0' : choice, confidence: 0.6 } } }; } } });
  assert.equal(await makeRoom(bot, pick('none'), 'raw_iron'), false, 'Jev chose to go without');
  assert.deepEqual(tossed, []);
  assert.match(offered.drop_0, /the only pickaxe/);
  assert.match(offered.drop_1, /part of the 16-block reserve/);
  assert.equal(await makeRoom(bot, pick('drop_1'), 'raw_iron'), true);
  assert.deepEqual(tossed, ['dirt'], 'Jev\'s pick went');
});

test('while a batch cooks, what the bot does is Jev\'s, asked once; without Jev, the order in smelt', async () => {
  const { whileCooking } = require('../src/work');
  const { Vec3 } = require('vec3');
  const bot = { inventory: { items: () => [{ name: 'cobblestone', count: 10 }], emptySlotCount: () => 10 }, entity: { position: new Vec3(0, 64, 0) }, time: { timeOfDay: 4000 },
    blockAt: () => ({ name: 'iron_ore' }) };
  const args = { cooking: 200000, oreInReach: () => new Vec3(1, 64, 0), walkTarget: () => new Vec3(10, 64, 0), what: 'raw iron', count: 20 };
  assert.equal(await whileCooking(bot, { check() {} }, {}, () => {}, args), null, 'no Jev: the order in smelt');
  let offered;
  const task = { check() {}, opportunityClient: { systemOne: async ({ questions }) => { offered = questions.branch_0.criteria; return { answers: { branch_0: { choice: 'mine_nearby', confidence: 0.5 } } }; } } };
  assert.equal(await whileCooking(bot, task, {}, () => {}, args), 'mine_nearby');
  assert.match(offered.wait_here, /200 seconds.*cooks on its own/);
});

test('a one-ingot batch is asked about too, and a walk is offered only where there and back fits in the cooking', async () => {
  // Trial 46: one ingot, then two, stood out at the furnace, seventy-five seconds on one spot.
  const { whileCooking } = require('../src/work');
  const { Vec3 } = require('vec3');
  const bot = { inventory: { items: () => [{ name: 'cobblestone', count: 10 }], emptySlotCount: () => 10 }, entity: { position: new Vec3(0, 64, 0) }, time: { timeOfDay: 4000 },
    blockAt: () => ({ name: 'iron_ore' }) };
  let offered;
  const task = { check() {}, opportunityClient: { systemOne: async ({ questions }) => { offered = questions.branch_0.criteria; return { answers: { branch_0: { choice: 'dig_stone', confidence: 0.5 } } }; } } };
  const args = { cooking: 10000, oreInReach: () => null, walkTarget: () => new Vec3(30, 64, 0), what: 'raw iron', count: 1 };
  assert.equal(await whileCooking(bot, task, {}, () => {}, args), 'dig_stone');
  assert(!offered.mine_nearby, 'thirty blocks there and back does not fit in ten seconds');
  await whileCooking(bot, task, {}, () => {}, { ...args, walkTarget: () => new Vec3(6, 64, 0), cooking: 20000 });
  assert(offered.mine_nearby, 'six blocks does');
});

test('with no way to throw given, a stack is thrown along the most open way, not into the tunnel wall to land at the feet', async () => {
  // mid-92-a: the dirt thrown for a diamond's slot hit the wall and was picked up again, three times over.
  const { faceAway, openDirection } = require('../src/inventory-tidy');
  const { Vec3 } = require('vec3');
  // A tunnel running west (-x) from the bot, rock everywhere else.
  const bot = { entity: { position: new Vec3(0.5, -59, 0.5), yaw: 0 },
    blockAt: p => ({ position: p, boundingBox: p.z === 0 && p.x <= 0 && p.x >= -8 && [-59, -58].includes(p.y) ? 'empty' : 'block' }),
    lookAt: async p => { bot.looked = p; } };
  assert.deepEqual({ ...openDirection(bot), open: undefined }, { x: -1, z: 0, open: undefined });
  await faceAway(bot);
  assert(bot.looked.x < bot.entity.position.x - 2 && Math.abs(bot.looked.z - bot.entity.position.z) < 0.1, `thrown down the tunnel: ${bot.looked}`);
});

test('short of wood in a mine, the reserve is offered with what running out costs down there', async () => {
  // The midgame trials spent 84 of 220 minutes climbing to the surface, much of it for wood.
  const { upkeepStep } = require('../src/work');
  const { Vec3 } = require('vec3');
  let offered;
  const client = { systemOne: async ({ questions }) => { offered = questions.branch_0.criteria; return { answers: { branch_0: { choice: 'carry_on', confidence: 0.7 } } }; } };
  const bot = { game: { gameMode: 'survival', dimension: 'overworld' }, time: { timeOfDay: 3000 }, entity: { isInWater: false, position: new Vec3(0.5, 20, 0.5) },
    registry, inventory: { items: () => [{ name: 'stone_pickaxe', count: 1, durabilityUsed: 100 }, { name: 'cobblestone', count: 64 }, { name: 'oak_log', count: 2 }] }, health: 20, food: 20,
    blockAt: p => ({ position: p, name: p.y === 63 ? 'grass_block' : p.y > 63 ? 'air' : 'stone', boundingBox: p.y > 63 ? 'empty' : 'block' }) };
  await upkeepStep(bot, { check() {} }, { kind: 'win', step: { action: 'mine', block: 'iron_ore' } }, () => {}, client);
  assert.match(offered.wood_reserve, /2 logs' worth .* 6 make the sticks for three pickaxes/);
  assert.match(offered.wood_reserve, /about 44 blocks under the surface: choosing this now means that climb now \(roughly 2 minutes with a pickaxe\)/);
  // On the surface the trees are looked for, not assumed (the decision audit).
  bot.entity.position = new Vec3(0.5, 64, 0.5);
  bot.findBlocks = () => [new Vec3(12, 64, 0)];
  await upkeepStep(bot, { check() {} }, { kind: 'win', step: { action: 'mine', block: 'iron_ore' } }, () => {}, client);
  assert.match(offered.wood_reserve, /A tree is 12 blocks away/);
});

test('making room, Jev sees junk and surplus first and marked, and what going without costs the step in hand', async () => {
  // mid-83-a: thirty-six slots of coal, dripstone and petals; "drop nothing" chosen five times, told only "go without the cobblestone".
  const { makeRoom } = require('../src/inventory-tidy');
  let items = [];
  const add = (name, count) => { const it = registry.itemsByName[name]; while (count > 0) { const k = Math.min(count, it.stackSize); items.push({ name, count: k, type: it.id, stackSize: it.stackSize }); count -= k; } };
  add('iron_pickaxe', 1); add('diamond_sword', 1); add('coal', 242); add('pink_petals', 8); add('pointed_dripstone', 29); add('dripstone_block', 64); add('raw_iron', 63);
  while (items.length < 36) add('white_wool', 1) || items.push({ name: `lapis_lazuli`, count: 64, type: registry.itemsByName.lapis_lazuli.id, stackSize: 64 });
  let offered;
  const client = { systemOne: async ({ questions }) => { offered = { ...questions.branch_0.criteria, ...questions.branch_1.criteria }; return { answers: { branch_0: { choice: 'none', confidence: 0.6 }, branch_1: { choice: 'drop_0', confidence: 0.6 } } }; } };
  const bot = { registry, inventory: { items: () => items, emptySlotCount: () => 36 - items.length, slots: [] }, entity: { position: new (require('vec3').Vec3)(0, 64, 0) }, game: { dimension: 'overworld' }, lookAt: async () => {} };
  await makeRoom(bot, { check() {}, opportunityClient: client }, 'cobblestone', { purpose: 'the step in hand (8 cobblestone for the reach nether step)' });
  const keys = Object.keys(offered);
  assert.match(offered.drop_0, /(pink petals|pointed dripstone|dripstone block|coal).*(no use on the way|more than the)/);
  assert.match(offered.none, /go without the cobblestone: the step in hand \(8 cobblestone for the reach nether step\) cannot go on without it/);
  assert(keys.some(k => /coal.*more than the \d+ worth keeping/.test(offered[k])), 'surplus coal marked');
});

test('making room says the only food, the only weapon, the water bucket, the valuables, what the step needs, and the stacks not listed (the decision audit)', async () => {
  const { makeRoom } = require('../src/inventory-tidy');
  const items = [];
  const add = (name, count) => { const it = registry.itemsByName[name]; items.push({ name, count, type: it.id, stackSize: it.stackSize }); };
  add('diamond_sword', 1); add('bread', 3); add('water_bucket', 1); add('diamond', 2); add('coal', 20);
  while (items.length < 36) add('white_wool', 1);
  let offered, state;
  const client = { systemOne: async ({ questions, state: s }) => { offered = Object.values({ ...questions.branch_0.criteria, ...questions.branch_1.criteria }); state = s; return { answers: { branch_0: { choice: 'none', confidence: 0.6 }, branch_1: { choice: 'drop_0', confidence: 0.6 } } }; } };
  const bot = { registry, inventory: { items: () => items, emptySlotCount: () => 36 - items.length, slots: [] }, entity: { position: new (require('vec3').Vec3)(0, 64, 0) }, game: { dimension: 'overworld' }, lookAt: async () => {} };
  const goal = { kind: 'obtain', step: { action: 'smelt', item: 'iron_ingot', fuel: 'coal' } };
  await makeRoom(bot, { check() {}, opportunityClient: client }, 'raw_iron', { goal });
  const said = offered.join('\n');
  assert.match(said, /diamond sword.*the only weapon/);
  assert.match(said, /bread.*the only food carried/);
  assert.match(said, /water bucket.*breaks a fall/);
  assert.match(said, /2 diamond.*a valuable/);
  assert.match(said, /20 coal.*needed by the step in hand/);
  assert.match(said, /\d+ more stacks are carried and not listed here/);
  assert.deepEqual(state.stepInHand, goal.step);
});

test('making room asks whether to drop anything apart from which stack, so junk stacks do not split the vote against "none"', async () => {
  // mid-83-b: dripstone 0.15, pointed dripstone 0.14, a mushroom 0.05, "none" 0.24; nothing was dropped and a stone pickaxe went uncrafted.
  const { makeRoom } = require('../src/inventory-tidy');
  let items = [];
  const add = (name, count) => { const it = registry.itemsByName[name]; items.push({ name, count, type: it.id, stackSize: it.stackSize }); };
  add('dripstone_block', 17); add('pointed_dripstone', 5); add('red_mushroom', 1);
  while (items.length < 36) add('white_wool', 1);
  let asked;
  const client = { systemOne: async ({ questions }) => { asked = questions; return { answers: { branch_0: { choice: 'drop', confidence: 0.87 }, branch_1: { choice: 'drop_1', confidence: 0.3 } } }; } };
  const tossed = [];
  const bot = { registry, inventory: { items: () => items, emptySlotCount: () => 36 - items.length, slots: [] }, entity: { position: new (require('vec3').Vec3)(0, 64, 0) }, game: { dimension: 'overworld' }, lookAt: async () => {},
    tossStack: async st => { tossed.push(st.name); items = items.filter(i => i !== st); } };
  assert.equal(await makeRoom(bot, { check() {}, opportunityClient: client }, 'stone_pickaxe'), true);
  assert.deepEqual(Object.keys(asked.branch_0.criteria).sort(), ['drop', 'none']);
  assert.match(asked.branch_0.criteria.drop, /3 of them with no use on the way to the dragon/);
  assert.equal(tossed.length, 1);
  assert(/dripstone|mushroom/.test(tossed[0]), `a junk stack went: ${tossed[0]}`);
});

test('with the portal frame to be cast, the water bucket is said to be what turns its blocks to obsidian', async () => {
  // mid-211-f dropped its water bucket twice for planks with the cast frame chosen, told only that water breaks a fall.
  const { makeRoom } = require('../src/inventory-tidy');
  let items = [{ name: 'water_bucket', count: 1, type: 1 }, { name: 'dirt', count: 20, type: 2 }, { name: 'bucket', count: 1, type: 3 }];
  const bot = { registry, inventory: { items: () => items, emptySlotCount: () => 0 }, entity: { position: { x: 0, y: 64, z: 0 } }, tossStack: async () => {} };
  let offered;
  const task = { check() {}, opportunityClient: { systemOne: async ({ questions }) => { offered = { ...questions.branch_0.criteria, ...(questions.branch_1?.criteria || {}) }; return { answers: { branch_0: { choice: 'none', confidence: 0.6 }, branch_1: { choice: 'drop_1', confidence: 0.6 } } }; } } };
  await makeRoom(bot, task, 'oak_planks', { goal: { portalMethod: { kind: 'cast' } } }).catch(() => {});
  assert.match(offered.drop_0 || '', /turns each block of the portal frame being cast to obsidian/);
  assert.match(offered.drop_2 || '', /a bucket for the lava of the portal frame/);
});

test('before dark, food enough to heal on and the base bed near are offered with the upkeep', async () => {
  // The evening's deaths: out at night, too hungry to heal, nothing to eat; nights spent in pockets.
  const { upkeepStep } = require('../src/work');
  const { establishedHome } = require('./fixtures/home-world');
  const w = await establishedHome();
  w.bot.time.timeOfDay = 9000; w.bot.food = 16;
  let offered = null;
  const client = { systemOne: async ({ questions }) => { offered = questions.branch_0.criteria; return { answers: { branch_0: { choice: 'carry_on', confidence: 0.7 } } }; } };
  const goal = { ...w.goal, kind: 'win', step: { action: 'mine', block: 'iron_ore' } };
  await upkeepStep(w.bot, { check() {} }, goal, () => {}, client);
  assert(offered?.food_reserve, Object.keys(offered || {}).join(','));
  assert.match(offered.food_reserve, /Find food before dark: 0 food points carried, hunger 16, dusk in about \d+ seconds/);
  assert(offered.take_bed, 'the base bed, a short walk away');
  assert.match(offered.take_bed, /any night passes in seconds wherever it comes/);
});

test('short of blocks in the Nether, the upkeep says they are the crossings', async () => {
  // mid-235-k, at its fortress with none, was told "seal a pocket for the night", carried on, and every leg stopped at the first gap.
  const { upkeepStep } = require('../src/work');
  let said = null;
  const client = { systemOne: async ({ questions }) => { said = questions.branch_0.criteria.block_reserve; return { answers: { branch_0: { choice: 'carry_on', confidence: 0.7 } } }; } };
  const bot = { game: { gameMode: 'survival', dimension: 'the_nether' }, time: { timeOfDay: 3000 }, entity: { isInWater: false, position: new (require('vec3').Vec3)(0, 64, 0) },
    registry, inventory: { items: () => [{ name: 'iron_pickaxe', count: 1 }] }, health: 20, food: 20 };
  await upkeepStep(bot, { check() {} }, { kind: 'win', step: { action: 'find_fortress' } }, () => {}, client);
  assert.match(said || '', /Mine netherrack for building blocks now: 0 carried\. Here every crossing over lava or a gap is laid a block a step, and a crossing with none stops at the first gap/);
});

test('short of blocks in the Nether, the upkeep says where the nearest netherrack it would dig is, and the drop between', async () => {
  // mid-227-r, on a one-wide basalt bridge at y 87 over a forty-four block drop, was told netherrack "is all around"; the nearest was thirty off across the void and fifteen up (2026-09-27).
  const { upkeepStep } = require('../src/work');
  const { Vec3 } = require('vec3');
  let said = null;
  const client = { systemOne: async ({ questions }) => { said = questions.branch_0.criteria.block_reserve; return { answers: { branch_0: { choice: 'carry_on', confidence: 0.7 } } }; } };
  const blockAt = p => {
    const name = p.y === 86 && p.z === 0 && p.x >= -5 && p.x <= 0 ? 'basalt' : p.y <= 42 || (p.x >= 30 && p.y >= 95 && p.y <= 110) ? 'netherrack' : 'air';
    return { name, position: p, boundingBox: name === 'air' ? 'empty' : 'block' };
  };
  const bot = { game: { gameMode: 'survival', dimension: 'the_nether' }, time: { timeOfDay: 3000 }, entity: { isInWater: false, position: new Vec3(0.5, 87, 0.5) },
    registry, inventory: { items: () => [{ name: 'iron_pickaxe', count: 1 }, { name: 'basalt', count: 2 }] }, health: 20, food: 20, entities: {}, blockAt,
    findBlocks: () => [new Vec3(31, 101, 0), new Vec3(30, 102, 0)] };
  await upkeepStep(bot, { check() {} }, { kind: 'win', step: { action: 'find_fortress' } }, () => {}, client);
  assert.doesNotMatch(said || '', /all around/);
  assert.match(said || '', /The nearest netherrack the gather would go for is 33 blocks off and 15 up, across 29 blocks of open drop on the straight line to it \(44 deep\)\./);
  bot.findBlocks = () => [];
  await upkeepStep(bot, { check() {} }, { kind: 'win', step: { action: 'find_fortress' } }, () => {}, client);
  assert.match(said || '', /No netherrack with an open face is within 48 blocks of here/);
});

test('making room says the flint and steel lights the Nether portal on the way to the dragon, and the tool a step needs', async () => {
  // mid-241-v (note 496): its only flint and steel went for four sticks, said only as "1 flint and steel".
  const { makeRoom } = require('../src/inventory-tidy');
  const items = [];
  const add = (name, count) => { const it = registry.itemsByName[name]; items.push({ name, count, type: it.id, stackSize: it.stackSize }); };
  add('flint_and_steel', 1); add('iron_pickaxe', 1); add('stone_pickaxe', 1);
  while (items.length < 36) add('white_wool', 1);
  let offered;
  const client = { systemOne: async ({ questions }) => { offered = Object.values({ ...questions.branch_0.criteria, ...questions.branch_1.criteria }).join('\n'); return { answers: { branch_0: { choice: 'none', confidence: 0.6 }, branch_1: { choice: 'drop_0', confidence: 0.6 } } }; } };
  const bot = { registry, inventory: { items: () => items, emptySlotCount: () => 36 - items.length, slots: [] }, entity: { position: new (require('vec3').Vec3)(0, 64, 0) }, game: { dimension: 'overworld' }, lookAt: async () => {} };
  const goal = { kind: 'win', step: { action: 'mine', block: 'iron_ore', drops: 'raw_iron', requires: { iron_pickaxe: 1 } } };
  await makeRoom(bot, { check() {}, opportunityClient: client }, 'stick', { goal });
  assert.match(offered, /1 flint and steel.*lights the Nether portal.*the only lighter carried/);
  assert.match(offered, /1 iron pickaxe.*needed by the step in hand/);
  assert.doesNotMatch(offered, /stone pickaxe[^\n]*needed by the step in hand/);
});
