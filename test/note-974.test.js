'use strict';
// Note 974: 25590 (mid-242-wb-fortress-6, 2026-10-03 04:00 to 04:15Z) stood
// at the end of its span over the lava sea with two pickaxes and no block.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const shore = require('../src/shore-blocks');

// Rock for x <= 10 (a corridor one wide at z 0, feet y 64), a cobblestone span from x 11 to 30 over the void.
function spanBot({ x = 30, items = [{ name: 'iron_pickaxe', count: 1 }], dimension = 'the_nether' } = {}) {
  const blockAt = p => { const f = p.floored();
    const corridor = f.x <= 10 && f.z === 0 && (f.y === 64 || f.y === 65);
    const name = f.x <= 10 ? (corridor ? 'air' : f.y <= 70 ? 'netherrack' : 'air') : f.y === 63 && f.z === 0 && f.x <= 30 ? 'cobblestone' : 'air';
    return { position: f, name, boundingBox: name === 'air' ? 'empty' : 'block', diggable: true }; };
  const cells = []; for (let i = 3; i <= 30; i++) cells.push([i, 64, 0]);
  return { bot: { game: { dimension }, entity: { position: new Vec3(x + 0.5, 64, 0.5) }, blockAt, inventory: { items: () => items } }, goal: { wayIn: { cells } } };
}

test('at the span\'s end with a pickaxe and no rock about: the nearest cell back along the way in with rock about it', () => {
  const { bot, goal } = spanBot();
  const o = shore.offer(bot, goal);
  assert.ok(o, 'offered');
  assert.deepEqual([o.cell.x, o.cell.y, o.cell.z], [10, 64, 0]);
  assert.equal(o.back, 20);
  assert.match(shore.says(bot, o), /^Go back along the way the bot came to solid rock, 20 cells back at \(10, 64, 0\), dig up to 48 blocks there with the pickaxe carried .* and come back here with them: about \d+ seconds in all\. Here there is no rock to dig/);
});

test('not offered with rock about where it stands, with no pickaxe, or out of the Nether', () => {
  assert.equal(shore.offer(...Object.values(spanBot({ x: 8 }))), null, 'rock about');
  assert.equal(shore.offer(...Object.values(spanBot({ items: [] }))), null, 'no pickaxe');
  assert.equal(shore.offer(...Object.values(spanBot({ dimension: 'overworld' }))), null);
});
