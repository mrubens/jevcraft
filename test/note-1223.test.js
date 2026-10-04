'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { find } = require('../src/nether-gather');

test('rock to build with is not taken from over a drop: a span\'s cells are not what is gathered, the ground\'s are (note 1223)', () => {
  const registry = require('minecraft-data')('26.1');
  // A span of netherrack at y 52 from x 0 to 9 over nothing; ground of netherrack at x 10 and on, down to y 40.
  const at = p => (p.y === 52 && p.x >= 0 && p.x < 10 && p.z === 0) || (p.x >= 10 && p.y <= 52 && p.y >= 40);
  const bot = { registry, entity: { position: new Vec3(5.5, 53, 0.5) },
    blockAt: p => { const q = p.floored(); return at(q) ? { name: 'netherrack', boundingBox: 'block', position: q } : { name: 'air', boundingBox: 'empty', position: q }; },
    findBlocks: ({ count }) => [new Vec3(4, 52, 0), new Vec3(6, 52, 0), new Vec3(3, 52, 0), new Vec3(10, 52, 0), new Vec3(11, 52, 0)].slice(0, count) };
  assert.deepEqual(find(bot, ['netherrack'], 32, 2).map(p => p.x), [10, 11]);
  // Stems are taken where they stand, as before.
  assert.equal(find(bot, ['crimson_stem'], 32, 2).length, 2);
});
