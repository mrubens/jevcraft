'use strict';
// Note 2618: the run's fallback walks to the priced cell's neighbours sixty degrees to either side, each a GoalNearXZ
// with a heuristic of its own, in place of GoalInvert, whose negative heuristic the pathfinder's bound (note 2615) cannot
// hold: mid-full-162-oom-3-fortress-1 ran out of a 4 GB heap twice in a minute at the escape on the bounded pathfinder.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { runCellsAside } = require('../src/survival');

test('the cells aside: twelve blocks out at sixty degrees either side of the line away from the mob', () => {
  const [a, b] = runCellsAside({ x: 0.5, z: 0.5 }, { x: 10.5, z: 0.5 }, 12);
  assert.deepEqual(a, { x: -6, z: -10 });
  assert.deepEqual(b, { x: -6, z: 11 });
  for (const c of [a, b]) assert.ok(Math.hypot(c.x - 10.5, c.z - 0.5) > 12, 'each is farther from the mob than the run wants');
});

test('no stance walks by an inverted or an all-of goal any more', () => {
  const src = fs.readFileSync(require.resolve('../src/survival'), 'utf8');
  assert.equal((src.match(/new goals\.GoalInvert\(/g) || []).length, 0);
  assert.equal((src.match(/new goals\.GoalCompositeAll\(/g) || []).length, 0);
});
