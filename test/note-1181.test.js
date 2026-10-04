'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { says } = require('../src/food-errand');

test('food sought for the hunger says the hour it is sought in, the health that goes with it and what the hunger itself costs (note 1181)', () => {
  const bot = { food: 13, health: 5.28, time: { timeOfDay: 14627 }, inventory: { items: () => [] }, entity: { position: { x: 0, y: 70, z: 0 } } };
  const text = says(bot, { kind: 'win' }, { supply: 0, desired: 64, hungry: true });
  assert.match(text, /This is for the hunger\./);
  assert.match(text, /night at the surface until dawn, about 7 real minutes off; the animals are found in the dark among its mobs/);
  assert.match(text, /Hunger 13 does no harm by itself: it harms only at 0 and stops a sprint at 6\./);
  assert.match(text, /Health 5\.3 of 20 goes on the search as it is and does not come back until the food is found and eaten\./);
  // By day and whole, the hour and the hunger's cost alone.
  const day = says({ ...bot, health: 20, time: { timeOfDay: 2000 } }, { kind: 'win' }, { supply: 0, desired: 64, hungry: true });
  assert.match(day, /day at the surface/);
  assert.doesNotMatch(day, /goes on the search/);
});
