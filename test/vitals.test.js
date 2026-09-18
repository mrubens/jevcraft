'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { chooseFood, maintainVitals } = require('../src/vitals');
const { Task } = require('../src/skills');
const { planningInventory } = require('../src/work');

test('eating uses safe food and verifies restored hunger', async () => {
  const actions = [];
  const bot = { food: 12, health: 18, entity: {}, registry: { foodsByName: {
    apple: { effectiveQuality: 6.4 }, rotten_flesh: { effectiveQuality: 4.8 },
  } }, inventory: { items: () => [{ name: 'rotten_flesh', count: 1 }, { name: 'apple', count: 1 }] },
  equip: async item => assert.equal(item.name, 'apple'), consume: async () => { bot.food = 16; }, deactivateItem: () => {}, };
  assert.equal(chooseFood(bot).name, 'apple');
  assert(await maintainVitals(bot, new Task('test', 'eat'), step => actions.push(step)));
  assert.equal(actions[0].action, 'eat');
  bot.food = 20;
  assert.equal(await maintainVitals(bot, new Task('test', 'full')), false);
});

test('eating can be cancelled while waiting for the server', async () => {
  let stopped = false;
  const task = new Task('test', 'eat');
  const bot = { food: 8, health: 10, entity: {}, registry: { foodsByName: { apple: { effectiveQuality: 6.4 } } },
    inventory: { items: () => [{ name: 'apple' }] }, equip: async () => {},
    consume: () => { setTimeout(() => task.cancel(), 20); return new Promise(() => {}); }, deactivateItem: () => { stopped = true; }, };
  await assert.rejects(maintainVitals(bot, task), { name: 'Cancelled' });
  assert(stopped);
});

test('near-broken tools are not counted as a usable planned supply', () => {
  const stock = [{ name: 'stone_pickaxe', count: 1, durabilityUsed: 128 }, { name: 'stone_pickaxe', count: 1, durabilityUsed: 0 }];
  const bot = { inventory: { items: () => stock }, registry: { itemsByName: { stone_pickaxe: { maxDurability: 131 } } } };
  assert.equal(planningInventory(bot).stone_pickaxe, 1);
  assert.equal(stock.length, 2);
});
