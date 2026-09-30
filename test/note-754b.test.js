'use strict';
// Note 754b (critic-20260930T1524Z items 3 to 6): the drop question offered
// golden apples and a lighter beside stacks of cobblestone, dirt and
// basalt; a spare pickaxe made and thrown by the tidy; a lava way out with
// no footing; the Nether food kit counting raw meat at its raw points.
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { Vec3 } = require('vec3');
const registry = require('minecraft-data')('26.1');
const { Task } = require('../src/skills');

const stack = (name, count = 1, extra = {}) => ({ name, count, type: registry.itemsByName[name].id, stackSize: registry.itemsByName[name].stackSize, ...extra });

test('with no junk, stacks dug again in seconds are offered alone before golden apples and the lighter (25584)', async () => {
  const { makeRoom } = require('../src/inventory-tidy');
  let items = [stack('golden_apple', 2), stack('flint_and_steel'), stack('coal', 64), stack('raw_iron', 14), stack('cobblestone', 64), stack('smooth_basalt', 32), stack('dirt', 32), stack('bucket', 8), stack('iron_pickaxe')];
  const bot = { registry, inventory: { items: () => items, emptySlotCount: () => 0 }, entity: { position: new Vec3(0, 64, 0) }, tossStack: async s => { items = items.filter(i => i !== s); } };
  let offered;
  const task = { check() {}, opportunityClient: { systemOne: async ({ questions }) => {
    offered = { ...questions.branch_0.criteria, ...questions.branch_1.criteria };
    const pick = Object.keys(questions.branch_1.criteria).find(k => /^drop_/.test(k));
    return { answers: { branch_0: { choice: 'drop', confidence: 0.7 }, branch_1: { choice: pick, confidence: 0.7 } } };
  } } };
  await makeRoom(bot, task, 'lava_bucket', { room: () => items.length < 9 });
  const drops = Object.keys(offered).filter(k => /^drop_/.test(k));
  assert(drops.length, 'something is offered');
  for (const k of drops) assert.match(k, /^drop_(cobblestone|smooth_basalt|dirt)$/, `only what is dug again in seconds: ${drops}`);
  assert(items.some(i => i.name === 'golden_apple') && items.some(i => i.name === 'flint_and_steel'));
});

test('the tidy keeps a pickaxe with a spare\'s uses: how many are carried is the budget\'s (25597)', () => {
  const { spares } = require('../src/inventory-tidy');
  const items = [stack('iron_pickaxe', 1, { durabilityUsed: 250 - 111 }), stack('stone_pickaxe'), stack('stone_pickaxe', 1, { durabilityUsed: 125 }), stack('stone_pickaxe', 1, { durabilityUsed: 0 })];
  const bot = { registry, inventory: { items: () => items, slots: {} } };
  const names = spares(bot).map(i => `${i.name}:${i.durabilityUsed || 0}`);
  assert.deepEqual(names, ['stone_pickaxe:125'], 'only the worn one past two goes');
});

test('spare_pickaxe with the pockets full says the room is asked for first (25597)', async () => {
  const { upkeepStep } = require('../src/work');
  let offered;
  const client = { systemOne: async ({ questions }) => { offered = questions.branch_0.criteria; return { answers: { branch_0: { choice: 'carry_on', confidence: 0.7 } } }; } };
  const bot = { game: { gameMode: 'survival', dimension: 'overworld' }, time: { timeOfDay: 3000 }, entity: { isInWater: false, position: new Vec3(0.5, 64, 0.5) },
    registry, inventory: { items: () => [stack('stone_pickaxe', 1, { durabilityUsed: 125 }), stack('cobblestone', 64), stack('stick', 8), stack('oak_log', 8)], emptySlotCount: () => 0 }, health: 20, food: 20,
    findBlocks: () => [], blockAt: p => ({ position: p, name: p.y >= 64 ? 'air' : 'stone', boundingBox: p.y >= 64 ? 'empty' : 'block' }) };
  await upkeepStep(bot, { check() {} }, { kind: 'survive', step: { action: 'mine', block: 'iron_ore' } }, () => {}, client);
  assert(offered?.spare_pickaxe, `offered: ${Object.keys(offered || {})}`);
  assert.match(offered.spare_pickaxe, /The pockets are full \(no free slot\): a craft takes one, so what to drop for it is asked first\./);
});

test('in the Nether short at the raw points, cooking the raw meat carried is offered beside the trip home, with what it covers (25585)', async () => {
  const { askStayKit } = require('../src/nether-food');
  const items = [stack('beef', 14), stack('mutton', 1), stack('cooked_beef', 3), stack('furnace'), stack('coal', 20), stack('iron_sword')];
  const bot = Object.assign(new EventEmitter(), {
    registry, health: 20, food: 19, foodSaturation: 0, entity: { id: 1, position: new Vec3(0.5, 41, 0.5), height: 1.8, width: 0.6, onGround: true, velocity: new Vec3(0, 0, 0) },
    game: { dimension: 'the_nether', gameMode: 'survival', difficulty: 'normal' }, time: { timeOfDay: 6000 },
    inventory: { items: () => items, slots: [] }, entities: {}, world: { raycast: () => null }, blockAt: () => ({ name: 'netherrack', boundingBox: 'block' }), findBlocks: () => [], chat() {} });
  const goal = { kind: 'win', portals: [{ x: 1, y: 41, z: 0, dimension: 'nether' }], survival: {} };
  const asked = [];
  const client = { systemOne: async ({ questions }) => { asked.push(questions.branch_0.criteria); return { answers: { branch_0: { choice: 'go_on', confidence: 0.8 } } }; } };
  const actions = { returnOverworld: async () => {}, navigate: async () => {}, acquire: async () => {} };
  await askStayKit(bot, new Task('t'), goal, () => {}, { actions, client });
  assert(asked.length, 'the kit is asked');
  const options = asked[0];
  assert(options.cook_meat, `cook_meat is on the first ask: ${Object.keys(options)}`);
  assert.match(options.cook_meat, /Cook the raw meat carried: 14 beef, 1 mutton/);
  assert.match(options.cook_meat, /is \d+ points more: \d+ in all/);
  assert.match(options.go_on, /The raw meat carried, cooked here/);
});
