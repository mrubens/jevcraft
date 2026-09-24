'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { deflect, meleeClose } = require('../src/projectile-guard');
const { Task } = require('../src/skills');

const fixture = entities => {
  const controls = {};
  return { entity: { position: new Vec3(0.5, 14, 0.5), height: 1.8 }, entities, time: { timeOfDay: 18000 }, world: { raycast: () => null },
    inventory: { slots: { 45: { name: 'shield' } } }, pathfinder: { setGoal() {} }, clearControlStates() {}, lookAt: async () => {},
    activateItem() { controls.shield = true; }, deactivateItem() { controls.shield = false; }, controls };
};
const mob = (id, name, x, z) => ({ id, name, type: 'hostile', position: new Vec3(x, 14, z), height: 1.9, isValid: true });
const arrow = { id: 9, name: 'arrow', position: new Vec3(0.5, 15.5, 4.5), velocity: new Vec3(0, 0, -1), isValid: true };

test('an arrow is blocked when nothing is at arm\'s length, and not with a zombie beside the bot', async () => {
  const shot = fixture({ 1: mob(1, 'skeleton', 0.5, 12.5), 9: arrow });
  assert.equal(meleeClose(shot), false);
  assert.equal(await deflect(shot, new Task('guard'), { holdMs: 50 }), true, 'a skeleton across the cave: face the arrow');
  const cornered = fixture({ 1: mob(1, 'skeleton', 0.5, 12.5), 2: mob(2, 'zombie', 2.0, 0.5), 9: arrow });
  assert.equal(meleeClose(cornered), true);
  assert.equal(await deflect(cornered, new Task('guard'), { holdMs: 50 }), false, 'the zombie hitting the bot comes before the skeleton shooting at it');
});
