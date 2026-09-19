'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { stairOptions, tunnelStep } = require('../src/tunneling');
const { Task } = require('../src/skills');
const { dig } = require('../src/work');

test('approaching a foundation moves off its top before digging', async () => {
  const target = new Vec3(10, 63, 10);
  let removed = false, routes = 0;
  const bot = { game: { gameMode: 'creative' }, entity: { position: new Vec3(0.5, 64, 0.5), onGround: true },
    inventory: { items: () => [] },
    blockAt: p => ({ position: p, type: p.y === 63 && !(removed && p.equals(target)) ? 1 : 0,
      name: p.y === 63 && !(removed && p.equals(target)) ? 'grass_block' : 'air', boundingBox: p.y === 63 ? 'block' : 'empty', diggable: true, digTime: () => 100 }),
    canDigBlock: b => b.position.distanceTo(bot.entity.position) < 5,
    pathfinder: { setGoal: () => {}, goto: async goal => {
      routes++;
      bot.entity.position = routes === 1 ? target.offset(0.5, 1, 0.5) : new Vec3(goal.x + 0.5, goal.y, goal.z + 0.5);
    } },
    dig: async () => { assert(!target.equals(bot.entity.position.floored().offset(0, -1, 0))); removed = true; },
  };
  await dig(bot, new Task('foundation'), target);
  assert(removed); assert.equal(routes, 2);
});

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
