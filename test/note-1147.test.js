'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const registry = require('prismarine-registry')('26.1');
const { Task } = require('../src/skills');
const { prepareEndSupplies } = require('../src/end-supplies');

function fixture(counts = {}) {
  const slots = [], items = ['iron_sword', 'iron_pickaxe', 'bow', 'arrow', 'cobblestone', 'cooked_beef', 'water_bucket', 'water_bucket', 'white_bed'].map(name => ({ name,
    count: ({ arrow: 192, cobblestone: 64, cooked_beef: 8, white_bed: 4, ...counts })[name] || 1, durabilityUsed: 0 }));
  for (const [slot, name] of [[5, 'iron_helmet'], [6, 'iron_chestplate'], [7, 'iron_leggings'], [8, 'iron_boots'], [45, 'shield']]) slots[slot] = { name, count: 1, durabilityUsed: 0 };
  const bot = { registry, health: 20, food: 20, oxygenLevel: 20, inventory: { slots, items: () => items.filter(i => i.count > 0) }, heldItem: items[0] };
  return { bot, items, goal: {}, task: new Task('End supplies') };
}
const jev = (answers, asked) => ({ systemOne: async ({ questions }) => { asked.push(questions.branch_0.criteria); return { answers: { branch_0: { choice: answers.shift(), confidence: 0.7 } } }; } });

test('the End\'s kit is Jev\'s: with 40 arrows and two beds, going now is offered beside each top-up, each said with what it is for (note 1147)', async () => {
  const { bot, goal, task } = fixture({ arrow: 40, white_bed: 2 });
  const asked = [], calls = [];
  const actions = { acquireStep: async (b, t, name, count) => calls.push({ name, count }) };
  assert.equal(await prepareEndSupplies(bot, task, goal, () => {}, actions, jev(['enter_now'], asked)), true);
  assert.deepEqual(Object.keys(asked[0]).filter(k => k !== 'none_good').sort(), ['enter_now', 'top_up_arrows', 'top_up_beds']);
  assert.match(asked[0].enter_now, /Go to the End with what is carried now: a bow, arrows 40 of 192, blocks 64 of 64, an iron pickaxe or better, water 2 of 2, beds 2 of 4, food \d+ of 64, health 20 of 18; health 20\. Short of what the code would take: arrows, beds\./);
  assert.match(asked[0].enter_now, /107 arrows loosed in 36 minutes took the dragon's last 166\.5 of 200 health, the bot alive at the end: about 130 arrows for the whole 200 by the bow alone/);
  assert.match(asked[0].enter_now, /no way back out of the End but the dragon's death or the bot's own/);
  assert.match(asked[0].top_up_arrows, /40 carried, the code would take 192\..*arrows come only from skeletons, none to two each.*until 72 are carried or a quarter hour has gone/);
  assert.match(asked[0].top_up_beds, /Make beds up to 4 first \(2 carried\)/);
  assert.deepEqual(calls, [], 'nothing fetched: it goes');
  assert.equal(goal.preparingEnd, undefined);
  // Asked once: going now holds while the kit is as it was.
  assert.equal(await prepareEndSupplies(bot, task, goal, () => {}, actions, jev([], asked)), true);
  assert.equal(asked.length, 1);
});

test('arrows are topped up thirty-two at a time, and the question asked again when they are carried', async () => {
  const { bot, items, goal, task } = fixture({ arrow: 40 });
  const asked = [], calls = [], answers = ['top_up_arrows', 'enter_now'];
  const actions = { acquireStep: async (b, t, name, count) => { calls.push({ name, count }); } };
  assert.equal(await prepareEndSupplies(bot, task, goal, () => {}, actions, jev(answers, asked)), false);
  assert.deepEqual(calls, [{ name: 'arrow', count: 72 }]);
  // Still short of the 72: the hunt goes on with no new question.
  items.find(i => i.name === 'arrow').count = 55;
  assert.equal(await prepareEndSupplies(bot, task, goal, () => {}, actions, jev(answers, asked)), false);
  assert.equal(asked.length, 1);
  assert.deepEqual(calls.at(-1), { name: 'arrow', count: 72 });
  // At 72 it is asked again.
  items.find(i => i.name === 'arrow').count = 72;
  assert.equal(await prepareEndSupplies(bot, task, goal, () => {}, actions, jev(answers, asked)), true);
  assert.equal(asked.length, 2);
  assert.match(asked[1].top_up_arrows, /72 carried.*until 104 are carried/);
});

test('with the whole kit carried nothing is asked', async () => {
  const { bot, goal, task } = fixture();
  assert.equal(await prepareEndSupplies(bot, task, goal, () => {}, { acquireStep: async () => assert.fail('nothing to fetch') }, { systemOne: async () => assert.fail('not asked') }), true);
});

test('food chosen for the End is gathered by the step itself, not left to the survival layer (note 1158)', async () => {
  const { bot, items, goal, task } = fixture();
  items.find(i => i.name === 'cooked_beef').count = 2;
  const asked = [], calls = [];
  const actions = { acquireStep: async () => assert.fail('no item to fetch'), gatherFood: async () => { calls.push('food'); } };
  assert.equal(await prepareEndSupplies(bot, task, goal, () => {}, actions, jev(['top_up_food'], asked)), false);
  assert.deepEqual(calls, ['food']);
  assert.equal(goal.step.action, 'prepare_end_supplies');
  assert.equal(goal.step.item, 'food');
});
