'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { DAY, dusk, night, dark } = require('../src/day');

test('the clock\'s moments come in order and each predicate means its own one', () => {
  const order = [DAY.DUSK, DAY.WALK_HOME_FAR, DAY.WALK_HOME, DAY.NIGHT, DAY.DARK, DAY.SLEEP_FROM, DAY.DAWN, DAY.SLEEP_UNTIL];
  assert.deepEqual([...order].sort((a, b) => a - b), order);
  const at = timeOfDay => ({ time: { timeOfDay } });
  assert.deepEqual([dusk, night, dark].map(f => f(at(10000))), [true, false, false], 'evening: work stops, not yet night');
  assert.deepEqual([dusk, night, dark].map(f => f(at(11800))), [true, true, false]);
  assert.deepEqual([dusk, night, dark].map(f => f(at(15000))), [true, true, true]);
  assert.deepEqual([dusk, night, dark].map(f => f(at(23500))), [false, false, false], 'morning');
  assert.equal(dusk({}), false, 'no clock, no dusk');
});
