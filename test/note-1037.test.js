'use strict';
// Note 1037: where food is weighed for the Nether, the day's deaths an hour
// by the food carried at the time are said, with the bot's own row.
const test = require('node:test');
const assert = require('node:assert/strict');
const ff = require('../src/food-facts');
const registry = require('minecraft-data')('26.1');

const bot = carried => ({ registry, game: { dimension: 'the_nether' }, food: 17, health: 9, inventory: { items: () => Object.entries(carried).map(([name, count]) => ({ name, count })) } });

test('the deaths an hour by food carried, and the row the bot is in', () => {
  const none = ff.byFoodSays(bot({ netherrack: 20 }));
  assert.equal(none, ' In the Nether by the food carried at the time (the trials of 2026-10-03 00:00Z to 10:00Z): none, 6.2 deaths an hour over 2.1 hours (17% of that time at 8 health or under); 1 to 11 points, 3.2 deaths an hour over 2.5 hours; 12 to 39 points, 1.3 deaths an hour over 9 hours; 40 points or more, 0.8 deaths an hour over 55.6 hours. 0 points are carried now: the row "none".');
  assert.match(ff.byFoodSays(bot({ cooked_beef: 2 })), /16 points are carried now: the row "12 to 39 points"\.$/);
  assert.match(ff.byFoodSays(bot({ cooked_beef: 8 })), /64 points are carried now: the row "40 points or more"\.$/);
  assert.match(ff.recordSays(bot({ cooked_beef: 1 })), /In the Nether by the food carried at the time/);
});
