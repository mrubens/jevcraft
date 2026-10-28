'use strict';
// The meal question says the mobs that reach the body in the meal's two seconds (note 2331).
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');

const world = mobs => {
  const bot = { entity: { position: new Vec3(0, 64, 0), eyeHeight: 1.62, metadata: [0] }, health: 11.2, food: 12, oxygenLevel: 20,
    game: { dimension: 'the_nether', difficulty: 'normal', gameMode: 'survival', minY: 0, height: 256 },
    time: { timeOfDay: 6000, age: 100000 }, inventory: { items: () => [], slots: [] }, registry: { entitiesByName: {} },
    blockAt: p => p.y < 64 ? { name: 'netherrack', boundingBox: 'block', position: p } : { name: 'air', boundingBox: 'empty', position: p }, entities: {} };
  mobs.forEach((m, i) => { bot.entities[i + 2] = { id: i + 2, type: 'hostile', height: 1, metadata: [], ...m }; });
  return bot;
};

test('a magma cube at reach: the meal names it, its blow and how many end the bot', () => {
  const { mealThreatSays } = require('../src/vitals');
  const says = mealThreatSays(world([{ name: 'magma_cube', position: new Vec3(1.5, 64, 0) }])).inReachDuringMeal;
  assert.match(says, /^The meal is about two seconds standing still, and these reach the body in it: a magma cube 1\.5 blocks off, at reach now, about 6 a blow through what is worn\. At 11\.2 health 2 such blows end the bot\.$/);
  assert.deepEqual(mealThreatSays(world([])), {});
  assert.deepEqual(mealThreatSays(world([{ name: 'magma_cube', position: new Vec3(30, 64, 0) }])), {}, 'far off: nothing said');
});

test('the same fact for standing still to rest, under its own key (note 2332)', () => {
  const { mealThreatSays } = require('../src/vitals');
  const r = mealThreatSays(world([{ name: 'zombie', position: new Vec3(1, 64, 0) }]), { what: 'Resting here or eating is standing still', key: 'inReachStandingStill' });
  assert.match(r.inReachStandingStill, /^Resting here or eating is standing still, and these reach the body in it: a zombie 1 blocks off, at reach now/);
});
