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

test('a keepsake or kit item lying within eight blocks is picked up by rule, what the tidy would toss is not, and the main step is kept', async () => {
  const { dropCandidates, opportunisticPickups } = require('../src/opportunistic-pickups');
  const { bot, stock } = oreWorld();
  const drop = (id, name, count, x) => ({ id, name: 'item', isValid: true, position: new Vec3(x, 70, .5), getDroppedItem: () => ({ name, count }) });
  bot.entities = { 1: drop(1, 'string', 2, 3.5), 2: drop(2, 'dirt', 5, 2.5), 3: drop(3, 'oak_log', 1, 5.5), 4: drop(4, 'feather', 1, 20.5), 5: drop(5, 'cobblestone', 8, 4.5) };
  bot.inventory.items = () => [{ name: 'iron_pickaxe', type: registry.itemsByName.iron_pickaxe.id, count: 1, durabilityUsed: 0 }, { name: 'cobblestone', count: 200 }];
  assert.deepEqual(dropCandidates(bot, {}).map(c => c.item), ['string', 'oak_log'], 'dirt is not kept, the feather is out of reach, and cobblestone over the tidy cap would be tossed again');
  bot.inventory.items = () => [{ name: 'iron_pickaxe', type: registry.itemsByName.iron_pickaxe.id, count: 1, durabilityUsed: 0 }, { name: 'cobblestone', count: 20 }];
  assert.deepEqual(dropCandidates(bot, {}).map(c => c.item), ['string', 'cobblestone', 'oak_log'], 'nearest first, and cobblestone under the cap is kit material');
  bot.inventory.emptySlotCount = () => 2; assert.equal(dropCandidates(bot, {}).length, 0, 'crowded pockets pick nothing up'); bot.inventory.emptySlotCount = () => 12;
  // The pickup is a rule: no client, no question, the collector is called for each and the step is restored.
  let items = [{ name: 'iron_pickaxe', type: registry.itemsByName.iron_pickaxe.id, count: 1, durabilityUsed: 0 }];
  bot.inventory.items = () => items;
  const collected = [], steps = [];
  const goal = { kind: 'win', step: { action: 'mine', drops: 'raw_iron' }, opportunistic: { primarySteps: 0, history: [], skipped: {} } };
  const result = await opportunisticPickups(bot, new Task('iron'), goal, () => steps.push(goal.step.action), { drops: 'raw_iron' }, {
    navigate: async () => {}, collectDrops: async (b, t, item) => { collected.push(item); if (item !== 'oak_log') items = [...items, { name: item, count: 2 }]; return item !== 'oak_log'; },
  }, null);
  assert.equal(result, true);
  assert.deepEqual(collected, ['string', 'cobblestone', 'oak_log']);
  assert(steps.includes('collect_nearby_resource') && goal.step.action === 'mine', 'the detour had its own step and gave the mine step back');
  assert.deepEqual(goal.opportunistic.history.at(-1).pickedUp, [{ item: 'string', count: 2 }, { item: 'cobblestone', count: 2 }]);
  assert.equal(goal.opportunistic.lastDecision.answer.rule, 'keepsake');
  assert(goal.opportunistic.skipped['drop:oak_log'], 'a log that could not be reached is left alone for a while');
  assert.deepEqual(dropCandidates(bot, goal).map(c => c.item), ['string', 'cobblestone']);
  stock([]);
});

