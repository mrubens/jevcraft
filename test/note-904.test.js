'use strict';
// Note 904: in the Nether a span is laid with what a ghast's blast does not
// break first; netherrack after. In the Overworld the order is as before.
const test = require('node:test');
const assert = require('node:assert/strict');
const { spanMaterial } = require('../src/bridging');

const bot = (dimension, names) => ({ game: { dimension }, inventory: { items: () => names.map(name => ({ name, count: 32 })) } });

test('netherrack and cobblestone carried: cobblestone in the Nether, netherrack in the Overworld as before', () => {
  assert.equal(spanMaterial(bot('the_nether', ['netherrack', 'cobblestone'])).name, 'cobblestone');
  assert.equal(spanMaterial(bot('the_nether', ['netherrack', 'basalt', 'dirt'])).name, 'basalt');
  assert.equal(spanMaterial(bot('the_nether', ['netherrack', 'dirt'])).name, 'netherrack', 'none blast-proof carried: netherrack as before');
  assert.equal(spanMaterial(bot('overworld', ['netherrack', 'cobblestone'])).name, 'netherrack');
});
