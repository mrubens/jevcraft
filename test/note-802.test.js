'use strict';
// Trial note 802: in an enderman hunt, a calm enderman or (beyond three
// blocks) one of the hunt's kind is no newcomer that ends the work's turn.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const arbiter = require('../src/arbiter');

const look = mobs => ({ inLava: () => false, burning: () => false, headInBlock: () => false, mobs: () => mobs });
const mob = (name, distance, id) => ({ entity: { name, id, position: new Vec3(distance, 64, 0) }, distance, visible: true });
const botAt = (hunt = null) => ({ entity: { position: new Vec3(0, 64, 0) }, health: 20, food: 20, oxygenLevel: 20, entities: {}, stopDigging() {}, clearControlStates() {}, pathfinder: { setGoal() {} },
  inventory: { items: () => [{ name: 'iron_sword', count: 1 }], slots: [] }, ...(hunt ? { _huntingEntity: { name: hunt, until: Date.now() + 5000 } } : {}),
  _arbiter: { holder: { layer: 'work', action: 'stalk_mob', since: 0, ids: [] } } });

test('a calm enderman within six is no newcomer; a zombie is (note 802)', () => {
  assert.equal(arbiter.watchOnce(botAt(), { live: true, look: look([mob('enderman', 5, 7)]), log: () => {} }), null);
  assert.equal(arbiter.watchOnce(botAt(), { live: true, look: look([mob('zombie', 5, 8)]), log: () => {} })?.by, 'newcomer');
});
