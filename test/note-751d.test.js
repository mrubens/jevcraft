'use strict';
// Note 751d (25588 mid-231-ad, 03:07-03:14Z on 2026-10-01): stems overhead
// climbed to by a pillar, priced in blocks; and blocks, while the ways on
// are short of them, kept from the tidy and the room-making question.
const test = require('node:test'), assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const registry = require('minecraft-data')('26.1');

const stack = (name, count = 1) => ({ name, count, type: registry.itemsByName[name].id });
// A netherrack floor at y 56 with open air above it up to y 90.
function world(position, items) {
  const at = p => { const q = p.floored ? p.floored() : p; const name = q.y <= 56 || q.y > 90 ? 'netherrack' : 'air';
    return { name, boundingBox: name === 'air' ? 'empty' : 'block', diggable: true, position: q, digTime: () => 400 }; };
  return { registry, game: { dimension: 'the_nether', gameMode: 'survival' }, health: 20, food: 20, entity: { position }, entities: {}, inventory: { items: () => items }, blockAt: at };
}

test('stems twelve blocks up are offered as a pillar and a crossing from the top, the blocks needed said against those carried', () => {
  const { climbTo } = require('../src/nether-gather');
  const target = new Vec3(20, 69, 0);
  const enough = climbTo(world(new Vec3(0.5, 57, 0.5), [stack('netherrack', 64)]), target);
  assert(enough, 'offered');
  assert.equal(enough.up, 12);
  assert.match(enough.says, /^pillar straight up 12 blocks \(jump and lay a block under the feet\) at \(\d+, 57, -?\d+\), .*a column clear of lava and water; then straight across at y 69: \d+ cells, \d+ of open air or lava to lay a block over, ending \d+ blocks? across from it\. In all it needs \d+ blocks laid of the 64 carried, \d+ left after\./);
  const few = climbTo(world(new Vec3(0.5, 57, 0.5), [stack('netherrack', 5)]), target);
  assert.match(few.says, /In all it needs \d+ blocks laid \(12 for the pillar, \d+ for the crossing\) and 5 are carried: it cannot be done with what is carried, and stops where they run out, 5 up the pillar\./);
  // Within a jump, or with no block carried: not a climb.
  assert.equal(climbTo(world(new Vec3(0.5, 57, 0.5), [stack('netherrack', 64)]), new Vec3(20, 59, 0)), null);
  assert.equal(climbTo(world(new Vec3(0.5, 57, 0.5), []), target), null);
});

test('while a way on is short of blocks, netherrack is kept from the tidy and is not cheap to the room-making question (25588 left 51 netherrack "pockets full")', () => {
  const bs = require('../src/block-stock');
  const { wantedItems } = require('../src/work');
  const goal = {};
  assert(!wantedItems(goal).has('netherrack'));
  bs.noteBlocksShort(goal, 53, 3, 'the crossing to the crimson stems at (45, 56, 211)');
  assert.equal(bs.blocksShortNow(goal).need, 53);
  assert(wantedItems(goal).has('netherrack'), 'kept while short');
  // The tidy's own surplus leaves what is kept.
  const { surplus } = require('../src/inventory-tidy');
  const bot = { inventory: { items: () => [stack('netherrack', 179)] } };
  assert.deepEqual(surplus(bot, wantedItems(goal)), []);
  assert.deepEqual(surplus(bot, wantedItems({})), [{ name: 'netherrack', count: 51 }]);
  // Ten minutes on, no longer.
  assert.equal(bs.blocksShortNow(goal, Date.now() + 11 * 60000), null);
  // Not short: nothing kept.
  const g2 = {}; bs.noteBlocksShort(g2, 10, 64, 'a leg');
  assert.equal(bs.blocksShortNow(g2), null);
});
