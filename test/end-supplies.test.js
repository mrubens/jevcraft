'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const registry = require('prismarine-registry')('26.1');
const { Task } = require('../src/skills');
const { prepareEndSupplies, kitItems } = require('../src/end-supplies');
function fixture() {
  const slots = [], items = ['iron_sword', 'iron_pickaxe', 'bow', 'arrow', 'cobblestone', 'cooked_beef', 'water_bucket', 'water_bucket', 'white_bed'].map(name => ({ name,
    count: ({ arrow: 64, cobblestone: 64, cooked_beef: 8, white_bed: 4 })[name] || 1, durabilityUsed: 0 }));
  for (const [slot, name] of [[5, 'iron_helmet'], [6, 'iron_chestplate'], [7, 'iron_leggings'], [8, 'iron_boots'], [45, 'shield']]) slots[slot] = { name, count: 1, durabilityUsed: 0 };
  const bot = { registry, health: 20, food: 20, oxygenLevel: 20, inventory: { slots, items: () => items }, heldItem: items[0] };
  return { bot, items, goal: {}, task: new Task('End supplies') };
}
test('End preparation acquires a new bow when worn and requires real arrow, bridge and food reserves', async () => {
  for (const missing of ['bow', 'arrow', 'cobblestone', 'water_bucket', 'cooked_beef', null]) {
    const { bot, items, goal, task } = fixture(); const calls = [];
    const item = items.find(i => i.name === missing);
    if (missing === 'bow') item.durabilityUsed = registry.itemsByName.bow.maxDurability - 1;
    else if (item) item.count--;
    const ready = await prepareEndSupplies(bot, task, goal, () => {}, { acquireStep: async (b, t, name, count) => calls.push({ name, count }) });
    assert.equal(ready, missing === null);
    if (missing === 'bow') assert.deepEqual(calls, [{ name: 'bow', count: 2 }]);
    if (missing === 'arrow') assert.deepEqual(calls, [{ name: 'arrow', count: 64 }]);
    if (missing === 'cobblestone') assert.deepEqual(calls, [{ name: 'cobblestone', count: 64 }]);
    // Two buckets: one for a landing, one against an enderman.
    if (missing === 'water_bucket') assert.deepEqual(calls, [{ name: 'water_bucket', count: 2 }]);
    if (missing === 'cooked_beef') { assert.deepEqual(calls, []); assert.equal(goal.preparingEnd, true); }
    if (!missing) assert.equal(goal.preparingEnd, undefined);
  }
});

test('four beds for the End: made from carried wool, and given up after twenty minutes of trying', async () => {
  const { bot, items, goal, task } = fixture();
  items.find(i => i.name === 'white_bed').count = 2;
  items.push({ name: 'black_wool', count: 3 });
  const calls = [];
  assert.equal(await prepareEndSupplies(bot, task, goal, () => {}, { acquireStep: async (b, t, name, count) => calls.push({ name, count }) }), false);
  assert.deepEqual(calls, [{ name: 'black_bed', count: 1 }]);
  goal.endBeds.startedAt = Date.now() - 21 * 60000;
  items.pop();
  assert.equal(await prepareEndSupplies(bot, task, goal, () => {}, { acquireStep: async () => assert.fail('no more bed hunting') }), true);
});

test('a top-up taken up a while: its time and what the count did meanwhile are said beside it (note 1307)', async () => {
  const { bot, items, goal, task } = fixture();
  const bow = items.find(i => i.name === 'bow'); bow.durabilityUsed = registry.itemsByName.bow.maxDurability - 1;
  goal.endKit = { spent: { bow: { ms: 40 * 60000, since: Date.parse('2026-10-05T17:04:00Z'), from: 0 } } };
  let text = '';
  task.opportunityClient = { systemOne: async ({ questions }) => { text = JSON.stringify(Object.values(questions)[0]); return { answers: Object.fromEntries(Object.keys(questions).map(k => [k, { choice: 'top_up_bow', confidence: 0.9 }])) }; } };
  let slow = 0;
  await prepareEndSupplies(bot, task, goal, () => {}, { acquireStep: async () => { slow++; } });
  assert.match(text, /Taken up already for about 40 minutes of play since 17:04Z, the bow carried going from 0 to \d+ meanwhile/);
  assert.equal(slow, 1);
  assert.ok(goal.endKit.spent.bow.ms >= 40 * 60000);
});

test('a counted top-up says what the rest would take at the pace so far (note 1337)', async () => {
  const { bot, items, goal, task } = fixture();
  const arrows = items.find(i => i.name === 'arrow');
  if (arrows) arrows.count = 3; else items.push({ name: 'arrow', count: 3 });
  goal.endKit = { spent: { arrows: { ms: 24 * 60000, since: Date.parse('2026-10-06T00:46:00Z'), from: 0 } } };
  let text = '';
  task.opportunityClient = { systemOne: async ({ questions }) => { text = JSON.stringify(Object.values(questions)[0]); return { answers: Object.fromEntries(Object.keys(questions).map(k => [k, { choice: 'enter_now', confidence: 0.9 }])) }; } };
  await prepareEndSupplies(bot, task, goal, () => {}, { acquireStep: async () => {} });
  assert.match(text, /the arrows carried going from 0 to 3 meanwhile\. At that pace \(3 in about 24 minutes\), the 61 more to 64 would take about 8 hours\./);
});

test('the water option says what a bucket costs and what the live End fights without one came to (note 1406)', () => {
  const { bot, items, goal } = fixture();
  for (const i of items.filter(i => i.name === 'water_bucket')) i.name = 'raw_iron';
  const water = kitItems(bot, goal).find(i => i.key === 'water');
  assert.equal(water.short, true);
  assert.match(water.says, /three iron ingots at a crafting table \(0 empty buckets, 0 iron ingots and 2 raw iron carried\)/);
  assert.match(water.says, /thrown 56 blocks up as it took off and died of the fall/);
});
