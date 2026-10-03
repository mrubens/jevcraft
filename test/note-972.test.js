'use strict';
// Note 972: in the Nether the last three head blocks (cobblestone, cobbled
// deepslate, blackstone) are kept back from the floor for the next pickaxe.
const test = require('node:test');
const assert = require('node:assert/strict');
const { blocksCarried, spanMaterial, headsKept } = require('../src/bridging');
const pack = (dimension, items) => ({ game: { dimension }, inventory: { items: () => items.map(([name, count]) => ({ name, count })) } });

test('the last three head blocks are not laid in the Nether, and not counted as blocks to lay', () => {
  assert.equal(spanMaterial(pack('the_nether', [['cobblestone', 10], ['netherrack', 5]])).name, 'cobblestone');
  assert.equal(blocksCarried(pack('the_nether', [['cobblestone', 10], ['netherrack', 5]])), 12);
  assert.equal(spanMaterial(pack('the_nether', [['cobblestone', 3], ['netherrack', 5]])).name, 'netherrack');
  assert.equal(spanMaterial(pack('the_nether', [['cobblestone', 2], ['blackstone', 1]])), undefined);
  assert.equal(blocksCarried(pack('the_nether', [['cobblestone', 2], ['blackstone', 1]])), 0);
  assert.equal(headsKept(pack('the_nether', [['cobblestone', 2]])), 2);
});

test('in the Overworld every block is laid as before', () => {
  assert.equal(spanMaterial(pack('overworld', [['cobblestone', 3]])).name, 'cobblestone');
  assert.equal(blocksCarried(pack('overworld', [['cobblestone', 3]])), 3);
});
