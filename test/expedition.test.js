'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { runGoal } = require('../src/work');
const { Task } = require('../src/skills');
const registry = require('minecraft-data')('26.1');

function fixture(names, extra = {}) {
  const items = Object.entries(names).map(([name, count]) => ({ name, count, type: registry.itemsByName[name].id, durabilityUsed: 0 }));
  return { registry, inventory: { items: () => items }, game: { gameMode: 'survival' },
    entity: { position: new Vec3(0.5, 64, 0.5) }, health: 20, food: 20,
    pathfinder: { movements: { blocksCantBreak: new Set() } },
    findBlocks: () => [], blockAt: () => ({ name: 'air' }), canDigBlock: () => false,
    _catalogObservation: { at: Date.now(), position: new Vec3(0.5, 64, 0.5), nearby: ['oak_log', 'lapis_ore', 'rose_bush'] },
    chat() {}, ...extra };
}
const survival = { state: {}, step: async () => false };

test('catalog concrete prepares carried expedition supplies before starting a deep recipe dependency', async () => {
  const bot = fixture({ stone_pickaxe: 1, oak_log: 8, crafting_table: 1 });
  const goal = { kind: 'obtain', item: 'purple_concrete', count: 32, request: 'get 32 purple concrete' };
  await runGoal(bot, new Task('test', goal.request), goal, { save() {} }, { survival, maxSteps: 1 });
  assert.equal(goal.expeditionReady, true);
  assert.equal(goal.preparingExpedition, undefined);
  assert.equal(goal.history[0].step.action, 'prepared_expedition');
  assert.equal(goal.history[0].inventory.oak_log, 8);
  assert.equal(goal.history[0].inventory.crafting_table, 1);
});

test('deep catalog requests acquire missing supplies before attempting the ore', async () => {
  const bot = fixture({ stone_pickaxe: 1, oak_log: 3, crafting_table: 1 }, {
    findBlocks: ({ matching, maxDistance }) => {
      if (maxDistance === 64) return []; // Read-only alternative recipe survey.
      if (matching.includes(registry.blocksByName.oak_log.id)) throw new Error('reached spare wood acquisition');
      return [];
    },
  });
  const goal = { kind: 'obtain', item: 'purple_concrete', count: 32, request: 'get 32 purple concrete' };
  await runGoal(bot, new Task('test', goal.request), goal, { save() {} }, { survival, maxSteps: 1 });
  assert.equal(goal.preparingExpedition, true);
  assert.notEqual(goal.expeditionReady, true);
  assert.equal(goal.step.drops, 'oak_log');
  assert.equal(goal.step.count, 5, 'up to the eight-log expedition supply');
});

test('an already acquired ordinary item finishes without preparing an expedition', async () => {
  const bot = fixture({ pumpkin: 1 });
  const goal = { kind: 'obtain', item: 'pumpkin', count: 1, request: 'get a pumpkin' };
  const result = await runGoal(bot, new Task('test', goal.request), goal, { save() {} }, { survival, maxSteps: 1 });
  assert(result.ok); assert.equal(goal.expeditionReady, undefined);
});

test('an iron pickaxe request uses eight carried logs without demanding more', async () => {
  const bot = fixture({ stone_pickaxe: 1, wooden_pickaxe: 1, oak_log: 8, crafting_table: 1 },
    { game: { gameMode: 'survival', difficulty: 'peaceful' } });
  const goal = { kind: 'obtain', item: 'iron_pickaxe', count: 1, request: 'get me an iron pickaxe' };
  await runGoal(bot, new Task('test', goal.request), goal, { save() {} }, { survival, maxSteps: 1 });
  assert.equal(goal.expeditionReady, true);
  assert.equal(goal.history[0].step.action, 'prepared_expedition');
  assert.equal(goal.history[0].inventory.oak_log, 8);
});

