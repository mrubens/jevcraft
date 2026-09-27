'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const registry = require('minecraft-data')('26.1');
const { foodSupply, forageChoices, hunt } = require('../src/foraging');
const { chooseFood } = require('../src/vitals');
const { planCatalog } = require('../src/knowledge');
const { Task } = require('../src/skills');

function fixture(items = []) {
  return { registry, entity: { position: new Vec3(0.5, 64, 0.5) }, entities: {},
    game: { minY: 0, height: 70 }, inventory: { items: () => items },
    world: { raycast: () => null },
    blockAt: p => ({ name: p.y < 64 ? 'stone' : 'air', boundingBox: p.y < 64 ? 'block' : 'empty' }),
    pathfinder: { movements: {}, getPathTo: () => ({ status: 'success', path: [] }), setGoal() {} },
    clearControlStates() {}, lookAt: async () => {},
  };
}

test('a hunt names every hostile near the animal, a creeper beyond it too (the decision audit)', async () => {
  const bot = fixture([{ name: 'stone_sword', count: 1 }]);
  bot.time = { timeOfDay: 6000 };
  bot.entities[1] = { id: 1, name: 'rabbit', position: new Vec3(-3, 64, .5), isValid: true };
  // Twenty-seven blocks past the rabbit, thirty from the bot: beyond the old look.
  bot.entities[2] = { id: 2, name: 'creeper', position: new Vec3(-30, 64, .5), height: 1.7, isValid: true };
  const choices = await forageChoices(bot, new Task('food'), {}, () => {}, {}, {});
  assert.deepEqual(choices.hunt_1.description.nearestHostileToIt, { name: 'creeper', distance: 27 });
  assert.equal(choices.hunt_1.description.hostilesWithin32OfIt.creepers, 1);
});

test('raw chicken is carried ingredient evidence, never edible reserve', () => {
  const items = [{ name: 'chicken', count: 16 }], bot = fixture(items);
  assert.equal(foodSupply(bot), 0); assert.equal(chooseFood(bot), undefined);
  items.push({ name: 'cooked_chicken', count: 2 });
  assert.equal(foodSupply(bot), 12); assert.equal(chooseFood(bot).name, 'cooked_chicken');
});

test('observed prey and nearby wood let Jev prepare a real hunting sword; carried weapons remove that choice', async () => {
  const items = [], bot = fixture(items), goal = {};
  bot.entities[1] = { id: 1, name: 'rabbit', position: new Vec3(3, 64, .5), isValid: true };
  bot.findBlocks = () => [new Vec3(8, 64, 0)];
  let planned;
  const actions = { acquireStep: async (b, t, item, count) => {
    planned = planCatalog(registry, item, count, {}, { nearby: ['oak_log'] });
  } };
  const choices = await forageChoices(bot, new Task('food'), goal, () => {}, actions, {});
  assert(choices.hunt_1); assert(choices.prepare_hunting_sword);
  await choices.prepare_hunting_sword.run();
  assert(planned.some(step => step.item === 'crafting_table'));
  assert.equal(planned.at(-1).item, 'wooden_sword');
  assert.equal(foodSupply(bot), 0);
  items.push({ name: 'stone_axe', count: 1 });
  assert.equal((await forageChoices(bot, new Task('food'), goal, () => {}, actions, {})).prepare_hunting_sword, undefined);
});

test('carried raw chicken exposes catalog cooking and plans real furnace, tool and fuel dependencies', async () => {
  const bot = fixture([{ name: 'chicken', count: 3 }]);
  let plan;
  const choices = await forageChoices(bot, new Task('test', 'food'), {}, () => {}, {
    acquireStep: async (b, t, output, quantity) => {
      assert.equal(output, 'cooked_chicken'); assert.equal(quantity, 2);
      plan = planCatalog(registry, output, quantity, { chicken: 3 }, { nearby: ['oak_log', 'stone'] });
    },
  }, {});
  assert(choices.search_food, 'a search is always on offer beside the rest');
  assert.equal(choices.cook_cooked_chicken.description.safeToEatRaw, false);
  await choices.cook_cooked_chicken.run();
  assert(plan.some(s => s.item === 'wooden_pickaxe'));
  assert(plan.some(s => s.item === 'furnace'));
  assert.equal(plan.at(-1).action, 'smelt');
  assert.equal(plan.at(-1).from, 'chicken');
  assert(plan.at(-1).consumes.oak_planks > 0);
  assert.equal(foodSupply(bot), 0, 'Planning cooking must not count unmade food');
});

