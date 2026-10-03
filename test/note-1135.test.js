'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { chaseSays, chaseCost } = require('../src/survival');

// 25593, 2026-10-03 23:27:09Z: bare at 7.2 health, a zombie with an iron spear on a zombie horse 2.7 blocks off, the run back the way it came 9 blocks to a cell 7 from it.
const bot = () => ({ health: 7.2, inventory: { slots: [] }, entity: { position: new Vec3(-650.2, 73, 28), effects: {} } });
const rider = (extra = {}) => ({ entity: { id: 1, name: 'zombie', position: new Vec3(-648.1, 73, 28.9), heldItem: { name: 'iron_spear' }, vehicle: { name: 'zombie_horse' }, ...extra }, distance: 2.7, visible: true });

test('a run from a spear holder on a mount is priced with its thrust on the way, not at nothing (note 1135)', () => {
  const cost = chaseCost(bot(), [rider()], { destination: { x: -641, y: 73, z: 28 }, runSeconds: 1.6 });
  assert.ok(cost.damage >= 13, `priced ${cost.damage}`);
  assert.match(cost.says, /the zombie with a spear on its zombie horse/);
  assert.match(cost.says, /more than the bot has/);
  assert.match(chaseSays(bot(), [rider()], { destination: { x: -641, y: 73, z: 28 }, runSeconds: 1.6 }), /the zombie on its zombie horse 3 blocks off at the run's pace or more, mounted: it is at the bot before the run ends/);
});

test('a zombie on foot with bare hands six blocks off keeps the price it had: one blow on reaching the bot after the run', () => {
  const walker = { entity: { id: 2, name: 'zombie', position: new Vec3(-644.2, 73, 28) }, distance: 6, visible: true };
  const cost = chaseCost(bot(), [walker], { destination: { x: -660, y: 73, z: 28 }, runSeconds: 1.8 });
  assert.equal(cost.damage, 3);
  assert.match(cost.says, /the zombie 1 blow \(on reaching the bot again/);
});

test('a spear on foot strikes from its reach as the bot turns to run', () => {
  const cost = chaseCost(bot(), [rider({ vehicle: null })], { destination: { x: -660, y: 73, z: 28 }, runSeconds: 1.8 });
  assert.match(cost.says, /as the bot turns to run, being at its reach now/);
  assert.ok(cost.damage >= 13);
});
