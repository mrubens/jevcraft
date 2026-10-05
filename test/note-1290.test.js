'use strict';
// Note 1290: eyes made count as the rods and pearls played through, wherever
// they lie. mid-243-ma-nether-1 (25597, 2026-10-05 08:08:44Z) drowned with its
// twelve eyes by its stronghold and was ended at its 24 hours three minutes later.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');

test('eyes made or a stronghold found: the End\'s hours, with nothing in the pack or the chests', () => {
  const { keptNow, limitFor } = require('../scripts/midgame');
  const identity = '127_0_0_1-25994-Jev', file = path.join(__dirname, '..', '.bot-state', `${identity}.json`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  try {
    fs.writeFileSync(file, JSON.stringify({ kind: 'win', rodStashes: [], gameProgress: { milestones: { nether_entered: {}, eyes_obtained: {}, stronghold_located: {} } } }));
    const kept = keptNow(identity);
    assert.equal(limitFor(kept), limitFor({ rods: 99, pearls: 99 }), 'the longest limit');
    fs.writeFileSync(file, JSON.stringify({ kind: 'win', rodStashes: [], gameProgress: { milestones: { nether_entered: {} } } }));
    assert.deepEqual(keptNow(identity), { rods: 0, pearls: 0 });
  } finally { fs.rmSync(file, { force: true }); }
});
