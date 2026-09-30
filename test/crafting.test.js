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
      world: { raycast: (_eye, ray) => ({ position: Math.abs(ray.x) > Math.abs(ray.z) ? stations.crafting_table : stations.furnace }) },
      pathfinder: { movements: {}, goto: async goal => assert(goal.isEnd(bot.entity.position.floored())), setGoal: () => {} },
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

test('crafting bypasses a sealed nearest table and uses a reachable alternative without digging', async () => {
  const registry = require('minecraft-data')('26.1');
  const Chunk = require('prismarine-chunk')(registry), World = require('prismarine-world')(registry);
  const world = new World(() => new Chunk()).sync;
  for (let x = -1; x <= 1; x++) for (let z = -1; z <= 1; z++) world.setColumn(x, z, new Chunk());
  const set = (p, name) => world.setBlockStateId(p, registry.blocksByName[name].defaultState);
  const sealed = new Vec3(2, 64, 0), usable = new Vec3(8, 64, 0), stock = { oak_planks: 8 };
  for (let x = -4; x <= 12; x++) for (let z = -4; z <= 4; z++) set(new Vec3(x, 63, z), 'stone');
  for (let x = 1; x <= 3; x++) for (let y = 64; y <= 67; y++) for (let z = -1; z <= 1; z++) set(new Vec3(x, y, z), 'stone');
  set(sealed, 'crafting_table'); set(usable, 'crafting_table');
  const movement = { canDig: true, allow1by1towers: true, scafoldingBlocks: [1] }, original = { ...movement };
  const bot = {
    registry, world, game: { gameMode: 'survival' }, entity: { position: new Vec3(.5, 64, .5), onGround: true },
    _catalogObservation: { at: Date.now(), position: { x: .5, y: 64, z: .5 }, nearby: [] },
    blockAt: p => world.getBlock(p),
    findBlocks: ({ matching, count }) => matching.includes(registry.blocksByName.crafting_table.id) ? [sealed, usable].slice(0, count) : [],
    inventory: { slots: [], items: () => Object.entries(stock).filter(([, count]) => count).map(([name, count]) => ({ name, count, type: registry.itemsByName[name].id })) },
    pathfinder: {
      movements: movement, setGoal: () => {},
      getPathTo: (m, goal) => {
        assert.equal(m.canDig, false); assert.deepEqual(m.scafoldingBlocks, []);
        return { status: goal.pos.equals(sealed) ? 'noPath' : 'success' };
      },
      goto: async goal => { if (goal.pos?.equals(usable)) bot.entity.position = new Vec3(6.5, 64, .5); },
    },
    craft: async (recipe, count, table) => {
      assert(table.position.equals(usable), 'must not try to open the sealed nearest table');
      for (const delta of recipe.delta) { const name = registry.items[delta.id].name; stock[name] = (stock[name] || 0) + delta.count; }
    },
  };
  await acquireStep(bot, new Task('reachable table'), 'chest', 1, {}, () => {});
  assert.equal(stock.chest, 1); assert.deepEqual(movement, original);
  assert.equal(bot.blockAt(sealed.offset(-1, 0, 0)).name, 'stone');
});

// A bot whose clicks behave as the library's: putting the cursor back with
// no slot named and none free clicks slot undefined, which the window refuses
// ("invalid operation"), and a craft with nowhere for its output does too.
function fullPockets(registry, { cursor = null, choices = [] } = {}) {
  const slots = Array(46).fill(null);
  const set = (i, name, count) => { const it = registry.itemsByName[name]; slots[i] = { name, count, type: it.id, stackSize: it.stackSize, slot: i }; };
  set(9, 'acacia_log', 7); set(10, 'dirt', 20); set(11, 'flint_and_steel', 1);
  for (let i = 12; i < 45; i++) set(i, 'white_terracotta', 64);
  const invalid = () => { const err = new Error('invalid operation'); err.name = 'AssertionError'; throw err; };
  const free = () => slots.findIndex((s, n) => n >= 9 && n < 45 && !s);
  const asked = [], tossed = [];
  const bot = {
    registry, game: { gameMode: 'survival', dimension: 'overworld' }, entity: { position: new Vec3(0, 64, 0), yaw: 0 },
    _catalogObservation: { at: Date.now(), position: { x: 0, y: 64, z: 0 }, nearby: [] },
    findBlocks: () => [], blockAt: () => null, lookAt: async () => {},
    inventory: { slots, inventoryStart: 9, inventoryEnd: 45, selectedItem: cursor ? { ...cursor, type: registry.itemsByName[cursor.name].id, stackSize: registry.itemsByName[cursor.name].stackSize } : null,
      items: () => slots.slice(9, 45).filter(Boolean), emptySlotCount: () => slots.slice(9, 45).filter(s => !s).length },
    // The real tossStack clicks the stack (swapping it with the cursor) and then outside.
    tossStack: async item => { tossed.push(item.name); const held = bot.inventory.selectedItem; slots[item.slot] = held ? { ...held, slot: item.slot } : null; bot.inventory.selectedItem = null; },
    putSelectedItemRange: async (start, end, window, slot) => {
      const held = bot.inventory.selectedItem, i = free();
      if (i >= 0) { slots[i] = { ...held, slot: i }; bot.inventory.selectedItem = null; return; }
      if (slot === null) { bot.inventory.selectedItem = null; return; }
      if (!(slot >= 0 && slot < 45)) invalid();
    },
    craft: async recipe => {
      const out = registry.items[recipe.result.id], log = slots.find(s => s?.name === 'acacia_log');
      const i = free();
      if (i < 0 && log.count > 1) invalid();
      if (--log.count === 0) slots[log.slot] = null;
      set(i >= 0 ? i : log.slot, out.name, recipe.result.count);
    },
  };
  const client = { systemOne: async ({ questions }) => {
    const pick = choices.shift() || 'none';
    asked.push({ ...questions.branch_0.criteria, ...(questions.branch_1?.criteria || {}) });
    return { answers: { branch_0: { choice: pick === 'none' ? 'none' : 'drop', confidence: 0.7 }, branch_1: { choice: pick === 'none' ? Object.keys(questions.branch_1?.criteria || {}).find(k => /^drop_/.test(k)) || 'none' : pick, confidence: 0.7 } } };
  } };
  return { bot, client, asked, tossed, slots };
}
const dropOf = (offered, name) => Object.keys(offered).find(k => /^drop_/.test(k) && new RegExp(`^Drop \\d+ ${name}`).test(offered[k]));

