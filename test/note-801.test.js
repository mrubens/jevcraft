'use strict';
// Trial note 801: the retreat's scout searches longer with nothing close.
const test = require('node:test');
const assert = require('node:assert/strict');
const { scoutBudget, SCOUT_MS, SCOUT_FAR_MS } = require('../src/survival');
const t = (name, distance) => ({ entity: { name }, distance });

test('the retreat scout: 300 ms with a biter within 4 or a creeper within 7, else 1.2 s (note 801)', () => {
  assert.equal(scoutBudget([t('zombie', 3)]), SCOUT_MS);
  assert.equal(scoutBudget([t('creeper', 6)]), SCOUT_MS);
  assert.equal(scoutBudget([t('zombie', 6), t('skeleton', 3)]), SCOUT_FAR_MS, 'a shooter close is not a biter at reach');
  assert.equal(scoutBudget([t('creeper', 9), t('drowned', 10)]), SCOUT_FAR_MS);
  assert.equal(scoutBudget([]), SCOUT_FAR_MS);
});
