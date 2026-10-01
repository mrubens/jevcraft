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

test('pockets filled while the batch cooks are cleared before the output is taken, junk thrown away from the furnace', { timeout: 3000 }, async () => {
  // Thirty-six slots: raw gold, coal, and thirty-four of junk and keepers,
  // the dirt from the furnace's footing among them.
  // One slot free when the window opens; dirt fills it while the batch cooks.
  // Twenty cobblestone keep the block reserve, so the dirt is spare.
  const pockets = [{ name: 'raw_gold', count: 5 }, { name: 'coal', count: 8 }, { name: 'cobblestone', count: 20 },
    ...Array.from({ length: 32 }, (_, i) => ({ name: `keeper_${i}`, count: 1 }))];
  let loaded = 0, ingots = 0, opens = 0, looked = null;
  const window = () => ({
    // The window's player slots follow the pockets live, as Mineflayer's do.
    get slots() { return [null, null, null, ...pockets.map(p => ({ ...p, stackSize: 64 })), ...Array(Math.max(0, 36 - pockets.length)).fill(null)]; },
    inventoryStart: 3, inventoryEnd: 39,
    outputItem: () => loaded ? { name: 'gold_ingot', count: loaded } : null,
    takeOutput: async () => { assert(pockets.length < 36, 'a slot for the ingots when they are taken'); ingots += loaded; loaded = 0; pockets.push({ name: 'gold_ingot', count: ingots }); },
    inputItem: () => null, fuelItem: () => ({ name: 'coal', count: 1 }), fuel: .5,
    putInput: async (type, meta, count) => { pockets[0].count -= count; loaded += count; pockets.push({ name: 'dirt', count: 3 }); },
    putFuel: async () => {}, close: () => {},
  });
  const bot = {
    entity: { position: new Vec3(0, 64, 0), yaw: 0 },
    inventory: { items: () => pockets, emptySlotCount: () => 36 - pockets.length },
    registry: { blocksByName: { furnace: { id: 1 } }, itemsByName: { raw_gold: { id: 5 }, coal: { id: 6 }, gold_ingot: { id: 7, stackSize: 64 } } },
    findBlocks: () => [new Vec3(1, 64, 0)], blockAt: p => ({ name: 'furnace', position: p }),
    world: { raycast: () => ({ position: new Vec3(1, 64, 0) }) },
    pathfinder: { movements: {}, goto: async () => {}, setGoal: () => {} },
    lookAt: async p => { looked = p; },
    tossStack: async item => { pockets.splice(pockets.indexOf(item), 1); },
    openFurnace: async () => { opens++; return window(); },
  };
  await smelt(bot, new Task('smelt', 'test'), { item: 'gold_ingot', from: 'raw_gold', count: 4, fuelItem: 'coal' }, {});
  assert.equal(ingots, 4);
  assert(!pockets.some(p => p.name === 'dirt'), 'the dirt made the room');
  assert(pockets.some(p => p.name === 'keeper_0') && pockets.some(p => p.name === 'coal'), 'nothing else was dropped');
  assert(opens >= 2, 'the window was closed to make room and opened again');
  assert(looked && looked.x < 0, 'thrown away from the furnace, which is at +x');
});

test('a furnace holding another batch\'s output and input has them taken out, then smelts what was asked', { timeout: 3000 }, async () => {
  let output = { name: 'iron_ingot', count: 3 }, input = { name: 'raw_iron', count: 2 }, taken = [];
  let loaded = 0, cooked = 0;
  const furnace = {
    outputItem: () => output || (loaded ? { name: 'cooked_mutton', count: loaded } : null),
    takeOutput: async () => { if (output) { taken.push(output.name); output = null; } else { cooked += loaded; loaded = 0; } },
    inputItem: () => input, takeInput: async () => { taken.push(input.name); input = null; },
    fuelItem: () => ({ name: 'coal', count: 1 }), fuel: .5,
    putInput: async (type, meta, count) => { loaded += count; }, putFuel: async () => {}, close: () => {},
  };
  const bot = {
    entity: { position: new Vec3(0, 64, 0) },
    inventory: { items: () => [{ name: 'mutton', count: 1 }, { name: 'coal', count: 8 }, ...(cooked ? [{ name: 'cooked_mutton', count: cooked }] : [])] },
    registry: { blocksByName: { furnace: { id: 1 } }, itemsByName: { mutton: { id: 5 }, coal: { id: 6 } } },
    findBlocks: () => [new Vec3(1, 64, 0)], blockAt: p => ({ name: 'furnace', position: p }),
    world: { raycast: () => ({ position: new Vec3(1, 64, 0) }) },
    pathfinder: { movements: {}, goto: async () => {}, setGoal: () => {} },
    openFurnace: async () => furnace,
  };
  await smelt(bot, new Task('smelt', 'test'), { item: 'cooked_mutton', from: 'mutton', count: 1, fuelItem: 'coal' }, {});
  assert.deepEqual(taken, ['iron_ingot', 'raw_iron'], 'the old batch out first');
  assert.equal(cooked, 1);
});