test('Normal expeditions cannot descend with tools and spare wood but no safe food reserve', async () => {
  const bot = fixture({ stone_pickaxe: 1, oak_log: 8, crafting_table: 1 }, { game: { gameMode: 'survival', difficulty: 'normal' } });
  const goal = { kind: 'obtain', item: 'purple_concrete', count: 32, request: 'get 32 purple concrete' };
  await runGoal(bot, new Task('test', goal.request), goal, { save() {} }, { survival, maxSteps: 1 });
  assert.equal(goal.preparingExpedition, true);
  assert.equal(goal.expeditionReady, undefined);
  assert.equal(goal.step.action, 'prepare_expedition_food');
  assert.equal(goal.step.carriedFoodPoints, 0);
  bot.inventory.items().push({ name: 'cooked_chicken', count: 2 });
  await runGoal(bot, new Task('test', goal.request), goal, { save() {} }, { survival, maxSteps: 1 });
  assert.equal(goal.expeditionReady, true);
  assert.equal(goal.step.foodPoints, 12);
});

test('a pickaxe about to break with no wood in the pockets reopens expedition prep before the descent', async () => {
  const bot = fixture({ stone_pickaxe: 1, cobblestone: 64, crafting_table: 1, cooked_beef: 4 });
  bot.inventory.items()[0].durabilityUsed = registry.itemsByName.stone_pickaxe.maxDurability - 6;
  const goal = { kind: 'obtain', item: 'purple_concrete', count: 32, request: 'get 32 purple concrete', expeditionReady: true };
  await runGoal(bot, new Task('test', goal.request), goal, { save() {} }, { survival, maxSteps: 1 });
  assert.equal(goal.preparingExpedition, true);
  assert.notEqual(goal.expeditionReady, true);
  assert.equal(goal.step.drops, 'oak_log', 'a spare pickaxe needs sticks, sticks need wood');
});

test('a spare pickaxe in the pockets keeps a ready expedition ready', async () => {
  const { runGoal: run } = require('../src/work');
  const bot = fixture({ stone_pickaxe: 2, cobblestone: 64, crafting_table: 1, oak_log: 4, cooked_beef: 4 });
  bot.inventory.items()[0].durabilityUsed = registry.itemsByName.stone_pickaxe.maxDurability - 6;
  const goal = { kind: 'obtain', item: 'purple_concrete', count: 32, request: 'get 32 purple concrete', expeditionReady: true };
  await run(bot, new Task('test', goal.request), goal, { save() {} }, { survival, maxSteps: 1 });
  assert.equal(goal.expeditionReady, true);
  assert.equal(goal.preparingExpedition, undefined);
});

test('a rung that goes deep with no wood carried prepares the expedition on the shared acquisition path', async () => {
  const { acquireStep } = require('../src/work');
  const bot = fixture({ iron_pickaxe: 1, cobblestone: 64, crafting_table: 1, cooked_beef: 4 }, { game: { gameMode: 'survival', difficulty: 'normal' } });
  const goal = { kind: 'win', request: 'beat the game' };
  // The prep goes looking for logs; this fixture has no world to find them in.
  await acquireStep(bot, new Task('rung', 'diamond'), 'diamond', 3, goal, () => {}).catch(err => assert.match(err.message, /oak_log/));
  assert.equal(goal.preparingExpedition, true);
  assert.equal(goal.expeditionPrepActive, undefined, 'the guard is released');
});

test('a pickaxe under the trip margin gets its spare made on the spot, whatever the step', async () => {
  const bot = fixture({ stone_pickaxe: 1, cobblestone: 64, stick: 2, crafting_table: 1, oak_log: 8, cooked_beef: 4 });
  bot.inventory.items()[0].durabilityUsed = registry.itemsByName.stone_pickaxe.maxDurability - 20;
  const said = []; bot.chat = line => said.push(line);
  const goal = { kind: 'obtain', item: 'purple_concrete', count: 32, request: 'get 32 purple concrete', expeditionReady: true };
  await runGoal(bot, new Task('test', goal.request), goal, { save() {} }, { survival, maxSteps: 1 });
  assert.equal(goal.step.action, 'craft'); assert.equal(goal.step.item, 'stone_pickaxe');
  assert.match(said.join(' '), /spare/);
});

