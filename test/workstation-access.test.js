'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { approachWorkstation, reachableWorkstation } = require('../src/workstation-access');
const { smelt, acquireStep } = require('../src/work');
const { Task } = require('../src/skills');

function fixture() {
  const registry = require('minecraft-data')('26.1');
  const Chunk = require('prismarine-chunk')(registry), World = require('prismarine-world')(registry);
  const world = new World(() => new Chunk()).sync;
  for (let x = -1; x <= 1; x++) for (let z = -1; z <= 1; z++) world.setColumn(x, z, new Chunk());
  const set = (p, name) => world.setBlockStateId(p, registry.blocksByName[name].defaultState);
  const p = new Vec3(8, 64, 0);
  set(p, 'furnace'); set(new Vec3(6, 63, 0), 'stone');
  const movements = { canDig: true, allow1by1towers: true, scafoldingBlocks: [1], countScaffoldingItems: () => 12, getScaffoldingItem: () => ({ name: 'dirt' }) };
  const bot = { registry, world, game: { gameMode: 'survival' }, blockAt: p => world.getBlock(p),
    entity: { position: new Vec3(.5, 64, .5), onGround: true }, inventory: { items: () => [] },
    pathfinder: { movements, setGoal: () => {}, goto: async () => { bot.entity.position = new Vec3(6.5, 64, .5); } } };
  return { bot, p, set };
}

test('workstation access finishes incremental searches and restores material reservations', async () => {
  const { bot, p } = fixture(), previous = { ...bot.pathfinder.movements };
  let slices = 0;
  bot.pathfinder.getPathFromTo = function * (movement) {
    assert.equal(movement.canDig, false); assert.equal(movement.countScaffoldingItems(), 0); assert.equal(movement.getScaffoldingItem(), null);
    slices++; yield { result: { status: 'partial' } };
    slices++; yield { result: { status: 'success' } };
  };
  assert((await approachWorkstation(bot, new Task('find furnace'), 'furnace', [p])).position.equals(p));
  assert.equal(slices, 2); assert.deepEqual(bot.pathfinder.movements, previous);
});

test('stop during workstation search prevents opening or travelling and restores movement', async () => {
  const { bot, p } = fixture(), task = new Task('stop finding furnace'), previous = { ...bot.pathfinder.movements };
  bot.pathfinder.goto = async () => assert.fail('must not travel after stop');
  bot.pathfinder.getPathFromTo = function * () {
    yield { result: { status: 'partial' } };
    task.cancel(); yield { result: { status: 'success' } };
  };
  await assert.rejects(approachWorkstation(bot, task, 'furnace', [p]), { name: 'Cancelled' });
  assert.deepEqual(bot.pathfinder.movements, previous);
});

test('a changed workstation is rejected after arriving instead of opening the old block', async () => {
  const { bot, p, set } = fixture();
  bot.pathfinder.getPathTo = () => ({ status: 'success' });
  bot.pathfinder.goto = async () => { set(p, 'stone'); bot.entity.position = new Vec3(6.5, 64, .5); };
  assert.equal(await approachWorkstation(bot, new Task('changed furnace'), 'furnace', [p]), null);
});

test('an inaccessible saved furnace never switches to a different furnace or loses its checkpoint', async () => {
  const { bot, p, set } = fixture(), other = new Vec3(1, 64, 0);
  set(other, 'furnace');
  bot.findBlocks = () => [other];
  bot.pathfinder.getPathTo = () => ({ status: 'noPath' });
  bot.openFurnace = async () => assert.fail('saved ingredients belong to the inaccessible furnace');
  const goal = { smelting: { item: 'glass', from: 'sand', count: 2, targetInventory: 2, position: { ...p } } }, saved = structuredClone(goal);
  await assert.rejects(smelt(bot, new Task('resume furnace'), goal.smelting, goal), { name: 'Blocked', message: "I can't reach the furnace holding our saved batch" });
  const { unreachable, ...kept } = goal.smelting;
  assert.deepEqual({ smelting: kept }, saved); assert.equal(unreachable, 1);
  // Out of reach twice running, the batch is let go rather than retried
  // for good (twice, as a rung that fails twice is left).
  await assert.rejects(smelt(bot, new Task('resume furnace'), goal.smelting, goal), /stayed out of reach/);
  assert.equal(goal.smelting, undefined); assert.equal(goal.lostSmelting.item, 'glass');
});

test('a saved batch whose furnace is empty, with none of its input carried, is let go', async () => {
  const { bot, p } = fixture();
  bot.pathfinder.getPathTo = () => ({ status: 'success' });
  bot.openFurnace = async () => ({ outputItem: () => null, inputItem: () => null, fuelItem: () => null, close: () => {} });
  const goal = { request: 'beat the game', smelting: { item: 'cooked_beef', from: 'beef', fuelItem: 'coal', count: 1, targetInventory: 1, position: { ...p } } };
  await assert.rejects(smelt(bot, new Task('resume furnace'), goal.smelting, goal), /nothing left in the furnace/);
  assert.equal(goal.smelting, undefined); assert.equal(goal.lostSmelting.reason, 'empty');
});

