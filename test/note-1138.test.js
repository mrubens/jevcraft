'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { pearlRoutes, overworldHourSays } = require('../src/pearl-routes');

const bot = (dimension, timeOfDay, entities = {}) => ({ game: { dimension }, time: { timeOfDay }, entity: { position: new Vec3(-94, 66, 17) }, entities,
  inventory: { items: () => [{ name: 'ender_pearl', count: 1 }] } });
const goalOf = () => ({ kind: 'win', gameProgress: { milestones: {} }, portals: [{ dimension: 'the_nether', x: -60, y: 71, z: 30 }, { dimension: 'overworld', x: -480, y: 64, z: 240 }],
  rodStashes: [{ dimension: 'overworld', position: { x: 0, y: 64, z: 0 }, contents: { ender_pearl: 7, blaze_rod: 9 } }] });

test('the way back to the Overworld for pearls says its hour, the endermen here and what changing the route has come to (note 1138)', async () => {
  const now = Date.parse('2026-10-03T23:53:00Z'), goal = goalOf();
  const endermen = { 1: { name: 'enderman', position: new Vec3(-90, 59, 21) }, 2: { name: 'enderman', position: new Vec3(-83, 58, 17) } };
  const b = bot('the_nether', 1000, endermen);
  const first = pearlRoutes(b, goal, { now: now - 15 * 60000 }).options.pearls_overworld;
  assert.match(first.description, /It is day in the Overworld now, about 10 minutes until dark: endermen spawn on the surface only in the dark/);
  assert.match(first.description, /Here, 2 endermen are within forty-eight blocks now\./);
  assert.doesNotMatch(first.description, /route was changed/);
  await first.run();
  assert.equal(goal.pearlRoute.pick, 'overworld');
  const back = pearlRoutes(bot('overworld', 1000), goal, { now: now - 13 * 60000 }).options.pearls_nether;
  assert.match(back.description, /In the last hour the pearls' route was changed 1 time \(to the Overworld 1\), the first 2 minutes ago: no pearl gained since, 8 held now\./);
  await back.run();
  assert.equal(goal.pearlRoute, undefined);
  const again = pearlRoutes(b, goal, { now }).options.pearls_overworld;
  assert.match(again.description, /In the last hour the pearls' route was changed 2 times \(to the Overworld 1, back to the Nether 1\), the first 15 minutes ago: no pearl gained since, 8 held now\./);
});

test('the Overworld\'s night is said as night, with the dark left', () => {
  assert.match(overworldHourSays({ time: { timeOfDay: 17000 } }), /It is night in the Overworld now, about 5 minutes of dark left\./);
  assert.equal(overworldHourSays({ time: {} }), '');
});
