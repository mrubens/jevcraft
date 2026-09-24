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
