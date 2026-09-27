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

test('fighting them all counts the shooters behind a wall: the fight is out among them', () => {
  const wall = { raycast: (eye, dir, range) => ({ position: eye.offset(dir.x, dir.y, dir.z), intersect: eye.offset(dir.x, dir.y, dir.z) }) };
  const mobs = [['skeleton', 7], ['skeleton', 11], ['skeleton', 11], ['zombie', 7]];
  const open = riskNow(botWith({ mobs })), walled = riskNow({ ...botWith({ mobs }), world: wall });
  assert.equal(walled.hostilesWithin.inSight, 0);
  assert.equal(open.hostilesWithin.inSight, 4);
  assert.deepEqual(walled.fightingAllHere, open.fightingAllHere);
  assert.doesNotMatch(walled.level, /^low/);
});

test('a shooter beyond twenty-four blocks is counted, and a shot in the air coming at the bot is said', () => {
  // mid-227-r was told "nothing hostile in view" while a blaze 27 off fired at it on a bridge over the void, and a fireball threw it off (2026-09-27).
  const blaze = riskNow(botWith({ mobs: [['blaze', 27]] }));
  assert.notEqual(blaze.level, 'none in view');
  assert.doesNotMatch(blaze.level, /nothing hostile in view/);
  assert.deepEqual(blaze.hostilesWithin.kinds, ['blaze']);
  assert.equal(blaze.hostilesWithin.shooters, 1);
  assert.equal(riskNow(botWith({ mobs: [['zombie', 27]] })).level, 'none in view', 'a biter that far is not yet about');
  assert.equal(riskNow(botWith({ mobs: [['blaze', 50]] })).level, 'none in view');
  const shot = botWith();
  shot.entities[9] = { id: 9, name: 'small_fireball', position: new Vec3(12, 66, 0), velocity: new Vec3(-1.5, -0.1, 0), isValid: true };
  shot.entities[10] = { id: 10, name: 'arrow', position: new Vec3(12, 66, 0), velocity: new Vec3(0, 0, 1.5), isValid: true };
  const said = riskNow(shot);
  assert.match(said.level, /nothing hostile in view, but a shot in the air is coming at the bot/);
  assert.equal(said.shotsComingAtTheBot, 1, 'the arrow flying across is not');
});
