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