test('a sound pickaxe beside the worn one needs no spare', async () => {
  const bot = fixture({ stone_pickaxe: 1, iron_pickaxe: 1, cobblestone: 64, stick: 2, crafting_table: 1, oak_log: 8, cooked_beef: 4 });
  bot.inventory.items()[0].durabilityUsed = registry.itemsByName.stone_pickaxe.maxDurability - 20;
  const goal = { kind: 'obtain', item: 'purple_concrete', count: 32, request: 'get 32 purple concrete', expeditionReady: true };
  await runGoal(bot, new Task('test', goal.request), goal, { save() {} }, { survival, maxSteps: 1 });
  assert.notEqual(goal.step.item, 'stone_pickaxe');
});

test('persist turns each resource\'s search heading instead of resetting it to the name-hash one', () => {
  const { turnSearch } = require('../src/work');
  const turned = turnSearch({ oak_log: { attempts: 40, frontier: { heading: 7, legs: 5, target: { x: 1 } } }, animals: { attempts: 3 } });
  assert.deepEqual(turned, { oak_log: { attempts: 0, frontier: { heading: 0, legs: 0 } } }, 'a new heading, a clean search, no stale target');
  assert.deepEqual(turnSearch(undefined), {});
});

test('a source is offered only when a route to it is found, searched in slices rather than one forty-millisecond look', async () => {
  const { reachableBlocks } = require('../src/work');
  const statuses = { 1: 'success', 2: 'partial', 3: 'timeout', 4: 'noPath' };
  const bot = { entity: { position: new Vec3(0.5, 64, 0.5) }, canDigBlock: () => false, blockAt: p => ({ name: 'oak_log', position: p }),
    pathfinder: { movements: {}, getPathTo: (_m, goal) => ({ status: statuses[goal.x] }) } };
  const found = await reachableBlocks(bot, new Task('reach'), [1, 2, 3, 4].map(x => new Vec3(x, 64, 5)));
  assert.deepEqual(found.map(p => p.x), [1], 'an unfinished search is not a route');
});

test('entering a portal stops inside it and stands still, instead of walking through and off the far side', async () => {
  const { enterPortal } = require('../src/work');
  const controls = {}, used = new Set();
  const bot = { entity: { position: new Vec3(0.5, 64, 0.5) }, game: { dimension: 'the_nether' },
    pathfinder: { setGoal() {}, movements: {}, goto: async () => {}, isMoving: () => false }, lookAt: async () => {},
    setControlState: (key, on) => { controls[key] = on; if (on) used.add(key); }, clearControlStates() {},
    blockAt: p => ({ name: p.x === 0 && p.z === -1 && (p.y === 64 || p.y === 65) ? 'nether_portal' : p.y < 64 ? 'netherrack' : 'air', position: p }) };
  // The world: forward walks toward -z, slower when sneaking; the portal
  // takes a player who has stood in it for a while.
  let inside = 0;
  const tick = setInterval(() => {
    if (controls.forward) bot.entity.position = bot.entity.position.offset(0, 0, controls.sneak ? -0.07 : -0.22);
    inside = bot.blockAt(bot.entity.position.floored()).name === 'nether_portal' && !controls.forward ? inside + 1 : 0;
    if (inside >= 6) bot.game.dimension = 'overworld';
  }, 50);
  try {
    // One block short of the sheet: the walk there is already done.
    await enterPortal(bot, new Task('portal'), new Vec3(0, 64, -1), () => bot.game.dimension === 'overworld');
  } finally { clearInterval(tick); }
  assert(used.has('sneak'), 'it steps in sneaking');
  assert.equal(bot.entity.position.floored().z, -1, 'and it is standing in the portal, not past it');
  assert.equal(bot.game.dimension, 'overworld');
  assert.equal(controls.forward, false);
});

