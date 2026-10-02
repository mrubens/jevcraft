'use strict';
// Note 905: in the Nether cover and pockets are built with what a ghast's
// blast does not break first.
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildingItem } = require('../src/shelter');

const bot = (dimension, names) => ({ game: { dimension }, inventory: { items: () => names.map(name => ({ name, count: 32 })) } });

test('netherrack first in the pack and cobblestone after: cobblestone in the Nether, the pack\'s order in the Overworld', () => {
  assert.equal(buildingItem(bot('the_nether', ['netherrack', 'dirt', 'cobblestone'])).name, 'cobblestone');
  assert.equal(buildingItem(bot('the_nether', ['netherrack', 'basalt'])).name, 'basalt');
  assert.equal(buildingItem(bot('the_nether', ['netherrack', 'white_wool'])).name, 'netherrack', 'nothing blast-proof: as before');
  assert.equal(buildingItem(bot('overworld', ['netherrack', 'dirt', 'cobblestone'])).name, 'netherrack');
});
