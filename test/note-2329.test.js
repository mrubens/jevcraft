'use strict';
// A deep portal site says the way back down from the bed after a death (note 2329).
const test = require('node:test');
const assert = require('node:assert/strict');

test('a frame 75 below the bed: the way back by hand and with a pickaxe, in minutes', () => {
  const { bedBackSays } = require('../src/work');
  const bot = { game: { dimension: 'overworld' }, _survivalState: { spawnBed: { foot: { x: 100, y: 23, z: 16 } } } };
  assert.match(bedBackSays(bot, { x: 97, y: -52, z: 12 }), /^ The frame would be 75 blocks below the bed slept in and 5 across: a death comes back to life at that bed with nothing, and the way back down to the portal is about 50 minutes dug by hand \(about 40 seconds a stair, full-13 on 2026-10-28\) or about 5 with a pickaxe made first/);
  assert.equal(bedBackSays(bot, { x: 110, y: 20, z: 16 }), '', 'near and level: nothing said');
});
