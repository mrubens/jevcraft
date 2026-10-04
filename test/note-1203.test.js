'use strict';
// Food from the water (note 1203): cod and salmon in open water and the rod
// from the bank are ways of obtain_food, each said with what it takes and
// brings. 25588 (mid-231-bp, 2026-10-04 07:29 to 08:27Z) searched an ocean
// map for food for an hour and starved to 0.36 health with only the land's
// ways on offer.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const registry = require('minecraft-data')('26.1');
const { forageChoices, foodSupply } = require('../src/foraging');
const fishing = require('../src/fishing');
const { Task } = require('../src/skills');

// A stone bank at y 63 (the bot's feet at 64) with a pool east of it: x 2 to
// 8, z -3 to 3, four deep (y 60 to 63), open sky over all. `ice`: the
// pool's top row is ice.
function shore(items = [], { ice = false, pool = true } = {}) {
  const inPool = p => pool && p.x >= 2 && p.x <= 8 && p.z >= -3 && p.z <= 3 && p.y >= 60 && p.y <= 63;
  const block = p => {
    const q = new Vec3(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z));
    const name = inPool(q) ? (ice && q.y === 63 ? 'ice' : 'water') : q.y <= 63 ? 'stone' : 'air';
    return { name, position: q, boundingBox: name === 'stone' || name === 'ice' ? 'block' : 'empty' };
  };
  const bot = { registry, entity: { position: new Vec3(0.5, 64, 0.5), velocity: new Vec3(0, 0, 0), onGround: true, yaw: 0, pitch: 0 }, entities: {},
    game: { minY: 0, height: 70, dimension: 'overworld' }, time: { timeOfDay: 6000 }, health: 20, food: 10, oxygenLevel: 20,
    inventory: { items: () => items, emptySlotCount: () => 20 },
    world: { raycast: () => null }, blockAt: block,
    findBlocks: ({ matching }) => {
      if (matching !== registry.blocksByName.water.id) return [];
      const out = [];
      for (let x = 2; x <= 8; x++) for (let z = -3; z <= 3; z++) for (let y = 60; y <= 63; y++) if (block(new Vec3(x, y, z)).name === 'water') out.push(new Vec3(x, y, z));
      return out;
    },
    pathfinder: { movements: {}, getPathTo: () => ({ status: 'success', path: [] }), setGoal() {} },
    controls: {}, setControlState(k, v) { this.controls[k] = v; }, clearControlStates() { this.controls = {}; },
    lookAt: async () => {}, equip: async function (item) { this.heldItem = item; }, heldItem: null,
  };
  return bot;
}
const fish = (bot, id, name, x, y, z) => (bot.entities[id] = { id, name, height: name === 'cod' ? 0.3 : 0.4, position: new Vec3(x, y, z), isValid: true });

