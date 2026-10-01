'use strict';
// Trial note 823: where the bot filled at a lava is kept, and the next trip
// to that lava walks the stairs dug before, routed without digging.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { noteLavaStand, walkKnownStairs } = require('../src/obsidian');

test('a fill keeps where it stood; the next trip to that lava walks back there first (note 823)', async () => {
  const bot = { game: { dimension: 'overworld' }, entity: { position: new Vec3(365.5, -14, 186.5) }, chat() {} };
  const goal = {};
  noteLavaStand(bot, goal, new Vec3(365, -15, 187));
  assert.equal(goal.lavaStands.length, 1);
  assert.deepEqual(goal.lavaStands[0].lava, { x: 365, y: -15, z: 187 });
  // Back up at the frame, 73 blocks above.
  bot.entity.position = new Vec3(385.5, 58, 170.5);
  const walked = [];
  const navigate = async (b, t, g) => { walked.push({ x: g.x, y: g.y, z: g.z }); b.entity.position = new Vec3(g.x + 0.5, g.y, g.z + 0.5); };
  assert.equal(await walkKnownStairs(bot, { check() {} }, goal, () => {}, { x: 365, y: -15, z: 187 }, navigate), true);
  assert.deepEqual(walked, [{ x: 365, y: -14, z: 186 }]);
  // Another lava: nothing kept for it, nothing walked.
  assert.equal(await walkKnownStairs(bot, { check() {} }, goal, () => {}, { x: 100, y: -15, z: 0 }, navigate), false);
});
