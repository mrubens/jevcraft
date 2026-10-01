'use strict';
// Trial note 806: the route search works out each mob's line of sight to
// the bot once a look, not once a cell, and the answers are the same.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { safeFromHostiles } = require('../src/danger');

test('safeFromHostiles: one raycast a mob a look, whatever the cells asked; the same answers (note 806)', () => {
  let casts = 0;
  const bot = { game: { gameMode: 'survival', difficulty: 'normal' }, entity: { position: new Vec3(0.5, 64, 0.5) },
    world: { raycast: () => { casts++; return { position: new Vec3(3, 65, 0), intersect: new Vec3(3, 65.5, 0.5) }; } } };
  const zombie = { id: 1, name: 'zombie', position: new Vec3(10.5, 64, 0.5), height: 1.95 };
  const cells = [new Vec3(1.5, 64, 0.5), new Vec3(5.5, 64, 0.5), new Vec3(6.5, 64, 0.5), new Vec3(-3.5, 64, 0.5), new Vec3(8.5, 64, 0.5)];
  const plain = cells.map(c => safeFromHostiles(bot, c, [zombie]));
  const before = casts; casts = 0;
  const sight = new Map();
  const kept = cells.map(c => safeFromHostiles(bot, c, [zombie], sight));
  assert.deepEqual(kept, plain);
  assert.equal(casts, 1, `one raycast for the zombie, not ${before} as cells asked`);
  // Out of sight: within six of it is not safe, farther is.
  assert.deepEqual(plain, [true, false, false, true, false]);
});
