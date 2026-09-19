'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { approachWorkstation } = require('../src/workstation-access');
const { smelt } = require('../src/work');
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
  assert.deepEqual(goal, saved);
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
