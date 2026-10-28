'use strict';
// The user, 2026-10-24: 'Get rid of my rules if they're not helping ... give jev more agency and better info' (note 2063).
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');

test('on waking, leaving the bed as the respawn or taking it along is offered, each with what it costs', () => {
  const { bedAfterSleepTree } = require('../src/survival');
  const now = Date.parse('2026-10-24T17:00:00Z');
  const bot = { entity: { position: new Vec3(300, 64, 0) }, spawnPoint: new Vec3(0, 64, 0),
    inventory: { items: () => [{ name: 'white_wool', count: 1 }, { name: 'string', count: 5 }] } };
  const tree = bedAfterSleepTree(bot, { deaths: [{ at: '2026-10-24T16:10:00Z' }, { at: '2026-10-24T12:00:00Z' }] }, now);
  // The carried bed first and the leaving last (note 2185), each with what it costs.
  assert.deepEqual(Object.keys(tree), ['leave_as_respawn'], 'the only bed is not carried off (note 2251)');
  assert.match(tree.leave_as_respawn.description, /a death comes back to life here however far the work goes, and the walk back is from here\. The next night needs another bed: 1 wool and 5 string \(four a wool\) carried, three wool a bed\./);
});

test('a bed the pockets make is offered as a second bed to carry, this one left as the respawn (note 2159)', () => {
  const { bedAfterSleepTree } = require('../src/survival');
  const bot = { entity: { position: new Vec3(300, 64, 0) }, spawnPoint: new Vec3(0, 64, 0),
    inventory: { items: () => [{ name: 'white_wool', count: 5 }, { name: 'oak_planks', count: 6 }] } };
  const tree = bedAfterSleepTree(bot, { deaths: [] }, Date.now(), { bedNow: { item: 'white_bed', from: '5 white wool' } });
  assert.deepEqual(Object.keys(tree), ['second_bed', 'leave_as_respawn']);
  assert.match(tree.second_bed.description, /^(?:This way: .*? health(?: \(more than the bot has\))?\. )?Leave this bed standing as the respawn and make another to carry, from what is carried \(5 white wool\), crafts alone/);
  assert.match(tree.second_bed.description, /A bed slept in becomes the respawn/);
  assert.equal(Object.keys(bedAfterSleepTree(bot, { deaths: [] }, Date.now())).length, 1);
});
