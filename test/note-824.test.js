// Note 824: 25583 (mid-230-bb, 2026-10-01 13:32Z) crossed with 12 of 80
// food points, the food step resting from its stall, and the crossing
// offered no food; it ran out at the fortress and died at 3.5 health.
const test = require('node:test');
const assert = require('node:assert');
const { Vec3 } = require('vec3');
const { Task } = require('../src/skills');

test('25583: food under the Nether reserve with its step set aside is offered back at the crossing, said with the reserve', async () => {
  const { crossingKitReady } = require('../src/work');
  const registry = require('minecraft-data')('26.1');
  const items = [{ name: 'cobblestone', count: 128 }, { name: 'cooked_mutton', count: 2 }, { name: 'iron_pickaxe', count: 2 }, { name: 'golden_boots', count: 1 }, { name: 'oak_log', count: 8 }, { name: 'crafting_table', count: 1 }, { name: 'chest', count: 1 }];
  const bot = { registry, health: 20, food: 18, game: { gameMode: 'survival', dimension: 'overworld', difficulty: 'normal' }, entity: { position: new Vec3(0.5, 64, 0.5) }, entities: {},
    inventory: { items: () => items, slots: [] }, blockAt: p => ({ name: p.y < 64 ? 'stone' : 'air', position: p, boundingBox: p.y < 64 ? 'block' : 'empty' }), findBlocks: () => [] };
  const goal = {};
  require('../src/progress').setAside(goal, 'rung', 'nether_food', 'ten working minutes on the food for the Nether without a point more', 1800000);
  let offered = null;
  const client = { systemOne: async ({ questions }) => { offered = questions.branch_0.criteria; return { answers: { branch_0: { choice: 'take_up_food', confidence: 0.6 } } }; } };
  assert.equal(await crossingKitReady(bot, new Task('win'), goal, () => {}, client), false);
  assert(offered.take_up_food, 'the food step offered back');
  assert.match(offered.take_up_food, /12 of \d+ points carried, under the Nether's reserve of 36/);
  assert.doesNotMatch(offered.cross_now, /No food at all is carried/);
  assert.equal(require('../src/progress').isSetAside(goal, 'rung', 'nether_food'), false, 'its rest lifted');
});
