'use strict';
// Note 986: a block gather that failed rests where it failed, not everywhere.
const test = require('node:test');
const assert = require('node:assert');
const { Vec3 } = require('vec3');
const { gatherRests, gatherResting } = require('../src/work');

test('the rest holds near where the gather failed and lifts sixteen blocks off', () => {
  const goal = { kind: 'win' };
  const bot = { entity: { position: new Vec3(-95.5, 36, 59.5) } };
  assert.strictEqual(gatherResting(bot, goal), false);
  gatherRests(bot, goal, 'netherrack sought twice in ten minutes and none gained');
  assert.strictEqual(gatherResting(bot, goal), true);
  bot.entity.position = new Vec3(-88.5, 36, 59.5);
  assert.strictEqual(gatherResting(bot, goal), true, 'seven blocks off: the same rock');
  bot.entity.position = new Vec3(-33.5, 35, 42.5);
  assert.strictEqual(gatherResting(bot, goal), false, 'sixty blocks on: lifted');
  bot.entity.position = new Vec3(-95.5, 36, 59.5);
  assert.strictEqual(gatherResting(bot, goal), false, 'and it stays lifted');
});
