'use strict';
// In the water, each move says the nearest land (note 2330).
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');

test('a swim in open water: the moves say how far the nearest land is after them, and which way is nearer', () => {
  const { localMoves, describeMove } = require('../src/unstuck');
  // Sea at y 62 (water from 55 to 62), a shore of grass from x >= 6 at y 62 with air over it.
  const view = { name: p => p.x >= 6 ? (p.y <= 62 ? 'grass_block' : 'air') : p.y <= 54 ? 'sand' : p.y <= 62 ? 'water' : 'air',
    carried: {}, pickaxe: null, pickaxeUses: 0, laid: () => null, health: 20 };
  const { moves } = localMoves(view, new Vec3(0, 62, 0), { goal: 'sky', visits: {}, breathS: 15 });
  const east = moves.find(m => m.key === 'step_east'), west = moves.find(m => m.key === 'step_west');
  assert.ok(east && west, moves.map(m => m.key).join(', '));
  assert.match(describeMove(east), /blocks from the nearest land, \(6, 63, -?\d+\) after, \d+ now: nearer it/);
  assert.match(describeMove(west), /: away from it/);
});
