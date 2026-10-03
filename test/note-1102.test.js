'use strict';
// Note 1102: the jump at a drop lying a step up is not made where it goes on over an edge.
// 25592 (2026-10-03 19:08:14Z) jumped at a netherrack drop on a ledge twenty over the lava sea and went over.
const test = require('node:test');
const assert = require('node:assert');
const { Vec3 } = require('vec3');
const { edgeOnTheWay } = require('../src/drop-collection');

const world = solid => ({ entity: { position: new Vec3(0.5, 64, 0.5) }, blockAt: p => ({ boundingBox: solid(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)) ? 'block' : 'empty' }) });

test('a drop a step up on a ledge two wide with nothing past it: the edge on the way is found; on open floor, or with a wall behind the drop, none (note 1102)', () => {
  // Floor at y 63 for x 0..1, a step at x 1 (y 64), then nothing: the lava sea twenty below.
  const ledge = world((x, y, z) => (y === 63 && x >= -3 && x <= 1) || (y === 64 && x === 1));
  const e = edgeOnTheWay(ledge, new Vec3(1.5, 65.2, 0.5));
  assert(e && e.x === 2, JSON.stringify(e));
  const floor = world((x, y, z) => y === 63 || (y === 64 && x === 1));
  assert.equal(edgeOnTheWay(floor, new Vec3(1.5, 65.2, 0.5)), null);
  const walled = world((x, y, z) => (y === 63 && x <= 1) || (y === 64 && x === 1) || (x === 2 && y >= 64 && y <= 67));
  assert.equal(edgeOnTheWay(walled, new Vec3(1.5, 65.2, 0.5)), null);
});
