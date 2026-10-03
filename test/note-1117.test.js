'use strict';
// Note 1117: the harness plays a trial on past the rods and the pearls to the End and the dragon.
const test = require('node:test');
const assert = require('node:assert');
const { MILESTONES, reached, limitFor } = require('../scripts/midgame');

test('the milestones run on to the End and the dragon; the End is read from the frames, and the rods and pearls kept give the End its hours (note 1117)', () => {
  assert.deepEqual(MILESTONES.slice(-2), ['the_end', 'dragon']);
  const frames = [
    { t: 1, snapshot: { dimension: 'the_nether', inventory: { blaze_rod: 7, ender_pearl: 13 } } },
    { t: 2, snapshot: { dimension: 'overworld', inventory: { ender_eye: 12 } } },
    { t: 3, snapshot: { dimension: 'the_end', inventory: {} } },
  ];
  const { at } = reached(frames);
  assert.equal(at.the_end, 3);
  assert('blaze_rods' in at && 'ender_pearls' in at && !('dragon' in at));
  assert.equal(reached(frames.slice(0, 2)).at.the_end, undefined, 'the Nether and the Overworld are not the End');
  assert(limitFor({ rods: 7, pearls: 13 }) >= 24 * 3600000);
  assert(limitFor({ rods: 7, pearls: 2 }) < limitFor({ rods: 7, pearls: 13 }));
});
