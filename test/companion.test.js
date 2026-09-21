'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { bundleStep, resolveItemBundle } = require('../src/item-bundle');
const { explorationTarget, discoverStep, discoveryCatalog } = require('../src/discovery');
const { Task } = require('../src/skills');
const { configureMovements } = require('../src/movement');
const registry = require('prismarine-registry')('26.1');

test('a resumed item list skips delivered outputs and retains the entire unfinished list', async () => {
  const bot = { inventory: { items: () => [] } }, goal = { from: 'Player', tasks: [
    { item: 'diamond_helmet', count: 1, deliver: true, delivered: 1, status: 'complete' },
    { item: 'diamond_chestplate', count: 1, deliver: true }, { item: 'white_bed', count: 1, deliver: true },
  ] }, calls = [], saved = [];
  const execute = async (child, save) => { calls.push(child.item); child.delivered = 1; save(); return true; };
  assert.equal(await bundleStep(bot, new Task('bundle'), goal, () => saved.push(JSON.parse(JSON.stringify(goal))), execute), false);
  const resumed = structuredClone(saved.at(-1));
  assert.equal(await bundleStep(bot, new Task('resume'), resumed, () => {}, execute), true);
  assert.deepEqual(calls, ['diamond_chestplate', 'white_bed']);
  assert.equal(resumed.tasks.length, 3);
});

test('bundle cancellation and an unfinished handover cannot complete or drop other outputs', async () => {
  const goal = { from: 'Player', tasks: [{ item: 'diamond_helmet', count: 1, deliver: true }, { item: 'white_bed', count: 1, deliver: true }] };
  const bot = { inventory: { items: () => [] } }, task = new Task('bundle');
  assert.equal(await bundleStep(bot, task, goal, () => {}, async child => { child.pendingDelivery = { item: child.item }; return false; }), false);
  task.cancel();
  await assert.rejects(bundleStep(bot, task, goal, () => {}, async () => assert.fail('cancelled work executed')), { name: 'Cancelled' });
  assert(goal.tasks[0].pendingDelivery); assert.equal(goal.tasks.length, 2); assert.notEqual(goal.tasks[1].status, 'complete');
});

test('a retained output lost or consumed during later work is reacquired before bundle completion', async () => {
  const goal = { tasks: [{ item: 'diamond', count: 1, deliver: false, status: 'complete' }, { item: 'white_bed', count: 1, deliver: true, status: 'complete' }] };
  let stock = [], called = false;
  assert(await bundleStep({ inventory: { items: () => stock } }, new Task('bundle'), goal, () => {}, async child => {
    called = true; assert.equal(child.item, 'diamond'); stock = [{ name: 'diamond', count: 1 }]; return true;
  }));
  assert(called);
});

test('multi-label catalog rejects incomplete coverage instead of silently accepting half a request', async () => {
  const small = { itemsArray: [{ name: 'diamond', displayName: 'Diamond' }, { name: 'stick', displayName: 'Stick' }], blocksByName: {}, foodsByName: {} };
  const client = { systemOne: async ({ questions }) => ({ answers: Object.fromEntries(Object.keys(questions).map(key => [key,
    key === 'covered' ? { noul: .1 } : key.startsWith('quantity') ? { choice: 'default' } : key.startsWith('recipient') ? { choice: 'speaker' } : { noul: .99 }])) }) };
  const result = await resolveItemBundle(client, small, 'diamonds and an imaginary thing');
  assert.equal(result.items.length, 0); assert.equal(result.incomplete, true);
});

test('surface exploration retains a distant frontier across restart and moves beyond it', () => {
  const state = {}, start = new Vec3(0, 70, 0);
  const first = explorationTarget(state, 'cherry_log', start);
  assert(first.distanceTo(start) > 500);
  assert.deepEqual(explorationTarget(structuredClone(state), 'cherry_log', start.offset(20, 0, 10)), first);
  const next = explorationTarget(state, 'cherry_log', first);
  assert(next.distanceTo(first) > 500); assert(next.distanceTo(start) > first.distanceTo(start));
});

