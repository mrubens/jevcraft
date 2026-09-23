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

test('remaining burn ticks protect the recipe reserve even before the total-fuel packet arrives', async () => {
  let reads = 0, collected = false;
  const furnace = {
    fuel: null, fuelSeconds: 5, inputItem: () => ({ name: 'sand', count: 1 }), fuelItem: () => null,
    outputItem: () => !collected && ++reads >= 2 ? { name: 'glass', count: 1 } : null,
    putFuel: async () => assert.fail('known remaining burn time must not be replaced'),
    takeOutput: async () => { collected = true; }, close: () => {},
  };
  const bot = {
    entity: { position: new Vec3(0, 64, 0) },
    inventory: { items: () => [{ name: 'oak_planks', count: 3 }, ...(collected ? [{ name: 'glass', count: 1 }] : [])] },
    registry: { itemsByName: { oak_planks: { id: 1 } }, blocksByName: { furnace: { id: 1 } } },
    findBlocks: () => [new Vec3(1, 64, 0)], blockAt: p => ({ name: 'furnace', position: p }),
    world: { raycast: () => ({ position: new Vec3(1, 64, 0) }) },
    pathfinder: { movements: {}, goto: async () => {}, setGoal: () => {} }, openFurnace: async () => furnace,
  };
  await smelt(bot, new Task('burn ticks'), { item: 'glass', from: 'sand', count: 1 });
  assert(collected);
});

test('stop after collecting output or while waiting for fuel status prevents loading more fuel', async () => {
  for (const phase of ['after output', 'awaiting status']) {
    const task = new Task(phase);
    let collected = 0, output = phase === 'after output' ? 1 : 0, closed = false, timer;
    const furnace = {
      fuel: phase === 'awaiting status' ? null : 0,
      inputItem: () => ({ name: 'sand', count: 1 }), fuelItem: () => null,
      outputItem: () => output ? { name: 'glass', count: output } : null,
      takeOutput: async () => { collected = output; output = 0; task.cancel(); },
      putFuel: async () => assert.fail('stop must fence off the next fuel transfer'), close: () => { closed = true; },
    };
    const bot = {
      entity: { position: new Vec3(0, 64, 0) }, inventory: { items: () => [{ name: 'oak_planks', count: 3 }, { name: 'glass', count: collected }] },
      registry: { itemsByName: { oak_planks: { id: 1 } } }, blockAt: p => ({ name: 'furnace', position: p }),
      world: { raycast: () => ({ position: new Vec3(1, 64, 0) }) },
      pathfinder: { movements: {}, goto: async () => {}, setGoal: () => {} }, openFurnace: async () => furnace,
    };
    const goal = { smelting: { item: 'glass', from: 'sand', targetInventory: output + 1, position: { x: 1, y: 64, z: 0 } } };
    if (phase === 'awaiting status') timer = setTimeout(() => task.cancel(), 25);
    try { await assert.rejects(smelt(bot, task, goal.smelting, goal), { name: 'Cancelled' }); }
    finally { clearTimeout(timer); }
    assert(closed); assert(goal.smelting); assert.equal(collected, phase === 'after output' ? 1 : 0);
  }
});

test('selected non-oak fuel survives stop/resume and leaves another wood untouched', async () => {
  const registry = require('minecraft-data')('26.1'), first = new Task('birch fuel'), goal = {};
  let planks = 5, glass = 0, output = 0, loads = 0, saved;
  const furnace = {
    fuel: 0, inputItem: () => output ? null : { name: 'sand', count: 2 }, fuelItem: () => null,
    outputItem: () => output ? { name: 'glass', count: output } : null,
    putFuel: async (type, metadata, count) => {
      assert.equal(type, registry.itemsByName.birch_planks.id); assert.equal(count, 2);
      loads++; planks -= count; output = 2; first.cancel();
    },
    takeOutput: async () => { glass += output; output = 0; }, close: () => {},
  };
  const bot = {
    registry, entity: { position: new Vec3(0, 64, 0) },
    inventory: { items: () => [{ name: 'birch_planks', count: planks }, { name: 'oak_planks', count: 12 }, { name: 'glass', count: glass }] },
    findBlocks: () => [new Vec3(1, 64, 0)], blockAt: p => ({ name: 'furnace', position: p }),
    world: { raycast: () => ({ position: new Vec3(1, 64, 0) }) },
    pathfinder: { movements: {}, goto: async () => {}, setGoal: () => {} }, openFurnace: async () => furnace,
  };
  const step = { item: 'glass', from: 'sand', count: 2, fuelItem: 'birch_planks' };
  await assert.rejects(smelt(bot, first, step, goal, () => { saved = structuredClone(goal); }), { name: 'Cancelled' });
  assert.equal(saved.smelting.fuelItem, 'birch_planks');
  await smelt(bot, new Task('resume birch fuel'), { ...step, fuelItem: 'oak_planks' }, saved);
  assert.equal(glass, 2); assert.equal(planks, 3); assert.equal(loads, 1); assert(!saved.smelting);
  assert.equal(bot.inventory.items().find(i => i.name === 'oak_planks').count, 12);
});

