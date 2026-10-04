// Note 1143: 25591 (2026-10-04 00:04 to 00:09Z), no food at hunger 14 to 13,
// crossed four times in five minutes, each turned back for food within
// twenty seconds; its crossing offered no food.
const test = require('node:test');
const assert = require('node:assert');
const { Vec3 } = require('vec3');
const { Task } = require('../src/skills');

const botOf = (food, items) => ({ registry: require('minecraft-data')('26.1'), health: 20, food, game: { gameMode: 'survival', dimension: 'overworld', difficulty: 'normal' }, entity: { position: new Vec3(0.5, 64, 0.5) }, entities: {},
  inventory: { items: () => items, slots: [] }, blockAt: p => ({ name: p.y < 64 ? 'stone' : 'air', position: p, boundingBox: p.y < 64 ? 'block' : 'empty' }), findBlocks: () => [] });
const kit = [{ name: 'cobblestone', count: 128 }, { name: 'iron_pickaxe', count: 2 }, { name: 'golden_boots', count: 1 }, { name: 'oak_log', count: 8 }, { name: 'crafting_table', count: 1 }, { name: 'chest', count: 1 }];

test('no food carried at hunger 13 with the food step set aside by going without: the food is offered back at the crossing', async () => {
  const { crossingKitReady } = require('../src/work');
  const goal = { foodTurnBack: { at: Date.now() - 60000 } };
  require('../src/progress').setAside(goal, 'rung', 'nether_food', 'Jev chose to go without: the Nether first', 1800000);
  let offered = null;
  const client = { systemOne: async ({ questions }) => { offered = questions.branch_0.criteria; return { answers: { branch_0: { choice: 'take_up_food', confidence: 0.6 } } }; } };
  assert.equal(await crossingKitReady(botOf(13, kit), new Task('win'), goal, () => {}, client), false);
  assert(offered.take_up_food, 'the food step offered back');
  assert.match(offered.take_up_food, /it is empty now, 0 of \d+ carried/);
  assert.match(offered.cross_now, /The last crossing turned back through the portal for food 1 minute ago/);
  assert.equal(require('../src/progress').isSetAside(goal, 'rung', 'nether_food'), false, 'its rest lifted');
});

test('no food carried at hunger 13 and no crossing turned back: going without still holds, as chosen', async () => {
  const { crossingKitReady } = require('../src/work');
  const goal = {};
  require('../src/progress').setAside(goal, 'rung', 'nether_food', 'Jev chose to go without: the Nether first', 1800000);
  let offered = null;
  const client = { systemOne: async ({ questions }) => { offered = questions.branch_0.criteria; return { answers: { branch_0: { choice: 'cross_now', confidence: 0.6 } } }; } };
  await crossingKitReady(botOf(13, kit), new Task('win'), goal, () => {}, client);
  assert.ok(!offered || !offered.take_up_food);
});