test('a chicken or a pig in view is never offered as food', async () => {
  // The user, 2026-09-25: "never hurt a chicken", "or a pig".
  const items = [], bot = fixture(items), goal = {};
  bot.entities[1] = { id: 1, name: 'chicken', height: 0.7, position: new Vec3(2, 64, 0.5), isValid: true };
  bot.entities[2] = { id: 2, name: 'pig', height: 0.9, position: new Vec3(3, 64, 0.5), isValid: true };
  const choices = await forageChoices(bot, new Task('test', 'choices'), goal, () => {}, {}, {});
  assert(!Object.keys(choices || {}).some(k => /^hunt_/.test(k)), JSON.stringify(Object.keys(choices || {})));
});

test('food surveys continue partial paths and keep only completed surface routes', async () => {
  const bot = fixture(), task = new Task('test', 'survey food');
  for (let id = 1; id <= 3; id++) bot.entities[id] = { id, name: 'sheep', isValid: true, position: new Vec3(id * 3, 64, 0.5) };
  let surveyed = 0;
  bot.pathfinder.getPathTo = () => { throw new Error('First-slice paths must not decide food reachability'); };
  bot.pathfinder.getPathFromTo = function* () {
    const n = ++surveyed;
    yield { result: { status: 'partial', path: [] } };
    yield { result: n === 1 ? { status: 'noPath', path: [] } :
      { status: 'success', path: [new Vec3(n * 3, n === 2 ? 64 : 60, 0.5)] } };
  };
  const choices = await forageChoices(bot, task, {}, () => {}, {}, {});
  assert(choices.hunt_2, 'The completed surface route exposes the animal to Jev');
  assert(!choices.hunt_1, 'A completed noPath result remains unavailable');
  assert(!choices.hunt_3, 'A route through underground terrain remains unavailable');
  assert(choices.search_food, 'a search is always on offer beside the rest');
  assert.equal(bot.pathfinder.movements.allowedPosition, undefined);
});

test('food route surveys are bounded and cancellation restores movement policy', async () => {
  const bot = fixture(), task = new Task('test', 'survey food');
  for (let id = 1; id <= 10; id++) bot.entities[id] = { id, name: 'cow', isValid: true, position: new Vec3(id * 2, 64, 0.5) };
  let surveyed = 0;
  bot.pathfinder.getPathFromTo = function* () { surveyed++; yield { result: { status: 'noPath', path: [] } }; };
  assert((await forageChoices(bot, task, {}, () => {}, {}, {})).search_food);
  assert.equal(surveyed, 8);

  const allowed = () => true;
  bot.pathfinder.movements.allowedPosition = allowed;
  bot.pathfinder.getPathFromTo = function* () {
    yield { result: { status: 'partial', path: [] } };
    task.cancel(); yield { result: { status: 'success', path: [] } };
  };
  await assert.rejects(forageChoices(bot, task, {}, () => {}, {}, {}), { name: 'Cancelled' });
  assert.equal(bot.pathfinder.movements.allowedPosition, allowed);
});

test('surface food choices include rabbits and mooshrooms, but exclude babies and hostile rabbits', async () => {
  const bot = fixture();
  const entity = (id, name, values = {}) => {
    const metadata = [];
    for (const [key, value] of Object.entries(values)) metadata[registry.entitiesByName[name].metadataKeys.indexOf(key)] = value;
    return bot.entities[id] = { id, name, metadata, isValid: true, position: new Vec3(id + 1, 64, 0.5) };
  };
  const rabbit = entity(1, 'rabbit', { baby: false, type: 1 });
  entity(2, 'mooshroom', { baby: false });
  entity(3, 'rabbit', { baby: true, type: 1 });
  entity(4, 'rabbit', { baby: false, type: 99 });
  entity(5, 'cow', { baby: true });
  entity(6, 'salmon');
  const choices = await forageChoices(bot, new Task('test', 'food'), {}, () => {}, {}, {});
  assert.equal(choices.hunt_1.description.food, 'rabbit');
  assert.equal(choices.hunt_2.description.food, 'beef');
  assert.deepEqual(Object.keys(choices), ['hunt_1', 'hunt_2', 'search_food']);
  assert(choices.hunt_1.valid());
  rabbit.metadata[registry.entitiesByName.rabbit.metadataKeys.indexOf('type')] = 99;
  assert(!choices.hunt_1.valid(), 'Recheck animal eligibility after the model decision');
  await assert.rejects(hunt(bot, new Task('test', 'hunt'), rabbit, {}, {}, () => {}), /not an eligible passive adult/);
});