test('discovery catalog includes registry biomes and sheep; find sheep never attacks or collects it', async () => {
  const biomes = Object.values(discoveryCatalog(registry, 'biome')).flatMap(group => Object.keys(group.children));
  assert.equal(biomes.length, registry.biomesArray.length); assert(biomes.includes('cherry_grove'));
  const animals = Object.values(discoveryCatalog(registry, 'entity')).flatMap(group => Object.keys(group.children));
  assert(animals.includes('sheep'));
  const sheep = { id: 1, name: 'sheep', isValid: true, position: new Vec3(3, 70, 0) };
  const bot = { registry, game: { dimension: 'overworld' }, entity: { position: new Vec3(0, 70, 0) }, entities: { 1: sheep } };
  const goal = { discoveryTarget: { kind: 'entity', name: 'sheep' } };
  assert(await discoverStep(bot, new Task('find sheep'), goal, () => {}, { navigate: async () => assert.fail('already near'), explore: async () => assert.fail('already observed') }));
  assert.equal(goal.discovery.found.entityId, 1);
});

test('a biome is verified at the bot location and cannot be completed from an old observation', async () => {
  const bot = { registry, game: { dimension: 'overworld' }, entity: { position: new Vec3(0, 70, 0) }, blockAt: () => ({ biome: { name: 'cherry_grove' } }) };
  const goal = { discoveryTarget: { kind: 'biome', name: 'cherry_grove' } };
  assert(await discoverStep(bot, new Task('find'), goal, () => {}, {}));
  assert.equal(goal.discovery.found.name, 'cherry_grove');
  goal.discoveryTarget.name = 'nether_wastes';
  await assert.rejects(discoverStep(bot, new Task('wrong dimension'), goal, () => {}, {}), /in nether/);
});

test('deep water has a surface entry and a shore exit without block placement or underwater nodes', () => {
  const Block = require('prismarine-block')(registry);
  const bot = { registry, game: { minY: 0, difficulty: 'peaceful' }, entities: {}, inventory: { items: () => [] },
    entity: { position: new Vec3(.5, 70, .5) }, pathfinder: { setMovements: m => { bot.pathfinder.movements = m; } },
    blockAt: point => {
      const p = point.floored(), water = p.x >= 1 && p.x <= 5 && p.y < 70 && p.y >= 66;
      const block = Block.fromStateId(registry.blocksByName[water ? 'water' : p.y < 70 ? 'stone' : 'air'].defaultState); block.position = p; return block;
    } };
  const movement = configureMovements(bot), entering = [], exiting = [];
  movement.getMoveDropDown({ x: 0, y: 70, z: 0, remainingBlocks: 64 }, new Vec3(1, 0, 0), entering);
  assert(entering.some(p => p.y === 69 && !p.toPlace.length));
  movement.getMoveJumpUp({ x: 5, y: 69, z: 0, remainingBlocks: 64 }, new Vec3(1, 0, 0), exiting);
  assert(exiting.some(p => p.y === 70 && p.x === 6 && !p.toPlace.length && !p.toBreak.length));
});

function oreWorld() {
  const Block = require('prismarine-block')(registry), ore = new Vec3(2, 70, 1);
  let stock = [{ name: 'iron_pickaxe', type: registry.itemsByName.iron_pickaxe.id, count: 1, durabilityUsed: 0 }];
  const bot = { registry, game: { difficulty: 'peaceful', gameMode: 'survival', minY: 0 }, health: 20, food: 20, entities: {},
    entity: { position: new Vec3(.5, 70, .5) }, inventory: { items: () => stock, emptySlotCount: () => 12 },
    canSeeBlock: () => true, blockAt: p => {
      const point = p.floored(), block = Block.fromStateId(registry.blocksByName[point.equals(ore) ? 'diamond_ore' : point.y < 70 ? 'stone' : 'air'].defaultState);
      block.position = point; return block;
    }, findBlocks: ({ useExtraInfo }) => useExtraInfo(bot.blockAt(ore)) ? [ore] : [],
    pathfinder: { movements: { canDig: true, scafoldingBlocks: [1], allow1by1towers: true }, getPathTo: () => ({ status: 'success', path: [] }) } };
  return { bot, ore, stock: next => { stock = next; } };
}