test('a saved furnace outside loaded chunks is approached before being declared missing', async () => {
  const { bot, p } = fixture(), blockAt = bot.blockAt;
  let loaded = false, available = true, held = 0, trips = 0;
  bot.blockAt = position => position.equals(p) && !loaded ? null : blockAt(position);
  bot.inventory.items = () => held ? [{ name: 'glass', count: held }] : [];
  bot.pathfinder.goto = async destination => {
    trips++; assert.equal(destination.x, p.x); loaded = true; bot.entity.position = new Vec3(6.5, 64, .5);
  };
  bot.openFurnace = async block => {
    assert(block.position.equals(p));
    return { outputItem: () => available ? { name: 'glass', count: 1 } : null,
      takeOutput: async () => { available = false; held = 1; }, close: () => {} };
  };
  const goal = { smelting: { item: 'glass', from: 'sand', count: 1, targetInventory: 1, position: { ...p } } };
  await smelt(bot, new Task('return to saved furnace'), goal.smelting, goal);
  assert.equal(trips, 1); assert.equal(held, 1); assert(!goal.smelting);
});

test('recipe planning makes a replacement when all observed stations of the needed kind are inaccessible', async () => {
  for (const [station, target, stock] of [
    ['crafting_table', 'chest', { oak_planks: 12 }],
    ['furnace', 'glass', { oak_planks: 2, cobblestone: 8, sand: 2 }],
  ]) {
    const { bot, p, set } = fixture(), table = new Vec3(1, 64, 0), crafted = [];
    set(p, station);
    if (station === 'furnace') set(table, 'crafting_table');
    bot._catalogObservation = { at: Date.now(), position: { ...bot.entity.position }, nearby: [] };
    bot.inventory = { slots: [], items: () => Object.entries(stock).filter(([, count]) => count)
      .map(([name, count]) => ({ name, count, type: bot.registry.itemsByName[name].id })) };
    bot.findBlocks = ({ matching, count }) => [p, table].filter(q => matching.includes(bot.blockAt(q)?.type)).slice(0, count);
    bot.pathfinder.getPathTo = () => ({ status: 'noPath' });
    bot.pathfinder.goto = async () => assert.fail('do not walk to an unusable station during recipe planning');
    bot.craft = async (recipe, count, usedTable) => {
      const item = bot.registry.items[recipe.result.id].name;
      crafted.push(item); assert.equal(count, 1);
      assert.equal(usedTable?.name || null, station === 'furnace' ? 'crafting_table' : null);
      for (const delta of recipe.delta) { const name = bot.registry.items[delta.id].name; stock[name] = (stock[name] || 0) + delta.count; }
    };
    const goal = {};
    assert.equal(await acquireStep(bot, new Task('replace blocked station'), target, station === 'furnace' ? 2 : 1, goal, () => {}), false);
    assert.deepEqual(crafted, [station]); assert.equal(stock[station], 1); assert.equal(goal.step.item, station);
    assert.equal(stock[target] || 0, 0, 'the original requested output remains unfinished');
  }
});

test('checking a distant usable station does not travel or consume materials during planning', async () => {
  const { bot, p } = fixture(), position = bot.entity.position.clone(), previous = { ...bot.pathfinder.movements };
  bot.pathfinder.getPathFromTo = function * () {
    yield { result: { status: 'partial' } }; yield { result: { status: 'success' } };
  };
  bot.pathfinder.goto = async () => assert.fail('availability is a survey, not a trip');
  assert((await reachableWorkstation(bot, new Task('inspect furnace'), 'furnace', [p])).position.equals(p));
  assert(bot.entity.position.equals(position)); assert.deepEqual(bot.pathfinder.movements, previous);
});

test('stop while planning station access prevents crafting a replacement and restores movement', async () => {
  const { bot, p, set } = fixture(), task = new Task('stop planning'), original = { ...bot.pathfinder.movements };
  set(p, 'crafting_table');
  bot.inventory = { slots: [], items: () => [{ name: 'oak_planks', count: 12, type: bot.registry.itemsByName.oak_planks.id }] };
  bot.findBlocks = ({ matching }) => matching.includes(bot.registry.blocksByName.crafting_table.id) ? [p] : [];
  bot.pathfinder.getPathFromTo = function * () {
    yield { result: { status: 'partial' } }; task.cancel(); yield { result: { status: 'success' } };
  };
  bot.craft = async () => assert.fail('stop must prevent the next recipe');
  const goal = {};
  await assert.rejects(acquireStep(bot, task, 'chest', 1, goal, () => {}), { name: 'Cancelled' });
  assert.equal(goal.step, undefined); assert.deepEqual(bot.pathfinder.movements, original);
});

test('a craft that made nothing is clicked once more before the step fails', async () => {
  const { bot } = fixture(), stock = { oak_planks: 2 };
  let clicks = 0;
  bot.findBlocks = () => [];
  bot._catalogObservation = { at: Date.now(), position: { ...bot.entity.position }, nearby: [] };
  bot.inventory = { slots: [], items: () => Object.entries(stock).filter(([, count]) => count)
    .map(([name, count]) => ({ name, count, type: bot.registry.itemsByName[name].id })) };
  bot.craft = async recipe => {
    // The first click leaves the planks on the cursor and makes nothing.
    if (++clicks === 1) return;
    for (const delta of recipe.delta) { const name = bot.registry.items[delta.id].name; stock[name] = (stock[name] || 0) + delta.count; }
  };
  await acquireStep(bot, new Task('sticks'), 'stick', 4, {}, () => {});
  assert.equal(clicks, 2);
  assert.equal(stock.stick, 4);
});

