'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const sc = require('../src/nether-shortcut');

const goalOf = () => ({ kind: 'win', gameProgress: { milestones: { stronghold_located: { at: 1, center: { x: 1878, y: 32, z: -294 } } } } });
const bot = (x, z, dim = 'overworld') => ({ entity: { position: new Vec3(x, 63, z) }, game: { dimension: dim }, chat() {} });

test('far from the chest with the End portal found, the way through the Nether is asked once, and chosen it is the errand (note 1279)', async () => {
  const goal = goalOf(); let asked = 0, said = '';
  const task = { check() {}, opportunityClient: { systemOne: async ({ questions }) => { asked++; said = JSON.stringify(questions.branch_0.criteria); return { answers: { branch_0: { choice: 'through_nether', confidence: 0.8 } } }; } } };
  assert.equal(await sc.ask(bot(1771, -254), task, goal, () => {}, { x: 4, y: 66, z: 5 }, 1788), true);
  assert.match(said, /224 blocks in the Nether to the portal by the chest and as many back, in place of 1788 on foot each way here/);
  assert.deepEqual({ d: goal.errand.dimension, f: goal.errand.for }, { d: 'nether', f: sc.ERRAND });
  assert.equal(goal.netherShortcut.phase, 'out');
  assert.equal(await sc.ask(bot(1771, -254), task, goal, () => {}, { x: 4, y: 66, z: 5 }, 1788), false);
  assert.equal(asked, 1);
  assert.deepEqual(sc.exitTarget(goal), { x: 4, y: 66, z: 5 }, 'the way out comes out by the chest');
});

test('out by the chest, the way back begins; with the eyes taken, into the Nether again; at the End portal, done', () => {
  const goal = goalOf();
  goal.netherShortcut = { chest: { x: 4, y: 66, z: 5 }, phase: 'out', at: 1 };
  goal.errand = { dimension: 'nether', items: [], for: sc.ERRAND, at: Date.now() };
  sc.settle(bot(10, 20), goal, () => {}, { eyesCarried: 0, wanted: 11 });
  assert.equal(goal.netherShortcut.phase, 'back');
  assert.equal(goal.errand, undefined, 'the chest first');
  assert.deepEqual(sc.exitTarget(goal), { x: 1878, y: 32, z: -294 });
  sc.settle(bot(10, 20), goal, () => {}, { eyesCarried: 12, wanted: 11 });
  assert.equal(goal.errand.dimension, 'nether');
  assert.equal(sc.carriesEyesBack(goal), true);
  sc.settle(bot(1700, -250), goal, () => {}, { eyesCarried: 12, wanted: 11 });
  assert.equal(goal.netherShortcut, undefined);
  assert.equal(goal.errand, undefined);
});

test('on the way through the Nether to a far chest, the crossing is not asked of its kit again (note 1281)', async () => {
  const { crossingKitReady } = require('../src/work');
  const reg = require('minecraft-data')('26.1');
  const b = { registry: reg, game: { dimension: 'overworld', gameMode: 'survival' }, inventory: { items: () => [], slots: [] }, entity: { position: new Vec3(0, 64, 0) }, entities: {}, health: 20, food: 20, blockAt: () => null, findBlocks: () => [] };
  let asked = 0;
  const client = { systemOne: async () => { asked++; return { answers: { branch_0: { choice: 'cross_now', confidence: 0.7 } } }; } };
  const goal = goalOf();
  goal.netherShortcut = { chest: { x: 4, y: 66, z: 5 }, phase: 'out', at: 1 };
  goal.errand = { dimension: 'nether', items: [], for: sc.ERRAND, at: Date.now() };
  assert.equal(await crossingKitReady(b, { check() {}, opportunityClient: client }, goal, () => {}, client), true);
  assert.equal(asked, 0);
});
