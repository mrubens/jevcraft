'use strict';
// Note 1364: a stay held for dawn and health back ends at dawn where health
// cannot come back (hunger under eighteen, no food carried).
const test = require('node:test');
const assert = require('node:assert/strict');
const NR = require('../src/night-record');

test('dawn come, health 17 that cannot come back: the hold ends; with a way to heal it waits', () => {
  const hold = { dawn: true, heal: true, kinds: ['surface_night', 'heal'] };
  assert.equal(NR.holdNow(hold, { night: false, health: 17, canHeal: false }).holds, false);
  assert.deepEqual(NR.holdNow(hold, { night: false, health: 17, canHeal: true }).waiting, ['health back']);
  assert.deepEqual(NR.holdNow(hold, { night: true, health: 17, canHeal: false }).waiting, ['dawn']);
});
