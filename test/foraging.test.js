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
  const choices = forageChoices(bot, new Task('test', 'food'), {}, () => {}, {
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
    assert(forageChoices(bot, new Task('test', 'choices'), goal, () => {}, {}, {}).hunt_1);
    const attempt = hunt(bot, new Task('test', 'hunt'), chicken, {}, goal, () => {});
    if (pickedUp) {
      await attempt;
      assert.equal(goal.survivalAction.count, 1);
      assert.equal(goal.survivalAction.needsCooking, true);
      assert.equal(goal.survivalAction.foodPointsGained, 0);
    } else await assert.rejects(attempt, /No food ingredient pickup confirmed/);
  }
});
