'use strict';
// Note 726: 25598 (mid-242-sf, critic-20260930T0543Z item 3) chose
// return_for_food at 7 health with nothing to eat (a 370-block trip), and
// three seconds later rung_progress was asked wide open, set_aside_rung
// beside keep_at_it with no word that an errand was under way; keep_at_it
// won and the trip was never carried on, nor said given up. rung_progress
// and stillness_detour are gated the same way upkeep's fetch already is
// (note 703) while the held intention is an errand: their own way on
// (fetch_stems, return_for_food, restock_food, ...) still shows, but an
// answer that would drop it with nothing said does not.
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { Vec3 } = require('vec3');
const registry = require('minecraft-data')('26.1');
const { decide } = require('../src/decisions');

function netherBot({ at = new Vec3(-140, 70, 150), health = 7 } = {}) {
  const inv = [['iron_sword', 1]].map(([name, count]) => ({ name, count, type: registry.itemsByName[name].id, durabilityUsed: 0 }));
  const said = [];
  return Object.assign(new EventEmitter(), {
    registry, version: '26.1', health, food: 6, game: { dimension: 'the_nether', gameMode: 'survival', difficulty: 'normal' }, said,
    entity: { position: at.clone(), onGround: true, height: 1.8, width: 0.6, velocity: new Vec3(0, 0, 0) }, entities: {},
    inventory: { items: () => inv.filter(i => i.count > 0), slots: [] }, chat(m) { said.push(m); }, blockAt: () => null,
  });
}
function jev(answers) {
  const offered = [];
  const client = { systemOne: async ({ questions }) => {
    const keys = Object.keys(questions.branch_0.criteria);
    offered.push(keys);
    const choice = answers.find(a => keys.includes(a));
    return { answers: { branch_0: { choice, confidence: 0.9, probabilities: { [choice]: 0.9 } } } };
  } };
  return { client, offered };
}
const opt = (d, target) => ({ description: d, ...(target ? { target } : {}) });

test('rung_progress is gated while a food errand is held: its own way on shows, set_aside_rung does not, and keep_at_it does not drop it (note 726)', async () => {
  const bot = netherBot(), goal = { kind: 'win' };
  const { client, offered } = jev(['return_for_food', 'keep_at_it']);
  const portal = { x: 40, y: 60, z: 150 };
  await decide('nether_food_kit', { client, bot, goal, tree: { return_for_food: opt('Back through the portal for food.', portal), go_on: opt('Go on with the stay as it is.') }, state: {} });
  assert.equal(goal.intention.choice, 'return_for_food');
  // As the real trial's rung_progress tree had it (critic-20260930T0543Z
  // item 3): keep_at_it chosen, return_for_food the runner-up, and
  // set_aside_rung offered too, with no word of the trip under way.
  await decide('rung_progress', { client, bot, goal,
    tree: { keep_at_it: opt('Keep at the rung.'), set_aside_rung: opt('Set the rung aside.'), return_for_food: opt('Back through the portal for food.', portal) }, state: {} });
  // set_aside_rung serves nothing of the trip and is withheld; keep_at_it
  // (KEEP) and the trip's own way on (return_for_food) stay offered.
  assert.deepEqual(offered.at(-1).filter(k => k !== 'none_good'), ['keep_at_it', 'return_for_food']);
  // Chosen, the errand still holds: keep_at_it does not end it.
  assert.equal(goal.intention.choice, 'return_for_food');
  assert.equal(goal.intention.q, 'nether_food_kit');
});

test('rung_progress\'s own way on (return_for_food) still carries the errand forward when offered there', async () => {
  const bot = netherBot(), goal = { kind: 'win' };
  const { client } = jev(['return_for_food']);
  const portal = { x: 40, y: 60, z: 150 };
  await decide('nether_food_kit', { client, bot, goal, tree: { return_for_food: opt('Back through the portal for food.', portal), go_on: opt('Go on.') }, state: {} });
  assert.equal(goal.intention.q, 'nether_food_kit');
  const { client: client2, offered } = jev(['return_for_food']);
  await decide('rung_progress', { client: client2, bot, goal,
    tree: { return_for_food: opt('Back through the portal for food.', portal), keep_at_it: opt('Keep at the rung.'), set_aside_rung: opt('Set the rung aside.') }, state: {} });
  assert(offered.at(-1).includes('return_for_food'));
  assert(!offered.at(-1).includes('set_aside_rung'));
  assert.equal(goal.intention.choice, 'return_for_food');
  assert.equal(goal.intention.way, 'rung_progress/return_for_food');
});

test('rung_progress is not gated for a non-errand intention (a fortress leg): stillness_detour and rung_progress keep their full menu', async () => {
  const bot = netherBot({ health: 20 }), goal = { kind: 'win' };
  const { client } = jev(['leg_west']);
  await decide('fortress_leg', { client, bot, goal, tree: { leg_west: opt('Go west.'), leg_east: opt('Go east.') }, state: {} });
  assert.equal(goal.intention.choice, 'leg_west');
  const { client: client2, offered } = jev(['set_aside_rung']);
  await decide('rung_progress', { client: client2, bot, goal,
    tree: { keep_at_it: opt('Keep at the rung.'), set_aside_rung: opt('Set the rung aside.') }, state: {} });
  assert.deepEqual(offered.at(-1).filter(k => k !== 'none_good'), ['keep_at_it', 'set_aside_rung']);
});
