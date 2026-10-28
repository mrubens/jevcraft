'use strict';
// Taking the Nether's food up says its minutes and the stay's legs (note 2322).
const test = require('node:test');
const assert = require('node:assert/strict');

test('15 of 80 points: the 65 short priced in minutes, and the rods and pearls legs said', () => {
  const { takeUpFoodSays } = require('../src/work');
  const bot = { inventory: { items: () => [] } };
  const says = takeUpFoodSays(bot, { gameProgress: {} }, { key: 'food', carried: 15, wants: 80 });
  assert.match(says, /^ The 65 points short are about 11 to 17 minutes of gathering at the fresh runs' pace \(3\.9 to 5\.9 points a minute of hunting and searching\)\./);
  assert.match(says, /the rods, about \d+ minutes and \d+ points, then the pearls, about \d+ minutes and \d+; the portal is the way back for more between them\./);
  assert.equal(takeUpFoodSays(bot, {}, { key: 'food', carried: 80, wants: 80 }), '');
});
