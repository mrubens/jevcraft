'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { advance, Attempts, attemptsFor } = require('../src/progress');

test('progress is a new best, not a step that worked', () => {
  const record = {};
  assert.equal(advance(record, 20), false, 'the first look is a best');
  for (const gap of [21, 20, 19.8, 20.4]) advance(record, gap);
  assert.equal(record.looks, 4, 'pacing is four looks without a new best');
  assert.equal(advance(record, 18), false); assert.equal(record.looks, 0);
  const food = {};
  advance(food, 4, { better: 'higher' }); advance(food, 12, { better: 'higher' });
  assert.equal(food.best, 12);
});

test('one memory of failed attempts, by action and target, with a reason and a rest', () => {
  const state = {};
  const attempts = attemptsFor({ survival: state });
  const ore = new Vec3(8.5, 55, -3.2);
  assert.equal(attempts.resting('night_mine', ore), false);
  attempts.fail('night_mine', ore, new Error('No safe way toward it: lava or water in the way'), { restMs: 60000 });
  assert(attempts.resting('night_mine', new Vec3(8, 55, -4)), 'the same block, however it is written');
  assert.match(attempts.why('night_mine', ore), /water/);
  assert.equal(state.attempts['night_mine:8,55,-4'].count, 1, 'kept with the survival state, which is saved per world');
  attempts.fail('chore', 'stock_stash', 'no path', { restMs: 1000, now: Date.now() - 5000 });
  assert.equal(attempts.resting('chore', 'stock_stash'), false, 'a rest runs out');
  attempts.clear('night_mine', ore);
  assert.equal(attempts.resting('night_mine', ore), false);
  assert(new Attempts({}).entries);
});

test('a strict dig with only water between it and its target says so, instead of stepping sideways', async () => {
  const { tunnelStep, NoSafeWay } = require('../src/tunneling');
  const { Task } = require('../src/skills');
  // Stone all round, and a water cell in every step toward +x.
  const bot = { entity: { position: new Vec3(0.5, 50, 0.5) }, game: { dimension: 'overworld' }, registry: require('minecraft-data')('26.1'),
    inventory: { items: () => [{ name: 'iron_pickaxe', type: 1 }] }, world: { raycast: () => null }, entities: {}, pathfinder: { movements: {} },
    blockAt: p => ({ name: p.x >= 1 && p.y >= 50 ? 'water' : 'stone', boundingBox: p.x >= 1 && p.y >= 50 ? 'empty' : 'block', diggable: true, position: p }) };
  const mine = {};
  await assert.rejects(tunnelStep(bot, new Task('mine'), mine, () => {}, new Vec3(8, 50, 0), { dig: async () => {}, navigate: async () => {}, strict: true }),
    err => err instanceof NoSafeWay && /water/.test(err.message));
  assert(mine.tunnel.lastBlocked, 'and what blocked it is kept on the tunnel');
});
