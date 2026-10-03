'use strict';
// Note 1003: buried already, the head in sand, the dig of that sand is not
// refused for burying the body. 25585 had it refused three times and
// suffocated there.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { sim } = require('./support/falling-world');

test('the sand the head is in is dug where the body is already buried; with the head free, a dig that would bury it is still refused', async () => {
  const { digGuardPlugin } = require('../src/skills');
  // Feet at y 56 in open air, the head's cell and the one over it sand.
  const buried = sim({ cells: { '0,56,0': 'air', '0,57,0': 'sand', '0,58,0': 'sand', '0,59,0': 'air' } });
  digGuardPlugin(buried.bot);
  await assert.doesNotReject(buried.bot.dig(buried.bot.blockAt(new Vec3(0, 57, 0))), 'dug: it is the way out');
  // Head free, sandstone over it holding two sand: the dig that lets them down is refused.
  const free = sim({ cells: { '0,56,0': 'air', '0,57,0': 'air', '0,58,0': 'sandstone', '0,59,0': 'sand', '0,60,0': 'sand', '0,61,0': 'air' } });
  digGuardPlugin(free.bot);
  await assert.rejects(free.bot.dig(free.bot.blockAt(new Vec3(0, 58, 0))), /would come down through the body/);
});