test('optional mining requires tools, room, health and visible useful ore', () => {
  const { opportunityCandidates } = require('../src/opportunistic-mining');
  const { bot, stock } = oreWorld(), primary = { drops: 'coal' };
  assert.equal(opportunityCandidates(bot, {}, primary)[0].resource, 'diamond');
  bot.health = 8; assert.equal(opportunityCandidates(bot, {}, primary).length, 0); bot.health = 20;
  bot.canSeeBlock = () => false; assert.equal(opportunityCandidates(bot, {}, primary).length, 0); bot.canSeeBlock = () => true;
  bot.inventory.emptySlotCount = () => 0; assert.equal(opportunityCandidates(bot, {}, primary).length, 0); bot.inventory.emptySlotCount = () => 12;
  stock([]); assert.equal(opportunityCandidates(bot, {}, primary).length, 0);
});

test('cancelled optional mining restores movement and retains the main request', async () => {
  const { opportunisticMining } = require('../src/opportunistic-mining');
  const { bot } = oreWorld(), task = new Task('coal'), goal = { kind: 'obtain', request: 'get coal', step: { action: 'mine', drops: 'coal' },
    opportunistic: { primarySteps: 2, history: [], skipped: {} } };
  const before = { ...bot.pathfinder.movements };
  await assert.rejects(opportunisticMining(bot, task, goal, () => {}, goal.step, {
    navigate: async () => {}, dig: async () => { task.cancel(); task.check(); },
  }, { systemOne: async () => ({ answers: { opportunity: { choice: 'ore_0' } } }) }), { name: 'Cancelled' });
  assert.deepEqual(bot.pathfinder.movements, { ...before, allowedPosition: undefined });
  assert.equal(goal.request, 'get coal'); assert.equal(goal.step.drops, 'coal'); assert.equal(goal.opportunistic.active, undefined);
});

test('coal within reach with no fuel in the pockets is taken by rule, without asking', async () => {
  const { opportunisticMining } = require('../src/opportunistic-mining');
  const { bot, ore } = oreWorld();
  const Block = require('prismarine-block')(registry);
  bot.blockAt = p => { const point = p.floored(); const block = Block.fromStateId(registry.blocksByName[point.equals(ore) ? 'coal_ore' : point.y < 70 ? 'stone' : 'air'].defaultState); block.position = point; return block; };
  const dug = [];
  const goal = { kind: 'win', opportunistic: { primarySteps: 0, history: [], skipped: {} }, step: { action: 'tunnel' } };
  assert.equal(await opportunisticMining(bot, new Task('iron'), goal, () => {}, { drops: 'raw_iron' }, {
    dig: async (b, t, p) => { dug.push(p); }, navigate: async () => {},
  }, { systemOne: async () => assert.fail('a rule needs no question') }), true);
  assert.deepEqual(dug, [ore]);
  assert.equal(goal.opportunistic.lastDecision.answer.rule, 'fuel');
  bot.inventory.items = () => [{ name: 'iron_pickaxe', type: registry.itemsByName.iron_pickaxe.id, count: 1, durabilityUsed: 0 }, { name: 'coal', count: 12 }];
  goal.opportunistic.skipped = {};
  assert.equal(await opportunisticMining(bot, new Task('iron'), goal, () => {}, { drops: 'raw_iron' }, { dig: async () => assert.fail('dug'), navigate: async () => {} }, null), false, 'with fuel in hand and no client, no detour');
});

test('long or excavating detour routes never reach the model or executor', async () => {
  const { opportunisticMining } = require('../src/opportunistic-mining');
  const { bot } = oreWorld();
  bot.pathfinder.getPathTo = () => ({ status: 'success', path: [{ x: 1, y: 70, z: 0, toBreak: [1] }] });
  const goal = { kind: 'obtain', opportunistic: { primarySteps: 2, history: [], skipped: {} } };
  assert.equal(await opportunisticMining(bot, new Task('coal'), goal, () => {}, { drops: 'coal' }, {
    dig: async () => assert.fail('dug'), navigate: async () => assert.fail('moved'),
  }, { systemOne: async () => assert.fail('unsafe detour offered') }), false);
  assert.equal(bot.pathfinder.movements.canDig, true);
});

test('server biome IDs override empty stale block biome objects', () => {
  const { biomeAt } = require('../src/discovery');
  assert.equal(biomeAt({ registry: { biomes: { 143: { name: 'minecraft:cherry_grove' } } }, blockAt: () => ({ biome: { id: 143, name: '' } }) }, new Vec3(0, 70, 0)), 'cherry_grove');
});
