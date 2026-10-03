'use strict';
// Note 991: a meal the health does not come back without is eaten through a
// shot on its way; cut still where the shot landing would end the bot first.
const test = require('node:test');
const assert = require('node:assert/strict');
const { mealThroughShot } = require('../src/shot-reflex');

const bot = (food, health) => ({ food, health, inventory: { slots: { 5: { name: 'iron_helmet' }, 6: { name: 'iron_chestplate' } } }, entity: { metadata: [] } });
const fireball = { name: 'small_fireball' };

test('at hunger under eighteen the meal goes on through a fireball, not at eighteen, and not where its hit would end the bot', () => {
  assert.equal(mealThroughShot(bot(17, 14.9), fireball), true, '25595: hunger 17, health 14.9');
  assert.equal(mealThroughShot(bot(17, 6.6), fireball), true, '25597: hunger 17, health 6.6');
  assert.equal(mealThroughShot(bot(18, 6.6), fireball), false, 'health comes back at eighteen: the shield');
  assert.equal(mealThroughShot(bot(17, 3), fireball), false, 'the hit would end it: the shield');
  assert.equal(mealThroughShot(bot(17, 14), { name: 'fireball' }), false, 'a ghast\'s is never eaten through');
});
