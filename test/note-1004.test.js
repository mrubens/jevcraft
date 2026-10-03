'use strict';
// Note 1004: no sortie from the bunker at a health one landing and a little more would end.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const stand = require('../src/blaze-stand');

test('the sortie\'s floor is a fireball\'s hit through what is worn, its fire and four more; under it none is made', async () => {
  const bot = { health: 10.6, inventory: { slots: { 5: { name: 'iron_helmet' }, 6: { name: 'iron_chestplate' } }, items: () => [] }, entity: { position: new Vec3(0.5, 64, 0.5) }, entities: {} };
  const floor = stand.sortieFloor(bot);
  assert.ok(floor > 11 && floor < 13, `floor ${floor}`);
  assert.equal(await stand.sortie(bot, { check() {} }, {}, () => {}, new Vec3(0, 64, 0)), false, 'nothing about: none');
  assert.ok(stand.sortieFloor({ inventory: { slots: { 5: { name: 'iron_helmet' }, 6: { name: 'iron_chestplate' }, 7: { name: 'iron_leggings' }, 8: { name: 'iron_boots' } } } }) < floor, 'lower in full iron');
});