test('one block from the sheet with the pathfinder refusing every cell beside the drop, the crouched step in is still taken (four arrivals of 2026-09-28)', async () => {
  const { enterPortal } = require('../src/work');
  const controls = {}, used = new Set();
  const bot = { entity: { position: new Vec3(0.5, 64, 0.5) }, game: { dimension: 'the_nether' },
    pathfinder: { setGoal() {}, movements: {}, goto: async () => {}, isMoving: () => false }, lookAt: async () => {},
    setControlState: (key, on) => { controls[key] = on; if (on) used.add(key); }, clearControlStates() {},
    blockAt: p => ({ name: p.x === 0 && p.z === -1 && (p.y === 64 || p.y === 65) ? 'nether_portal' : p.y < 64 ? 'netherrack' : 'air', position: p }) };
  let inside = 0;
  const tick = setInterval(() => {
    if (controls.forward) bot.entity.position = bot.entity.position.offset(0, 0, controls.sneak ? -0.07 : -0.22);
    inside = bot.blockAt(bot.entity.position.floored()).name === 'nether_portal' && !controls.forward ? inside + 1 : 0;
    if (inside >= 6) bot.game.dimension = 'overworld';
  }, 50);
  const noRoute = async () => { throw Object.assign(new Error('No route from here to (0, 64, -1) (partial): the way passes along a drop that would kill'), { name: 'NoRoute' }); };
  try {
    await enterPortal(bot, new Task('portal'), new Vec3(0, 64, -1), () => bot.game.dimension === 'overworld', { walk: noRoute });
  } finally { clearInterval(tick); }
  assert(used.has('sneak'), 'the step is crouched');
  assert.equal(bot.game.dimension, 'overworld', 'the portal took it');
  // Far from the frame the refusal stands: nothing is stepped toward a sheet ten blocks off.
  const far = { ...bot, entity: { position: new Vec3(20.5, 64, 0.5) }, game: { dimension: 'the_nether' } };
  await assert.rejects(enterPortal(far, new Task('portal'), new Vec3(0, 64, -1), () => false, { walk: noRoute }), { name: 'NoRoute' });
});

test('afloat before a portal whose floor is a block up, the step in is a climb out of the water, not a crouch that sinks', async () => {
  // mid-242-ab (note 567): water before its portal's face, a hole under it. The walk ended afloat at the sheet,
  // the crouched step sank the bot to the bottom of the hole, and the step failed there every two seconds.
  const { enterPortal } = require('../src/work');
  const controls = {}, used = new Set();
  // The portal's sheet from y 65 at z -1, on obsidian at y 64; before it, water at y 63 and 64 in a hole.
  const nameAt = p => p.x === 0 && p.z === -1 ? (p.y === 64 ? 'obsidian' : p.y === 65 || p.y === 66 ? 'nether_portal' : p.y < 64 ? 'stone' : 'air')
    : p.x === 0 && p.z === 0 && (p.y === 63 || p.y === 64) ? 'water' : p.y < 64 ? 'stone' : 'air';
  // Where the walk left it: afloat at the sheet, the feet a moment above the water.
  const bot = { entity: { position: new Vec3(0.5, 65.2, 0.5), onGround: false, isInWater: true }, game: { dimension: 'overworld' },
    pathfinder: { setGoal() {}, movements: {}, goto: async () => {}, isMoving: () => false }, lookAt: async () => {},
    setControlState: (key, on) => { controls[key] = on; if (on) used.add(key); }, clearControlStates() {},
    blockAt: p => ({ name: nameAt(p.floored()), position: p }) };
  // The world: in water, jump swims up and a crouch sinks, to the water's floor at 63; forward goes toward -z only
  // once the feet clear the obsidian's top (the game's lift of a swimmer against a wall), then stands on it.
  let inside = 0;
  const tick = setInterval(() => {
    let { x, y, z } = bot.entity.position;
    if (z > 0) y = Math.max(63, Math.min(65.3, y + (controls.jump ? 0.15 : 0) - (controls.sneak ? 0.1 : 0.02) - (y > 65.1 ? 0.08 : 0)));
    if (controls.forward && (y >= 65 || z > 0.35)) z = Math.max(-0.5, z - 0.2);
    if (z < 0 && y > 65) y = 65;
    bot.entity.position = new Vec3(x, y, z); bot.entity.isInWater = z > 0 && y < 65.2; bot.entity.onGround = z < 0;
    inside = nameAt(bot.entity.position.floored()) === 'nether_portal' && !controls.forward ? inside + 1 : 0;
    if (inside >= 6) bot.game.dimension = 'the_nether';
  }, 50);
  try {
    await enterPortal(bot, new Task('portal'), new Vec3(0, 65, -1), () => bot.game.dimension === 'the_nether');
  } finally { clearInterval(tick); }
  assert(used.has('jump'), 'it swims up and climbs out');
  assert.equal(bot.game.dimension, 'the_nether');
  assert.equal(controls.forward, false);
});

