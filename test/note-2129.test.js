'use strict';
// Note 2129: the last food carried is said as the last on the meal question,
// with what heals after it and the food known; "later" says what the food
// kept is for.
const test = require('node:test');
const assert = require('node:assert');
const { mealWays } = require('../src/meal-ways');
const registry = require('minecraft-data')('26.1');

const bot = (items, { food = 16, health = 20 } = {}) => ({ registry, food, health, foodSaturation: 0, game: { dimension: 'overworld' }, entity: { position: { x: 0, y: 64, z: 0 } }, entities: {},
  inventory: { items: () => items.map(([name, count]) => ({ name, count, type: registry.itemsByName[name].id })), slots: {} } });

test('one porkchop at full health: said as the last food carried, eating back hunger alone', () => {
  const ways = mealWays(bot([['cooked_porkchop', 1]]));
  assert.match(ways.eat_cooked_porkchop.description, /, 4 of its points past 20 lost\. It is the last food carried: eaten, nothing carried heals after it, and health is full now, so it eats back hunger alone; the food known from here: none known\.$/);
  assert.match(ways.eat_later.description, /^(?:This way: .*? health(?: \(more than the bot has\))?\. )?Eat nothing now and go on with the work: asked again when hunger or health falls\. Kept, the 8 food points carried are the meal for a hurt later: health comes back only at hunger 18 or more, and from hunger 16 that takes 2 points eaten first\.$/);
});

test('with more food carried nothing is the last; hurt, the full-health clause goes', () => {
  const ways = mealWays(bot([['cooked_porkchop', 2], ['bread', 1]], { health: 9 }));
  assert.doesNotMatch(ways.eat_cooked_porkchop.description, /last food carried/);
  assert.doesNotMatch(ways.eat_bread.description, /last food carried/);
  const one = mealWays(bot([['bread', 1]], { health: 9, food: 19 }));
  assert.match(one.eat_bread.description, /It is the last food carried: eaten, nothing carried heals after it; the food known from here: none known\.$/);
  assert.match(one.eat_later.description, /Kept, the 5 food points carried are the meal for a hurt later: health comes back only at hunger 18 or more, and from hunger 19 it comes back now\.$/);
});
