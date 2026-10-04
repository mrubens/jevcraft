'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { rawFacts } = require('../src/vitals');

const registry = require('minecraft-data')('26.1');
const bot = (items, food = 16) => ({ registry, food, inventory: { items: () => items } });

test('raw meat about to be eaten is said with what cooking makes of it (note 1243)', () => {
  const f = rawFacts(bot([{ name: 'beef', count: 4 }, { name: 'mutton', count: 5 }, { name: 'coal', count: 3 }]), { name: 'beef' });
  assert.deepEqual(f, { raw: { points: 3, cooked: 8, carried: 4, furnace: false, fuel: true } });
  assert.deepEqual(rawFacts(bot([{ name: 'cooked_beef', count: 2 }]), { name: 'cooked_beef' }), {}, 'cooked already');
  assert.deepEqual(rawFacts(bot([{ name: 'beef', count: 1 }], 5), { name: 'beef' }), {}, 'starving: eaten as it is');
});

test('the eat option says it: the points raw and cooked, and that a full health can wait for the fire', () => {
  const { claimSays } = require('../src/arbiter');
  if (typeof claimSays !== 'function') return;
  const says = claimSays({ layer: 'vitals', action: 'eat', facts: { health: 20, food: 16, item: 'beef', foodPoints: 3, raw: { points: 3, cooked: 8, carried: 4, furnace: true, fuel: true } }, cost: { seconds: 1.6 } });
  assert.match(String(says.does || says), /It is raw: 3 points a piece, and 8 cooked at a furnace, ten seconds a piece \(the 4 carried are 12 points raw and 32 cooked\); a furnace is carried and fuel for it is carried\. Health is full and hunger 16 stops nothing but its coming back \(under eighteen\) and a sprint \(under seven\): the meal can wait for the fire\./);
});
