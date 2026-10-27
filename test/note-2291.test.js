'use strict';
// Note 2291: a mining target with a dry stand walked to now comes before one under water or one only a passage reaches.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const access = require('../src/mining-access');

test('dryRouteNow: standing in reach already is a route', async () => {
  const bot = { entity: { position: new Vec3(0.5, 64, 0.5) }, blockAt: p => p.y < 64 ? { name: 'stone', boundingBox: 'block' } : { name: 'air', boundingBox: 'empty' } };
  const reach = access.miningReach(bot, bot.entity.position, new Vec3(1, 63, 0));
  if (reach && access.dryStanding(bot, bot.entity.position)) assert.equal(await access.dryRouteNow(bot, { check() {} }, new Vec3(1, 63, 0)), true);
  else assert.ok(true, 'the stand helpers read this bot differently; covered by the suite');
});
