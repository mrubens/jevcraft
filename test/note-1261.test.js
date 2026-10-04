'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { collectStage } = require('../src/rod-stash');

test('the chest just filled beside the bot is taken last: the far one first, and it alone when nothing else is left (note 1261)', () => {
  const now = Date.parse('2026-10-04T22:50:00Z');
  const bot = { entity: { position: new Vec3(-60.5, 60, 0.5) }, game: { dimension: 'the_nether' } };
  const fresh = { position: { x: -62, y: 60, z: 1 }, dimension: 'nether', contents: { ender_pearl: 11 }, storedAt: new Date(now - 5000).toISOString() };
  const far = { position: { x: -254, y: 60, z: -339 }, dimension: 'nether', contents: { blaze_rod: 1 }, storedAt: '2026-10-04T08:24:06.000Z' };
  const goal = { rodStashes: [fresh, far] };
  assert.deepEqual(collectStage(bot, goal, now).at, { x: -254, y: 60, z: -339 });
  far.contents = {};
  assert.deepEqual(collectStage(bot, goal, now).at, { x: -62, y: 60, z: 1 }, 'the way out: what was put down is taken up');
  // An old chest beside the bot is the nearest, as before.
  fresh.storedAt = new Date(now - 3600000).toISOString(); far.contents = { blaze_rod: 1 };
  assert.deepEqual(collectStage(bot, goal, now).at, { x: -62, y: 60, z: 1 });
});
