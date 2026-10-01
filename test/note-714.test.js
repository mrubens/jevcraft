'use strict';
// Note 714: the structural bug in questions the rules did not yet cover.
// (1) 25581 asked portal_method twice within a second (cast_frame, then
// cast_at_lava), then surface_trip's climb undid the cast_at_lava it had
// just chosen, sending it "back to daylight" in the same second. (2) 25583's
// fortress_leg return_for_blocks won three times and nether_gather was asked
// in the same second, the trip never said as its own. Fixed by covering
// portal_method and surface_trip under the one-intention rule (intention.js,
// note 689: surface_trip's climb and mine_first, which would undo a stand
// taken to build the portal, are withheld while it holds), and by a chat
// line said when a question is asked as a sub-need of the intention rather
// than a new plan. (The first ask-twice-in-a-row itself needs no new rule:
// once portal_method is a timed answer, the ledger's existing "tried lately,
// came to nothing" fact already tells Jev why the first way failed before
// it answers again.)
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { Vec3 } = require('vec3');
const registry = require('minecraft-data')('26.1');
const { decide } = require('../src/decisions');

function overworldBot({ at = new Vec3(16, 68, 60), health = 20, food = 20, items = [] } = {}) {
  const inv = items.map(([name, count]) => ({ name, count, type: registry.itemsByName[name].id, durabilityUsed: 0 }));
  const said = [];
  return Object.assign(new EventEmitter(), {
    registry, version: '26.1', health, food, game: { dimension: 'overworld', gameMode: 'survival', difficulty: 'normal' }, said,
    entity: { position: at.clone(), onGround: true, height: 1.8, width: 0.6, velocity: new Vec3(0, 0, 0) }, entities: {},
    inventory: { items: () => inv.filter(i => i.count > 0), slots: [] }, chat(m) { said.push(m); }, blockAt: () => null,
  });
}
function jev(answers) {
  const offered = [], states = [];
  const client = { systemOne: async ({ state, questions }) => {
    const keys = Object.keys(questions.branch_0.criteria);
    offered.push(keys); states.push(state);
    const choice = answers.find(a => keys.includes(a));
    return { answers: { branch_0: { choice, confidence: 0.9, probabilities: { [choice]: 0.9 } } } };
  } };
  return { client, offered, states };
}
const opt = (d, target) => ({ description: d, ...(target ? { target } : {}) });

test('a stand taken to cast a portal by the lava holds: surface_trip is asked without the climb that would undo it (25581, note 714)', async () => {
  const bot = overworldBot(), goal = { kind: 'win' };
  const { client, offered } = jev(['beside_pool_1', 'dig_site']);
  await decide('portal_plan', { client, bot, goal, tree: {
    here_pool_1: opt('Cast a frame in place.'), beside_pool_1: opt('Cast beside the known lava.'), build_new: opt('Build from obsidian.'),
  }, state: {} });
  assert.equal(goal.intention.q, 'portal_plan');
  assert.equal(goal.intention.choice, 'beside_pool_1');
  const s = await decide('surface_trip', { client, bot, goal, tree: {
    climb: opt('Climb to open sky.'), mine_first: opt('Mine ore first, then climb.'), dig_site: opt('Dig a site for the frame here.'),
  }, state: {} });
  // climb and mine_first would send it back up, undoing the stand at the
  // lava; dig_site builds the portal where it stands and is left as the one
  // way, so it is taken without a second ask of Jev.
  assert.equal(offered.length, 1, 'surface_trip was not asked: dig_site was the only way left');
  assert.deepEqual(s.path, ['dig_site']);
  assert.equal(s.only, true);
  // The intention still holds: dig_site is a way of it, not a new plan.
  assert.equal(goal.intention.choice, 'beside_pool_1');
});

test('with more than one compatible way still open, surface_trip is asked, but climb and mine_first stay withheld while the lava stand holds (note 714)', async () => {
  const bot = overworldBot(), goal = { kind: 'win' };
  const { client, offered } = jev(['beside_pool_1', 'stay_below']);
  await decide('portal_plan', { client, bot, goal, tree: {
    here_pool_1: opt('Cast a frame in place.'), beside_pool_1: opt('Cast beside the known lava.'),
  }, state: {} });
  const s = await decide('surface_trip', { client, bot, goal, tree: {
    climb: opt('Climb to open sky.'), mine_first: opt('Mine ore first, then climb.'), stay_below: opt('Leave the step and go on with the ladder.'), dig_site: opt('Dig a site for the frame here.'),
  }, state: {} });
  // mine_first still climbs after mining, so it too would undo the stand at
  // the lava; stay_below and dig_site do not, so with two ways left it is a
  // real ask, and Jev picks between them, not blind to what climbing would
  // undo.
  assert.equal(offered.length, 2, 'portal_method, then surface_trip, each asked once');
  assert(!offered[1].includes('climb') && !offered[1].includes('mine_first'), 'climb and mine_first are withheld while the lava stand holds');
  assert(offered[1].includes('stay_below') && offered[1].includes('dig_site'));
  assert.deepEqual(s.path, ['stay_below']);
});

test('nether_gather chosen as a way of the trip back through the portal is said as part of it, not a new plan (25583, note 714)', async () => {
  const { Vec3: V } = require('vec3');
  const registry26 = require('minecraft-data')('26.1');
  const said = [];
  const bot = Object.assign(new EventEmitter(), {
    registry: registry26, version: '26.1', health: 20, food: 20, game: { dimension: 'the_nether', gameMode: 'survival', difficulty: 'normal' }, said,
    entity: { position: new V(17, 59, 13), onGround: true, height: 1.8, width: 0.6, velocity: new V(0, 0, 0) }, entities: {},
    inventory: { items: () => [], slots: [] }, chat(m) { said.push(m); }, blockAt: () => null,
  });
  const goal = { kind: 'win' };
  const { client } = jev(['return_for_blocks', 'cross_to_2']);
  await decide('fortress_leg', { client, bot, goal, tree: { return_for_blocks: opt('Go back through the portal for blocks.'), leg_west: opt('Search west.') }, state: {} });
  assert.equal(goal.intention.q, 'fortress_leg');
  assert.equal(goal.intention.choice, 'return_for_blocks');
  const before = said.length;
  await decide('nether_gather', { client, bot, goal, tree: {
    cross_to_2: opt('Cross to the wood in view.'), without: opt('Go on without.'),
  }, state: {} });
  // Still the one intention (the trip back for blocks); the gathering is
  // its way, not a replacement, and Jev is told so in chat.
  assert.equal(goal.intention.choice, 'return_for_blocks');
  assert.equal(goal.intention.way, 'nether_gather/cross_to_2');
  assert(said.length > before, 'the sub-need was said');
  assert.match(said.at(-1), /^cross to 2 \(nether gather\), part of return for blocks \(fortress leg\): back to it after\.$/);
});