test('on the water with no land animal: before, the search alone; now a cod in open water and the rod are ways to food, with their numbers', async () => {
  const items = [], bot = shore(items);
  // Before: nothing but the search for a dry area (what 25588 was offered).
  assert.deepEqual(Object.keys(await forageChoices(bot, new Task('food'), {}, () => {}, {}, {})), ['search_food']);
  fish(bot, 7, 'cod', 4.5, 62.4, 0.5);
  items.push({ name: 'stone_sword', count: 1 }, { name: 'fishing_rod', count: 1, durabilityUsed: 4 });
  const choices = await forageChoices(bot, new Task('food'), {}, () => {}, {}, {});
  assert.deepEqual(Object.keys(choices).sort(), ['fish_with_rod', 'hunt_7', 'search_food']);
  const hunt = choices.hunt_7.description;
  assert.equal(hunt.animal, 'cod'); assert.equal(hunt.food, 'cod'); assert.equal(hunt.needsCooking, false);
  assert.equal(hunt.inWater, true); assert.equal(hunt.blocksUnderTheWatersTop, 1.5);
  assert.equal(hunt.blows, 1); assert.equal(hunt.pointsRaw, 2); assert.equal(hunt.pointsCooked, 5);
  assert.match(hunt.action, /kill it from the water's top \(3 health: one blow with the stone sword\)/);
  const rod = choices.fish_with_rod.description;
  assert.equal(rod.rod, 'carried, 60 casts left in it');
  // Twelve points wanted, none carried: six fish at two each, about 33 seconds a fish.
  assert.equal(rod.fishWanted, 6); assert.equal(rod.secondsAFish, 33); assert.equal(rod.catchSeconds, 198);
  assert.equal(rod.pointsExpectedRaw, 12); assert.equal(rod.pointsExpectedCooked, 32);
  assert.equal(rod.openSky, true); assert.equal(rod.walkSeconds, 0);
  assert.match(rod.action, /72 catches in 100 are a cod or a salmon \(2 hunger raw and safe to eat so, 5 and 6 cooked\)/);
  // The minutes to the food count the rod's wait (food-plan.js).
  assert.equal(require('../src/food-plan').minutesOf('fish_with_rod', choices.fish_with_rod, 'surface'), 198000);
});

test('bare hands take three blows, and the hunt says so', async () => {
  const bot = shore([]);
  fish(bot, 7, 'salmon', 4.5, 62.4, 0.5);
  const d = (await forageChoices(bot, new Task('food'), {}, () => {}, {}, {})).hunt_7.description;
  assert.equal(d.blows, 3); assert.equal(d.pointsCooked, 6);
  assert.match(d.action, /three blows|3 blows with bare hands/);
});

test('not a pufferfish or a tropical fish, not a fish under ice, not one deeper than the dive', async () => {
  const bot = shore([{ name: 'stone_sword', count: 1 }]);
  fish(bot, 1, 'pufferfish', 4.5, 62.4, 0.5); fish(bot, 2, 'tropical_fish', 4.5, 62.4, 1.5);
  assert.deepEqual(Object.keys(await forageChoices(bot, new Task('food'), {}, () => {}, {}, {})), ['search_food']);
  const iced = shore([{ name: 'stone_sword', count: 1 }, { name: 'fishing_rod', count: 1 }], { ice: true });
  fish(iced, 3, 'cod', 4.5, 61.4, 0.5);
  assert.equal(fishing.surfaceOver(iced, iced.entities[3].position), null);
  assert.deepEqual(Object.keys(await forageChoices(iced, new Task('food'), {}, () => {}, {}, {})), ['search_food'], 'no open water: neither the fish nor the rod');
  const deep = shore([]);
  deep.blockAt = (inner => p => (p.x >= 2 && p.x <= 8 && Math.abs(p.z) <= 3 && p.y >= 50 && p.y < 60 ? { name: 'water', boundingBox: 'empty', position: p } : inner(p)))(deep.blockAt);
  fish(deep, 4, 'cod', 4.5, 57.5, 0.5);
  assert.equal(fishing.surfaceOver(deep, deep.entities[4].position).depth, 6.4);
  assert.deepEqual(fishing.fishInView(deep), []);
});

test('the rod is offered with a rod or with two string to make one of, and not otherwise', async () => {
  const actions = { acquireStep: async () => {} };
  const none = shore([{ name: 'string', count: 1 }, { name: 'stick', count: 4 }]);
  assert.equal((await forageChoices(none, new Task('food'), {}, () => {}, actions, {})).fish_with_rod, undefined);
  const string = shore([{ name: 'string', count: 2 }]);
  const made = (await forageChoices(string, new Task('food'), {}, () => {}, actions, {})).fish_with_rod;
  assert.match(made.description.rod, /^made first from 3 sticks and 2 of the 2 string carried/);
  const dry = shore([{ name: 'fishing_rod', count: 1 }], { pool: false });
  assert.equal((await forageChoices(dry, new Task('food'), {}, () => {}, actions, {})).fish_with_rod, undefined, 'no water within 32 blocks');
});

test('the cast is from the bank cell right at the water, two cells out (the drill: three blocks back, 12 catches struck the bank and none was carried)', () => {
  const bot = shore([]);
  const spot = fishing.castSpot(bot);
  assert.deepEqual({ ...spot.stand }, { x: 1, y: 64, z: 0 });
  assert.deepEqual({ ...spot.water }, { x: 4, y: 63, z: 0 });
  assert.equal(spot.openSky, true);
});

// bot.fish() as the server answers it: each cast puts the next catch in the pockets.
function casting(bot, items, catches) {
  let casts = 0;
  bot.activateItem = () => {};
  bot.fish = async () => { const name = catches[casts++]; if (name === null) throw new Error('Fishing cancelled'); if (name) { const held = items.find(i => i.name === name); if (held) held.count++; else items.push({ name, count: 1 }); } };
  return () => casts;
}

test('fishing with the rod counts cod and salmon as food points, and the rest as caught', async () => {
  const items = [{ name: 'fishing_rod', count: 1 }], bot = shore(items), goal = {};
  const casts = casting(bot, items, ['cod', 'pufferfish', 'salmon', 'leather_boots', 'cod', 'cod']);
  const choices = await forageChoices(bot, new Task('food'), goal, () => {}, { navigate: async () => {} }, {}, { target: 6 });
  assert.equal(choices.fish_with_rod.description.fishWanted, 3);
  const result = await choices.fish_with_rod.run();
  assert.equal(casts(), 5, 'three food fish wanted: the fifth cast brings the third');
  assert.deepEqual(result.caught, { cod: 2, pufferfish: 1, salmon: 1, leather_boots: 1 });
  assert.equal(result.fish, 3);
  assert.equal(foodSupply(bot), 6, 'three fish at two points; the pufferfish is never food');
  assert.equal(goal.survivalAction.action, 'food_collected');
  assert.equal(goal.survivalAction.source, 'fishing_rod');
  assert.equal(goal.survivalAction.foodPointsGained, 6);
});

test('two casts with no bite end it, said, and the rod rests five minutes', async () => {
  const items = [{ name: 'fishing_rod', count: 1 }], bot = shore(items), goal = {};
  casting(bot, items, [null, null]);
  const choices = await forageChoices(bot, new Task('food'), goal, () => {}, { navigate: async () => {} }, {});
  await assert.rejects(choices.fish_with_rod.run(), /No bite in 2 casts at the water at \(4, 63, 0\)/);
  assert.equal((await forageChoices(bot, new Task('food'), goal, () => {}, {}, {})).fish_with_rod, undefined);
});

test('a cod in reach is struck from where the bot stands and its fish picked up: two points', async () => {
  const items = [{ name: 'stone_sword', count: 1 }], bot = shore(items), goal = {};
  bot.entity.position = new Vec3(1.5, 64, 0.5);
  const cod = fish(bot, 7, 'cod', 2.6, 63.2, 0.5);
  let swings = 0;
  bot.attack = target => { swings++; delete bot.entities[target.id]; items.push({ name: 'cod', count: 1 }); };
  const choices = await forageChoices(bot, new Task('food'), goal, () => {}, { navigate: async () => { throw new Error('no walk is needed'); } }, {});
  await choices.hunt_7.run();
  assert.equal(swings, 1); assert.equal(cod.isValid, true);
  assert.equal(foodSupply(bot), 2);
  assert.equal(goal.survivalAction.action, 'food_collected');
  assert.equal(goal.survivalAction.source, 'cod'); assert.equal(goal.survivalAction.foodPointsGained, 2);
});

test('the food known lists a cod in open water with its points, and the ways say what fish take', () => {
  const bot = shore([]);
  fish(bot, 7, 'cod', 4.5, 62.4, 0.5); fish(bot, 8, 'cod', 5.5, 62.4, 0.5);
  const sources = require('../src/healing').foodSources(bot, {});
  assert.equal(sources.length, 1);
  assert.equal(sources[0].animal, 'cod'); assert.equal(sources[0].count, 2); assert.equal(sources[0].points, 10);
  assert.equal(sources[0].says, '2 cod in open water in view, 4 blocks off');
  assert.equal(require('../src/healing').RAW_MEAT_POINTS.cod, 2);
  assert.match(require('../src/food-facts').overworldWays(bot), /a fishing rod, 3 sticks and 2 string from spiders, brings a catch each 5 to 30 seconds from the bank/);
});
