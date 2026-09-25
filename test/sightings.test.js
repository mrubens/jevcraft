'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { noteSightings, sighted } = require('../src/sightings');

test('a flock seen in passing is remembered where it was, and said with its distance and direction', () => {
  // Trial 60: fourteen sheep a hundred-odd blocks off, and "none seen yet".
  const sheep = (id, x, z) => ({ id, name: 'sheep', position: new Vec3(x, 70, z), isValid: true });
  const bot = { entity: { position: new Vec3(0, 70, 0) }, game: { dimension: 'overworld' },
    entities: { 1: sheep(1, 100, 5), 2: sheep(2, 104, 8), 3: sheep(3, 98, 2), 4: { id: 4, name: 'cow', position: new Vec3(10, 70, 0) } } };
  const goal = {};
  let t = 1_000_000;
  noteSightings(bot, goal, t);
  assert.equal(goal.sightings.sheep.length, 1, 'three sheep together are one flock');
  assert.equal(goal.sightings.sheep[0].count, 3);
  // Walked on: the flock is out of view, and still remembered.
  bot.entities = {}; bot.entity.position = new Vec3(-60, 70, 0);
  noteSightings(bot, goal, t += 5 * 60000);
  const [flock] = sighted(bot, goal, 'sheep', t);
  assert.equal(flock.count, 3);
  assert.equal(flock.direction, 'east');
  assert.equal(flock.distance, 161);
  assert.match(flock.says, /3 sheep seen 5 minutes ago, 161 blocks east/);
  assert.equal(sighted(bot, goal, 'sheep', t + 31 * 60000).length, 0, 'half an hour is as long as a flock is worth walking back to');
});

test('with no sheep in view, the search offers the flock seen earlier, and Jev\'s pick walks back to it', async () => {
  const { gatherWool } = require('../src/home-base');
  const bot = { entity: { position: new Vec3(-60, 70, 0) }, game: { dimension: 'overworld' }, entities: {}, registry: require('minecraft-data')('26.1'),
    inventory: { items: () => [], slots: [] }, blockAt: () => null, chat() {} };
  const goal = { sightings: { sheep: [{ x: 100, y: 70, z: 5, count: 3, at: Date.now() - 5 * 60000, dimension: 'overworld' }] } };
  let offered;
  const task = { check() {}, opportunityClient: { systemOne: async ({ questions }) => { offered = questions.branch_0.criteria; return { answers: { branch_0: { choice: 'seen_0', confidence: 0.7 } } }; } } };
  await gatherWool(bot, task, goal, () => {}, null, { explore: async () => { throw new Error('explored instead'); } });
  assert.match(offered.seen_0, /3 sheep seen 5 minutes ago, 160 blocks east/);
  assert.deepEqual({ x: goal.woolSearch.toward.x, z: goal.woolSearch.toward.z }, { x: 100, z: 5 });
});
