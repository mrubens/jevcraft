'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { riskNow } = require('../src/risk');

const botWith = ({ mobs = [], health = 20, food = 20, time = 6000, weapon = 'stone_sword' } = {}) => {
  const registry = require('prismarine-registry')('26.1');
  const items = weapon ? [{ name: weapon, count: 1, slot: 36, type: registry.itemsByName[weapon].id }] : [];
  return { registry, game: { dimension: 'overworld', gameMode: 'survival', difficulty: 'normal' }, health, food, time: { timeOfDay: time },
    entity: { position: new Vec3(0, 64, 0) }, inventory: { items: () => items, slots: [] }, world: { raycast: () => null },
    blockAt: () => ({ name: 'air', skyLight: 15, boundingBox: 'empty' }),
    entities: Object.fromEntries(mobs.map(([name, x], i) => [i + 1, { id: i + 1, name, position: new Vec3(x, 64, 0), height: 1.8, isValid: true }])) };
};

test('the risk of dying now is said from the mobs about, the fight they would be, the dark and the chance to heal', () => {
  assert.equal(riskNow(botWith()).level, 'none in view');
  assert.match(riskNow(botWith({ time: 15000 })).level, /^low for now: .*spawn here in the dark/);
  assert.match(riskNow(botWith({ mobs: [['zombie', 10]] })).level, /^low:/);
  assert.match(riskNow(botWith({ mobs: [['zombie', 5], ['zombie', 7], ['skeleton', 12]], health: 8 })).level, /^high: the mobs about could kill/);
  assert.match(riskNow(botWith({ mobs: [['creeper', 6]] })).level, /^high: a creeper/);
  const hungry = riskNow(botWith({ food: 12 }));
  assert.match(hungry.healing, /^no healing/);
  assert.deepEqual(riskNow(botWith({ mobs: [['spider', 5], ['skeleton', 9]], time: 15000 })).hostilesWithin.kinds, ['spider', 'skeleton']);
});
