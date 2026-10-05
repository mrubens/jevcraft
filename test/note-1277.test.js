'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { strongholdToward } = require('../src/shore');

test('while the stronghold is unfound with its bearings met, a swim out of sight of land goes toward that place (note 1277)', () => {
  const goal = { strongholdSearch: { bearings: [{}, {}], estimate: { x: 1839.4, z: -287.9 } }, gameProgress: { milestones: {} } };
  assert.deepEqual(strongholdToward(goal), { key: 'stronghold', x: 1839, z: -288, biome: 'stronghold' });
  assert.equal(strongholdToward({ ...goal, gameProgress: { milestones: { stronghold_located: { at: 1 } } } }), null, 'found: not');
  assert.equal(strongholdToward({ strongholdSearch: { bearings: [{}], estimate: null } }), null, 'one bearing: not');
});
