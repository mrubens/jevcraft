'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { slotMissSays } = require('../src/mob-hunt');

test('a slot offered again where the last wait killed nothing says that wait, how many running, and where this enderman stands against the mouth (note 1145)', () => {
  const now = Date.parse('2026-10-04T00:48:19Z');
  const bot = { entity: { position: new Vec3(-113.5, 53, 65.5) } };
  const state = { slotMiss: { x: -114, y: 53, z: 65, at: now - 1000, n: 2, why: 'it turned and did not come to the mouth in 45 seconds (4 blocks off, -3 up when the wait began, 4 blocks off, -3 up at its end, a line from the mouth to it)' } };
  const target = { position: new Vec3(-110.5, 50, 63.5) }, site = { mouth: new Vec3(-112, 53, 64) };
  const says = slotMissSays(bot, state, target, site, now);
  assert.match(says, /The last wait at this slot ended 1 second ago with nothing killed: it turned and did not come to the mouth in 45 seconds/);
  assert.match(says, /; 2 such waits running here\. An enderman walks up one block at a step and does not climb/);
  assert.match(says, /This one is 5 blocks off, 3 under the mouth\.$/);
  assert.equal(slotMissSays(bot, {}, target, site, now), '');
  assert.equal(slotMissSays(bot, state, target, site, now + 10 * 60000), '', 'past its two minutes it is not said');
});
