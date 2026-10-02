'use strict';
// Note 919: a warned shooter out of sight is due only for its warning's own
// longest past the last look that had it in sight; the shield's answer does
// not hold the body for as long as a hidden blaze keeps its glow.
const test = require('node:test');
const assert = require('node:assert/strict');
const { warnDue, WARNS } = require('../src/shot-reflex');

const now = 1_000_000;
const blaze = (warnAgo, seenAgo) => ({ id: 5, name: 'blaze', _shotWarn: { key: `5:${now - warnAgo}`, at: now - warnAgo, kind: 'blaze' }, ...(seenAgo == null ? {} : { _shotSeenAt: now - seenAgo }) });

test('a glowing blaze in sight is due for as long as its warning is on', () => {
  assert.equal(warnDue({ _shotInSight: new Set([5]) }, blaze(60000, 0), now), true);
  assert.equal(warnDue({ _shotInSight: new Set([5]) }, blaze(1000, 0), now), false, 'before its shots can come');
});

test('one out of sight is due for its warning\'s longest past the last look that had it in sight, and not after', () => {
  const most = WARNS.blaze.most * 1000;
  assert.equal(warnDue({ _shotInSight: new Set() }, blaze(60000, most - 500), now), true);
  assert.equal(warnDue({ _shotInSight: new Set() }, blaze(60000, most + 500), now), false);
  assert.equal(warnDue({ _shotInSight: new Set() }, blaze(15 * 60000, null), now), false, 'never seen, its glow fifteen minutes old: 25581');
  assert.equal(warnDue({ _shotInSight: new Set() }, blaze(3000, null), now), true, 'a warning just begun, not yet seen');
});

test('in sight again, it is due again at once', () => {
  const e = blaze(15 * 60000, 60000);
  assert.equal(warnDue({ _shotInSight: new Set() }, e, now), false);
  assert.equal(warnDue({ _shotInSight: new Set([5]) }, e, now), true);
});

test('with no look taken yet (no sight set) the warning is due as before', () => {
  assert.equal(warnDue({}, blaze(60000, null), now), true);
});
