'use strict';
// Note 2401. full-22 (25590, 2026-10-28 16:49:35Z) died in a river; its drops floated downstream past the twelve blocks
// looked over, and the walk back said 'Nothing left where I died'.
const test = require('node:test');
const assert = require('node:assert/strict');
const { searchReach } = require('../src/corpse-run');

test('a death in water looks thirty-two blocks about for its drops; on dry ground twelve (note 2401)', () => {
  const wet = { blockAt: p => ({ name: p.y <= 62 ? 'water' : 'air' }) };
  const dry = { blockAt: p => ({ name: p.y < 64 ? 'stone' : 'air' }) };
  assert.equal(searchReach(wet, { x: 70.4, y: 62.2, z: -342.8 }), 32);
  assert.equal(searchReach(dry, { x: 0, y: 64, z: 0 }), 12);
});
