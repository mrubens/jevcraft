'use strict';
// Note 767b: a lava pool is a fact that stays known with its record, and
// the frame's nearest lava is read from the frame, in three dimensions.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { Task } = require('../src/skills');
const { setAside } = require('../src/progress');
const registry = require('minecraft-data')('26.1');

function poolBot({ at = new Vec3(198.5, 9, -109.5), lava = [] } = {}) {
  const lavaAt = new Set(lava.map(p => `${p.x},${p.y},${p.z}`));
  const bot = {
    registry, game: { gameMode: 'survival', dimension: 'overworld' }, entities: {}, entity: { position: at },
    inventory: { items: () => [{ name: 'bucket', count: 1 }] }, world: { raycast: () => null },
    blockAt: p => { const q = p.floored(), k = `${q.x},${q.y},${q.z}`; return lavaAt.has(k) ? { name: 'lava', position: q, boundingBox: 'empty', getProperties: () => ({ level: 0 }) } : { name: q.y < 9 || q.y > 10 ? 'stone' : 'air', position: q, boundingBox: q.y < 9 || q.y > 10 ? 'block' : 'empty' }; },
    findBlocks: ({ useExtraInfo }) => lava.filter(p => !useExtraInfo || useExtraInfo(bot.blockAt(p))),
  };
  return bot;
}

test('25581: a pool reached with its lava covered is gone to, not forgotten; with none it rests half an hour and is known again with its record', async () => {
  const { arrivedAtPool, poolSpent, lavaRecord, POOL_REST_MS } = require('../src/obsidian');
  // (202, 8, -117): a source under the rock, no open air over it.
  const covered = new Vec3(203, 7, -116);
  const bot = poolBot({ lava: [covered] });
  const l = { kind: 'lava_pool', dimension: 'overworld', x: 202, y: 8, z: -117 };
  const walks = [];
  const navigate = async (b, t, g) => { walks.push([g.x, g.y, g.z]); bot.entity.position = new Vec3(g.x + 2.5, 9, g.z + 0.5); };
  assert.equal(await arrivedAtPool(bot, new Task('lava'), {}, () => {}, l, navigate), false);
  assert.equal(l.spent, undefined, 'not spent: its lava lies covered');
  assert.deepEqual(walks, [[203, 7, -116]], 'gone to, within a bucket\'s reach of it');
  assert.equal(await arrivedAtPool(bot, new Task('lava'), {}, () => {}, l, navigate), false);
  assert.equal(l.spent, undefined);
  // Two tries and none taken: found with no lava to take, for now.
  assert.equal(await arrivedAtPool(bot, new Task('lava'), {}, () => {}, l, navigate), false);
  assert(l.spent && poolSpent(l));
  assert.match(lavaRecord({}, l), /found with no lava to take when last reached, 1 minutes ago \(its 1 lava source lie covered and none was taken in two tries\), passed over for now/);
  // Half an hour on, known again.
  l.spent = new Date(Date.now() - POOL_REST_MS - 1000).toISOString();
  assert.equal(poolSpent(l), false);
  // No lava at all there: rests at once, said why.
  const dry = { kind: 'lava_pool', dimension: 'overworld', x: 202, y: 8, z: -117 };
  assert.equal(await arrivedAtPool(poolBot(), new Task('lava'), {}, () => {}, dry, navigate), false);
  assert.equal(dry.spentWhy, 'no lava source left within sixteen blocks of it');
});

test('lava_way says the known pools it does not offer, each with its record (25581 00:42:17Z: the near pool gone from the question)', async () => {
  const { collectLava } = require('../src/obsidian');
  const items = [{ name: 'bucket', count: 1 }, { name: 'stone_pickaxe', count: 1 }];
  const bot = { registry, game: { gameMode: 'survival', difficulty: 'normal', dimension: 'overworld' }, entities: {},
    entity: { position: new Vec3(200.5, 22, -100.5) }, inventory: { items: () => items }, world: { raycast: () => null },
    blockAt: p => ({ name: p.y < 22 ? 'stone' : 'air', position: p.clone(), boundingBox: p.y < 22 ? 'block' : 'empty' }),
    findBlocks: () => [], pathfinder: { movements: {}, getPathTo: async () => ({ status: 'noPath', path: [] }) }, chat: () => {} };
  const goal = { landmarks: [
    { kind: 'lava_pool', dimension: 'overworld', x: 255, y: 21, z: -8 },
    { kind: 'lava_pool', dimension: 'overworld', x: 57, y: 21, z: -234 },
    { kind: 'lava_pool', dimension: 'overworld', x: 202, y: 8, z: -117, spent: new Date().toISOString(), spentWhy: 'no lava source left within sixteen blocks of it' }] };
  for (const k of ['lava_pool:255,-8', 'lava_pool:57,-234']) setAside(goal, 'landmark_trip', k, 'no nearer', 1800000);
  let state = null;
  const task = new Task('lava');
  task.opportunityClient = { systemOne: async arg => { const { questions } = arg; state = JSON.stringify(arg); return { answers: { branch_0: { choice: 'deep', confidence: 0.7 } } }; } };
  await collectLava(bot, task, { action: 'fill_bucket', item: 'lava_bucket', count: 1 }, goal, () => {}, { navigate: async () => {}, dig: async () => {}, resourceTunnelStep: async () => {} });
  assert(state, 'asked');
  assert.match(state, /\(202, 8, -117\), 22 blocks off: found with no lava to take when last reached, 1 minutes ago \(no lava source left within sixteen blocks of it\), passed over for now/);
});

test('the frame\'s nearest lava is the lava nearest the frame, by its distance in three dimensions (25581: "302 blocks from it")', () => {
  const { nearestLava } = require('../src/work');
  const bot = { registry, game: { dimension: 'overworld' }, entity: { position: new Vec3(200.5, 22, -100.5) }, findBlocks: () => [], blockAt: () => null };
  const goal = { landmarks: [
    { kind: 'lava_pool', dimension: 'overworld', x: 255, y: 43, z: -8 },
    { kind: 'lava_pool', dimension: 'overworld', x: 57, y: 10, z: -234 }] };
  assert.deepEqual(nearestLava(bot, goal).at, { x: 255, y: 43, z: -8 }, 'from the bot');
  const fromFrame = nearestLava(bot, goal, undefined, { x: 50, y: 31, z: -230 });
  assert.deepEqual(fromFrame.at, { x: 57, y: 10, z: -234 });
  assert.equal(fromFrame.distance, 22);
});
