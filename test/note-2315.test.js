'use strict';
// The wait on a batch Jev chose to leave says so, and the run's standing at furnaces (note 2315).
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { Task } = require('../src/skills');
const registry = require('minecraft-data')('26.1');

test('the wait on a left batch says the leaving and what the run has stood at furnaces, and a wait taken is counted', async () => {
  const { breakStillness } = require('../src/work');
  const bot = { registry, game: { dimension: 'overworld', gameMode: 'survival', difficulty: 'normal' }, health: 20, food: 18, isAlive: true, chat() {}, emit() {},
    entity: { id: 1, position: new Vec3(104.5, 52, 504.5), onGround: true }, time: { timeOfDay: 6000 }, entities: {},
    inventory: { items: () => [{ name: 'stone_pickaxe', count: 1, type: registry.itemsByName.stone_pickaxe.id }], slots: {}, emptySlotCount: () => 30 },
    blockAt: () => ({ name: 'stone', boundingBox: 'block', position: new Vec3(0, 0, 0) }), findBlocks: () => [], findBlock: () => null, nearestEntity: () => null };
  const goal = { version: 1, kind: 'win', request: 'beat the game', survival: {}, step: { action: 'smelt', item: 'cooked_mutton', count: 7, from: 'mutton' },
    smelting: { item: 'cooked_mutton', count: 7, startedAt: Date.now() - 10000, position: { x: 104, y: 51, z: 505 } }, cookWaits: { n: 4, ms: 150000 } };
  bot._cookHold = { until: Date.now() + 50000, item: 'cooked_mutton', leftAt: Date.now() - 12000 };
  let asked = null;
  const client = { model: 'jev', systemOne: async ({ questions }) => { asked = Object.values(questions)[0]; return { answers: Object.fromEntries(Object.keys(questions).map(k => [k, { choice: 'wait_it_out', confidence: 0.8 }])) }; } };
  const log = console.log; console.log = () => {};
  try {
    await breakStillness(bot, new Task('still'), goal, () => {}, { client, reason: 'smelt:cooked_mutton', until: Date.now() + 50000, holding: { minutes: 1, why: '7 mutton cooking in the furnace at (104, 51, 505), taken out when done' },
      answers: { wood_reserve: { description: 'Gather wood for sticks and a table.', run: async () => {} } } });
  } finally { console.log = log; }
  const text = asked.criteria?.wait_it_out?.description || asked.options?.wait_it_out || JSON.stringify(asked).match(/Wait here[^"]*/)?.[0];
  assert.match(text, /Leaving this batch to work meanwhile was chosen 1[12] seconds ago\. This run has stood out 4 batches at a furnace so far, 2\.5 minutes in all\./);
  assert.doesNotMatch(text, /spends no hunger/);
  assert.equal(goal.cookWaits.n, 5);
});
