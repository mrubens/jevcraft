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

test('the progress watchdog counts five quiet minutes as stuck, whatever the steps say, and drops the shaft', async () => {
  const { progressWatchdog } = require('../src/work');
  const bot = fixture({ stone_pickaxe: 1 }); const said = []; bot.chat = line => said.push(line);
  const goal = { kind: 'win', step: { action: 'tunnel', resource: 'fortress' }, tunnel: { steps: 400 }, miningSites: { 'nether:fortress': { workPosition: { x: 1, y: 2, z: 3 } } } };
  assert.equal(await progressWatchdog(bot, new Task('watch'), goal, () => {}), false, 'the first look only starts the clock');
  goal.progressWatch.at -= 6 * 60 * 1000;
  bot.entity.position = new Vec3(14.5, 64, 0.5); await progressWatchdog(bot, new Task('watch'), goal, () => {}).catch(() => {});
  goal.progressWatch.at -= 6 * 60 * 1000;
  bot.entity.position = new Vec3(3.5, 64, 3.5);
  assert.equal(await progressWatchdog(bot, new Task('watch'), goal, () => {}), true, 'five minutes within a fourteen-block shuffle is stuck');
  assert.equal(goal.tunnel, undefined); assert.equal(goal.miningSites['nether:fortress'].workPosition, undefined);
  assert.match(said[0], /stuck around here for five minutes/);
  goal.progressWatch.at -= 6 * 60 * 1000;
  bot.entity.position = new Vec3(40.5, 64, 3.5);
  assert.equal(await progressWatchdog(bot, new Task('watch'), goal, () => {}), false, 'covering forty blocks in the window is progress');
  assert.equal(goal.progressWatch.strikes, 0);
});

test('the watchdog excuses time survival had the bot, sees persist loops, and dug rock or a retry step is not progress', async () => {
  const { progressWatchdog, excuseWatch, freshWatch } = require('../src/work');
  const bot = fixture({ stone_pickaxe: 1 }); bot.chat = () => {};
  const goal = { kind: 'obtain', step: { action: 'tunnel', resource: 'diamond_ore' } };
  await progressWatchdog(bot, new Task('watch'), goal, () => {});
  const started = goal.progressWatch.at;
  bot.inventory.items().push({ name: 'cobblestone', count: 12 });
  goal.step = { action: 'persist', attempt: 1 };
  await progressWatchdog(bot, new Task('watch'), goal, () => {});
  assert.equal(goal.progressWatch.at, started, 'cobblestone from the shaft and a persist step keep the same window');
  // A night in a shelter: survival had the bot, and that time is excused.
  goal.progressWatch.at -= 6 * 60 * 1000; excuseWatch(goal, 6 * 60 * 1000);
  assert.equal(await progressWatchdog(bot, new Task('watch'), goal, () => {}), false, 'a night sheltered is not a stall');
  // A persist loop: forty seconds between looks, and five minutes of it strikes.
  goal.progressWatch.at -= 6 * 60 * 1000;
  assert.equal(await progressWatchdog(bot, new Task('watch'), goal, () => {}), true, 'an error, a persist and the same error again is seen');
  // A resume starts a fresh window.
  goal.progressWatch.at -= 6 * 60 * 1000; freshWatch(goal);
  assert.equal(await progressWatchdog(bot, new Task('watch'), goal, () => {}), false);
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

test('rock that was asked for is progress: a cobblestone request is not judged stuck for digging cobblestone', async () => {
  const { progressWatchdog } = require('../src/work');
  const bot = fixture({ stone_pickaxe: 1 }); bot.chat = () => {};
  const goal = { kind: 'obtain', item: 'cobblestone', count: 256, step: { action: 'mine', drops: 'cobblestone' } };
  await progressWatchdog(bot, new Task('watch'), goal, () => {});
  const before = goal.progressWatch.key;
  bot.inventory.items().push({ name: 'cobblestone', count: 12 });
  await progressWatchdog(bot, new Task('watch'), goal, () => {});
  assert.notEqual(goal.progressWatch.key, before, 'the pile growing is a change, and starts a new window');
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
