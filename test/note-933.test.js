'use strict';
// Note 933: sand and gravel on a climb's stairs.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { restsOnSolid, fallingOver } = require('../src/tunneling');

const world = cells => ({ blockAt: p => { const name = cells[`${p.x},${p.y},${p.z}`] || 'air'; return { name, position: p, boundingBox: name === 'air' || name === 'water' ? 'empty' : 'block' }; } });

test('sand on stone rests on solid ground; on air, or on more sand over air, it does not', () => {
  assert.equal(restsOnSolid(world({ '0,63,0': 'stone' }), new Vec3(0, 64, 0)), true);
  assert.equal(restsOnSolid(world({ '0,63,0': 'gravel', '0,62,0': 'stone' }), new Vec3(0, 64, 0)), true);
  assert.equal(restsOnSolid(world({}), new Vec3(0, 64, 0)), false);
  assert.equal(restsOnSolid(world({ '0,63,0': 'sand' }), new Vec3(0, 64, 0)), false);
  assert.equal(restsOnSolid(world({ '0,63,0': 'water' }), new Vec3(0, 64, 0)), false);
});

test('the sand and gravel over a cell are counted up to the first block that does not fall', () => {
  assert.equal(fallingOver(world({ '0,65,0': 'gravel', '0,66,0': 'gravel', '0,67,0': 'sand', '0,68,0': 'stone' }), new Vec3(0, 64, 0)), 3);
  assert.equal(fallingOver(world({ '0,65,0': 'stone' }), new Vec3(0, 64, 0)), 0);
});
