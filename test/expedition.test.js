'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { runGoal } = require('../src/work');
const { Task } = require('../src/skills');
const registry = require('minecraft-data')('26.1');

function fixture(names, extra = {}) {
  const items = Object.entries(names).map(([name, count]) => ({ name, count, type: registry.itemsByName[name].id, durabilityUsed: 0 }));
  return { registry, inventory: { items: () => items }, game: { gameMode: 'survival' },
    entity: { position: new Vec3(0.5, 64, 0.5) }, health: 20, food: 20,
    pathfinder: { movements: { blocksCantBreak: new Set() } },
    findBlocks: () => [], blockAt: () => ({ name: 'air' }), canDigBlock: () => false,
    _catalogObservation: { at: Date.now(), position: new Vec3(0.5, 64, 0.5), nearby: ['oak_log', 'lapis_ore', 'rose_bush'] },
    chat() {}, ...extra };
}
const survival = { state: {}, step: async () => false };

test('catalog concrete prepares carried expedition supplies before starting a deep recipe dependency', async () => {
  const bot = fixture({ stone_pickaxe: 1, oak_log: 8, crafting_table: 1 });
  const goal = { kind: 'obtain', item: 'purple_concrete', count: 32, request: 'get 32 purple concrete' };
  await runGoal(bot, new Task('test', goal.request), goal, { save() {} }, { survival, maxSteps: 1 });
  assert.equal(goal.expeditionReady, true);
  assert.equal(goal.preparingExpedition, undefined);
  assert.equal(goal.history[0].step.action, 'prepared_expedition');
  assert.equal(goal.history[0].inventory.oak_log, 8);
  assert.equal(goal.history[0].inventory.crafting_table, 1);
});

test('deep catalog requests acquire missing supplies before attempting the ore', async () => {
  const bot = fixture({ stone_pickaxe: 1, oak_log: 3, crafting_table: 1 }, {
    findBlocks: ({ matching, maxDistance }) => {
      if (maxDistance === 64) return []; // Read-only alternative recipe survey.
      if (matching.includes(registry.blocksByName.oak_log.id)) throw new Error('reached spare wood acquisition');
      return [];
    },
  });
  const goal = { kind: 'obtain', item: 'purple_concrete', count: 32, request: 'get 32 purple concrete' };
  await runGoal(bot, new Task('test', goal.request), goal, { save() {} }, { survival, maxSteps: 1 });
  assert.equal(goal.preparingExpedition, true);
  assert.notEqual(goal.expeditionReady, true);
  assert.equal(goal.step.drops, 'oak_log');
  assert.equal(goal.step.count, 1);
});

test('an already acquired ordinary item finishes without preparing an expedition', async () => {
  const bot = fixture({ pumpkin: 1 });
  const goal = { kind: 'obtain', item: 'pumpkin', count: 1, request: 'get a pumpkin' };
  const result = await runGoal(bot, new Task('test', goal.request), goal, { save() {} }, { survival, maxSteps: 1 });
  assert(result.ok); assert.equal(goal.expeditionReady, undefined);
});

test('an iron pickaxe request uses six carried logs without demanding two more', async () => {
  const bot = fixture({ stone_pickaxe: 1, wooden_pickaxe: 1, oak_log: 6, crafting_table: 1 },
    { game: { gameMode: 'survival', difficulty: 'peaceful' } });
  const goal = { kind: 'obtain', item: 'iron_pickaxe', count: 1, request: 'get me an iron pickaxe' };
  await runGoal(bot, new Task('test', goal.request), goal, { save() {} }, { survival, maxSteps: 1 });
  assert.equal(goal.expeditionReady, true);
  assert.equal(goal.history[0].step.action, 'prepared_expedition');
  assert.equal(goal.history[0].inventory.oak_log, 6);
});

test('Normal expeditions cannot descend with tools and spare wood but no safe food reserve', async () => {
  const bot = fixture({ stone_pickaxe: 1, oak_log: 8, crafting_table: 1 }, { game: { gameMode: 'survival', difficulty: 'normal' } });
  const goal = { kind: 'obtain', item: 'purple_concrete', count: 32, request: 'get 32 purple concrete' };
  await runGoal(bot, new Task('test', goal.request), goal, { save() {} }, { survival, maxSteps: 1 });
  assert.equal(goal.preparingExpedition, true);
  assert.equal(goal.expeditionReady, undefined);
  assert.equal(goal.step.action, 'prepare_expedition_food');
  assert.equal(goal.step.carriedFoodPoints, 0);
  bot.inventory.items().push({ name: 'cooked_chicken', count: 2 });
  await runGoal(bot, new Task('test', goal.request), goal, { save() {} }, { survival, maxSteps: 1 });
  assert.equal(goal.expeditionReady, true);
  assert.equal(goal.step.foodPoints, 12);
});
