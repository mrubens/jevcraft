'use strict';
// Note 2595: no way at the spawner walked to from here (it lies behind brick), and the way dug to it is offered.
// full-198 (25588, 2026-10-30 16:22 to 16:36Z), 13 blocks from its cage behind nether bricks, was offered a box 12.7
// blocks off and a slit, answered none_good at 0.67, and held fourteen minutes for no blaze and no rod.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { groundBot } = require('./fixtures/saved-ground');
const es = require('../src/empty-spawner');

// x 0..20, y 60..64, z 0..6: a brick floor at 60; a corridor x 0..5 and a room x 12..19 open at 61 and 62, brick
// between (x 6..11) and round them; the cage at (16, 61, 3).
function room() {
  const rows = [];
  for (let y = 60; y <= 64; y++) for (let z = 0; z <= 6; z++) {
    let row = '';
    for (let x = 0; x <= 20; x++) {
      const open = (y === 61 || y === 62) && z >= 1 && z <= 5 && ((x >= 0 && x <= 5) || (x >= 12 && x <= 19));
      row += open ? 'b' : 'a';
    }
    rows.push(row);
  }
  return { box: { x: [0, 20], y: [60, 64], z: [0, 6] }, palette: ['nether_bricks', 'air', 'spawner'], rows };
}

test('the cage behind brick with no way walked to it: digging a way toward it is offered, said with the blocks in the way', () => {
  const bot = groundBot(room(), { at: new Vec3(2.5, 61, 3.5), health: 20, food: 20, items: [['iron_pickaxe', 1], ['netherrack', 40]], dimension: 'the_nether', indexed: true, mobs: [] });
  bot.changed.set('16,61,3', 'spawner');
  bot._spawnClock = { tries: {}, near: {} };
  const known = { cage: new Vec3(16, 61, 3) };
  const tree = es.lullOptions(bot, { check() {} }, {}, () => {}, { navigate: async () => {}, dig: async () => {} }, known, { cage: known.cage });
  assert.ok(tree.dig_to_spawner, `offered: ${Object.keys(tree)}`);
  assert.match(tree.dig_to_spawner.description, /^Dig a way straight toward the cage, 14 blocks off, to a cell three blocks short of it at this height: about 12 blocks in the way on the line/);
  assert.ok(!tree.box_at_spawner && !tree.stand_by_spawner, 'nothing at the spawner is walked to');
});
