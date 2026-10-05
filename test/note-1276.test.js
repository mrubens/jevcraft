'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { walkToKnownPortal } = require('../src/work');

test('with the stronghold found, the way out of the Nether is the portal whose whole way to it is shortest, not the nearest (note 1276)', async () => {
  const bot = { entity: { position: new Vec3(5, 89, 46) }, game: { dimension: 'the_nether' }, inventory: { items: () => [] }, entities: {},
    pathfinder: { setGoal() {}, goto: async () => { throw new Error('stop'); } }, blockAt: () => null };
  const goal = { kind: 'win', gameProgress: { milestones: { stronghold_located: { center: { x: 604, y: -37, z: 1540 } } } },
    portals: [{ x: -33, y: 95, z: 133, dimension: 'overworld' }, { x: -20, y: 71, z: 19, dimension: 'nether' }, { x: 461, y: 117, z: 1028, dimension: 'overworld' }, { x: 58, y: 101, z: 127, dimension: 'nether' }] };
  await walkToKnownPortal(bot, { check() {} }, goal, () => {}, 'nether').catch(() => {});
  assert.deepEqual(goal.step.portal, { x: 58, y: 101, z: 127 });
  // No stronghold found: the nearest, as before.
  const g2 = { ...goal, gameProgress: { milestones: {} } };
  await walkToKnownPortal(bot, { check() {} }, g2, () => {}, 'nether').catch(() => {});
  assert.deepEqual(g2.step.portal, { x: -20, y: 71, z: 19 });
});
