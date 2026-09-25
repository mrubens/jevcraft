'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { localMoves, describeMove } = require('../src/unstuck');

// A world of stone with named cells.
const view = (cells, extra = {}) => ({ name: p => cells[`${p.x},${p.y},${p.z}`] ?? (p.y >= 80 ? 'air' : 'stone'), carried: {}, pickaxe: 'iron_pickaxe', ...extra });

test('in a pool under a stone lid, the moves say the lid can be dug and the climb out waits for it', () => {
  // Trial 33: feet in water, head in the one open cell, stone over the
  // head, a dry bank a block up to the east.
  const cells = { '0,70,0': 'water', '0,71,0': 'air', '1,71,0': 'air', '1,72,0': 'air', '-1,70,0': 'water' };
  const feet = new Vec3(0, 70, 0);
  const before = localMoves(view(cells), feet, { goal: 'dry' });
  const keys = before.moves.map(m => m.key);
  assert(keys.includes('dig_up'), 'the lid can be dug');
  assert(!keys.includes('climb_east'), 'no climb out with stone at the top of the head');
  assert.equal(before.here.headroomToRise, false);
  cells['0,72,0'] = 'air';
  const after = localMoves(view(cells), feet, { goal: 'dry' });
  const climb = after.moves.find(m => m.key === 'climb_east');
  assert(climb && climb.dryFooting, 'with the lid gone, the climb east ends on dry ground');
  assert.match(describeMove(climb), /Climb out of the water onto the block east.*ends on dry ground/);
});

test('digging under sand says it will fall onto the head, and a pillar is offered only with blocks and headroom', () => {
  const cells = { '0,71,0': 'air', '0,72,0': 'air', '0,73,0': 'sand', '0,74,0': 'sand', '0,75,0': 'sand' };
  const feet = new Vec3(0, 71, 0);
  const up = localMoves(view(cells), feet).moves.find(m => m.key === 'dig_up');
  assert.match(up.effects.join(), /2 blocks of sand above would fall into it, onto the bot's head/);
  assert(!localMoves(view(cells, { carried: { dirt: 4 } }), feet).moves.some(m => m.key === 'pillar'), 'no headroom for a pillar under sand');
  cells['0,73,0'] = 'air';
  assert(localMoves(view(cells, { carried: { dirt: 4 } }), feet).moves.some(m => m.key === 'pillar'));
});
