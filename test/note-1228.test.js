'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { bareNightSays, BARE_NIGHT } = require('../src/night-record');

test('with next to no armour on, each of the night\'s choices says what it came to in the record; in iron none is said (note 1228)', () => {
  const bare = { inventory: { slots: {}, items: () => [] } };
  const food = bareNightSays(bare, 'obtain_food');
  assert.match(food, /going out for food was followed by a death within five minutes 10 times in 49, within ten 14; beside it, sealing in 10 of 96, staying up at the work 2 of 21, sleeping in a nook dug in the wall 0 of 15, sleeping in a bed set down in the open 3 of 14\./);
  assert.match(bareNightSays(bare, 'sleep_in_nook'), /sleeping in a nook dug in the wall was followed by a death within five minutes 0 times in 15/);
  const iron = { inventory: { slots: { 5: { name: 'iron_helmet' }, 6: { name: 'iron_chestplate' }, 7: { name: 'iron_leggings' }, 8: { name: 'iron_boots' } }, items: () => [] } };
  assert.equal(bareNightSays(iron, 'obtain_food'), '');
  assert.equal(bareNightSays(bare, 'hunt_zombie'), '');
  assert.equal(BARE_NIGHT.by.obtain_food.n, 49);
});
