'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { blocksCarried, spanMaterial } = require('../src/bridging');
const { overCaps } = require('../src/inventory-tidy');

// 25598 (mid-242-jc-nether-1, 2026-10-02 20:20 to 21:15Z) carried 83 soul
// sand and no pickaxe; its tunnel home stopped at the first open cell, "no
// blocks carried to lay the tunnel's floor" (note 944).
const pack = items => ({ game: { dimension: 'the_nether' }, inventory: { items: () => items.map(([name, count]) => ({ name, count })) } });

test('soul sand and soil are blocks the span and tunnel lay, after the rock and wart blocks', () => {
  assert.equal(blocksCarried(pack([['soul_sand', 83], ['bone', 3]])), 83);
  assert.equal(spanMaterial(pack([['soul_sand', 83], ['crimson_stem', 4]])).name, 'soul_sand');
  assert.equal(spanMaterial(pack([['soul_sand', 8], ['soul_soil', 8]])).name, 'soul_soil');
  assert.equal(spanMaterial(pack([['soul_sand', 8], ['netherrack', 8]])).name, 'netherrack');
  assert.equal(spanMaterial(pack([['soul_sand', 8], ['warped_wart_block', 8]])).name, 'warped_wart_block');
});

test('the tidy keeps soul sand in the Nether within the building budget, last, and none out of it', () => {
  const nether = overCaps({ soul_sand: 83, netherrack: 40 }, { dimension: 'the_nether' });
  assert.equal(nether.find(d => d.name === 'netherrack'), undefined);
  assert.equal(nether.find(d => d.name === 'soul_sand'), undefined);
  const full = overCaps({ soul_sand: 83, netherrack: 120 }, { dimension: 'the_nether' });
  assert.equal(full.find(d => d.name === 'soul_sand').count, 75);
  assert.equal(full.find(d => d.name === 'netherrack'), undefined);
  const home = overCaps({ soul_sand: 83, soul_soil: 4 }, { dimension: 'overworld' });
  assert.equal(home.find(d => d.name === 'soul_sand').count, 83);
  assert.equal(home.find(d => d.name === 'soul_soil').count, 4);
});
