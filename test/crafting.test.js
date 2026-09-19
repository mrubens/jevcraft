'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { acquireStep } = require('../src/work');
const { Task } = require('../src/skills');

test('batch crafting confirms every recipe and returns cursor output and unused grid ingredients', async () => {
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
      assert(server.oak_planks >= 2);
      const extra = server.oak_planks > 2 ? 1 : 0;
      server.oak_planks -= 2 + extra; grid = extra ? { name: 'oak_planks', count: extra } : null; cursor = { name: 'stick', count: 4 };
      visible = { stick: 16 };
    },
    putSelectedItemRange: async () => { server[cursor.name] = (server[cursor.name] || 0) + cursor.count; cursor = null; },
    putAway: async slot => { assert.equal(slot, 1); server[grid.name] += grid.count; grid = null; },
  };
  assert.equal(await acquireStep(bot, new Task('craft', '16 sticks'), 'stick', 16, {}, () => {}), false);
  assert.deepEqual(visible, { oak_planks: 0, stick: 16 });
  assert.equal(cursor, null); assert.equal(grid, null);
});

test('requesting a workstation produces a carried item even when that station exists nearby', async () => {
  const registry = require('minecraft-data')('26.1');
  for (const target of ['crafting_table', 'furnace']) {
    const stock = { oak_planks: 4, cobblestone: 8 };
    let crafted = 0;
    const stations = { crafting_table: new Vec3(1, 64, 0), furnace: new Vec3(0, 64, 1) };
    const bot = {
      registry, game: { gameMode: 'survival' }, entity: { position: new Vec3(0.5, 64, 0.5), onGround: true },
      _catalogObservation: { at: Date.now(), position: { x: 0.5, y: 64, z: 0.5 }, nearby: [] },
      findBlocks: ({ matching }) => Object.entries(stations).filter(([name]) => matching.includes(registry.blocksByName[name].id)).map(([, p]) => p),
      blockAt: p => ({ name: Object.keys(stations).find(name => stations[name].equals(p)), position: p }),
      pathfinder: { goto: async goal => assert(goal.isEnd(bot.entity.position.floored())), setGoal: () => {} },
      inventory: { slots: [], items: () => Object.entries(stock).filter(([, count]) => count).map(([name, count]) => ({ name, count, type: registry.itemsByName[name].id })) },
      craft: async (recipe, count, table) => {
        crafted++;
        assert.equal(recipe.result.id, registry.itemsByName[target].id);
        assert.equal(count, 1);
        assert.equal(table?.name || null, target === 'furnace' ? 'crafting_table' : null);
        for (const delta of recipe.delta) {
          const name = registry.items[delta.id].name;
          stock[name] = (stock[name] || 0) + delta.count;
        }
      },
    };
    assert.equal(await acquireStep(bot, new Task('craft', target), target, 1, {}, () => {}), false);
    assert.equal(stock[target], 1);
    assert.equal(crafted, 1);
    assert.equal(await acquireStep(bot, new Task('craft', target), target, 1, {}, () => {}), true);
    assert.equal(crafted, 1);
  }
});
