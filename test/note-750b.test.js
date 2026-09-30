'use strict';
// Trial note 750b: 25581 (mid-243-jd), 12:51-13:06Z on 2026-09-30, in a
// fortress 22 minutes after its first blaze fight with no rod
// (critic-20260930T1305Z item 1).
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');

test('a walk the step names (a way on of the floors, a patrol, a place gone to) that moved nothing is not excused as "at a known fortress" (note 750b)', () => {
  const { stepWait } = require('../src/stillness');
  const bot = { entity: { position: new Vec3(-146, 57, 550) }, health: 20, food: 20 };
  const fortressSearch = { inFortressSince: Date.now() - 600000 };
  const exploring = { action: 'find_fortress', found: { x: -145, y: 57, z: 550 }, exploring: { x: -145, y: 57, z: 550 }, legs: 12 };
  assert.equal(stepWait(bot, { step: exploring, fortressSearch }), null);
  assert.equal(stepWait(bot, { step: { action: 'find_fortress', goingTo: { x: -132, y: 57, z: 511, kind: 'blazes' }, legs: 12 }, fortressSearch }), null);
  // Standing at it deciding, as before (notes 732, 739b).
  assert.equal(stepWait(bot, { step: { action: 'find_fortress', found: { x: -145, y: 57, z: 550 }, legs: 12 }, fortressSearch }), 'at a known fortress');
  assert.equal(stepWait(bot, { step: { action: 'cross_toward' }, fortressSearch }), 'at a known fortress');
});

test('no "Searching past the fortress I know" on its own floors or on a walk to a place in it; said away from it (25581 at 12:57:55Z, note 750b)', () => {
  const narration = require('../src/narration');
  const fortressAt = { x: -65, y: 62, z: 520, firstAt: 1 };
  const bot = { chat() {} };
  assert.equal(narration.stepLine({ fortressSearch: { fortressAt, inFortressSince: Date.now() } }, { action: 'find_fortress', legs: 12 }, null, null, bot), null);
  assert.equal(narration.stepLine({ fortressSearch: { fortressAt } }, { action: 'find_fortress', goingTo: { x: -159, y: 59, z: 510, kind: 'blazes' }, legs: 12 }, null, null, bot), null);
  assert.equal(narration.stepLine({ fortressSearch: { fortressAt } }, { action: 'find_fortress', target: { x: 300, y: 60, z: 0 }, legs: 13 }, null, null, bot), 'Searching past the fortress I know at -65, 520 (leg 13).');
  // No fortress known: the search's own line, unchanged.
  assert.equal(narration.stepLine({ fortressSearch: {} }, { action: 'find_fortress', target: { x: 300, y: 60, z: 0 }, legs: 3 }, null, null, bot), "I'm looking for a fortress (leg 3).");
});
