'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { explore } = require('../src/work');
const { Task } = require('../src/skills');

test('exploration reaches a distant waypoint through intermediate walks before rotating', async () => {
  const registry = require('minecraft-data')('26.1');
  const bot = {
    entity: { position: new Vec3(0, 64, 0) },
    registry,
    blockAt: () => ({ name: 'air' }),
    findBlocks: ({ matching }) => matching.includes(registry.blocksByName.grass_block.id) ? [bot.entity.position.offset(9, -1, 0), bot.entity.position.offset(0, -1, 9)] : [],
    pathfinder: { goto: async g => { bot.entity.position = new Vec3(g.x, g.y, g.z); }, setGoal: () => {} },
  };
  const task = new Task('test', 'search');
  const goal = {};
  await explore(bot, task, goal, () => {}, 'sand');
  assert.equal(goal.search.sand.leg, 0);
  assert.equal(bot.entity.position.x, 9);
  await explore(bot, task, goal, () => {}, 'sand');
  assert.equal(goal.search.sand.leg, 0);
  assert.equal(bot.entity.position.x, 18);
  await explore(bot, task, goal, () => {}, 'sand');
  assert.equal(goal.search.sand.leg, 1);
  assert.equal(bot.entity.position.x, 27);
});
test('an empty path resolving successfully is not accepted as arrival', async () => {
  const { navigate } = require('../src/skills');
  const { goals } = require('mineflayer-pathfinder');
  let stopped = false;
  const bot = { entity: { position: new Vec3(0, 64, 0) }, pathfinder: {
    goto: async () => {}, setGoal: () => { stopped = true; },
  } };
  await assert.rejects(navigate(bot, new Task('test', 'test'), new goals.GoalBlock(10, 64, 0)), /before reaching/);
  assert(stopped);
});

test('navigation stops when stationary, but allows a longer route that makes progress', async () => {
  const { navigate } = require('../src/skills');
  let stopped = false;
  const bot = { entity: { position: new Vec3(0, 64, 0) }, pathfinder: {
    goto: () => new Promise(() => {}), setGoal: () => { stopped = true; },
  } };
  await assert.rejects(navigate(bot, new Task('test', 'stalled'), {}, { timeoutMs: 2000, stallMs: 100 }), /timed out/);
  assert(stopped);
  const motion = setInterval(() => { bot.entity.position.x++; }, 50);
  bot.pathfinder.goto = () => new Promise(resolve => setTimeout(resolve, 450));
  try { await navigate(bot, new Task('test', 'moving'), {}, { timeoutMs: 2000, stallMs: 200 }); }
  finally { clearInterval(motion); }
});

test('navigation has a hard deadline even while moving', async () => {
  const { navigate } = require('../src/skills');
  const bot = { entity: { position: new Vec3(0, 64, 0) }, pathfinder: {
    goto: () => new Promise(() => {}), setGoal: () => {},
  } };
  const motion = setInterval(() => { bot.entity.position.x++; }, 50);
  try {
    await assert.rejects(navigate(bot, new Task('test', 'wandering'), {}, { timeoutMs: 250, stallMs: 200 }), /timed out/);
  } finally { clearInterval(motion); }
});

test('navigation waits to land before the next digging action can start', async () => {
  const { navigate } = require('../src/skills');
  let stopped = false;
  const bot = { entity: { position: new Vec3(0, 64.9, 0), onGround: false }, clearControlStates: () => { stopped = true; },
    pathfinder: { goto: async () => {}, setGoal: () => {} } };
  setTimeout(() => { bot.entity.position.y = 64; bot.entity.onGround = true; }, 80);
  await navigate(bot, new Task('test', 'land'), {});
  assert(stopped);
  assert(bot.entity.onGround);
  assert.equal(bot.entity.position.y, 64);
});

test('navigation interrupts promptly for air even while making progress', async () => {
  const { navigate } = require('../src/skills');
  let stopped = false;
  const bot = { oxygenLevel: 20, entity: { position: new Vec3(0, 60, 0), isInWater: true },
    clearControlStates: () => {}, stopDigging: () => {},
    pathfinder: { goto: () => new Promise(() => {}), setGoal: () => { stopped = true; } } };
  setTimeout(() => { bot.oxygenLevel = 12; bot.entity.position.x += 2; }, 20);
  await assert.rejects(navigate(bot, new Task('test', 'dive'), {}), { name: 'NeedsAir' });
  assert(stopped);
});

test('resource pickup ends a mining approach without excavating the rest of the route', async () => {
  const { navigate } = require('../src/skills');
  const { goals } = require('mineflayer-pathfinder');
  let collected = false;
  let stopped = false;
  const bot = { entity: { position: new Vec3(0, 64, 0), onGround: true },
    clearControlStates: () => {}, stopDigging: () => {},
    pathfinder: { goto: () => new Promise(() => {}), setGoal: () => { stopped = true; } } };
  setTimeout(() => { collected = true; }, 20);
  await navigate(bot, new Task('test', 'mine'), new goals.GoalBlock(20, 30, 0), { stopWhen: () => collected });
  assert(stopped);
  assert.equal(bot.entity.position.y, 64);
});

test('bobbing in place does not indefinitely reset the navigation stall timer', async () => {
  const { navigate } = require('../src/skills');
  const bot = { entity: { position: new Vec3(0, 62, 0), isInWater: true },
    pathfinder: { goto: () => new Promise(() => {}), setGoal: () => {} } };
  const motion = setInterval(() => { bot.entity.position.y = bot.entity.position.y === 62 ? 64 : 62; }, 80);
  const started = Date.now();
  try { await assert.rejects(navigate(bot, new Task('test', 'swim'), {}, { timeoutMs: 2000, stallMs: 300 }), /timed out/); }
  finally { clearInterval(motion); }
  assert(Date.now() - started < 1500);
});
