'use strict';
// Note 1065: the forest's fifteen minutes without a pearl are minutes in the
// forest: a watch left while the bot was away begins again.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const warped = require('../src/warped-pearls');
const exploration = require('../src/exploration');
const { isSetAside } = require('../src/progress');

function scene(t, pearls = 0) {
  const items = [{ name: 'ender_pearl', count: pearls }].filter(i => i.count);
  const said = [];
  const bot = { game: { dimension: 'the_nether' }, entity: { position: new Vec3(0.5, 64, 0.5) }, inventory: { items: () => items }, chat: m => said.push(m) };
  const forest = { landmark: { kind: 'warped_forest', x: 4, y: 64, z: 4 }, distance: 6 };
  t.mock.method(exploration, 'knownLandmarks', () => [forest]);
  t.mock.method(exploration, 'goToLandmark', async () => true);
  let hunts = 0;
  const actions = { acquireStep: async () => { hunts++; }, navigate: async () => {} };
  const run = (goal, at) => warped.warpedPearls(bot, { check() {} }, goal, () => {}, actions, { count: 12 }, { now: () => at });
  return { bot, items, said, run, hunts: () => hunts };
}

test('back in the forest after forty minutes away: the watch begins again and the hunt goes on', async t => {
  const t0 = 10_000_000, s = scene(t);
  const goal = { kind: 'win', warpedHunt: { since: t0 - 40 * 60000, best: 0, lastAt: t0 - 35 * 60000 } };
  assert.equal(await s.run(goal, t0), true);
  assert.equal(s.hunts(), 1);
  assert.equal(goal.warpedHunt.since, t0);
  assert(!isSetAside(goal, 'rung', 'warped_pearls', t0));
  assert.deepEqual(s.said, []);
  // A watch kept by an older build (no lastAt) is read the same way.
  const old = { kind: 'win', warpedHunt: { since: t0 - 40 * 60000, best: 3 } };
  assert.equal(await s.run(old, t0), true);
  assert.equal(old.warpedHunt.best, 0, 'the pearls it counted are no longer carried');
});

test('fifteen minutes in the forest, looked at pass after pass, with no pearl: the forest rests as before', async t => {
  const t0 = 20_000_000, s = scene(t);
  const goal = { kind: 'win' };
  for (let at = t0; at <= t0 + 15 * 60000; at += 30000) assert.equal(await s.run(goal, at), true);
  assert.equal(await s.run(goal, t0 + 15 * 60000 + 30000), false);
  assert.match(s.said.join(' '), /No pearls from the warped forest for a while/);
});

test('standing in the forest, the walk to its landmark\'s own point is not made, and the hunt begins (note 1072)', async t => {
  const registry = require('minecraft-data')('26.1');
  const t0 = 30_000_000, s = scene(t);
  s.bot.registry = registry;
  s.bot.blockAt = p => ({ position: p, name: 'warped_nylium', biome: { id: registry.biomesByName.warped_forest.id } });
  let walks = 0;
  exploration.goToLandmark.mock.mockImplementation(async () => { walks++; return null; });
  const goal = { kind: 'win' };
  assert.equal(await s.run(goal, t0), true);
  assert.equal(walks, 0);
  assert.equal(s.hunts(), 1);
  assert.equal(warped.inForest(s.bot), true);
  // Off it, the walk is made as before; one that comes no nearer is no arrival.
  s.bot.blockAt = p => ({ position: p, name: 'netherrack', biome: { id: registry.biomesByName.nether_wastes.id } });
  assert.equal(warped.inForest(s.bot), false);
  assert.equal(await s.run(goal, t0 + 1000), false);
  assert.equal(walks, 1);
});

test('standing in a forest whose walk rests, or one never noted: the hunt is here, not the sweep for another (note 1072)', async t => {
  const registry = require('minecraft-data')('26.1');
  const s = scene(t);
  s.bot.registry = registry;
  s.bot.blockAt = p => ({ position: p, name: 'warped_nylium', biome: { id: registry.biomesByName.warped_forest.id } });
  exploration.knownLandmarks.mock.mockImplementation(() => []);
  const goal = { kind: 'win' };
  assert.equal(await s.run(goal, 40_000_000), true);
  assert.equal(s.hunts(), 1);
  assert.equal(goal.step.action, 'warped_pearls');
  assert.equal(goal.warpedSearch, undefined, 'no sweep begun');
});

test('a walk to a forest 33 blocks off that ran out of its time: the staircase toward it is tried, and ground gained lets the forest\'s rest go (note 1073)', async t => {
  const { attemptsFor } = require('../src/progress');
  const s = scene(t);
  const forest = { landmark: { kind: 'warped_forest', x: -75, y: 69, z: 28, lastWalk: { why: 'navigation timed out without reaching new ground' } }, distance: 33 };
  const goal = { kind: 'win' };
  let open = true;
  exploration.knownLandmarks.mock.mockImplementation(() => open ? [forest] : []);
  // The walk comes no nearer and its trip rests, as goToLandmark leaves it.
  exploration.goToLandmark.mock.mockImplementation(async () => { attemptsFor(goal).fail('landmark_trip', 'warped_forest:-75,28', new Error('came no nearer'), { restMs: 1800000 }); return null; });
  s.bot.blockAt = p => ({ position: p, name: 'netherrack', biome: { id: 0 } });
  s.bot.entity.position = new Vec3(-62.5, 50, 5.5);
  let tunnels = 0;
  const actions = { navigate: async () => {}, acquireStep: async () => {}, tunnel: async b => { tunnels++; b.entity.position = b.entity.position.offset(-4, 6, 6); } };
  const done = await warped.warpedPearls(s.bot, { check() {} }, goal, () => {}, actions, { count: 12 }, { now: () => 50_000_000 });
  assert.equal(done, true);
  assert.equal(tunnels, 1);
  assert.equal(attemptsFor(goal).resting('landmark_trip', 'warped_forest:-75,28', 50_000_000), false, 'the rest let go');
});
