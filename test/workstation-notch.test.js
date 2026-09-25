'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { workstation } = require('../src/work');
const { Task } = require('../src/skills');

// The bottom of a one-block shaft: stone on every side, the bot's own
// column open above it (trial 4, 2026-09-24: "No place for crafting_table"
// six times over).
function shaft() {
  const registry = require('minecraft-data')('26.1');
  const Chunk = require('prismarine-chunk')(registry), World = require('prismarine-world')(registry);
  const world = new World(() => new Chunk()).sync;
  for (let x = -1; x <= 1; x++) for (let z = -1; z <= 1; z++) world.setColumn(x, z, new Chunk());
  const set = (p, name) => world.setBlockStateId(p, registry.blocksByName[name].defaultState);
  for (let x = -4; x <= 4; x++) for (let z = -4; z <= 4; z++) for (let y = 55; y <= 70; y++) set(new Vec3(x, y, z), 'stone');
  for (let y = 64; y <= 70; y++) set(new Vec3(0, y, 0), 'air');
  const table = { name: 'crafting_table', count: 1, type: registry.itemsByName.crafting_table.id };
  const items = [table];
  const bot = { registry, world, game: { gameMode: 'survival' }, blockAt: p => world.getBlock(p), entity: { position: new Vec3(0.5, 64, 0.5), onGround: true, height: 1.8, width: 0.6 },
    inventory: { items: () => items, slots: [] }, heldItem: null, entities: {}, findBlocks: () => [], canDigBlock: () => true,
    equip: async item => { bot.heldItem = item; }, lookAt: async () => {}, setControlState() {}, clearControlStates() {},
    dig: async block => { set(block.position, 'air'); },
    placeBlock: async (reference, face) => { set(reference.position.plus(face), 'crafting_table'); items.length = 0; },
    pathfinder: { movements: {}, setGoal() {}, goto: async () => {}, getPathFromTo: function * () { yield { result: { status: 'success', path: [] } }; } } };
  return { bot, world };
}

test('walled in at the foot of a shaft, the table goes in a notch cut in the wall', async () => {
  const { bot } = shaft();
  const placed = await workstation(bot, new Task('table'), 'crafting_table', {}).catch(err => err);
  const notch = [new Vec3(1, 64, 0), new Vec3(-1, 64, 0), new Vec3(0, 64, 1), new Vec3(0, 64, -1), new Vec3(1, 65, 0), new Vec3(-1, 65, 0), new Vec3(0, 65, 1), new Vec3(0, 65, -1)]
    .find(p => bot.blockAt(p).name === 'crafting_table');
  assert(notch, `a table stands in the wall (${placed?.message || 'placed'})`);
});

test('on snowy plains, where every cell at the feet is a snow layer over grass, the table goes onto the snow', async () => {
  // Trial 40: "No place for crafting_table" forty times in a minute.
  const { bot, world } = shaft();
  const registry = bot.registry;
  const set = (p, name) => world.setBlockStateId(p, registry.blocksByName[name].defaultState);
  for (let x = -4; x <= 4; x++) for (let z = -4; z <= 4; z++) { set(new Vec3(x, 63, z), 'grass_block'); set(new Vec3(x, 64, z), 'snow'); for (let y = 65; y <= 70; y++) set(new Vec3(x, y, z), 'air'); }
  set(new Vec3(0, 64, 0), 'air');
  const placed = await workstation(bot, new Task('table'), 'crafting_table', {}).catch(err => err);
  const at = [...Array(25).keys()].map(i => new Vec3(i % 5 - 2, 64, Math.floor(i / 5) - 2)).find(p => bot.blockAt(p).name === 'crafting_table');
  assert(at, `a table stands where the snow was (${placed?.message || 'placed'})`);
});

test('an open cell beyond the wall is not a place for the table: it goes in a notch the bot can reach', async () => {
  // Trial 68: sealed in a night pocket, the table went into a cave cell two
  // blocks off through the wall, and "I can't reach the crafting table I
  // placed" every three seconds for two minutes.
  const { bot, world } = shaft();
  const set = (p, name) => world.setBlockStateId(p, bot.registry.blocksByName[name].defaultState);
  set(new Vec3(-2, 64, 0), 'air'); set(new Vec3(-2, 65, 0), 'air');
  assert.equal(typeof bot.world.raycast, 'function', 'the fixture world can be seen through');
  await workstation(bot, new Task('table'), 'crafting_table', {}).catch(() => {});
  assert.notEqual(bot.blockAt(new Vec3(-2, 64, 0)).name, 'crafting_table', 'not behind the wall');
  const notch = [new Vec3(1, 64, 0), new Vec3(-1, 64, 0), new Vec3(0, 64, 1), new Vec3(0, 64, -1), new Vec3(1, 65, 0), new Vec3(-1, 65, 0), new Vec3(0, 65, 1), new Vec3(0, 65, -1)]
    .find(p => bot.blockAt(p).name === 'crafting_table');
  assert(notch, 'in the wall beside the bot');
});
