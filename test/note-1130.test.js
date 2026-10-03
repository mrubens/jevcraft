'use strict';
// Note 1130: with no surveyed route, the dodge runs straight away over ground that has a floor.
// The rehearsal of 2026-10-03 (23:02Z) stood in the dragon's breath, "No surveyed walking escape" twelve times, 20 health to none.
const test = require('node:test');
const assert = require('node:assert');
const { Vec3 } = require('vec3');
const { straightAway } = require('../src/end-safety');

const world = floorAt => ({ blockAt: p => ({ boundingBox: floorAt(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)) ? 'block' : 'empty' }) });

test('the run goes straight away from the dragon over floored cells, a quarter or a side where the void lies behind, and nowhere on a lone block (note 1130)', () => {
  const start = new Vec3(0.5, 64, 0.5), bearing = 0; // the dragon to the east (+x)
  const flat = straightAway(world((x, y) => y === 63), start, bearing);
  assert(flat && flat.x < -4 && Math.abs(flat.z - 0.5) < 0.1, JSON.stringify(flat));
  // The void to the west: floor only for x >= -1. It goes to a side.
  const edge = straightAway(world((x, y) => y === 63 && x >= -1), start, bearing);
  assert(edge && Math.abs(edge.z - 0.5) > 4, JSON.stringify(edge));
  // A slope down a block every two cells is run down.
  const slope = straightAway(world((x, y) => y === 63 + Math.ceil(x / 2)), start, bearing);
  assert(slope && slope.y < 64, JSON.stringify(slope));
  assert.equal(straightAway(world((x, y, z) => y === 63 && x === 0 && z === 0), start, bearing), null);
});
