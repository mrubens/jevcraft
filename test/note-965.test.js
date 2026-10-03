'use strict';
// Note 965: 25597 (mid-242-pf-nether-1, 2026-10-03 02:33:59 to 02:36:19Z) took
// walk_to_21 again two minutes after the same walk came no nearer, begun
// from the next 8-block area.
const test = require('node:test');
const assert = require('node:assert/strict');
const { setAside } = require('../src/progress');
const { failedLatelySays } = require('../src/nether-gather');

test('a gather way that came no nearer lately from other places near here says so', () => {
  const goal = {};
  const place = { x: -62, y: 68, z: 91 };
  assert.equal(failedLatelySays(goal, place, 'walk'), '');
  setAside(goal, 'gather_way', '-8,8,11>-62,91:walk', 'came no nearer', 300000);
  setAside(goal, 'gather_way', '-10,8,13>-62,91:walk', 'came no nearer', 300000);
  setAside(goal, 'gather_way', '-10,8,13>-62,91:cross', 'came no nearer', 300000);
  assert.equal(failedLatelySays(goal, place, 'walk'), ' This way there came no nearer 2 times in the last ten minutes, begun from other places near here.');
  assert.match(failedLatelySays(goal, place, 'cross'), /came no nearer once/);
});
