'use strict';
// Note 983: rods_now says the last bank walk that ended without the chest.
const test = require('node:test');
const assert = require('node:assert');
const { lastWalkSays } = require('../src/rod-bank');

test('the last bank walk ended without the chest is said, a pending or banked one is not', () => {
  const now = Date.now();
  const walk = { at: now - 34 * 60000, rods: 1, from: { x: 151, y: 44, z: 108 } };
  assert.strictEqual(lastWalkSays({ rodBank: walk }, now), '', 'still under way');
  assert.strictEqual(lastWalkSays({ rodBank: { ...walk, doneAt: now - 60000, endedAt: now - 60000 } }, now), '', 'banked');
  const says = lastWalkSays({ rodBank: { ...walk, endedAt: now - 3 * 60000, why: 'the walk out came no nearer its portal for twenty minutes (102 blocks off at its nearest)' } }, now);
  assert.match(says, /begun 34 minutes ago with 1 rod from \(151, 44, 108\), ended 3 minutes ago after 31 minutes without reaching the chest: the walk out came no nearer its portal for twenty minutes \(102 blocks off at its nearest\)\./);
  assert.strictEqual(lastWalkSays({ rodBank: { ...walk, at: now - 3 * 3600000, endedAt: now - 2 * 3600000, why: 'x' } }, now), '', 'over an hour old');
});
