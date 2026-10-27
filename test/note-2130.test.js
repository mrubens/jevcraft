'use strict';
// Note 2130: inside a rest held (holdForRest), the wait itself is on offer:
// chosen, breakStillness reports no work done and the hold waits quietly to
// the rest's end instead of asking again after each detour over at once.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { Task } = require('../src/skills');
const registry = require('minecraft-data')('26.1');

function world() {
  const bot = { registry, game: { dimension: 'overworld', gameMode: 'survival', difficulty: 'normal' }, health: 20, food: 18, isAlive: true, chat() {}, emit() {},
    entity: { id: 1, position: new Vec3(104.5, 52, 504.5), onGround: true }, time: { timeOfDay: 6000 }, entities: {},
    inventory: { items: () => [{ name: 'stone_pickaxe', count: 1, type: registry.itemsByName.stone_pickaxe.id }], slots: {}, emptySlotCount: () => 30 },
    blockAt: () => ({ name: 'stone', boundingBox: 'block', position: new Vec3(0, 0, 0) }), findBlocks: () => [], findBlock: () => null, nearestEntity: () => null };
  const goal = { version: 1, kind: 'win', request: 'beat the game', survival: {}, step: { action: 'smelt', item: 'cooked_mutton', count: 11, from: 'mutton' },
    smelting: { item: 'cooked_mutton', count: 11, startedAt: Date.now() - 30000, position: { x: 104, y: 51, z: 505 } } };
  return { bot, goal };
}

test('a rest held offers the wait itself; chosen, no work is reported and the step is restored', async () => {
  const { breakStillness } = require('../src/work');
  const { bot, goal } = world();
  let asked = null;
  const client = { model: 'jev', systemOne: async ({ questions }) => { asked = Object.values(questions)[0]; return { answers: Object.fromEntries(Object.keys(questions).map(k => [k, { choice: 'wait_it_out', confidence: 0.8 }])) }; } };
  const until = Date.now() + 80000;
  const log = console.log; console.log = () => {};
  let worked;
  try {
    worked = await breakStillness(bot, new Task('still'), goal, () => {}, { client, reason: 'step:smelt', until, holding: { minutes: 2, why: '11 mutton cooking in the furnace at (104, 51, 505), taken out when done' },
      answers: { wood_reserve: { description: 'Gather wood for sticks and a table.', run: async () => {} } } });
  } finally { console.log = log; }
  assert.equal(worked, 'wait', 'the wait is its own answer: the hold waits to the end');
  assert.ok(asked, 'asked with two ways on offer');
  const text = asked.criteria.wait_it_out;
  assert.match(text, /^Wait here for the smelt's rest to end, about (79|80) seconds \(at \d\d:\d\d:\d\dZ\), set for: 11 mutton cooking in the furnace at \(104, 51, 505\), taken out when done; the step waiting smelts 11 cooked mutton in the furnace at \(104, 51, 505\), 1 blocks? from here: 3 of 11 done, about 80 seconds for the rest; set aside or walked from, they stay in the furnace, not carried\. Standing still spends no hunger; nothing is asked meanwhile but a threat that shows, and the work is taken up when the rest ends\. The \d+ seconds are the run's own time all the same, \d+ other ways? on offer here to spend them on, each back for the batch when it is done\. On 5 fresh runs \(2026-10-26 01:00 to 03:15Z\) this question came round 103 times while a batch smelted/);
  assert.equal(goal.step.action, 'smelt', 'the step is put back');
});

test('with no rest held the wait is not offered', async () => {
  const { breakStillness } = require('../src/work');
  const { bot, goal } = world();
  let asked = null;
  const client = { model: 'jev', systemOne: async ({ questions }) => { asked = Object.values(questions)[0]; return { answers: Object.fromEntries(Object.keys(questions).map(k => [k, { choice: 'wood_reserve', confidence: 0.8 }])) }; } };
  const log = console.log; console.log = () => {};
  try { await breakStillness(bot, new Task('still'), goal, () => {}, { client, reason: 'step:smelt', answers: { wood_reserve: { description: 'Gather wood for sticks and a table.', run: async () => {} }, spare_pickaxe: { description: 'Make a spare stone pickaxe.', run: async () => {} } } }); }
  catch (_) { /* a mock world: the way taken may fail */ } finally { console.log = log; }
  assert.ok(!asked || !asked.criteria.wait_it_out, 'no wait without a rest held');
});

test('on a smelt\'s hold the wait is offered though the hold is not idle (note 2140)', async () => {
  const { breakStillness } = require('../src/work');
  const { bot, goal } = world();
  let asked = null;
  const client = { model: 'jev', systemOne: async ({ questions }) => { asked = Object.values(questions)[0]; return { answers: Object.fromEntries(Object.keys(questions).map(k => [k, { choice: 'wait_it_out', confidence: 0.8 }])) }; } };
  const log = console.log; console.log = () => {};
  let worked;
  try {
    worked = await breakStillness(bot, new Task('still'), goal, () => {}, { client, reason: 'smelt:cooked_mutton', until: Date.now() + 80000, holding: { minutes: 2, why: '11 mutton cooking', idle: false },
      answers: { wood_reserve: { description: 'Gather wood for sticks and a table.', run: async () => {} } } });
  } finally { console.log = log; }
  assert.equal(worked, 'wait');
  assert.ok(asked?.criteria?.wait_it_out, 'the wait is on the smelt\'s hold');
});

test('the wait chosen holds the rest to its end and asks nothing above again (note 2146)', async () => {
  const { holdForRest } = require('../src/work');
  const { bot, goal } = world();
  let asks = 0;
  const client = { model: 'jev', systemOne: async ({ questions }) => { asks++; return { answers: Object.fromEntries(Object.keys(questions).map(k => [k, { choice: 'wait_it_out', confidence: 0.8 }])) }; } };
  const logs = [], log = console.log; console.log = (...a) => logs.push(a.join(' '));
  const t0 = Date.now(); let done;
  try { done = await holdForRest(bot, new Task('hold'), goal, () => {}, { client, reason: 'smelt:cooked_mutton', until: Date.now() + 1500, why: '11 mutton cooking', idle: false, answers: undefined }); }
  finally { console.log = log; }
  assert.equal(done, true, 'the rest was held to its end');
  assert.ok(Date.now() - t0 >= 1400, 'waited the rest out');
  assert.ok(!logs.some(l => /has run out; the question above is asked again/.test(l)), logs.join('\n'));
});

test('a smelt hold ends when the batch is done by the furnace clock (note 2154)', async () => {
  const { holdForRest } = require('../src/work');
  const { bot, goal } = world();
  goal.smelting.startedAt = Date.now() - 200000; // 11 items, 110 s: long done
  let asks = 0;
  const client = { model: 'jev', systemOne: async ({ questions }) => { asks++; return { answers: Object.fromEntries(Object.keys(questions).map(k => [k, { choice: 'wait_it_out', confidence: 0.8 }])) }; } };
  const log = console.log; const logs = []; console.log = (...a) => logs.push(a.join(' '));
  const t0 = Date.now(); let done;
  try { done = await holdForRest(bot, new Task('hold'), goal, () => {}, { client, reason: 'smelt:cooked_mutton', until: Date.now() + 60000, why: '11 mutton cooking', idle: false }); }
  finally { console.log = log; }
  assert.equal(done, true);
  assert.ok(Date.now() - t0 < 2000, 'ended at once');
  assert.equal(asks, 0, 'nothing asked');
  assert.ok(logs.some(l => /the batch in the furnace is done by its clock/.test(l)), logs.join('\n'));
});