test('a long batch is not stood beside: an ore further off is walked to and dug while it cooks, then the batch is finished', { timeout: 5000 }, async () => {
  const { goals } = require('mineflayer-pathfinder');
  let ingots = 0, raw = 6, loaded = 0, walkedOut = false;
  const walks = [];
  const furnace = {
    // The ingots come only once the bot has been away and back.
    outputItem: () => walkedOut && loaded ? { name: 'iron_ingot', count: loaded } : null,
    takeOutput: async () => { ingots += loaded; loaded = 0; },
    inputItem: () => (loaded && !walkedOut ? { name: 'raw_iron', count: loaded } : null), fuelItem: () => ({ name: 'coal', count: 1 }), fuel: .5,
    putInput: async (type, meta, count) => { raw -= count; loaded += count; },
    putFuel: async () => {}, close: () => {},
  };
  const ore = new Vec3(10, 64, 0), furnaceAt = new Vec3(1, 64, 0);
  const bot = {
    entity: { position: new Vec3(0, 64, 0) }, entities: {},
    inventory: { items: () => [...(raw ? [{ name: 'raw_iron', count: raw }] : []), ...(ingots ? [{ name: 'iron_ingot', count: ingots }] : []), { name: 'coal', count: 8 }], emptySlotCount: () => 20 },
    registry: { blocksByName: { furnace: { id: 1 }, coal_ore: { id: 7 } }, itemsByName: { raw_iron: { id: 5 }, coal: { id: 6 } } },
    findBlocks: ({ matching }) => matching.includes(7) ? [ore] : [furnaceAt],
    blockAt: p => p.equals(ore) ? { name: 'coal_ore', position: p } : { name: 'furnace', position: p },
    world: { raycast: () => ({ position: furnaceAt }) },
    pathfinder: { movements: {}, setGoal: () => {}, goto: async g => { walks.push(g); if (g instanceof goals.GoalGetToBlock) { walkedOut = true; bot.entity.position = new Vec3(9, 64, 0); } else bot.entity.position = new Vec3(0, 64, 0); } },
    openFurnace: async () => furnace,
  };
  const goal = {};
  await smelt(bot, new Task('smelt', 'test'), { item: 'iron_ingot', from: 'raw_iron', count: 6, fuelItem: 'coal' }, goal);
  assert(walks.some(g => g instanceof goals.GoalGetToBlock && g.x === 10), 'walked to the ore');
  assert.equal(ingots, 6);
});

