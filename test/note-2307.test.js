'use strict';
// A lava stand walked to with no fill since is not walked to again (note 2307).
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { noteLavaStand, walkKnownStairs } = require('../src/obsidian');

test('two stands at one lava, neither filled from: each is walked to once, not back and forth', async () => {
  const bot = { game: { dimension: 'overworld' }, entity: { position: new Vec3(137.5, 56, 291.5) }, chat() {} };
  const goal = {}, lava = { x: 140, y: 54, z: 290 };
  noteLavaStand(bot, goal, new Vec3(lava.x, lava.y, lava.z));
  bot.entity.position = new Vec3(143.5, 55, 293.5);
  noteLavaStand(bot, goal, new Vec3(lava.x, lava.y, lava.z));
  assert.equal(goal.lavaStands.length, 2);
  const walked = [];
  const navigate = async (b, t, g) => { walked.push(`${g.x},${g.z}`); b.entity.position = new Vec3(g.x + 0.5, g.y, g.z + 0.5); };
  const go = () => walkKnownStairs(bot, { check() {} }, goal, () => {}, lava, navigate);
  assert.equal(await go(), true, 'to the stand 6 blocks off');
  assert.equal(await go(), true, 'then to the other, once');
  assert.equal(await go(), false, 'both walked to with no fill since: neither again');
  assert.deepEqual(walked, ['137,291', '143,293']);
  // A fill there makes the stand fresh: it is walked to again later.
  noteLavaStand(bot, goal, new Vec3(lava.x, lava.y, lava.z));
  bot.entity.position = new Vec3(150.5, 56, 300.5);
  assert.equal(await go(), true);
});
