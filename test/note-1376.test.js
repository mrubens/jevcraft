'use strict';
const test = require('node:test');
const assert = require('node:assert');
const shelter = require('../src/shelter');

const { Vec3 } = require('vec3');
// The bot at y 35 over a lava sea at y 31, as 25591 stood.
const bot = (dimension, items, lava = true) => ({ game: { dimension }, entity: { position: new Vec3(-124.5, 35, -99.5) },
  blockAt: p => ({ name: lava && p.y <= 31 ? 'lava' : 'air' }), inventory: { items: () => items.map(([name, count]) => ({ name, count })) } });

test('in the Nether over lava nothing that burns is built with, and no oak planks are made for it (note 1376)', () => {
  const nether = bot('the_nether', [['white_wool', 9], ['oak_planks', 8], ['oak_log', 5]]);
  assert.equal(shelter.buildingItem(nether), null);
  assert.equal(shelter.materialStock(nether), 0);
  assert.equal(shelter.plankCraft(nether), null);
  const stems = bot('the_nether', [['white_wool', 9], ['crimson_stem', 2], ['nether_wart_block', 3]]);
  assert.equal(shelter.buildingItem(stems).name, 'nether_wart_block');
  assert.equal(shelter.plankCraft(stems).item, 'crimson_planks');
});

test('in the Nether with no lava within reach, wool still builds', () => {
  assert.equal(shelter.buildingItem(bot('the_nether', [['white_wool', 9]], false)).name, 'white_wool');
});

test('in the Overworld planks and wool still build', () => {
  const ow = bot('overworld', [['white_wool', 9], ['oak_planks', 8]]);
  assert.equal(shelter.buildingItem(ow).name, 'oak_planks');
  assert.equal(shelter.materialStock(ow), 17);
});