test('while a long batch cooks the bot goes out once, mines on from ore to ore, and comes back once', { timeout: 8000 }, async () => {
  const { goals } = require('mineflayer-pathfinder');
  let ingots = 0, raw = 12, loaded = 0, dug = 0;
  const walks = [], visited = new Set();
  const furnace = {
    // Cooked by the time the bot is back from its outing.
    outputItem: () => walks.includes('GoalNear') && loaded ? { name: 'iron_ingot', count: loaded } : null,
    takeOutput: async () => { ingots += loaded; loaded = 0; },
    inputItem: () => (loaded && !walks.includes('GoalNear') ? { name: 'raw_iron', count: loaded } : null), fuelItem: () => ({ name: 'coal', count: 1 }), fuel: .5,
    putInput: async (type, meta, count) => { raw -= count; loaded += count; }, putFuel: async () => {}, close: () => {},
  };
  const ores = [new Vec3(10, 64, 0), new Vec3(12, 64, 2)], furnaceAt = new Vec3(1, 64, 0);
  const bot = {
    entity: { position: new Vec3(0, 64, 0) }, entities: {},
    inventory: { items: () => [...(raw ? [{ name: 'raw_iron', count: raw }] : []), ...(ingots ? [{ name: 'iron_ingot', count: ingots }] : []), { name: 'coal', count: 8 }], emptySlotCount: () => 20 },
    registry: { blocksByName: { furnace: { id: 1 }, coal_ore: { id: 7 } }, itemsByName: { raw_iron: { id: 5 }, coal: { id: 6 } } },
    findBlocks: ({ matching }) => matching.includes(7) ? ores.filter(o => !visited.has(`${o}`)) : [furnaceAt],
    blockAt: p => ores.some((o, i) => i >= dug && o.equals(p)) ? { name: 'coal_ore', position: p, diggable: true, boundingBox: 'block' } : ores.some(o => o.equals(p)) ? { name: 'air', position: p, boundingBox: 'empty' } : { name: 'furnace', position: p },
    canDigBlock: () => true, dig: async () => { dug++; }, stopDigging() {},
    world: { raycast: () => ({ position: furnaceAt }) },
    pathfinder: { movements: {}, setGoal: () => {}, goto: async g => { walks.push(g.constructor.name); if (g instanceof goals.GoalGetToBlock) { visited.add(`${new Vec3(g.x, g.y, g.z)}`); bot.entity.position = new Vec3(g.x - 1, 64, g.z); } else bot.entity.position = new Vec3(0, 64, 0); } },
    openFurnace: async () => furnace,
  };
  await smelt(bot, new Task('smelt', 'test'), { item: 'iron_ingot', from: 'raw_iron', count: 12, fuelItem: 'coal' }, {});
  assert.equal(ingots, 12);
  const back = walks.filter(w => w === 'GoalNear').length, out = walks.filter(w => w === 'GoalGetToBlock').length;
  assert.equal(out, 2, `both ores in one outing: ${walks}`);
  assert.equal(back, 1, `one walk back to the furnace: ${walks}`);
});

test('a while-cooking choice that runs out is asked again among what is left, not stood out', { timeout: 5000 }, async () => {
  // Trial 55: Jev chose to mine nearby, the ores in walking distance ran out,
  // and the bot stood by its twenty-four iron ninety seconds with stone about.
  const registry = require('minecraft-data')('26.1');
  let loaded = 0, ingots = 0, opens = 0; const asked = [];
  const started = Date.now();
  const furnace = () => ({
    outputItem: () => loaded && Date.now() - started > 800 ? { name: 'iron_ingot', count: loaded } : null,
    takeOutput: async () => { ingots += loaded; loaded = 0; },
    inputItem: () => loaded ? { name: 'raw_iron', count: loaded } : null, fuelItem: () => ({ name: 'coal', count: 1 }), fuel: .5,
    putInput: async (type, meta, count) => { loaded += count; }, putFuel: async () => {}, close: () => {},
  });
  const furnaceAt = new Vec3(1, 64, 0), stone = new Vec3(0, 65, 2), ore = new Vec3(5, 64, 0);
  const bot = {
    registry, entity: { position: new Vec3(0, 64, 0) }, time: { timeOfDay: 4000 }, entities: {},
    inventory: { items: () => [{ name: 'raw_iron', count: 4 - loaded - ingots }, { name: 'coal', count: 4 }, ...(ingots ? [{ name: 'iron_ingot', count: ingots }] : [])].filter(i => i.count), emptySlotCount: () => 20 },
    findBlocks: ({ matching }) => matching.includes(registry.blocksByName.furnace.id) ? [furnaceAt] : matching.includes(registry.blocksByName.stone.id) ? [stone]
      : matching.includes(registry.blocksByName.iron_ore.id) ? [ore] : [],
    blockAt: p => p.equals(furnaceAt) ? { name: 'furnace', position: p } : p.equals(ore) ? { name: 'iron_ore', position: p, diggable: false } : p.equals(stone) ? { name: 'stone', position: p, diggable: false } : { name: 'air', position: p, boundingBox: 'empty' },
    canDigBlock: () => true,
    world: { raycast: () => ({ position: furnaceAt }) },
    pathfinder: { movements: {}, goto: async () => {}, setGoal: () => {} },
    openFurnace: async () => { opens++; return furnace(); },
  };
  const task = new Task('smelt', 'test');
  task.opportunityClient = { systemOne: async ({ questions }) => {
    const offered = Object.keys(questions.branch_0.criteria); asked.push(offered);
    return { answers: { branch_0: { choice: offered.includes('mine_nearby') ? 'mine_nearby' : 'dig_stone', confidence: 0.6 } } };
  } };
  await smelt(bot, task, { item: 'iron_ingot', from: 'raw_iron', count: 4, fuelItem: 'coal' }, {});
  assert.equal(ingots, 4);
  // Asked again once the walk had nothing left, and once more when the
  // stone ran out too: leaving the batch to cook (note 771) is still a way.
  assert.equal(asked.length, 3, 'asked again once the walk had nothing left');
  assert(!asked[1].includes('mine_nearby'), 'the spent choice is not offered again');
  assert.deepEqual(asked[2].filter(k => k !== 'none_good').sort(), ['leave_cooking', 'wait_here']);
  assert(opens >= 2, 'the stone was dug meanwhile (the furnace shut and opened again)');
});

