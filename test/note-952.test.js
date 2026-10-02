'use strict';
// Note 952: 25592 (mid-242-ka-nether-1, 2026-10-02 21:45:44Z) held
// await_in_reach in its box, four blazes 13 to 16 blocks off landing
// fireballs and fire, from 20 health to 0.8 in nine seconds, never asked again.
const test = require('node:test');
const assert = require('node:assert/strict');
const holds = require('../src/holds');

const blaze = (id, d) => ({ entity: { id, name: 'blaze', position: { x: d, y: 64, z: 0 } }, distance: d, visible: true });

test('a stance chosen with no price is asked again once it has cost four health', () => {
  const mobs = [blaze(1, 13.3), blaze(2, 14.1), blaze(3, 14.5), blaze(4, 16)];
  const hold = holds.begin({ choice: 'await_in_reach', at: 0, health: 20, mobs, offered: ['await_in_reach', 'box_here', 'take_cover'] });
  const at = { x: 78.5, y: 62, z: -567.4 };
  assert.equal(holds.diverged(hold, { now: 1000, health: 17, mobs, offered: ['await_in_reach', 'box_here', 'take_cover'], at }), null);
  assert.equal(holds.diverged(hold, { now: 2000, health: 16.2, mobs, offered: ['await_in_reach', 'box_here', 'take_cover'], at }), null, '3.8 lost: not yet');
  assert.match(holds.diverged(hold, { now: 2000, health: 12.5, mobs, offered: ['await_in_reach', 'box_here', 'take_cover'], at }), /7\.5 health lost in .* under a stance chosen with no price said/);
});

test('a priced stance keeps its own price', () => {
  const mobs = [blaze(1, 13.3)];
  const hold = holds.begin({ choice: 'box_here', at: 0, health: 20, expects: { damage: 10, seconds: 10 }, mobs, offered: ['box_here'] });
  assert.equal(holds.diverged(hold, { now: 8000, health: 13, mobs, offered: ['box_here'], at: null }), null, '7 lost against 8 priced');
});
