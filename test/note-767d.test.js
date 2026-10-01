'use strict';
// Note 767d: the pool chosen holds for the fetch, a switch is lava_way's
// question, and close lava is dug to its shore.
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

test('25597: the pool chosen holds past a bucket and through a nearer one, and when it fails the switch is asked, not taken', async () => {
  const { collectLava, heldLava } = require('../src/obsidian');
  const bot = lavaBot();
  const far = { kind: 'lava_pool', dimension: 'overworld', x: 120, y: 21, z: 39 }, near = { kind: 'lava_pool', dimension: 'overworld', x: 60, y: 21, z: 39 };
  const goal = { landmarks: [far, near], lavaFetch: { way: 'pool', lava: { x: 120, y: 21, z: 39 }, dest: { x: 120, y: 22, z: 39 }, since: Date.now(), carried: 0, dimension: 'overworld' } };
  // A bucket filled: the fetch's hold ends, the pool stays the one chosen.
  bot.inventory.items = () => [{ name: 'lava_bucket', count: 1 }, { name: 'bucket', count: 1 }, { name: 'stone_pickaxe', count: 1 }];
  assert.equal(heldLava(bot, goal), null);
  assert.deepEqual(goal.lavaChosen.at, { x: 120, y: 21, z: 39 });
  const walks = [];
  const task = new Task('lava');
  const asked = [];
  task.opportunityClient = { systemOne: async ({ questions }) => { asked.push(questions.branch_0.criteria); return { answers: { branch_0: { choice: Object.keys(questions.branch_0.criteria).find(k => /^pool_/.test(k)), confidence: 0.7 } } }; } };
  const actions = { navigate: async (b, t, g) => { walks.push([g.x, g.z]); }, dig: async () => {}, resourceTunnelStep: async () => {} };
  await collectLava(bot, task, step, goal, () => {}, actions);
  assert.deepEqual(walks[0], [120, 39], 'back to the pool chosen, not the nearer one');
  assert.equal(asked.length, 0);
  // Found with no lava to take: asked, with why, the nearer pool on offer.
  far.spent = new Date().toISOString(); far.spentWhy = 'no lava source left within sixteen blocks of it';
  await collectLava(bot, task, step, goal, () => {}, actions);
  assert.equal(asked.length, 1, 'the switch asked');
  assert(Object.values(asked[0]).some(d => /\(60, 21, 39\)/.test(d)));
  assert.match(goal.lavaWayFailed.at(-1).why, /it was found with no lava to take \(no lava source left/);
});

test('a cast beside the pool chosen goes beside the pool chosen in its place when it fails', async () => {
  const { collectLava } = require('../src/obsidian');
  const bot = lavaBot();
  const a = { kind: 'lava_pool', dimension: 'overworld', x: 120, y: 21, z: 39, spent: new Date().toISOString() }, b = { kind: 'lava_pool', dimension: 'overworld', x: 60, y: 21, z: 39 };
  const goal = { landmarks: [a, b], portalMethod: { kind: 'cast', near: { x: 120, y: 21, z: 39 }, activeMs: 0, from: {} } };
  const task = new Task('lava');
  task.opportunityClient = { systemOne: async ({ questions }) => ({ answers: { branch_0: { choice: Object.keys(questions.branch_0.criteria).find(k => /^pool_/.test(k)), confidence: 0.7 } } }) };
  await collectLava(bot, task, step, goal, () => {}, { navigate: async () => {}, dig: async () => {}, resourceTunnelStep: async () => {} });
  assert.deepEqual(goal.portalMethod.near, { x: 60, y: 21, z: 39 });
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
