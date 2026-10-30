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
  // The crossing's question kept; the food step it runs then (note 1969) asks its own, answered with its first option.
  const client = { systemOne: async ({ questions }) => { const c = questions.branch_0.criteria; offered ||= c; return { answers: { branch_0: { choice: c.take_up_food ? 'take_up_food' : (Object.keys(c).find(k => /^top_up_food/.test(k)) || Object.keys(c).find(k => k !== 'none_good' && k !== 'go_without') || Object.keys(c)[0]), confidence: 0.6 } } }; } };
  assert.equal(await crossingKitReady(bot, new Task('win'), goal, () => {}, client), false);
  assert(offered.take_up_food, 'the food step offered back');
  assert.match(offered.take_up_food, /Get the Nether's food here first, before crossing: 12 of \d+ points carried/);
  assert.match(offered.cross_now, /12 food points, about 18 minutes of it at 40 an hour/);
  assert.doesNotMatch(offered.cross_now, /No food at all is carried/);
  // Taken up: the food trip set and the food step run at once (note 1969); here it finds no food about and rests on its own account.
  assert.ok(goal.kitFood, 'the food step ran');
});
