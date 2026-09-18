'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { stairOptions, tunnelStep } = require('../src/tunneling');
const { Task } = require('../src/skills');

function world() {
  const blocks = new Map();
  return { blocks, entity: { position: new Vec3(0.5, 70, 0.5) }, inventory: { items: () => [{ type: 1 }] },
    blockAt: p => blocks.get(`${p}`) || { name: 'stone', position: p, diggable: true, boundingBox: 'block', harvestTools: { 1: true } },
  };
}

test('staircase descends beside the bot without digging beneath its feet', async () => {
  const bot = world(); const dug = [];
  const goal = {};
  await tunnelStep(bot, new Task('test', 'descend'), goal, () => {}, new Vec3(5, 60, 0), {
    dig: async (_bot, _task, p) => { dug.push(p); bot.blocks.set(`${p}`, { name: 'air', boundingBox: 'empty', position: p }); },
    navigate: async (_bot, _task, target) => { bot.entity.position = new Vec3(target.x + 0.5, target.y, target.z + 0.5); },
  });
  assert.equal(bot.entity.position.y, 69);
  assert(dug.length >= 3);
  assert(dug.every(p => p.x !== 0 || p.z !== 0));
  assert.equal(bot.blockAt(new Vec3(1, 68, 0)).name, 'stone');
  assert.equal(goal.tunnel.steps, 1);
});

test('staircase refuses lava, missing footing, and construction foundations', () => {
  const bot = world();
  bot.blocks.set(`${new Vec3(1, 69, 0)}`, { name: 'lava', boundingBox: 'empty' });
  assert(stairOptions(bot, {}, new Vec3(5, 60, 0)).every(c => c.destination.x !== 1));
  assert.equal(stairOptions(bot, { blueprint: { origin: { x: 0, y: 70, z: 0 } } }, new Vec3(5, 60, 0)).length, 0);
  bot.blockAt = p => ({ name: 'air', position: p, boundingBox: 'empty' });
  assert.equal(stairOptions(bot, {}, new Vec3(5, 60, 0)).length, 0);
});
