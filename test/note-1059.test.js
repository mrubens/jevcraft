'use strict';
// Note 1059: a creeper met in water. The run from it is priced at a swim for
// its lengths in water, and the way to air is not asked, with breath in
// hand, while a creeper is within its fuse's reach in sight.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const vitals = require('../src/vitals');
const danger = require('../src/danger');
const { timedWay, RUN_PACE, SWIM_PACE, creeperRunSays } = require('../src/creeper-run');

test('a way timed with its first cells in water: those are swum, the rest run', () => {
  const from = new Vec3(0.5, 62, 0.5), path = [1, 2, 3, 4, 5, 6].map(x => new Vec3(x, 62, 0));
  const wet = p => p.x < 4;
  const dry = timedWay(from, path, RUN_PACE), swum = timedWay(from, path, RUN_PACE, wet);
  assert.equal(Math.round(dry.at(-1).t * 100) / 100, Math.round(6 / RUN_PACE * 100) / 100);
  assert.equal(swum.swum, 4);
  assert.equal(Math.round(swum.at(-1).t * 100) / 100, Math.round((4 / SWIM_PACE + 2 / RUN_PACE) * 100) / 100);
});

test('the run\'s creeper sentence says the lengths swum', () => {
  const result = { swum: 5, worst: { creeper: { distance: 5.8, entity: {} }, goesOff: false, lights: null, nearest: 3.4 } };
  assert.match(creeperRunSays(result).says, /its first 5 blocks in water swum at about 2/);
  assert.doesNotMatch(creeperRunSays({ ...result, swum: undefined }).says, /swum/);
});

test('a creeper in sight within eight blocks holds the way to air back while there is breath; farther, unseen, or none, it does not', t => {
  const bot = { oxygenLevel: 19, entity: { position: new Vec3(0.5, 60, 0.5), isInWater: true } };
  const creeper = (d, visible = true) => [{ entity: { id: 9, name: 'creeper', position: new Vec3(0.5 + d, 62, 0.5) }, distance: d, visible }];
  let about = creeper(3.2);
  t.mock.method(danger, 'threats', (b, r) => about.filter(m => m.distance <= r));
  assert.equal(vitals.creeperAtFuse(bot), true);
  about = creeper(9.2); assert.equal(vitals.creeperAtFuse(bot), false);
  about = creeper(3.2, false); assert.equal(vitals.creeperAtFuse(bot), false);
  about = []; assert.equal(vitals.creeperAtFuse(bot), false);
});
