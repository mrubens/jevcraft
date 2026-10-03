'use strict';
// Note 1131: from a height with the island's ground under its edge, the way down before the fight is called blocked.
// The rehearsals of 2026-10-03 (23:00 and 23:05Z) ended at their first steps on the End's entry platform, ten blocks over the island.
const test = require('node:test');
const assert = require('node:assert');
const { Vec3 } = require('vec3');
const { dropOffs } = require('../src/end-combat');

// A platform five wide at y 48 round (100, 0); the island's ground at y 38 to its west only; the void elsewhere.
const world = { entity: { position: new Vec3(100.5, 49, 0.5) }, health: 20, inventory: { items: () => [] },
  blockAt: p => { const x = Math.floor(p.x), y = Math.floor(p.y), z = Math.floor(p.z);
    const platform = y === 48 && Math.abs(x - 100) <= 2 && Math.abs(z) <= 2, ground = y <= 38 && y >= 30 && x <= 99;
    return y < 0 ? null : { name: platform ? 'obsidian' : ground ? 'end_stone' : 'air', boundingBox: platform || ground ? 'block' : 'empty' }; } };

test('off the entry platform ten blocks over the island: the west edge, a fall of ten; with 9 health and no water, none; over the void, none (note 1131)', () => {
  const ways = dropOffs(world, { x: 0, z: 0 });
  assert(ways.length >= 1, 'a way down');
  assert.deepEqual([ways[0].edge.x, ways[0].fall], [97, 10]);
  assert(ways.every(w => w.land.x <= 99), 'never over the void to the east');
  assert.equal(dropOffs({ ...world, health: 9 }, { x: 0, z: 0 }).length, 0, 'the fall would leave under eight');
  assert(dropOffs({ ...world, health: 9, inventory: { items: () => [{ name: 'water_bucket', count: 1 }] } }, { x: 0, z: 0 }).length >= 1, 'a bucket breaks it');
});