test('rabbit hunt verifies real meat pickup and exposes its catalog cooking dependency', async () => {
  const items = [], bot = fixture(items), goal = { search: { 'food animals': { attempts: 110, leg: 9, visited: { old: 2 } } } };
  const rabbit = { id: 1, name: 'rabbit', height: 0.6, isValid: true, position: new Vec3(2, 64, 0.5) };
  bot.entities[1] = rabbit;
  bot.attack = () => { rabbit.isValid = false; items.push({ name: 'rabbit', count: 1 }); };
  await hunt(bot, new Task('test', 'hunt'), rabbit, {}, goal, () => {});
  assert.equal(goal.survivalAction.item, 'rabbit');
  assert.equal(goal.survivalAction.count, 1);
  assert.equal(goal.survivalAction.foodPointsGained, 3);
  assert.deepEqual(goal.search['food animals'], { attempts: 0, leg: 9, visited: { old: 2 } }, 'Confirmed pickup resets only the no-progress budget, preserving search coverage');
  assert.equal(foodSupply(bot), 3);
  let plan;
  const choices = await forageChoices(bot, new Task('test', 'cook'), goal, () => {}, {
    acquireStep: async (b, t, output, amount) => {
      assert.equal(output, 'cooked_rabbit'); assert.equal(amount, 1);
      plan = planCatalog(registry, output, amount, { rabbit: 1 }, { nearby: ['oak_log', 'stone'] });
    },
  }, {});
  await choices.cook_cooked_rabbit.run();
  assert.equal(plan.at(-1).action, 'smelt');
  assert.equal(plan.at(-1).from, 'rabbit');
  assert(plan.some(step => step.item === 'furnace'));
  assert.equal(foodSupply(bot), 3, 'An unexecuted cooking plan creates no food');
});

test('a search that finds no dry ground to walk to is rested, so it is not chosen again at once', async () => {
  // mid-92-d: on a lily pad in the open sea, "search for animals" chosen 385 times in eight minutes, failing at once each time.
  const bot = fixture([]);
  bot.time = { timeOfDay: 6000 };
  const goal = {};
  const actions = { explore: async () => { throw new Error('No reachable surveyed ground while searching for food animals'); } };
  const first = await forageChoices(bot, new Task('food'), goal, () => {}, actions, {});
  await assert.rejects(first.search_food.run(), /No reachable surveyed ground/);
  const again = await forageChoices(bot, new Task('food'), goal, () => {}, actions, {});
  assert.equal(again.search_food, undefined, 'rested after finding nowhere to walk');
});

test('a food step gives the work its threat check back when it ends, not nothing (mid-231-o: a creeper went unanswered after)', async () => {
  const bot = fixture([{ name: 'chicken', count: 3 }]), task = new Task('test', 'food');
  const outer = () => {};
  task.interruptCheck = outer;
  const choices = await forageChoices(bot, task, {}, () => {}, { acquireStep: async () => {} }, {});
  await choices.cook_cooked_chicken.run();
  assert.equal(task.interruptCheck, outer);
});

test('the food search says the climb out, the health and whether it comes back, and the mobs about (mid-207-l)', async () => {
  const bot = fixture([]);
  bot.game.dimension = 'overworld'; bot.health = 5.2; bot.food = 16; bot.time = { timeOfDay: 8867 };
  bot.entity.position = new Vec3(0.5, 20, 0.5);
  bot.blockAt = p => ({ name: p.y > 20 && p.y < 40 ? 'stone' : p.y < 20 ? 'stone' : 'air', boundingBox: p.y < 20 || (p.y > 21 && p.y < 40) ? 'block' : 'empty', position: p });
  bot.entities[1] = { id: 1, name: 'zombie', type: 'hostile', position: new Vec3(6, 20, 0.5), height: 1.9, isValid: true };
  const d = (await forageChoices(bot, new Task('food'), {}, () => {}, {}, {})).search_food.description;
  assert.equal(d.healthNow, 5);
  assert.match(d.healing, /none meanwhile: hunger 16/);
  assert.match(d.climbFirst, /up to the surface first/);
  assert.match(d.hostilesWithin24, /1 zombie/);
});

test('rotten flesh is counted beside the reserve, its points and its Hunger said; the reserve stays safe food (note 515)', () => {
  // Several of the day's low-health deaths carried rotten flesh and were told "0 food points carried".
  const { lastResortSupply } = require('../src/foraging');
  const bot = fixture([{ name: 'rotten_flesh', count: 3 }, { name: 'rotten_flesh', count: 2 }, { name: 'bread', count: 1 }]);
  assert.equal(foodSupply(bot), 5, 'the reserve is the bread');
  const last = lastResortSupply(bot);
  assert.equal(last.points, 20);
  assert.match(last.says, /^5 rotten flesh, 4 hunger each; each eaten has a 80% chance of Hunger for 30 seconds, which spends about 0\.75 of a hunger point/);
  assert.equal(lastResortSupply(fixture([{ name: 'bread', count: 2 }])).points, 0);
});
