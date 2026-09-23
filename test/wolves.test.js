'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { Task } = require('../src/skills');
const registry = require('minecraft-data')('26.1');
const wolves = require('../src/wolves');
const breeding = require('../src/breeding');

const keys = name => registry.entitiesByName[name].metadataKeys;
function wolf(id, x, { tamedBy = null, sit = false } = {}) {
  const m = [];
  m[keys('wolf').indexOf('flags')] = (tamedBy ? 0x04 : 0) | (sit ? 0x01 : 0);
  if (tamedBy) m[keys('wolf').indexOf('owneruuid')] = tamedBy;
  return { id, name: 'wolf', position: new Vec3(x, 64, 0), isValid: true, metadata: m };
}
function bot(entities, items) {
  const b = { registry, game: { dimension: 'overworld' }, entity: { position: new Vec3(0, 64, 0) }, player: { uuid: 'aaaa-bbbb' }, entities, chat() {},
    inventory: { items: () => items }, heldItem: null, equip: async () => {}, unequip: async () => {}, lookAt: async () => {}, used: [] };
  b.useOn = e => { b.used.push(e.id); };
  return b;
}

test('a wild wolf is tamed with bones: fed until it takes, then kept and said', async () => {
  const w = wolf(5, 2);
  const items = [{ name: 'bone', count: 5 }];
  const b = bot({ 5: w }, items);
  const goal = {};
  assert(wolves.tameReady(b, goal));
  let fed = 0;
  b.useOn = e => { fed++; items[0].count--; if (fed === 2) e.metadata[keys('wolf').indexOf('flags')] = 0x04; };
  assert.equal(await wolves.tameWolf(b, new Task('tame'), goal, () => {}, { navigate: async () => {} }), true);
  assert.equal(fed, 2, 'fed until it took');
  assert.equal(goal.wolves.length, 1);
});

test('before a crossing the bot\'s own wolves sit; back home they stand, and another player\'s wolf is left alone', async () => {
  const mine = wolf(1, 3, { tamedBy: 'aaaabbbb' }), theirs = wolf(2, 4, { tamedBy: 'ccccdddd' });
  const b = bot({ 1: mine, 2: theirs }, []);
  const goal = {};
  assert.equal(await wolves.commandWolves(b, new Task('cross'), goal, () => {}, true), true);
  assert.deepEqual(b.used, [1], 'only its own');
  assert.equal(goal.wolfOrder.sit, true);
  mine.metadata[keys('wolf').indexOf('flags')] |= 0x01;
  assert.equal(await wolves.commandWolves(b, new Task('cross'), goal, () => {}, true), false, 'already sitting: nothing to do');
  assert.equal(await wolves.commandWolves(b, new Task('home'), goal, () => {}, false), true, 'stood up again');
});

test('two adult sheep and two wheat breed; not again for five minutes', async () => {
  const sheep = id => ({ id, name: 'sheep', position: new Vec3(id, 64, 0), isValid: true, metadata: [] });
  const b = bot({ 1: sheep(1), 2: sheep(2) }, [{ name: 'wheat', count: 4 }]);
  const goal = {};
  assert(breeding.breedReady(b, goal, 'sheep'));
  assert.equal(await breeding.breedNearby(b, new Task('breed'), goal, () => {}, 'sheep', { navigate: async () => {} }), true);
  assert.deepEqual(b.used, [1, 2]);
  assert.equal(breeding.breedReady(b, goal, 'sheep'), false, 'resting');
  assert.equal(breeding.breedReady(b, {}, 'chicken'), false, 'no chickens, no seeds');
});
