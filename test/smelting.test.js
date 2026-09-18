'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { smelt } = require('../src/work');
const { Task } = require('../src/skills');

test('smelting observes window output and verifies inventory after closing', { timeout: 1500 }, async () => {
  let closed = false;
  let available = true;
  let collected = false;
  const furnace = {
    outputItem: () => available ? { name: 'iron_ingot', count: 1 } : null,
    takeOutput: async () => { available = false; collected = true; },
    close: () => { closed = true; },
  };
  const bot = {
    entity: { position: new Vec3(0, 64, 0) },
    inventory: { items: () => closed && collected ? [{ name: 'iron_ingot', count: 1 }] : [] },
    registry: { blocksByName: { furnace: { id: 1 } } },
    findBlocks: () => [new Vec3(1, 64, 0)], blockAt: () => ({ name: 'furnace' }),
    pathfinder: { goto: async () => {}, setGoal: () => {} },
    openFurnace: async () => furnace,
  };
  await smelt(bot, new Task('smelt', 'test'), { item: 'iron_ingot', from: 'raw_iron', count: 1 });
  assert(closed && collected);
});
