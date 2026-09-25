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

test('under a flock seen from a mine, the bot has not arrived: it goes to the sheep, height and all, and does not forget them', async () => {
  // Trial 70: "back to the sheep" by x and z ended sixty blocks under them, none in reach, and the flock was forgotten.
  const { gatherWool } = require('../src/home-base');
  const bot = { entity: { position: new Vec3(100.5, 12, 5.5) }, game: { dimension: 'overworld' }, entities: {}, registry: require('minecraft-data')('26.1'),
    inventory: { items: () => [], slots: [] }, blockAt: () => null, chat() {} };
  const flock = { x: 100, y: 72, z: 5, count: 3, at: Date.now() - 60000, dimension: 'overworld' };
  const goal = { sightings: { sheep: [flock] }, woolSearch: { since: Date.now(), from: { x: 0, y: 70, z: 0 }, toward: { x: 100, y: 72, z: 5, seen: true } } };
  let went;
  await gatherWool(bot, { check() {} }, goal, () => {}, null, { navigate: async (b, t, g) => { went = g; }, explore: async () => { throw new Error('explored instead'); } });
  assert(went, 'walked on toward the flock');
  assert.equal(went.y, 72, 'to the height the sheep were seen at');
  assert.equal(goal.sightings.sheep.length, 1, 'the flock is not forgotten from underneath it');
});

test('a flock the bot cannot walk to is forgotten, not chosen again at once', async () => {
  // Trial 76: "back to the sheep I saw 85 blocks north" four times a second, and a kick for the chat.
  const { gatherWool } = require('../src/home-base');
  const bot = { entity: { position: new Vec3(0.5, 89, 0.5) }, game: { dimension: 'overworld' }, entities: {}, registry: require('minecraft-data')('26.1'),
    inventory: { items: () => [], slots: [] }, blockAt: () => null, chat() {} };
  const goal = { sightings: { sheep: [{ x: 0, y: 70, z: -85, count: 2, at: Date.now() - 60000, dimension: 'overworld' }] },
    woolSearch: { since: Date.now(), from: { x: 0, y: 89, z: 0 }, toward: { x: 0, y: 70, z: -85, seen: true } } };
  await gatherWool(bot, { check() {} }, goal, () => {}, null, { navigate: async () => { throw new Error('No path to the goal'); }, explore: async () => {} });
  assert.equal(goal.sightings.sheep.length, 0, 'forgotten');
  assert.equal(goal.woolSearch.toward, undefined);
});

test('cows, pigs and chickens are remembered too, counted as known, and a herd not reached is forgotten', async () => {
  // The user: "remember the animals", so the last two cows are known to be the last two.
  const { noteSightings, known, walkToSighting, sighted } = require('../src/sightings');
  const cow = (id, x) => ({ id, name: 'cow', position: new Vec3(x, 64, 0), isValid: true });
  const bot = { entity: { position: new Vec3(0, 64, 0) }, game: { dimension: 'overworld' }, entities: { 1: cow(1, 100), 2: cow(2, 103) } };
  const goal = {};
  noteSightings(bot, goal, Date.now());
  assert.equal(goal.sightings.cow[0].count, 2);
  bot.entities = {}; bot.entity.position = new Vec3(-20, 64, 0);
  assert.deepEqual(known(bot, goal, 'cow'), { inView: 0, rememberedAway: 2, total: 2 });
  const [herd] = sighted(bot, goal, 'cow');
  const reached = await walkToSighting(bot, { check() {} }, goal, () => {}, 'cow', herd, async () => { throw new Error('No path to the goal'); });
  assert.equal(reached, false);
  assert.equal(goal.sightings.cow.length, 0, 'forgotten when it cannot be walked to');
});

test('the food choices offer a herd seen earlier, and a hunt says how many of its kind are known', async () => {
  const { forageChoices } = require('../src/foraging');
  const reg = require('minecraft-data')('26.1');
  const bot = { registry: reg, entity: { position: new Vec3(0, 64, 0) }, game: { dimension: 'overworld' }, entities: {}, time: { timeOfDay: 4000 },
    inventory: { items: () => [] }, blockAt: () => null, findBlocks: () => [], pathfinder: { movements: {} } };
  const goal = { sightings: { cow: [{ x: 90, y: 64, z: 0, count: 3, at: Date.now() - 120000, dimension: 'overworld' }] } };
  const choices = await forageChoices(bot, { check() {} }, goal, () => {}, { navigate: async () => {} }, {});
  assert.match(choices.seen_food_0?.description?.action || '', /3 cow seen 2 minutes ago, 90 blocks east/);
});
