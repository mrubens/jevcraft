'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { spanMaterial } = require('../src/bridging');

test('a span is laid from rock while any is carried, and from wool only when none is; planks are kept for the next pickaxe (note 1229)', () => {
  const bot = items => ({ game: { dimension: 'the_nether' }, inventory: { items: () => items } });
  assert.equal(spanMaterial(bot([{ name: 'black_wool', count: 5 }, { name: 'netherrack', count: 2 }])).name, 'netherrack');
  assert.equal(spanMaterial(bot([{ name: 'black_wool', count: 5 }, { name: 'leather', count: 12 }])).name, 'black_wool');
  assert.equal(spanMaterial(bot([{ name: 'spruce_planks', count: 12 }])), undefined);
  assert.equal(spanMaterial(bot([{ name: 'leather', count: 12 }, { name: 'spruce_log', count: 3 }])), undefined);
});
