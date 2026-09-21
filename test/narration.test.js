'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { narrate, MIN_GAP_MS } = require('../src/narration');

const decision = key => ({ path: ['build_house', 'gather_materials', key], options: { build_house: { children: { gather_materials: { children: {
  source_oak_log_3_64_0: { description: { block: 'oak_log', blocksWithinReach: 3, distance: 6, elevationChange: 0 } },
  source_birch_log_30_64_4: { description: { block: 'birch_log', blocksWithinReach: 5, distance: 31, elevationChange: 2 } },
} } } } } });

test('the bot says what it is starting, once per phase, not once per tree', () => {
  const said = [], bot = { chat: line => said.push(line) };
  const goal = { kind: 'house', step: { action: 'mine', block: 'oak_log', drops: 'oak_log' }, decisions: [decision('source_oak_log_3_64_0')] };
  let now = 1000;
  goal.step.count = 24;
  assert.equal(narrate(bot, goal, { now }), 'Getting 24 oak log.');
  assert.equal(narrate(bot, goal, { now: now += MIN_GAP_MS }), null, 'the same phase is not repeated');
  goal.decisions.push({ path: ['continue_source', 'source_oak_log_3_64_0'], committed: true, options: {} });
  assert.equal(narrate(bot, goal, { now: now += MIN_GAP_MS }), null, 'continuing the same source is not a new phase');
  goal.decisions.push(decision('source_birch_log_30_64_4'));
  assert.equal(narrate(bot, goal, { now: now += MIN_GAP_MS }), null, 'a different tree for the same resource is not announced');
  goal.step = { action: 'craft', item: 'oak_planks', count: 96 };
  assert.equal(narrate(bot, goal, { now: now += MIN_GAP_MS }), 'Crafting 96 oak planks.');
  goal.step = { action: 'place', position: { x: 1, y: 64, z: 2 }, material: 'oak_planks' };
  assert.equal(narrate(bot, goal, { now: now += MIN_GAP_MS }), 'Building the house.');
  goal.step = { action: 'place', position: { x: 2, y: 64, z: 2 }, material: 'oak_planks' };
  assert.equal(narrate(bot, goal, { now: now += MIN_GAP_MS }), null, 'every block of the same build is one phase');
  assert.equal(said.length, 3);
});

test('survival taking over is announced ahead of the step, and the chat gap is respected', () => {
  const said = [], bot = { chat: line => said.push(line) };
  const goal = { kind: 'house', step: { action: 'mine', block: 'oak_log', drops: 'oak_log' }, decisions: [] };
  assert.equal(narrate(bot, goal, { now: 1000 }), 'Getting oak log.');
  goal.survivalAction = { action: 'gather_shelter_materials', at: '2026-09-21T04:00:00Z' };
  assert.equal(narrate(bot, goal, { now: 2000 }), null, 'too soon after the last line');
  assert.match(narrate(bot, goal, { now: 1000 + MIN_GAP_MS }), /^Night's coming/);
  assert.equal(narrate(bot, goal, { now: 1000 + 2 * MIN_GAP_MS }), null, 'the same survival action is not repeated');
  goal.survivalAction = { action: 'escape_threat', at: '2026-09-21T04:01:00Z', threats: [{ name: 'zombie' }, { name: 'zombie' }] };
  assert.equal(narrate(bot, goal, { now: 1000 + 3 * MIN_GAP_MS }), 'Something hostile is close (zombie), moving away.');
  goal.survivalAction = { action: 'eat', at: '2026-09-21T04:02:00Z' };
  assert.equal(narrate(bot, goal, { now: 1000 + 4 * MIN_GAP_MS }), null, 'quiet actions stay quiet');
  goal.survivalAction = { action: 'leave_shelter', at: '2026-09-21T04:03:00Z' };
  assert.equal(narrate(bot, goal, { now: 1000 + 5 * MIN_GAP_MS }), 'Morning. Back to it.');
  assert.equal(narrate(bot, goal, { now: 1000 + 6 * MIN_GAP_MS }), 'I think I lost it.', 'once the chase has been quiet for a while');
  assert.equal(narrate({}, goal), null, 'no chat, no crash');
});

test('the same creeper five times is one story: announced once, then "I think I lost it"', () => {
  const said = [], bot = { chat: line => said.push(line) };
  const goal = { kind: 'house', step: { action: 'mine', block: 'oak_log', drops: 'oak_log' }, decisions: [] };
  let now = 1000;
  assert.equal(narrate(bot, goal, { now }), 'Getting oak log.');
  for (let i = 0; i < 5; i++) {
    goal.survivalAction = { action: 'escape_threat', at: `2026-09-21T04:0${i}:00Z`, threats: [{ name: 'creeper' }] };
    narrate(bot, goal, { now: now += 8000 });
  }
  assert.equal(said.filter(l => /creeper/.test(l)).length, 1, 'one announcement for the same chaser');
  assert.equal(narrate(bot, goal, { now: now += 5000 }), null, 'not quiet for long enough yet');
  assert.equal(narrate(bot, goal, { now: now += 8000 }), 'I think I lost it.');
  assert.equal(narrate(bot, goal, { now: now += 8000 }), null, 'said once');
  goal.survivalAction = { action: 'escape_threat', at: '2026-09-21T04:30:00Z', threats: [{ name: 'creeper' }] };
  assert.match(narrate(bot, goal, { now: now += 130000 }), /creeper/, 'a new chase after the window is news again');
});

test('a combined request narrates its inner step and a delivery says what is coming', () => {
  const said = [], bot = { chat: line => said.push(line) };
  const goal = { kind: 'bundle', step: { action: 'combined_request', task: 2, total: 3, detail: { action: 'smelt', item: 'iron_ingot' } }, decisions: [] };
  assert.equal(narrate(bot, goal, { now: 1000 }), 'Smelting iron ingot.');
  goal.step = { action: 'deliver', item: 'iron_pickaxe', count: 1, recipient: 'Player' };
  assert.equal(narrate(bot, goal, { now: 1000 + MIN_GAP_MS }), 'Bringing you 1 iron pickaxe.');
});
