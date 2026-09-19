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

test('raw chicken is carried ingredient evidence, never edible reserve', () => {
  const items = [{ name: 'chicken', count: 16 }], bot = fixture(items);
  assert.equal(foodSupply(bot), 0); assert.equal(chooseFood(bot), undefined);
  items.push({ name: 'cooked_chicken', count: 2 });
  assert.equal(foodSupply(bot), 12); assert.equal(chooseFood(bot).name, 'cooked_chicken');
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
  assert(!choices.search_food);
  assert.equal(choices.cook_cooked_chicken.description.safeToEatRaw, false);
  await choices.cook_cooked_chicken.run();
  assert(plan.some(s => s.item === 'wooden_pickaxe'));
  assert(plan.some(s => s.item === 'furnace'));
  assert.equal(plan.at(-1).action, 'smelt');
  assert.equal(plan.at(-1).from, 'chicken');
  assert(plan.at(-1).consumes.oak_planks > 0);
  assert.equal(foodSupply(bot), 0, 'Planning cooking must not count unmade food');
});

test('chicken hunting requires actual ingredient pickup and does not claim edible food', async () => {
  for (const pickedUp of [true, false]) {
    const items = [], bot = fixture(items), goal = {};
    const chicken = { id: 1, name: 'chicken', height: 0.7, position: new Vec3(2, 64, 0.5), isValid: true };
    bot.entities[1] = chicken;
    bot.attack = () => { chicken.isValid = false; if (pickedUp) items.push({ name: 'chicken', count: 1 }); };
    assert((await forageChoices(bot, new Task('test', 'choices'), goal, () => {}, {}, {})).hunt_1);
    const attempt = hunt(bot, new Task('test', 'hunt'), chicken, {}, goal, () => {});
    if (pickedUp) {
      await attempt;
      assert.equal(goal.survivalAction.count, 1);
      assert.equal(goal.survivalAction.needsCooking, true);
      assert.equal(goal.survivalAction.foodPointsGained, 0);
    } else await assert.rejects(attempt, /No food ingredient pickup confirmed/);
  }
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
  assert(!choices.search_food);
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
  assert.deepEqual(Object.keys(choices), ['hunt_1', 'hunt_2']);
  assert(choices.hunt_1.valid());
  rabbit.metadata[registry.entitiesByName.rabbit.metadataKeys.indexOf('type')] = 99;
  assert(!choices.hunt_1.valid(), 'Recheck animal eligibility after the model decision');
  await assert.rejects(hunt(bot, new Task('test', 'hunt'), rabbit, {}, {}, () => {}), /not an eligible passive adult/);
});

test('rabbit hunt verifies real meat pickup and exposes its catalog cooking dependency', async () => {
  const items = [], bot = fixture(items), goal = {};
  const rabbit = { id: 1, name: 'rabbit', height: 0.6, isValid: true, position: new Vec3(2, 64, 0.5) };
  bot.entities[1] = rabbit;
  bot.attack = () => { rabbit.isValid = false; items.push({ name: 'rabbit', count: 1 }); };
  await hunt(bot, new Task('test', 'hunt'), rabbit, {}, goal, () => {});
  assert.equal(goal.survivalAction.item, 'rabbit');
  assert.equal(goal.survivalAction.count, 1);
  assert.equal(goal.survivalAction.foodPointsGained, 3);
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
