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
    findBlocks: () => [new Vec3(1, 64, 0)], blockAt: p => ({ name: 'furnace', position: p }),
    world: { raycast: () => ({ position: new Vec3(1, 64, 0) }) },
    pathfinder: { movements: {}, goto: async () => {}, setGoal: () => {} },
    openFurnace: async () => furnace,
  };
  await smelt(bot, new Task('smelt', 'test'), { item: 'iron_ingot', from: 'raw_iron', count: 1 });
  assert(closed && collected);
});

test('interrupted furnace batches resume their remaining output without loading ingredients twice', async () => {
  let held = 0, output = 1, closed = 0, inputs = 0;
  const first = new Task('interrupted smelt');
  let active = first;
  const furnace = {
    outputItem: () => output ? { name: 'iron_ingot', count: output } : null,
    inputItem: () => ({ name: 'raw_iron', count: 1 }), fuelItem: () => ({ name: 'oak_planks', count: 1 }), fuel: .5,
    takeOutput: async () => { held += output; output = 0; if (active === first) first.cancel(); },
    putInput: async () => { inputs++; }, putFuel: async () => assert.fail('already fueled'),
    close: () => { closed++; },
  };
  const goal = { smelting: { item: 'iron_ingot', from: 'raw_iron', count: 2, targetInventory: 2, position: { x: 1, y: 64, z: 0 } } };
  const bot = {
    entity: { position: new Vec3(0, 64, 0) }, inventory: { items: () => held ? [{ name: 'iron_ingot', count: held }] : [] },
    registry: { itemsByName: {} }, blockAt: p => ({ name: 'furnace', position: p }),
    world: { raycast: () => ({ position: new Vec3(1, 64, 0) }) },
    pathfinder: { movements: {}, goto: async () => {}, setGoal: () => {} }, openFurnace: async () => furnace,
  };
  await assert.rejects(smelt(bot, first, goal.smelting, goal), { name: 'Cancelled' });
  assert.equal(goal.smelting.targetInventory, 2); assert.equal(held, 1); assert.equal(closed, 1);
  output = 1; active = new Task('resume');
  await smelt(bot, active, goal.smelting, goal);
  assert.equal(held, 2); assert.equal(inputs, 0); assert.equal(goal.smelting, undefined); assert.equal(closed, 2);
});

test('burning fuel is not replaced from stale player inventory or the next recipe reserve', async () => {
  let reads = 0, collected = false;
  const furnace = {
    slots: Array(39).fill(null), inventoryStart: 3, inventoryEnd: 39,
    fuel: .5, inputItem: () => ({ name: 'sand', count: 2 }), fuelItem: () => ({ name: 'oak_planks', count: 1 }),
    outputItem: () => !collected && ++reads >= 2 ? { name: 'glass', count: 2 } : null,
    putFuel: async () => assert.fail('burning fuel plus the remaining stack already covers this batch'),
    takeOutput: async () => { collected = true; }, close: () => {},
  };
  const bot = {
    entity: { position: new Vec3(0, 64, 0) },
    inventory: { items: () => [{ name: 'oak_planks', count: 3 }, ...(collected ? [{ name: 'glass', count: 2 }] : [])] },
    registry: { itemsByName: {}, blocksByName: { furnace: { id: 1 } } },
    findBlocks: () => [new Vec3(1, 64, 0)], blockAt: p => ({ name: 'furnace', position: p }),
    world: { raycast: () => ({ position: new Vec3(1, 64, 0) }) },
    pathfinder: { movements: {}, goto: async () => {}, setGoal: () => {} }, openFurnace: async () => furnace,
  };
  await smelt(bot, new Task('fuel reserve'), { item: 'glass', from: 'sand', count: 2 });
  assert(collected);
});
