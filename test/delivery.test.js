'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');
const { Vec3 } = require('vec3');
const { deliver } = require('../src/delivery');
const { Task } = require('../src/skills');

function setup(collector = 7, pickup = 32) {
  const client = new EventEmitter();
  let count = 32;
  const bot = {
    players: { Player: { entity: { id: 7, position: new Vec3(1, 64, 0) } } },
    entity: { position: new Vec3(0, 64, 0) }, entities: {},
    pathfinder: { goto: async () => {}, setGoal: () => {} },
    inventory: { items: () => count ? [{ name: 'purple_concrete', count }] : [] },
    lookAt: async () => {}, equip: async () => {}, _client: client,
    registry: { itemsByName: { purple_concrete: { id: 1 } } },
    toss: async () => {
      count = 0;
      bot.entities[10] = { getDroppedItem: () => ({ name: 'purple_concrete', count: 32 }) };
      client.emit('collect', { collectedEntityId: 10, collectorEntityId: collector, pickupItemCount: pickup });
    },
  };
  client.write = () => bot.toss();
  return { bot, goal: { count: 32, from: 'Player' }, task: new Task('deliver', 'test') };
}
test('delivery requires receiver pickup and records exact quantity', async () => {
  const { bot, goal, task } = setup();
  assert(await deliver(bot, task, goal, () => {}, { timeout: 0 }));
  assert.equal(goal.delivered, 32);
  assert.equal(goal.pendingDelivery, undefined);
  assert.equal(goal.deliveryEvidence[0].recipient, 'Player');
  assert.equal(bot._client.listenerCount('collect'), 0);
});
test('self-pickup or another player pickup does not satisfy delivery', async () => {
  const { bot, goal, task } = setup(99);
  await assert.rejects(deliver(bot, task, goal, () => {}, { timeout: 0 }), { name: 'Blocked' });
  assert(!goal.delivered);
  assert(goal.pendingDelivery);
  assert.equal(bot._client.listenerCount('collect'), 0);
});
test('partial pickup is preserved and uncertain delivery is not silently repeated', async () => {
  const { bot, goal, task } = setup(7, 12);
  await assert.rejects(deliver(bot, task, goal, () => {}, { timeout: 0 }), { name: 'Blocked' });
  assert.equal(goal.delivered, 12);
  let tossedAgain = false;
  bot.toss = async () => { tossedAgain = true; };
  await assert.rejects(deliver(bot, task, goal, () => {}, { timeout: 0 }), /interrupted/);
  assert(!tossedAgain);
});