test('a furnace batch saved in the Overworld is parked in the Nether, not a wall every step runs into, and comes back at home', () => {
  const { localBatch } = require('../src/work');
  const bot = { game: { dimension: 'the_nether' } };
  const batch = { item: 'iron_ingot', from: 'raw_iron', dimension: 'overworld', position: { x: 1, y: 64, z: 1 }, targetInventory: 8, count: 8 };
  const goal = { smelting: batch };
  assert.equal(localBatch(bot, goal), null, 'nothing to finish here');
  assert.equal(goal.smelting, undefined); assert.deepEqual(goal.smeltingElsewhere.overworld, batch, 'kept, not dropped');
  bot.game.dimension = 'overworld';
  assert.deepEqual(localBatch(bot, goal), batch, 'home again, the batch is picked up where it was left');
  assert.equal(goal.smeltingElsewhere.overworld, undefined);
});

test('a turned search gets an origin back when it is next used', () => {
  const { turnSearch, searchFor } = require('../src/work');
  const goal = { search: turnSearch({ 'food animals': { attempts: 9, origin: { x: 1, y: 2, z: 3 }, frontier: { heading: 3, legs: 2 } } }) };
  assert.equal(goal.search['food animals'].origin, undefined);
  const search = searchFor(goal, 'food animals', { x: 40, y: 64, z: -6 });
  assert.deepEqual(search.origin, { x: 40, y: 64, z: -6 });
  assert.equal(search.frontier.heading, 4, 'and keeps its turned heading');
  assert.deepEqual(searchFor({}, 'oak_log', { x: 1, y: 2, z: 3 }).origin, { x: 1, y: 2, z: 3 });
});

test('a bug in the code is recorded with where it happened; a failure in the world is not', () => {
  const { noteError, searchFor } = require('../src/work');
  const goal = {};
  let bug; try { searchFor(null, 'food animals', { x: 0, y: 0, z: 0 }); } catch (err) { bug = err; }
  const logged = []; const error = console.error; console.error = (...a) => logged.push(a.join(' '));
  try { noteError(goal, bug); noteError(goal, bug); } finally { console.error = error; }
  assert.match(goal.lastErrorAt, /^searchFor \(src\/work\.js:\d+:\d+\)/);
  assert.equal(logged.length, 1, 'logged once per message');
  noteError(goal, new Error('No wheat seed took on the plot'));
  assert.equal(goal.lastErrorAt, undefined);
  assert.equal(goal.lastError, 'No wheat seed took on the plot');
});

