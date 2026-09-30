'use strict';
// Note 734 (critic-20260930T0755Z item 1): 25597 (mid-242-tf) chose
// fortress_visit's go_back at fourteen health with no food ("Going back
// through the portal for food"), and thirty seconds later a find_fortress
// stall's stillness_detour picked cross_toward with no word that the trip
// home was under way. The errand was dropped in silence, fortress legs took
// over, and it died at three health with no food. go_back is the same kind
// of errand as return_for_food (a trip through the portal for food) and
// must be gated at stillness_detour and rung_progress the same way (note
// 726, src/intention.js ERRANDS).
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { Vec3 } = require('vec3');
const registry = require('minecraft-data')('26.1');
const { decide } = require('../src/decisions');

function netherBot({ at = new Vec3(-116, 74, 153), health = 14 } = {}) {
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
const portal = { x: -69, y: 74, z: 141 };
const fortress = { x: -180, y: 53, z: 200 }; // far from the portal: not the trip home

test('stillness_detour is gated while fortress_visit\'s go_back (a food trip) is held: cross_toward is withheld (note 734)', async () => {
  const bot = netherBot(), goal = { kind: 'win' };
  const { client } = jev(['go_back']);
  await decide('fortress_visit', { client, bot, goal, tree: { go_back: opt('Going back through the portal for food.', portal), go_in: opt('Go in now.') }, state: {} });
  assert.equal(goal.intention.choice, 'go_back');
  assert.equal(goal.intention.q, 'fortress_visit');
  // As the real trial's stall (find_fortress -> stillness_detour) had it:
  // cross_toward offered beside a safe keep-on, with no word of the trip
  // home under way.
  const { client: client2, offered } = jev(['cross_toward', 'keep_on']);
  await decide('stillness_detour', { client: client2, bot, goal,
    tree: { keep_on: opt('Go on in the Nether without going back for food.'), cross_toward: opt('Cross toward the fortress seen.', fortress), return_for_food: opt('Back through the portal for food.', portal) }, state: {} });
  // cross_toward serves nothing of the trip home (its target is the
  // fortress, not the portal) and is withheld; keep_on (KEEP) and the
  // errand's own way on (return_for_food, its target the same portal) stay.
  assert.deepEqual(offered.at(-1).filter(k => k !== 'none_good').sort(), ['keep_on', 'return_for_food']);
  // Chosen, the errand still holds: keep_on does not end it.
  assert.equal(goal.intention.choice, 'go_back');
  assert.equal(goal.intention.q, 'fortress_visit');
});

test('stillness_detour\'s own way on (return_for_food, to the same portal) carries the go_back errand forward when offered there', async () => {
  const bot = netherBot(), goal = { kind: 'win' };
  const { client } = jev(['go_back']);
  await decide('fortress_visit', { client, bot, goal, tree: { go_back: opt('Going back through the portal for food.', portal), go_in: opt('Go in.') }, state: {} });
  assert.equal(goal.intention.q, 'fortress_visit');
  const { client: client2, offered } = jev(['return_for_food']);
  await decide('stillness_detour', { client: client2, bot, goal,
    tree: { return_for_food: opt('Back through the portal for food.', portal), keep_on: opt('Go on without going back for food.'), cross_toward: opt('Cross toward the fortress seen.', fortress) }, state: {} });
  assert(offered.at(-1).includes('return_for_food'));
  assert(!offered.at(-1).includes('cross_toward'));
  // The trip home still holds, now carried on by stillness_detour's own way.
  assert.equal(goal.intention.choice, 'go_back');
  assert.equal(goal.intention.q, 'fortress_visit');
  assert.equal(goal.intention.way, 'stillness_detour/return_for_food');
});

test('stillness_detour is not gated for a non-errand intention (going into the fortress): its full menu stays', async () => {
  const bot = netherBot({ health: 20 }), goal = { kind: 'win' };
  const { client } = jev(['go_in']);
  await decide('fortress_visit', { client, bot, goal, tree: { go_in: opt('Go in now.'), go_back: opt('Going back for food.') }, state: {} });
  assert.equal(goal.intention.choice, 'go_in');
  const { client: client2, offered } = jev(['cross_toward']);
  await decide('stillness_detour', { client: client2, bot, goal,
    tree: { keep_on: opt('Go on without going back for food.'), cross_toward: opt('Cross toward the fortress seen.', fortress) }, state: {} });
  assert.deepEqual(offered.at(-1).filter(k => k !== 'none_good').sort(), ['cross_toward', 'keep_on']);
});
