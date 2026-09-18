'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { explore } = require('../src/work');
const { Task } = require('../src/skills');

test('exploration reaches a distant waypoint through intermediate walks before rotating', async () => {
  const bot = {
    entity: { position: new Vec3(0, 64, 0) },
    registry: { blocksByName: { grass_block: { id: 1 } } },
    blockAt: () => ({ name: 'air' }),
    findBlocks: () => [bot.entity.position.offset(9, -1, 0), bot.entity.position.offset(0, -1, 9)],
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
