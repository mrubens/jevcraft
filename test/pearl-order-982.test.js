'use strict';
// Note 982: a pearl way taken up before the rods ends when Jev leaves it.
const test = require('node:test');
const assert = require('node:assert');
const { Vec3 } = require('vec3');
const order = require('../src/pearl-order');

const bot = (entities = {}) => ({ entity: { position: new Vec3(0.5, 64, 0.5), height: 1.8 }, game: { dimension: 'the_nether' }, entities, health: 20, food: 20,
  inventory: { items: () => [], slots: [] }, blockAt: () => ({ name: 'air', boundingBox: 'empty' }), registry: {} });
const enderman = { id: 9, name: 'enderman', isValid: true, position: new Vec3(8.5, 64, 0.5) };

test('an enderman way held ends by name, and the ladder gives the rods', () => {
  const now = Date.now();
  const goal = { kind: 'win', pearlOrder: { pick: 'hunt_enderman', at: now - 120000, until: now + 1e6, offered: ['enderman'], pearlsAt: 0 } };
  const b = bot({ 9: enderman });
  assert.strictEqual(order.orderStage(b, goal, { now })?.phase, 'obtain_ender_pearls');
  assert.strictEqual(order.endHeld(goal, 'Jev left the endermen in reach', now), true);
  assert.strictEqual(order.orderStage(b, goal, { now }), null, 'the rods, and not asked again with nothing new');
  assert.strictEqual(order.endHeld(goal, 'again', now), false);
});

test('the stall offers the rods again only while a pearl way is held', () => {
  const now = Date.now();
  const b = bot({ 9: enderman });
  assert.strictEqual(order.rodsAgain(b, { kind: 'win' }, now), null);
  assert.strictEqual(order.rodsAgain(b, { kind: 'win', pearlOrder: { pick: 'rods_first', at: now, until: now + 1e6 } }, now), null);
  const goal = { kind: 'win', pearlOrder: { pick: 'hunt_enderman', at: now - 300000, until: now + 1e6, offered: ['enderman'], pearlsAt: 0 } };
  const again = order.rodsAgain(b, goal, now);
  assert.match(again.description, /drop the pearl way chosen 5 minutes ago \(hunt enderman; 0 pearls from it so far\)/);
  again.run();
  assert.strictEqual(goal.pearlOrder.ended.why, 'left at a stall for the rods');
  assert.strictEqual(order.rodsAgain(b, goal, now), null);
});