test('a craft with the pockets full and sticks on the cursor makes room as Jev chooses, never clicking outside the window', async () => {
  // mid-241-v (note 496): four sticks on the cursor, thirty-six slots full, ten "invalid operation" crafting acacia planks.
  const registry = require('minecraft-data')('26.1');
  const { bot, tossed, slots } = fullPockets(registry, { cursor: { name: 'stick', count: 4 } });
  // The dirt goes for the sticks; the planks then need a slot of their own.
  const asked = [];
  const client = { systemOne: async ({ questions }) => {
    const offered = { ...questions.branch_0.criteria, ...questions.branch_1.criteria }; asked.push(offered);
    const pick = dropOf(offered, 'dirt') || dropOf(offered, 'white terracotta');
    return { answers: { branch_0: { choice: 'drop', confidence: 0.7 }, branch_1: { choice: pick, confidence: 0.7 } } };
  } };
  const task = new Task('craft', 'acacia planks'); task.opportunityClient = client;
  await acquireStep(bot, task, 'acacia_planks', 4, {}, () => {});
  assert.equal(bot.inventory.selectedItem, null, 'the sticks are off the cursor');
  assert(slots.some(s => s?.name === 'stick' && s.count === 4), 'the sticks are in the pockets');
  assert(slots.some(s => s?.name === 'acacia_planks' && s.count === 4), 'the planks were made');
  // Terracotta by the stack is dug again in seconds, offered before the
  // dirt that is the block reserve (note 754b).
  assert.deepEqual(tossed, ['white_terracotta', 'white_terracotta']);
  assert.match(asked[1].drop, /make room for the 4 acacia planks/);
});

test('a craft with the pockets full and no room made fails as that, named, not "invalid operation"', async () => {
  const registry = require('minecraft-data')('26.1');
  for (const cursor of [null, { name: 'stick', count: 4 }]) {
    const { bot, client, tossed } = fullPockets(registry, { cursor, choices: ['none', 'none', 'none'] });
    const task = new Task('craft', 'acacia planks'); task.opportunityClient = client;
    await assert.rejects(acquireStep(bot, task, 'acacia_planks', 4, {}, () => {}),
      err => err.name === 'Blocked' && (cursor ? /No free slot for the 4 stick on the cursor; the inventory is full/ : /No free slot for the 4 acacia planks; the inventory is full/).test(err.message));
    assert.deepEqual(tossed, []);
  }
});

test('a craft with no free slot asks for room even where its ingredient stack would empty (note 754)', async () => {
  // Of 3,638 "timed out ... after crafting" in the flight records, 3,566 had
  // 0 free slots, 1,129 of them "have 0 of 4": the slot a last log would
  // free was not room the server gave the output.
  const registry = require('minecraft-data')('26.1');
  const { bot, client, asked, tossed, slots } = fullPockets(registry, { choices: ['drop_white_terracotta'] });
  slots[9].count = 1;
  const task = new Task('craft', 'acacia planks'); task.opportunityClient = client;
  await acquireStep(bot, task, 'acacia_planks', 4, {}, () => {});
  assert.equal(asked.length, 1, 'Jev is asked what to drop before the click');
  assert.equal(tossed.length, 1);
  assert(slots.some(s => s?.name === 'acacia_planks' && s.count === 4));
});

test('a craft resting for want of a free slot goes to the drop question, not the rest (note 754)', async () => {
  // 25597 (mid-241-ba): "Crafting oak planks made nothing twice ... 0 free
  // slots" thirty-six times running, the drop question never asked.
  const registry = require('minecraft-data')('26.1');
  const { noteCraftFailure, craftRest } = require('../src/craft-failures');
  const { bot, client, asked, tossed, slots } = fullPockets(registry, { choices: ['drop_white_terracotta'] });
  for (let n = 0; n < 2; n++) noteCraftFailure(bot, 'acacia_planks', 'no output: acacia planks after crafting, twice (have 0 of 4, 0 free slots)');
  assert(craftRest(bot, 'acacia_planks'), 'the craft rests');
  const task = new Task('craft', 'acacia planks'); task.opportunityClient = client;
  await acquireStep(bot, task, 'acacia_planks', 4, {}, () => {});
  assert.equal(asked.length, 1, 'the room is asked for');
  assert.equal(tossed.length, 1);
  assert(slots.some(s => s?.name === 'acacia_planks' && s.count === 4), 'and the craft is made');
  // A rest for any other reason is still said as the rest.
  const other = fullPockets(registry);
  other.slots[12] = null;
  for (let n = 0; n < 2; n++) noteCraftFailure(other.bot, 'acacia_planks', 'no output: acacia planks after crafting, twice (have 0 of 4, 3 free slots)');
  const t2 = new Task('craft', 'acacia planks'); t2.opportunityClient = other.client;
  await assert.rejects(acquireStep(other.bot, t2, 'acacia_planks', 4, {}, () => {}), err => err.name === 'Blocked' && /made nothing twice/.test(err.message));
  assert.equal(other.asked.length, 0);
});
