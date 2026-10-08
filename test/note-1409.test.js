'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { navigate, Task } = require('../src/skills');
const { crossingWater } = require('../src/work');

test('a walk over water keeps its heading as of its end, so the shore rule lets the crossing go on (note 1409)', async () => {
  // 25595 (2026-10-07 23:06Z on): a 45-second leg toward a ring under the sea, then swum back to shore.
  const bot = { entity: { position: new Vec3(1641.5, 61, -226.5) }, oxygenLevel: 20, blockAt: () => ({ name: 'air', boundingBox: 'empty' }) };
  const leg = { x: 1690, z: -240 };
  bot._heading = { ...leg, at: Date.now() - 45000 };
  assert.equal(crossingWater(bot), false, 'stale: begun 45 seconds ago');
  const task = new Task('leg');
  task.cancelled = true;
  await assert.rejects(navigate(bot, task, leg));
  assert.equal(crossingWater(bot), true, 'kept as of the walk\'s end');
  // A walk elsewhere does not refresh the old heading.
  bot._heading.at = Date.now() - 45000;
  await assert.rejects(navigate(bot, task, { x: 0, z: 0 }));
  assert.equal(crossingWater(bot), false);
});
