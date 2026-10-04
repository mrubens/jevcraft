'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const registry = require('prismarine-registry')('26.1');
const { Task } = require('../src/skills');
const { findStronghold } = require('../src/stronghold');
const { need } = require('../src/eye-need');

// Two bearings sixty blocks apart that meet at (0, 0).
const bearings = () => [
  { origin: { x: -300, y: 70, z: 0 }, direction: { x: 1, z: 0 }, end: { x: -288, y: 74, z: 0 } },
  { origin: { x: -300, y: 70, z: 60 }, direction: { x: 300 / Math.hypot(300, 60), z: -60 / Math.hypot(300, 60) }, end: { x: -288, y: 74, z: 57 } },
];
function fixture(at, eyes = 12) {
  const items = [{ name: 'ender_eye', count: eyes }];
  const bot = { registry, game: { dimension: 'overworld', difficulty: 'peaceful', gameMode: 'survival' }, health: 20, food: 20, entities: {},
    entity: { position: at }, inventory: { items: () => items, slots: [] }, findBlocks: () => [],
    blockAt: p => ({ name: p.y < 70 ? 'stone' : 'air', position: p, boundingBox: p.y < 70 ? 'block' : 'empty', skyLight: 15 }) };
  const goal = { kind: 'win', gameProgress: { milestones: {} }, strongholdSearch: { bearings: bearings(), throws: 2, moves: 0, visited: {}, estimate: { x: 0, z: 0, strength: 0.1, residual: 0, source: 'observed_eye_bearings' } } };
  return { bot, goal };
}

test('with twelve eyes and the bearings met at one place, the spare is not wanted and the ground there is searched for the portal (note 1151)', async () => {
  const { bot, goal } = fixture(new Vec3(3.5, 70, 2.5));
  assert.equal(need(bot, goal).pearlsLeft, 0, 'twelve eyes are the portal\'s: no pearl is short');
  const calls = [];
  const actions = { explore: async (b, t, g, s, what, opts) => calls.push({ what, opts }), surfaceStep: async () => calls.push({ what: 'surface' }) };
  await findStronghold(bot, new Task('find'), goal, () => {}, actions, null);
  assert.deepEqual(calls, [{ what: 'end_portal_frame', opts: { surfaceOnly: false } }]);
  assert.equal(goal.step.action, 'search_at_estimate');
  assert.deepEqual(goal.step.target, { x: 0, z: 0 });
});

test('with twelve eyes and no place the bearings meet at, the search still asks for its spare, and the ladder for the pearl', async () => {
  const { bot, goal } = fixture(new Vec3(-300.5, 70, 0.5));
  goal.strongholdSearch.bearings = bearings().slice(0, 1); delete goal.strongholdSearch.estimate;
  assert.equal(need(bot, goal).pearlsLeft, 1);
  bot.entity.position = new Vec3(-100.5, 70, 0.5);
  await assert.rejects(findStronghold(bot, new Task('find'), goal, () => {}, { explore: async () => {}, surfaceStep: async () => {} }, null), /needs another spare Eye of Ender/);
});
