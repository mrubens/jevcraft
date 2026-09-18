'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { acquireStep } = require('../src/work');
const { Task } = require('../src/skills');

test('crafting confirms one recipe and returns cursor output and unused grid ingredients', async () => {
  const registry = require('minecraft-data')('26.1');
  const server = { oak_planks: 8 };
  let visible = { ...server }, cursor = null, grid = null;
  const bot = {
    registry, game: { gameMode: 'survival' }, entity: { position: new Vec3(0, 64, 0) },
    _catalogObservation: { at: Date.now(), position: { x: 0, y: 64, z: 0 }, nearby: ['oak_log'] },
    findBlocks: () => [],
    inventory: { inventoryStart: 9, inventoryEnd: 45, slots: [],
      items: () => Object.entries(visible).filter(([, count]) => count).map(([name, count]) => ({ name, count, type: registry.itemsByName[name].id })) },
    _syncWindow: async () => { visible = { ...server }; bot.inventory.selectedItem = cursor; bot.inventory.slots[1] = grid; },
    craft: async (recipe, count) => {
      assert.equal(count, 1);
      assert.equal(recipe.result.count, 4);
      // Reproduce an optimistic local result while the real output remains
      // on the cursor and one unused ingredient remains in the grid.
      server.oak_planks = 5; grid = { name: 'oak_planks', count: 1 }; cursor = { name: 'stick', count: 4 };
      visible = { stick: 16 };
    },
    putSelectedItemRange: async () => { server[cursor.name] = (server[cursor.name] || 0) + cursor.count; cursor = null; },
    putAway: async slot => { assert.equal(slot, 1); server[grid.name] += grid.count; grid = null; },
  };
  assert.equal(await acquireStep(bot, new Task('craft', '16 sticks'), 'stick', 16, {}, () => {}), false);
  assert.deepEqual(visible, { oak_planks: 6, stick: 4 });
  assert.equal(cursor, null); assert.equal(grid, null);
});
