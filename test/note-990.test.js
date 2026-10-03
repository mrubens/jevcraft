'use strict';
// Note 990: a meal eaten in a blaze hold, where hunger under eighteen keeps
// health from coming back. 25597 held its box two minutes at 6.6 health and
// hunger 17 with food carried and ate nothing.
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');
const { Vec3 } = require('vec3');
const stand = require('../src/blaze-stand');
const { Task } = require('../src/skills');

function holdBot({ food = 17, health = 6.6, stock = [['cooked_beef', 3], ['iron_sword', 1]] } = {}) {
  const registry = require('minecraft-data')('26.1');
  const items = stock.map(([name, count], i) => ({ name, type: registry.itemsByName[name].id, count, slot: 36 + i, durabilityUsed: 0 }));
  const bot = Object.assign(new EventEmitter(), { registry, game: { dimension: 'the_nether', gameMode: 'survival' }, health, food, foodSaturation: 0, entities: {},
    entity: { position: new Vec3(0.5, 64, 0.5), onGround: true, yaw: 0, pitch: 0, height: 1.8 }, heldItem: null,
    inventory: { items: () => items.filter(i => i.count > 0), slots: {} }, blockAt: () => ({ name: 'air', boundingBox: 'empty' }),
    equip: async item => { bot.heldItem = item; }, deactivateItem() {}, activateItem() {}, clearControlStates() {}, pathfinder: { setGoal() {} },
    consume: async () => { const beef = items.find(i => i.name === 'cooked_beef'); beef.count--; bot.food = Math.min(20, bot.food + 8); } });
  return bot;
}

test('in a hold with hunger under eighteen and health short, the food carried is eaten; not at hunger eighteen, at full health, or again within five seconds', async () => {
  const bot = holdBot();
  assert.equal(await stand.eatInHold(bot, new Task('hold')), true);
  assert.equal(bot.food, 20);
  const fed = holdBot({ food: 18 });
  assert.equal(await stand.eatInHold(fed, new Task('hold')), false);
  const whole = holdBot({ health: 20 });
  assert.equal(await stand.eatInHold(whole, new Task('hold')), false);
  const none = holdBot({ stock: [['iron_sword', 1]] });
  assert.equal(await stand.eatInHold(none, new Task('hold')), false);
  const again = holdBot();
  again.consume = async () => {};
  assert.equal(await stand.eatInHold(again, new Task('hold')), true, 'tried');
  assert.equal(await stand.eatInHold(again, new Task('hold')), false, 'not begun again at once');
});