test('while a long batch cooks and there is ore about, the walks go on: no count sends the bot back to stand', { timeout: 8000 }, async () => {
  // Trial 67: twenty-four digs of budget used, back at the furnace with ore about and 97 s of iron to wait for.
  const registry = require('minecraft-data')('26.1');
  let loaded = 0, ingots = 0, walks = 0;
  const started = Date.now();
  const furnace = () => ({
    outputItem: () => loaded && Date.now() - started > 2500 ? { name: 'iron_ingot', count: loaded } : null,
    takeOutput: async () => { ingots += loaded; loaded = 0; },
    inputItem: () => loaded ? { name: 'raw_iron', count: loaded } : null, fuelItem: () => ({ name: 'coal', count: 1 }), fuel: .5,
    putInput: async (type, meta, count) => { loaded += count; }, putFuel: async () => {}, close: () => {},
  });
  const furnaceAt = new Vec3(1, 64, 0);
  let next = 0; const dugOut = new Set();
  const bot = {
    registry, entity: { position: new Vec3(0, 64, 0) }, time: { timeOfDay: 4000 }, entities: {},
    inventory: { items: () => [{ name: 'raw_iron', count: 8 - loaded - ingots }, { name: 'coal', count: 4 }, { name: 'cobblestone', count: 200 }, ...(ingots ? [{ name: 'iron_ingot', count: ingots }] : [])].filter(i => i.count), emptySlotCount: () => 20 },
    findBlocks: ({ matching }) => matching.includes(registry.blocksByName.furnace.id) ? [furnaceAt]
      : matching.includes(registry.blocksByName.iron_ore.id) ? [new Vec3(4 + (next % 6), 64, Math.floor(next / 6))] : [],
    blockAt: p => p.equals(furnaceAt) ? { name: 'furnace', position: p } : { name: 'iron_ore', position: p, diggable: false },
    canDigBlock: () => true, world: { raycast: () => ({ position: furnaceAt }) },
    pathfinder: { movements: {}, goto: async g => {
      if (g.x !== undefined && !(g.x === 1 && g.z === 0)) { walks++; next++; }
      // Each walk gets there, the bot left where it is for the furnace's
      // reach (a walk that ends short is a failed one, and failed walks from
      // one spot are not walked on unasked, note 785).
      g.isEnd = () => true;
    }, setGoal: () => {} },
    openFurnace: async () => furnace(),
  };
  const task = new Task('smelt', 'test');
  task.opportunityClient = { systemOne: async ({ questions }) => ({ answers: { branch_0: { choice: 'mine_nearby', confidence: 0.6 } } }) };
  await smelt(bot, task, { item: 'iron_ingot', from: 'raw_iron', count: 8, fuelItem: 'coal' }, {});
  assert.equal(ingots, 8);
  assert(walks > 24, `walked to ${walks} ores`);
});

