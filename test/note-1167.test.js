'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const registry = require('prismarine-registry')('26.1');
const { Task } = require('../src/skills');
const { findStronghold } = require('../src/stronghold');

test('the thrown eye still coming down when its flight ends is waited for and picked up where it lands (note 1167)', async () => {
  const items = [{ name: 'ender_eye', count: 12 }];
  const drop = { id: 77, name: 'item', position: new Vec3(10.5, 78, 0.5), velocity: { x: 0, y: -0.4, z: 0 }, getDroppedItem: () => ({ name: 'ender_eye' }) };
  const bot = { registry, game: { dimension: 'overworld', difficulty: 'peaceful', gameMode: 'survival' }, health: 20, food: 20, oxygenLevel: 20, entities: { 77: drop },
    entity: { position: new Vec3(0.5, 70, 0.5) }, inventory: { items: () => items, slots: [] }, findBlocks: () => [],
    blockAt: p => ({ name: p.y < 70 ? 'stone' : 'air', position: p, boundingBox: p.y < 70 ? 'block' : 'empty', skyLight: 15 }),
    pathfinder: { movements: { scafoldingBlocks: [1], allow1by1towers: true, blocksCantBreak: new Set() }, getPathTo: () => ({ status: 'success', path: [] }), setGoal() {} } };
  // It lands a second and a half after the flight ended.
  setTimeout(() => { drop.position = new Vec3(10.5, 70, 0.5); drop.velocity = { x: 0, y: 0, z: 0 }; }, 1500);
  const goal = { kind: 'win', gameProgress: { milestones: {} }, strongholdSearch: { bearings: [{ origin: { x: 0, y: 70, z: 0 }, direction: { x: 1, z: 0 }, end: { x: 10, y: 78, z: 0 } }], throws: 1, moves: 0, visited: {}, pendingPickup: { end: { x: 10, y: 78, z: 0 } } } };
  const walks = [];
  const started = Date.now();
  await findStronghold(bot, new Task('find'), goal, () => {}, { navigate: async (b, t, dest) => { walks.push(dest); items[0].count = 13; } }, null);
  assert.equal(walks.length, 1, 'walked to the eye once it lay still');
  assert.ok(Date.now() - started >= 1400, 'not given up while it was in the air');
  assert.deepEqual(goal.strongholdSearch.lastPickup.pickedUp, 1);
  assert.equal(goal.strongholdSearch.pendingPickup, undefined);
});

test('in the water with a place to go on toward, no Eye is asked for: the way goes on (note 1172)', async () => {
  const items = [{ name: 'ender_eye', count: 16 }];
  const bot = { registry, game: { dimension: 'overworld', difficulty: 'peaceful', gameMode: 'survival' }, health: 20, food: 20, oxygenLevel: 20, entities: {},
    entity: { position: new Vec3(-983.5, 62, -950.5), isInWater: true }, inventory: { items: () => items, slots: [] }, findBlocks: () => [],
    blockAt: p => ({ name: p.y < 55 ? 'stone' : p.y < 63 ? 'water' : 'air', position: p, boundingBox: p.y < 55 ? 'block' : 'empty', skyLight: 15 }),
    activateItem: () => assert.fail('no Eye thrown from the water'),
    pathfinder: { movements: { scafoldingBlocks: [1], allow1by1towers: true, blocksCantBreak: new Set() }, getPathTo: () => ({ status: 'noPath', path: [] }), setGoal() {} } };
  const goal = { kind: 'win', gameProgress: { milestones: {} }, strongholdSearch: { throws: 2, moves: 0, visited: {}, estimate: { x: -1024, z: -976, strength: 0.1, residual: 0 },
    bearings: [{ origin: { x: -700, y: 70, z: -976 }, direction: { x: -1, z: 0 }, end: { x: -712, y: 74, z: -976 } }, { origin: { x: -700, y: 70, z: -900 }, direction: { x: -324 / Math.hypot(324, 76), z: -76 / Math.hypot(324, 76) }, end: { x: -712, y: 74, z: -903 } }] } };
  let error = null;
  try { await findStronghold(bot, new Task('find'), goal, () => {}, { navigate: async () => {}, explore: async () => {}, surfaceStep: async () => {}, tunnel: async () => {}, acquireStep: async () => {} }, null); }
  catch (err) { error = err; }
  assert.ok(!error || !/dry stable footing/.test(error.message), error?.message);
  assert.equal(goal.strongholdSearch.throws, 2, 'no throw counted');
});

test('in the water with no Eye thrown yet, the shore is made for first: no throw is asked for afloat (note 1217)', async () => {
  const items = [{ name: 'ender_eye', count: 16 }];
  const bot = { registry, game: { dimension: 'overworld', difficulty: 'peaceful', gameMode: 'survival' }, health: 20, food: 20, oxygenLevel: 20, entities: {},
    entity: { position: new Vec3(-231.5, 62, -1137.5), isInWater: true }, inventory: { items: () => items, slots: [] }, findBlocks: () => [],
    blockAt: p => ({ name: p.y < 55 ? 'stone' : p.y < 63 ? 'water' : 'air', position: p, boundingBox: p.y < 55 ? 'block' : 'empty', skyLight: 15 }),
    activateItem: () => assert.fail('no Eye thrown from the water'),
    pathfinder: { movements: { scafoldingBlocks: [1], allow1by1towers: true, blocksCantBreak: new Set() }, getPathTo: () => ({ status: 'noPath', path: [] }), setGoal() {} } };
  const goal = { kind: 'win', gameProgress: { milestones: {} } };
  const shore = require('../src/shore'), reachShore = shore.reachShore;
  let swam = 0;
  shore.reachShore = async () => { swam++; return true; };
  try { await findStronghold(bot, new Task('find'), goal, () => {}, { navigate: async () => {}, explore: async () => {}, surfaceStep: async () => {}, tunnel: async () => {}, acquireStep: async () => {} }, null); }
  finally { shore.reachShore = reachShore; }
  assert.equal(swam, 1);
  assert.equal(goal.step.action, 'reach_shore');
  assert.equal(goal.strongholdSearch.throws, 0);
});