test('a furnace the bot placed is picked back up after the batch when it is travelling', { timeout: 3000 }, async () => {
  let closed = false, available = true, dug = null, furnaceCount = 0;
  const furnace = { outputItem: () => available ? { name: 'cooked_beef', count: 1 } : null, takeOutput: async () => { available = false; }, close: () => { closed = true; } };
  const items = () => [...(closed && !available ? [{ name: 'cooked_beef', count: 1 }] : []), ...(furnaceCount ? [{ name: 'furnace', count: furnaceCount }] : []), { name: 'wooden_pickaxe', count: 1 }];
  const bot = {
    entity: { position: new Vec3(0, 64, 0) }, inventory: { items },
    registry: { blocksByName: { furnace: { id: 1 } }, itemsByName: { wooden_pickaxe: { maxDurability: 59 } } },
    findBlocks: () => [new Vec3(1, 64, 0)], blockAt: p => dug && p.equals(dug) ? { name: 'air', type: 0, position: p, boundingBox: 'empty' }
      : { name: 'furnace', type: 1, position: p, diggable: true, boundingBox: 'block', digTime: () => 20 },
    world: { raycast: () => ({ position: new Vec3(1, 64, 0) }) }, game: { gameMode: 'survival' }, heldItem: null,
    pathfinder: { movements: {}, goto: async () => { if (dug) furnaceCount = 1; }, setGoal: () => {} },
    openFurnace: async () => furnace, dig: async block => { dug = block.position; }, canDigBlock: () => true,
    equip: async () => {}, _ownedWorkstations: new Set(['furnace:(1, 64, 0)']),
  };
  const goal = { preparingExpedition: true };
  await smelt(bot, new Task('smelt', 'test'), { item: 'cooked_beef', from: 'beef', count: 1 }, goal);
  assert(dug && dug.equals(new Vec3(1, 64, 0)), 'the placed furnace was dug up');
  assert.equal(furnaceCount, 1); assert.equal(bot._ownedWorkstations.size, 0);
});

test('a furnace batch planned on planks burns carried coal when no planks are left', async () => {
  const registry = require('minecraft-data')('26.1');
  let coal = 2, output = 0, ingots = 0; const fuelled = [];
  const furnace = {
    fuel: 0, inputItem: () => output ? null : { name: 'raw_iron', count: 3 }, fuelItem: () => null,
    outputItem: () => output ? { name: 'iron_ingot', count: output } : null,
    putFuel: async (type, metadata, count) => { fuelled.push([type, count]); coal -= count; output = 3; },
    takeOutput: async () => { ingots += output; output = 0; }, close: () => {},
  };
  const bot = {
    registry, entity: { position: new Vec3(0, 64, 0) },
    inventory: { items: () => [{ name: 'coal', count: coal }, { name: 'iron_ingot', count: ingots }] },
    findBlocks: () => [new Vec3(1, 64, 0)], blockAt: p => ({ name: 'furnace', position: p }),
    world: { raycast: () => ({ position: new Vec3(1, 64, 0) }) },
    pathfinder: { movements: {}, goto: async () => {}, setGoal: () => {} }, openFurnace: async () => furnace,
  };
  await smelt(bot, new Task('coal fuel'), { item: 'iron_ingot', from: 'raw_iron', count: 3, fuelItem: 'oak_planks' }, {});
  assert.deepEqual(fuelled, [[registry.itemsByName.coal.id, 1]], 'one coal covers three ingots');
  assert.equal(ingots, 3); assert.equal(coal, 1);
});

test('a new batch is only as large as the raw input carried: four planned with one raw gold smelts one', { timeout: 3000 }, async () => {
  let ingots = 0, raw = 1, closed = false, loaded = 0;
  const furnace = {
    outputItem: () => loaded ? { name: 'gold_ingot', count: loaded } : null,
    takeOutput: async () => { ingots += loaded; loaded = 0; },
    inputItem: () => null, fuelItem: () => ({ name: 'coal', count: 1 }), fuel: .5,
    putInput: async (type, meta, count) => { assert.equal(count, 1, 'one raw gold loaded, not four'); raw -= count; loaded += count; },
    putFuel: async () => {}, close: () => { closed = true; },
  };
  const bot = {
    entity: { position: new Vec3(0, 64, 0) },
    inventory: { items: () => [...(raw ? [{ name: 'raw_gold', count: raw }] : []), ...(ingots ? [{ name: 'gold_ingot', count: ingots }] : []), { name: 'coal', count: 8 }] },
    registry: { blocksByName: { furnace: { id: 1 } }, itemsByName: { raw_gold: { id: 5 }, coal: { id: 6 } } },
    findBlocks: () => [new Vec3(1, 64, 0)], blockAt: p => ({ name: 'furnace', position: p }),
    world: { raycast: () => ({ position: new Vec3(1, 64, 0) }) },
    pathfinder: { movements: {}, goto: async () => {}, setGoal: () => {} },
    openFurnace: async () => furnace,
  };
  const goal = {};
  await smelt(bot, new Task('smelt', 'test'), { item: 'gold_ingot', from: 'raw_gold', count: 4, fuelItem: 'coal' }, goal);
  assert(closed);
  assert.equal(ingots, 1);
  assert.equal(goal.smelting, undefined, 'no batch left waiting in the furnace');
});
