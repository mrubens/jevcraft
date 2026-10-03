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
