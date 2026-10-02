'use strict';
// Note 953: 25594 (mid-242-xa-fortress-5, 2026-10-02 22:42Z) had dig_across
// end at "oak fence in the way" 22 blocks from its portal again and again;
// 25598 (21:03Z) had its tunnel home stop at "The span is blocked by
// white_wool". In the Nether those are the bot's own, to dig through.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { surveyCrossing } = require('../src/bridging');

function flat(dimension, inTheWay) {
  const blockAt = p => {
    const f = p.floored();
    const name = f.y < 64 ? 'netherrack' : f.x === 5 && f.z === 0 && f.y === 64 ? inTheWay : 'air';
    return { position: f, name, boundingBox: name === 'air' ? 'empty' : 'block', diggable: true, digTime: () => 300 };
  };
  return { game: { dimension }, entity: { position: new Vec3(0.5, 64, 0.5) }, blockAt, inventory: { items: () => [{ name: 'iron_pickaxe', count: 1 }] }, heldItem: null };
}

test('in the Nether an oak fence or wool in the line is dug through, not a stop', () => {
  for (const kind of ['oak_fence', 'white_wool']) {
    const s = surveyCrossing(flat('the_nether', kind), new Vec3(20, 64, 0), { cells: 16 });
    assert.ok(!/in the way/.test(s.stoppedBy || ''), `${kind}: ${s.stoppedBy}`);
    assert.ok(s.cells >= 10, `${kind}: ${s.cells} cells`);
  }
});

test('a block the Nether makes that is not natural rock still stops it (a bastion\'s gold block)', () => {
  const s = surveyCrossing(flat('the_nether', 'gold_block'), new Vec3(20, 64, 0), { cells: 16 });
  assert.match(s.stoppedBy || '', /gold block in the way/);
});
