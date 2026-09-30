'use strict';
// Note 753d: after note 753c went live (15:59Z, 2026-09-30), the live
// critic's report of 17:14Z, item 3 (25583 mid-244-gh, 25590 mid-239-ce).
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const registry = require('minecraft-data')('26.1');
const { Task } = require('../src/skills');
const { setAside } = require('../src/progress');

function openBot(at) {
  const chat = [];
  const bot = {
    registry, game: { gameMode: 'survival', difficulty: 'normal', dimension: 'overworld' }, entities: {},
    entity: { position: at }, inventory: { items: () => [{ name: 'bucket', count: 1 }] }, world: { raycast: () => null },
    blockAt: p => ({ name: p.y < 20 ? 'stone' : 'air', position: p.clone(), boundingBox: p.y < 20 ? 'block' : 'empty' }),
    findBlocks: () => [], pathfinder: { movements: {}, getPathTo: async () => ({ status: 'noPath', path: [] }) }, chat: m => chat.push(m),
  };
  return { bot, chat };
}

test('a walk to a pool that arrives ends the pass: the rest is read from where the bot now stands, not from where it set out (25583 mid-244-gh 17:08:41-17:09:21Z, note 753d)', async () => {
  const { collectLava, LAVA_DEPTH } = require('../src/obsidian');
  // Set out 118 blocks off and 73 above the pool at (392, 23, -47), as 25583 did.
  const { bot, chat } = openBot(new Vec3(319.5, 96, -102.5));
  // Lava at the pool, seen only from within 48 blocks (poolSurface).
  const lava = new Vec3(392, 23, -47);
  bot.findBlocks = ({ matching, maxDistance, useExtraInfo = () => true }) => matching === registry.blocksByName.lava.id && lava.distanceTo(bot.entity.position) <= maxDistance
    ? [lava].filter(p => useExtraInfo({ name: 'lava', position: p, getProperties: () => ({ level: 0 }) })) : [];
  const inner = bot.blockAt; bot.blockAt = p => p.floored().equals(lava) ? { name: 'lava', position: lava, boundingBox: 'empty', getProperties: () => ({ level: 0 }) } : inner(p);
  const frame = { origin: { x: 316, y: -4, z: -46 }, cast: true, axis: 'x', blocks: [] };
  const goal = { portalFrame: frame, landmarks: [{ kind: 'lava_pool', dimension: 'overworld', x: 392, y: 23, z: -47 }] };
  const dug = [];
  const actions = { navigate: async (b, t, g) => { bot.entity.position = new Vec3(386.5, 22, -46.5); }, dig: async () => {}, resourceTunnelStep: async (b, t, g, s, dest) => { dug.push(dest); } };
  await collectLava(bot, new Task('lava'), { action: 'fill_bucket', item: 'lava_bucket', count: 1 }, goal, () => {}, actions);
  assert.equal(dug.length, 0, `before: dug for the deep lava at ${dug.map(String)}`);
  assert(!chat.some(m => /deep lava/.test(m)), chat.join(' | '));
  assert.equal(goal.lavaFetch.way, 'pool');
});

test('the deep lava is not a heading whose staircase rests from this landing (25590 mid-239-ce 17:16:01-10Z, note 753d)', async () => {
  const { collectLava, LAVA_DEPTH } = require('../src/obsidian');
  const { descentTargets, landingKey } = require('../src/tunneling');
  const { bot } = openBot(new Vec3(223.5, -1, 40.5));
  bot.blockAt = p => ({ name: p.y < -1 ? 'stone' : 'air', position: p.clone(), boundingBox: p.y < -1 ? 'block' : 'empty' });
  const goal = {};
  const feet = bot.entity.position.floored(), first = descentTargets(feet, LAVA_DEPTH);
  for (const t of first.slice(0, 4)) setAside(goal, 'staircase_from', landingKey(feet, t), 'paced the same few cells about (223, -1, 40), 60 blocks from it', 600000);
  const dug = [];
  await collectLava(bot, new Task('lava'), { action: 'fill_bucket', item: 'lava_bucket', count: 1 }, goal, () => {}, { navigate: async () => {}, dig: async () => {}, resourceTunnelStep: async (b, t, g, s, dest) => { dug.push(dest); } });
  assert.equal(dug.length, 1);
  assert(!first.slice(0, 4).some(t => t.equals(dug[0])), `before: a resting heading, ${dug[0]}`);
  assert.equal(dug[0].y, LAVA_DEPTH);
});

test('a stair chosen again after the work was away a while is taken up again, not counted as pacing (25590 17:14:54-17:15:59Z, note 753d)', () => {
  const src = require('fs').readFileSync(require.resolve('../src/tunneling'), 'utf8');
  assert.match(src, /const resumed = tunnel\.lastDest === destKey && now - \(tunnel\.lastStepAt \|\| 0\) > RESUME_MS;/);
  assert.match(src, /if \(!resumed\) \{\n\s+noteProgress\(tunnel, target, bot\.entity\.position\.distanceTo\(target\)\);\n\s+tunnel\.visited\[destKey\]/);
});
