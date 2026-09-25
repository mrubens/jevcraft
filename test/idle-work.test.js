'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { Task } = require('../src/skills');
const { idleWork, idleOptions } = require('../src/work');
const registry = require('minecraft-data')('26.1');

function fixture(items, { timeOfDay = 3000 } = {}) {
  const stacks = items.map(([name, count]) => ({ name, count, type: registry.itemsByName[name].id }));
  const bot = { registry, inventory: { items: () => stacks }, game: { dimension: 'overworld', gameMode: 'survival', difficulty: 'normal' },
    entity: { id: 1, position: new Vec3(0.5, 64, 0.5) }, health: 20, food: 20, entities: {}, time: { timeOfDay },
    findBlocks: () => [], blockAt: () => ({ name: 'air', boundingBox: 'empty' }), pathfinder: { movements: {}, setGoal() {} },
    clearControlStates() {}, chat(line) { this.said.push(line); }, said: [], emit() {} };
  const goal = { kind: 'survive', request: 'Stay alive between player requests', survival: {}, dream: 'beat_the_game' };
  return { bot, goal, task: new Task('idle', 'idle') };
}

test('spare daylight offers the feasible chores and the long game, and Jev chooses', async () => {
  const { bot, goal, task } = fixture([['beef', 4], ['wooden_pickaxe', 1], ['oak_log', 2]]);
  const options = idleOptions(bot, goal);
  assert.deepEqual(Object.keys(options).sort(), ['cook_food', 'explore', 'long_game', 'stone_tools']);
  assert.match(options.explore.description, /0 areas walked, 0 villages/);
  assert.match(options.cook_food.description, /4 raw beef/); assert.equal(options.cook_food.item, 'cooked_beef');
  assert.match(options.long_game.description, /stone pickaxe/, 'the ladder starts with a rung you can see');
  assert.equal(idleOptions(bot, { ...goal, dream: undefined }).long_game, undefined, 'no dream, no ladder');
  assert.equal(idleOptions(bot, { ...goal, dream: 'build_a_village' }).long_game, undefined);
  const asked = [], acquired = [];
  const client = { model: 'jev-test', systemOne: async ({ questions, state }) => {
    asked.push(Object.values(questions)[0].criteria); assert.equal(state.foodReserve > 0, true);
    return { answers: { branch_0: { choice: 'cook_food', confidence: 0.9, probabilities: { cook_food: 0.9, rest: 0.05, stone_tools: 0.03, long_game: 0.02 } } } };
  } };
  assert.equal(await idleWork(bot, task, goal, () => {}, client, () => {}, { acquire: async (_b, _t, item, count) => { acquired.push([item, count]); } }), true);
  assert.deepEqual(acquired, [['cooked_beef', 4]]);
  assert(!asked[0].rest, 'standing still is never on offer');
  assert.match(bot.said[0], /cook the beef/);
  assert.equal(goal.decisions.at(-1).path[0], 'cook_food');
});

test('idle work stays off at night, in Creative, when hurt, or when there is nothing worth doing', async () => {
  const night = fixture([['beef', 4]], { timeOfDay: 12000 });
  assert.equal(await idleWork(night.bot, night.task, night.goal, () => {}, { systemOne: async () => assert.fail('no question at night') }), false);
  const hurt = fixture([['beef', 4]]); hurt.bot.health = 8;
  assert.equal(await idleWork(hurt.bot, hurt.task, hurt.goal, () => {}, { systemOne: async () => assert.fail('no chores while hurt') }), false);
  const creative = fixture([['beef', 4]]); creative.bot.game.gameMode = 'creative';
  assert.equal(await idleWork(creative.bot, creative.task, creative.goal, () => {}, { systemOne: async () => assert.fail('creative needs nothing') }), false);
});

test('a loot trip says its walk against the daylight left, and a dungeon its depth and spawner (the decision audit)', () => {
  const { sideTrips } = require('../src/work');
  const bot = { registry: require('minecraft-data')('26.1'), game: { dimension: 'overworld' }, time: { timeOfDay: 8000 }, entity: { position: new Vec3(0, 40, 0) }, entities: {},
    inventory: { items: () => [], slots: {} }, findBlocks: () => [], blockAt: () => null };
  const goal = { landmarks: [{ kind: 'dungeon', dimension: 'overworld', x: 100, y: 38, z: 0 }] };
  const loot = sideTrips(bot, goal, null).loot;
  assert.match(loot.description, /underground at y 38, and its spawner keeps making mobs/);
  assert.match(loot.description, /About 47 seconds there and back at a walk; 75 seconds of daylight left\./);
  bot.time.timeOfDay = 9000;
  assert.match(sideTrips(bot, goal, null).loot.description, /25 seconds of daylight left: it would end after dusk/);
});

test('the enchanting table trip says what it takes from the pockets (the decision audit)', () => {
  const { sideTrips } = require('../src/work');
  const reg = require('minecraft-data')('26.1');
  const items = [['diamond', 2], ['lapis_lazuli', 3], ['obsidian', 4], ['iron_sword', 1], ['book', 1]].map(([name, count]) => ({ name, count, type: reg.itemsByName[name].id }));
  const bot = { registry: reg, game: { dimension: 'overworld', gameMode: 'survival' }, time: { timeOfDay: 3000 }, experience: { level: 5 }, entity: { position: new Vec3(0, 64, 0) }, entities: {},
    inventory: { items: () => items, slots: {} }, findBlocks: () => [], blockAt: () => null };
  const table = sideTrips(bot, {}, null).enchanting_table;
  assert.match(table.description, /From the pockets as they are it takes: .*craft 1 crafting table, craft 1 enchanting table\./);
});

test('stone tools that spend the last sticks say so, for the next pickaxe (mid-87-a)', () => {
  const { bot, goal } = fixture([['wooden_pickaxe', 1], ['stick', 5], ['cobblestone', 9], ['crafting_table', 1]]);
  const options = idleOptions(bot, goal);
  assert.match(options.stone_tools.description, /It leaves 0 logs, 0 planks, 0 sticks and 0 iron ingots .*and no sticks can be made from what is left\. Pickaxes carried: the wooden pickaxe \(59 uses left\)/);
});

test('choosing the long game runs the next rung of the beat-the-game ladder', async () => {
  const { bot, goal, task } = fixture([['white_bed', 1], ['stone_pickaxe', 1], ['stone_axe', 1], ['stone_sword', 1], ['oak_log', 16]]);
  const ran = [];
  const client = { systemOne: async () => ({ answers: { branch_0: { choice: 'long_game', confidence: 0.8, probabilities: { long_game: 0.8, rest: 0.2 } } } }) };
  const handlers = { acquireStep: async (_b, _t, item, count) => { ran.push([item, count]); } };
  assert.equal(await idleWork(bot, task, goal, () => {}, client, () => {}, { handlers }), true);
  assert.deepEqual(ran, [['iron_pickaxe', 1]], 'with stone tools in hand, the next rung is an iron pickaxe');
  assert.equal(goal.gameProgress.phase, 'iron_pickaxe');
  assert.match(bot.said[0], /long game: iron pickaxe/);
});
