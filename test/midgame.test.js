'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { reached, counts } = require('../scripts/midgame');

test('the midgame counts the Nether, a fortress, six blaze rods and twelve pearls once each is reached, rods and pearls as eyes too', () => {
  const f = (t, snapshot) => ({ t, snapshot });
  const frames = [
    f(1, { dimension: 'overworld', inventory: { ender_pearl: 3 } }),
    f(2, { dimension: 'the_nether', inventory: { ender_pearl: 3 } }),
    f(3, { dimension: 'the_nether', step: { action: 'find_fortress', walking: { x: 1, y: 70, z: 2 } } }),
    f(4, { dimension: 'the_nether', inventory: { blaze_rod: 4, blaze_powder: 4, ender_pearl: 5 } }),
    f(5, { dimension: 'overworld', inventory: { blaze_rod: 3, ender_eye: 6, ender_pearl: 6 } }),
  ];
  const { at, best } = reached(frames);
  assert.deepEqual(at, { nether: 2, fortress: 3, blaze_rods: 4, ender_pearls: 5 });
  assert.equal(best.rods, 6);
  assert.equal(best.pearls, 12);
  assert.deepEqual(counts({ blaze_powder: 3 }), { rods: 1.5, pearls: 0 });
});
