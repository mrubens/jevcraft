'use strict';
// The spare's cost in minutes and this run's re-kit time after deaths (note 2327).
const test = require('node:test');
const assert = require('node:assert/strict');

test('the spare chestplate says its minutes and what a death cost this run', () => {
  const { spareCostSays } = require('../src/strategy');
  assert.match(spareCostSays({ survival: { kitBack: [{ minutes: 31 }] } }, 8, 2, 0), /^ Making it is about 5 to 9 minutes, 6 iron mined and 6 smelted at the fresh runs' pace\. Without one, this run's one kit lost at a death was back on the body after 31 minutes\.$/);
  assert.match(spareCostSays({ survival: { kitBack: [{ minutes: 31 }, { minutes: 50 }, { minutes: 12 }] } }, 8, 8, 0), /^ Making it is a craft from the ingots carried, seconds\. Without one, this run's 3 kits lost at deaths were back on the body after a median 31 minutes\.$/);
  assert.equal(spareCostSays({}, 8, 0, 8).includes('Without one'), false);
});
