'use strict';
// Note 767d: the pool chosen holds for the fetch, a switch is lava_way's
// question, and close lava is dug to its shore. Since note 782 the pool
// chosen is the portal plan's, and a switch is the plan's question.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { Task } = require('../src/skills');
const { setAside } = require('../src/progress');
const registry = require('minecraft-data')('26.1');

function lavaBot(items = [{ name: 'bucket', count: 1 }, { name: 'stone_pickaxe', count: 1 }], at = new Vec3(36.5, 22, 39.5)) {
  return { registry, game: { gameMode: 'survival', difficulty: 'normal', dimension: 'overworld' }, entities: {},
    entity: { position: at }, inventory: { items: () => items }, world: { raycast: () => null },
    blockAt: p => ({ name: p.y < 22 ? 'stone' : 'air', position: p.clone(), boundingBox: p.y < 22 ? 'block' : 'empty' }),
    findBlocks: () => [], pathfinder: { movements: {}, getPathTo: async () => ({ status: 'noPath', path: [] }) }, chat: () => {} };
}
const step = { action: 'fill_bucket', item: 'lava_bucket', count: 1 };

test('25597: the plan\'s pool holds past a bucket and through a nearer one, and when it fails the plan is asked again, no other pool taken (note 767d, note 782)', async () => {
  const { collectLava } = require('../src/obsidian');
  const bot = lavaBot();
  const far = { kind: 'lava_pool', dimension: 'overworld', x: 120, y: 21, z: 39 }, near = { kind: 'lava_pool', dimension: 'overworld', x: 60, y: 21, z: 39 };
  const goal = { landmarks: [far, near], portalMethod: { kind: 'cast', key: 'here_pool_0', lava: { way: 'pool', at: { x: 120, y: 21, z: 39 } }, chosenAt: Date.now(), facts: { dimension: 'overworld' } } };
  // A bucket filled: the plan's pool is still the one.
  bot.inventory.items = () => [{ name: 'lava_bucket', count: 1 }, { name: 'bucket', count: 1 }, { name: 'stone_pickaxe', count: 1 }];
  const walks = [];
  const task = new Task('lava');
  const asked = [];
  task.opportunityClient = { systemOne: async ({ questions }) => { asked.push(questions.branch_0.criteria); return { answers: { branch_0: { choice: Object.keys(questions.branch_0.criteria)[0], confidence: 0.7 } } }; } };
  const actions = { navigate: async (b, t, g) => { walks.push([g.x, g.z]); }, dig: async () => {}, resourceTunnelStep: async () => {} };
  await collectLava(bot, task, step, goal, () => {}, actions);
  assert.deepEqual(walks[0], [120, 39], 'to the plan\'s pool, not the nearer one');
  assert.equal(asked.length, 0);
  // Found with no lava to take: the route failed, said, and the nearer pool not walked to here.
  far.spent = new Date().toISOString(); far.spentWhy = 'no lava source left within sixteen blocks of it';
  await collectLava(bot, task, step, goal, () => {}, actions);
  assert.equal(asked.length, 0, 'nothing asked by the fetch');
  assert.equal(walks.length, 1, 'no walk to other lava');
  assert.match(goal.portalMethod.routeFailed.why, /^the pool at \(120, 21, 39\): it was found with no lava to take \(no lava source left/);
});

test('a cast beside the plan\'s pool, the pool failing: the route failed, the frame\'s place not moved unasked (note 782)', async () => {
  const { collectLava } = require('../src/obsidian');
  const bot = lavaBot();
  const a = { kind: 'lava_pool', dimension: 'overworld', x: 120, y: 21, z: 39, spent: new Date().toISOString() }, b = { kind: 'lava_pool', dimension: 'overworld', x: 60, y: 21, z: 39 };
  const goal = { landmarks: [a, b], portalMethod: { kind: 'cast', key: 'beside_pool_0', near: { x: 120, y: 21, z: 39 }, lava: { way: 'pool', at: { x: 120, y: 21, z: 39 } }, chosenAt: Date.now() - 60000, activeMs: 0, from: {}, facts: { dimension: 'overworld' } } };
  await collectLava(bot, new Task('lava'), step, goal, () => {}, { navigate: async () => {}, dig: async () => {}, resourceTunnelStep: async () => {} });
  assert.deepEqual(goal.portalMethod.near, { x: 120, y: 21, z: 39 });
  assert.match(goal.portalMethod.routeFailed.why, /it was found with no lava to take/);
});

test('25595: lava five blocks off below the feet is dug to its shore, a block above it, not to the cell over it', async () => {
  const { collectLava } = require('../src/obsidian');
  const bot = lavaBot(undefined, new Vec3(115.5, 39, 106.5));
  bot.blockAt = p => ({ name: p.y < 39 ? 'stone' : 'air', position: p.clone(), boundingBox: p.y < 39 ? 'block' : 'empty' });
  const pool = { kind: 'lava_pool', dimension: 'overworld', x: 111, y: 38, z: 109 };
  const goal = { landmarks: [pool], lavaFetch: { way: 'dig', lava: { x: 111, y: 38, z: 109 }, dest: { x: 111, y: 39, z: 109 }, since: Date.now(), carried: 0, dimension: 'overworld', pick: { way: 'pool', at: { x: 111, y: 38, z: 109 }, chosenAt: Date.now() - 1000 } } };
  setAside(goal, 'landmark_trip', 'lava_pool:111,109', 'no nearer', 1800000);
  const dug = [];
  await collectLava(bot, new Task('lava'), step, goal, () => {}, { navigate: async () => {}, dig: async () => {}, resourceTunnelStep: async (b, t, g, s, dest) => { dug.push(dest); } });
  assert.equal(dug.length, 1);
  assert.deepEqual([dug[0].x, dug[0].y, dug[0].z], [112, 39, 109]);
});