test('without Jev, the crossing kit\'s own walk heals before the portal, however the crossing is reached', async () => {
  const { gameHandlers } = require('../src/work');
  const registry = require('minecraft-data')('26.1');
  const bot = { registry, game: { dimension: 'overworld', gameMode: 'survival', difficulty: 'normal' }, health: 9, food: 20,
    inventory: { items: () => [{ name: 'cooked_beef', count: 10, type: registry.itemsByName.cooked_beef.id }] }, entity: { position: { x: 0, y: 64, z: 0 } } };
  const goal = {};
  const entered = await gameHandlers(bot).enter_nether(bot, new Task('cross'), goal, () => {});
  assert.equal(entered, false, 'not through the portal at nine health');
  assert.equal(goal.step.action, 'recover_before_nether');
  const { permittedWait } = require('../src/stillness');
  assert.equal(permittedWait({ ...bot, entities: {}, isSleeping: false }, goal), 'recovering', 'healing at the portal is a wait, not a stall');
});

test('a ring search is turned to its next leg from the same origin, not dropped', () => {
  const { turnSearch } = require('../src/work');
  const turned = turnSearch({ enderman: { attempts: 4, origin: { x: -369, y: 59, z: -69 }, leg: 1, walksWithoutProgress: 2 } });
  assert.deepEqual(turned.enderman, { attempts: 0, origin: { x: -369, y: 59, z: -69 }, leg: 2 });
});

test('without Jev, the ladder gathers two stacks of blocks to bridge and pillar with before the portal', async () => {
  // mid-87-k: out of its portal on an island in the lava sea with too few blocks to reach a shore. The blocks are a
  // rung before the portal now (crossing-kit.js kitRungs, note 673), taken in the ladder's order without Jev.
  const { kitRungs } = require('../src/crossing-kit');
  const registry = require('minecraft-data')('26.1');
  const items = [{ name: 'cooked_beef', count: 10, type: registry.itemsByName.cooked_beef.id }, { name: 'cobblestone', count: 20, type: registry.itemsByName.cobblestone.id },
    { name: 'iron_pickaxe', count: 1 }, { name: 'stone_pickaxe', count: 1 }];
  const bot = { registry, game: { dimension: 'overworld', gameMode: 'survival', difficulty: 'normal' }, health: 20, food: 20,
    inventory: { items: () => items, emptySlotCount: () => 10, slots: [] }, entity: { position: { x: 0, y: 64, z: 0 } } };
  assert.deepEqual(kitRungs(bot, {}).map(r => [r.phase, r.item, r.count]), [['nether_blocks', 'cobblestone', 128]], 'twenty carried, a hundred and eight more');
});

test('an item left in the crafting grid with the pockets full is put away after room is made', async () => {
  // mid-83-k: logs and tables went into the grid with no room to come back, and it crafted seventeen tables.
  const { settleCraftInventory } = require('../src/work');
  const registry = require('minecraft-data')('26.1');
  const slots = Array(46).fill(null);
  for (let i = 9; i < 45; i++) slots[i] = { name: 'dirt', count: 64, type: registry.itemsByName.dirt.id, slot: i };
  slots[2] = { name: 'acacia_log', count: 1, type: registry.itemsByName.acacia_log.id, slot: 2 };
  const put = [];
  const bot = { registry, game: { dimension: 'overworld', gameMode: 'survival' }, entity: { position: new Vec3(0, 64, 0) }, blockAt: () => null,
    inventory: { slots, inventoryStart: 9, inventoryEnd: 45, items: () => slots.slice(9, 45).filter(Boolean), emptySlotCount: () => slots.slice(9, 45).filter(s => !s).length },
    toss: async (type, meta, count) => { const i = slots.findIndex((s, n) => n >= 9 && s && s.type === type); if (i >= 0) slots[i] = null; },
    tossStack: async item => { slots[item.slot] = null; },
    look: async () => {}, lookAt: async () => {},
    putAway: async slot => { const free = slots.findIndex((s, n) => n >= 9 && n < 45 && !s); if (free < 0) throw new Error('no room'); slots[free] = { ...slots[slot], slot: free }; slots[slot] = null; put.push(slot); } };
  await settleCraftInventory(bot, new Task('craft'));
  assert.deepEqual(put, [2]);
  assert(bot.inventory.items().some(i => i.name === 'acacia_log'), 'the log is back in the pockets');
});