test('side furnaces out of reach do not hold up a new batch, and are let go after three tries', { timeout: 5000 }, async () => {
  // mid-87-e: two side furnaces sixty blocks under its pocket, gone back for and not reached on every smelt, 579 times.
  let opened = 0;
  const furnace = { outputItem: () => ({ name: 'iron_ingot', count: 1 }), takeOutput: async () => {}, close: () => {}, inputItem: () => null };
  const bot = {
    entity: { position: new Vec3(0, 64, 0) },
    inventory: { items: () => [{ name: 'iron_ingot', count: opened ? 1 : 0 }].filter(i => i.count) },
    registry: { blocksByName: { furnace: { id: 1 } } },
    game: { dimension: 'overworld' },
    findBlocks: () => [new Vec3(1, 64, 0)], blockAt: p => ({ name: 'furnace', position: p }),
    world: { raycast: () => ({ position: new Vec3(1, 64, 0) }) },
    pathfinder: { movements: {}, setGoal: () => {}, goto: async g => { if (g.y < 10) throw new Error('No path to the goal'); } },
    openFurnace: async () => { opened++; return furnace; },
  };
  const goal = { smeltingSides: [{ position: { x: 0, y: 3, z: -60 }, dimension: 'overworld', item: 'iron_ingot', from: 'raw_iron', count: 11, at: Date.now() }] };
  await smelt(bot, new Task('smelt', 'test'), { item: 'iron_ingot', from: 'raw_iron', count: 1 }, goal).catch(() => {});
  assert(opened >= 1, 'the smelt went on at the furnace in reach');
  for (let i = 0; i < 2; i++) await smelt(bot, new Task('smelt', 'test'), { item: 'iron_ingot', from: 'raw_iron', count: 1 }, goal).catch(() => {});
  assert.equal(goal.smeltingSides.length, 0, 'let go after three failed walks');
});

test('a furnace holding another batch\'s output with the pockets full makes room for it first, not an error (25592, note 754c)', { timeout: 3000 }, async () => {
  // 25592 (mid-237-be, 16:54:21Z): cooked mutton at a furnace holding
  // another batch, 0 free slots; "Furnace contains a different output and
  // there is no room to take it", five times, no question asked.
  // A part stack of cooked mutton carried: room "for cooked mutton" was
  // read as there, and none was made for the iron left in the furnace.
  const pockets = [{ name: 'mutton', count: 2 }, { name: 'coal', count: 8 }, { name: 'cobblestone', count: 40 }, { name: 'cooked_mutton', count: 3 }, { name: 'dirt', count: 30 },
    ...Array.from({ length: 31 }, (_, i) => ({ name: `keeper_${i}`, count: 1 }))];
  let output = { name: 'iron_ingot', count: 3 }, loaded = 0, opens = 0;
  const window = () => ({
    get slots() { return [null, null, null, ...pockets.map(p => ({ ...p, stackSize: 64 })), ...Array(Math.max(0, 36 - pockets.length)).fill(null)]; },
    inventoryStart: 3, inventoryEnd: 39,
    outputItem: () => output || (loaded ? { name: 'cooked_mutton', count: loaded } : null),
    takeOutput: async () => {
      assert(pockets.length < 36, 'a free slot when an output is taken');
      if (output) { pockets.push({ name: output.name, count: output.count }); output = null; } else { pockets.push({ name: 'cooked_mutton', count: loaded }); loaded = 0; }
    },
    inputItem: () => null, fuelItem: () => ({ name: 'coal', count: 1 }), fuel: .5,
    putInput: async (type, meta, count) => { pockets[0].count -= count; if (!pockets[0].count) pockets.shift(); loaded += count; },
    putFuel: async () => {}, close: () => {},
  });
  const bot = {
    entity: { position: new Vec3(0, 64, 0), yaw: 0 },
    inventory: { items: () => pockets, emptySlotCount: () => 36 - pockets.length },
    registry: { blocksByName: { furnace: { id: 1 } }, itemsByName: { mutton: { id: 5 }, coal: { id: 6 }, cooked_mutton: { id: 7, stackSize: 64 }, iron_ingot: { id: 8, stackSize: 64 } } },
    findBlocks: () => [new Vec3(1, 64, 0)], blockAt: p => ({ name: 'furnace', position: p }),
    world: { raycast: () => ({ position: new Vec3(1, 64, 0) }) },
    pathfinder: { movements: {}, goto: async () => {}, setGoal: () => {} },
    lookAt: async () => {}, tossStack: async item => { pockets.splice(pockets.indexOf(item), 1); },
    openFurnace: async () => { opens++; return window(); },
  };
  await smelt(bot, new Task('smelt', 'test'), { item: 'cooked_mutton', from: 'mutton', count: 2, fuelItem: 'coal' }, {});
  assert(pockets.some(p => p.name === 'iron_ingot'), 'the other batch\'s ingots were taken');
  assert(pockets.some(p => p.name === 'cooked_mutton'), 'and the mutton cooked');
  assert(opens >= 1);
  assert(!pockets.some(p => p.name === 'dirt'), 'the dirt made the room');
});