test('an isolated sheep or chicken in view with its drop short is offered to Jev every third step, and the chase is bounded and returns to the step', async () => {
  const { animalCandidates, opportunisticPickups } = require('../src/opportunistic-pickups');
  const { bot } = oreWorld();
  Object.assign(bot.game, { difficulty: 'normal', dimension: 'minecraft:overworld' }); bot.oxygenLevel = 20;
  const sheep = { id: 9, name: 'sheep', isValid: true, position: new Vec3(6.5, 70, .5), metadata: [] };
  const chicken = { id: 10, name: 'chicken', isValid: true, position: new Vec3(4.5, 70, 2.5), metadata: [] };
  const lamb = { id: 11, name: 'sheep', isValid: true, position: new Vec3(2.5, 70, .5), metadata: [] };
  lamb.metadata[registry.entitiesByName.sheep.metadataKeys.indexOf('baby')] = true;
  bot.entities = { 9: sheep, 10: chicken, 11: lamb };
  assert.deepEqual(animalCandidates(bot, {}).map(c => [c.animal, c.label, c.carried, c.wanted]), [['sheep', 'wool', 0, 3], ['chicken', 'feathers', 0, 4]], 'the lamb is not a candidate');
  assert.equal(animalCandidates(bot, {})[0].entity, sheep);
  bot.inventory.items = () => [{ name: 'white_wool', count: 3 }, { name: 'feather', count: 1 }];
  assert.deepEqual(animalCandidates(bot, {}).map(c => c.animal), ['chicken'], 'three wool is enough for a bed');
  bot.inventory.items = () => [];
  bot.health = 8; assert.equal(animalCandidates(bot, {}).length, 0); bot.health = 20;
  // Not every step is a question: the first two pass, the third asks, and continue is remembered for those animals.
  const asked = [], hunted = [], observed = [];
  const goal = { kind: 'win', request: 'beat the game', step: { action: 'mine', drops: 'oak_log' }, opportunistic: { primarySteps: 0, history: [], skipped: {} } };
  const actions = { navigate: async () => {}, collectDrops: async () => false,
    hunt: async (b, t, target) => { hunted.push(target.name); bot.inventory.items = () => [{ name: 'white_wool', count: 2 }]; },
    huntObserved: async (b, t, g) => { observed.push({ ...g.mobHunt }); bot.inventory.items = () => [{ name: 'feather', count: 1 }]; return true; } };
  const client = { systemOne: async ({ questions }) => { asked.push(Object.keys(questions.opportunity.criteria)); return { answers: { opportunity: { choice: asked.length === 1 ? 'continue' : 'animal_0' } } }; } };
  for (let i = 0; i < 2; i++) assert.equal(await opportunisticPickups(bot, new Task('logs'), goal, () => {}, goal.step, actions, client), false);
  assert.equal(asked.length, 0);
  assert.equal(await opportunisticPickups(bot, new Task('logs'), goal, () => {}, goal.step, actions, client), false, 'Jev chose to continue');
  assert.deepEqual(asked, [['animal_0', 'animal_1', 'continue']]); assert.deepEqual(hunted, []);
  assert(goal.opportunistic.skipped['mob:9'] && goal.opportunistic.skipped['mob:10'], 'the animals Jev passed on are not asked about again for a while');
  goal.opportunistic.skipped = {}; goal.opportunistic.pickupSteps = 2;
  assert.equal(await opportunisticPickups(bot, new Task('logs'), goal, () => {}, goal.step, actions, client), true, 'the sheep chase gathered wool');
  assert.deepEqual(hunted, ['sheep']); assert.equal(goal.step.action, 'mine', 'the mine step came back');
  assert.deepEqual(goal.opportunistic.history.at(-1), { ...goal.opportunistic.history.at(-1), kind: 'animal', animal: 'sheep', resource: 'wool', pickedUp: 2 });
  // With wool in hand the chicken is next, through the mob hunt with a feather target, and the hunt state is cleaned up after.
  goal.opportunistic.pickupSteps = 2; bot.entities = { 10: chicken };
  assert.equal(await opportunisticPickups(bot, new Task('logs'), goal, () => {}, goal.step, actions, client), true);
  assert.deepEqual(observed, [{ item: 'feather', entity: 'chicken', targetCount: 4 }]); assert.equal(goal.mobHunt, undefined);
  // No client: no question, no chase.
  goal.opportunistic.pickupSteps = 2; bot.inventory.items = () => [];
  assert.equal(await opportunisticPickups(bot, new Task('logs'), goal, () => {}, goal.step, actions, null), false);
  assert.deepEqual(hunted, ['sheep']);
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

test('nether gold is not broken with a piglin within sixteen blocks: they turn on a player who does, gold armour or not', () => {
  const { opportunityCandidates } = require('../src/opportunistic-mining');
  const { bot, ore } = oreWorld();
  const Block = require('prismarine-block')(registry);
  bot.game.dimension = 'the_nether';
  bot.blockAt = p => { const point = p.floored(); const block = Block.fromStateId(registry.blocksByName[point.equals(ore) ? 'nether_gold_ore' : point.y < 70 ? 'netherrack' : 'air'].defaultState); block.position = point; return block; };
  const primary = { drops: 'netherrack' };
  assert.equal(opportunityCandidates(bot, {}, primary)[0]?.resource, 'gold_nugget', 'alone, the gold is taken');
  bot.entities = { 1: { name: 'zombified_piglin', position: new Vec3(4, 70, 1), isValid: true } };
  assert.equal(opportunityCandidates(bot, {}, primary).length, 1, 'a zombified piglin does not care');
  bot.entities[2] = { name: 'piglin', position: new Vec3(12, 70, 1), isValid: true };
  assert.equal(opportunityCandidates(bot, {}, primary).length, 0, 'a piglin ten blocks off would turn');
  bot.entities[2].position = new Vec3(22, 70, 1);
  assert.equal(opportunityCandidates(bot, {}, primary).length, 1, 'twenty blocks off it does not');
});

test('a Nether walk stops for gold within four blocks while pearls are short, and the fortress step digs it before going on', async () => {
  const { goldInPassing } = require('../src/opportunistic-mining');
  const { findFortressStep } = require('../src/mob-hunt');
  const { bot, ore, stock } = oreWorld();
  const Block = require('prismarine-block')(registry);
  bot.game.dimension = 'the_nether';
  let gold = true;
  bot.blockAt = p => { const point = p.floored(); const block = Block.fromStateId(registry.blocksByName[point.equals(ore) && gold ? 'nether_gold_ore' : point.y < 70 ? 'netherrack' : 'air'].defaultState); block.position = point; return block; };
  bot.findBlocks = ({ matching, useExtraInfo }) => gold && matching.includes(registry.blocksByName.nether_gold_ore.id) && (!useExtraInfo || useExtraInfo(bot.blockAt(ore))) ? [ore] : [];
  let now = 1e12;
  assert.equal(goldInPassing(bot, {}, now), true, 'gold two blocks off the path stops the walk');
  assert.equal(goldInPassing(bot, {}, now + 100), false, 'the look is throttled');
  bot.entities = { 7: { name: 'piglin', position: new Vec3(8, 70, 1), isValid: true } };
  assert.equal(goldInPassing(bot, {}, now += 1000), false, 'not with a piglin to see it');
  bot.entities = {};
  stock([{ name: 'iron_pickaxe', type: registry.itemsByName.iron_pickaxe.id, count: 1, durabilityUsed: 0 }, { name: 'ender_pearl', type: registry.itemsByName.ender_pearl.id, count: 16 }]);
  assert.equal(goldInPassing(bot, {}, now += 1000), false, 'with the pearls in hand the gold is left');
  stock([{ name: 'iron_pickaxe', type: registry.itemsByName.iron_pickaxe.id, count: 1, durabilityUsed: 0 }]);

  const dug = [], legs = [];
  const goal = { kind: 'win', step: { action: 'hunt_mob' } };
  const actions = { navigate: async (b, t, g) => { legs.push(g); }, dig: async (b, t, p) => { dug.push(`${p}`); gold = false; }, tunnel: async () => {} };
  await findFortressStep(bot, new Task('hunt'), goal, () => {}, actions);
  assert.deepEqual(dug, [`${ore}`], 'the gold is dug first');
  assert.equal(goal.fortressSearch.legs, 0, 'and the sweep leg waits for the next step');
});

test('a diamond beside the tunnel is dug by rule, never walked past for want of a question', async () => {
  const { opportunisticMining, valuableInPassing } = require('../src/opportunistic-mining');
  const { bot, ore } = oreWorld();
  const find = bot.findBlocks;
  bot.findBlocks = opts => opts.useExtraInfo ? find(opts) : [ore];
  const dug = [];
  const goal = { kind: 'win', opportunistic: { primarySteps: 0, history: [], skipped: {} } };
  assert.equal(valuableInPassing(bot, goal, Date.now() + 1000), true, 'a walk stops for it');
  const mined = await opportunisticMining(bot, new Task('tunnel'), goal, () => {}, { drops: 'cobblestone' }, {
    navigate: async () => {}, dig: async (b, t, p) => { dug.push(`${p}`); } }, null);
  assert.equal(mined, true, 'no Jev asked, the diamond taken all the same');
  assert.deepEqual(dug, [`${ore}`]);
});

test('iron ore is taken by rule while iron is short, and left once the pockets hold enough', () => {
  const { opportunityCandidates } = require('../src/opportunistic-mining');
  const { bot, ore, stock } = oreWorld();
  const Block = require('prismarine-block')(registry);
  bot.blockAt = p => { const f = p.floored(); const b = Block.fromStateId(registry.blocksByName[f.equals(ore) ? 'iron_ore' : f.y < 70 ? 'stone' : 'air'].defaultState); b.position = f; return b; };
  const neededNow = () => opportunityCandidates(bot, {}, { drops: 'cobblestone' }).length;
  assert.equal(neededNow(), 1);
  const { valuableInPassing } = require('../src/opportunistic-mining');
  const find = bot.findBlocks; bot.findBlocks = o => o.useExtraInfo ? find(o) : [ore];
  assert.equal(valuableInPassing(bot, {}, Date.now() + 5000), true, 'short of iron: a walk stops for it');
  stock([{ name: 'iron_pickaxe', type: registry.itemsByName.iron_pickaxe.id, count: 1, durabilityUsed: 0 }, { name: 'raw_iron', type: registry.itemsByName.raw_iron.id, count: 40 }]);
  assert.equal(valuableInPassing(bot, {}, Date.now() + 10000), false, 'forty carried: walked past');
});
