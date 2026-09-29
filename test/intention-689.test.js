'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { Vec3 } = require('vec3');
const registry = require('minecraft-data')('26.1');
const { decide } = require('../src/decisions');
const intention = require('../src/intention');
const tried = require('../src/tried');

// One committed intention at a time (note 689). 25581 at 20:32:42 said "I'm
// in the fortress. Now, where are the blazes?" (fortress_visit go_in 0.98) and
// a second later fortress_approach keep_searching: "Leaving this fortress for
// now", with nine blazes in sight; 25590 went back_to_fortress, go_in,
// walk_route, keep_searching and back again every few seconds for an hour.
function netherBot({ at = new Vec3(-140, 70, 150), health = 20, items = [['iron_sword', 1], ['netherrack', 64], ['iron_pickaxe', 1]] } = {}) {
  const inv = items.map(([name, count]) => ({ name, count, type: registry.itemsByName[name].id, durabilityUsed: 0 }));
  const said = [];
  return Object.assign(new EventEmitter(), {
    registry, version: '26.1', health, food: 20, game: { dimension: 'the_nether', gameMode: 'survival', difficulty: 'normal' }, said,
    entity: { position: at.clone(), onGround: true, height: 1.8, width: 0.6, velocity: new Vec3(0, 0, 0) }, entities: {},
    inventory: { items: () => inv.filter(i => i.count > 0), slots: [] }, chat(m) { said.push(m); }, blockAt: () => null,
  });
}
// Jev's stand-in: what was offered each time, and the answer given.
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
const approachTree = () => ({ walk_route: opt('Walk the route to it.'), cross_level: opt('Go straight at it.'), keep_searching: opt('Leave this fortress for ten minutes and search on.') });

test('go_in holds: the way in is asked without leaving it, said as under way and in chat (25581, note 689)', async () => {
  const bot = netherBot(), goal = { kind: 'win' };
  const { client, offered, states } = jev(['go_in', 'keep_searching', 'walk_route']);
  const visit = await decide('fortress_visit', { client, bot, goal, target: { x: -108, y: 77, z: 155 },
    tree: { go_in: opt('Go in now.'), leave_fortress: opt('Leave it for ten minutes.') }, state: { health: 20 } });
  assert.deepEqual(visit.path, ['go_in']);
  assert.equal(goal.intention.q, 'fortress_visit');
  assert.deepEqual(goal.intention.target, { x: -108, y: 77, z: 155 });
  assert.match(bot.said.at(-1), /^Going into the fortress at \(-108, 77, 155\): \d+ more rods needed\.$/);
  const way = await decide('fortress_approach', { client, bot, goal, tree: approachTree(), state: { health: 20 } });
  assert.deepEqual(offered[1].filter(k => k !== 'none_good'), ['walk_route', 'cross_level']);
  assert.deepEqual(way.path, ['walk_route']);
  assert.match(states[1].underWay, /^go in \(fortress visit, to \(-108, 77, 155\)\), chosen \d+ seconds? ago; it holds until it arrives, is done or fails, or walks 3 minutes with nothing gained; not offered while it holds: keep searching$/);
  // Still the one intention, its way noted.
  assert.equal(goal.intention.choice, 'go_in');
  assert.equal(goal.intention.way, 'fortress_approach/walk_route');
});

test('the intention ends by its end: its ways all resting, arriving, health lost, and leaving is offered again (note 689)', async () => {
  const bot = netherBot(), goal = { kind: 'win' };
  const { client, offered } = jev(['go_in', 'keep_searching']);
  await decide('fortress_visit', { client, bot, goal, target: { x: -108, y: 77, z: 155 }, tree: { go_in: opt('Go in.'), leave_fortress: opt('Leave.') }, state: {} });
  // The ways below it came to nothing: an escalation, a moment later.
  goal.intention.at -= 1000;
  tried.escalate(goal, { from: 'fortress_approach', to: 'fortress_leg', why: 'every way it had from here rests' });
  const later = await decide('fortress_approach', { client, bot, goal, tree: approachTree(), state: {} });
  assert(offered[1].includes('keep_searching'));
  assert.deepEqual(later.path, ['keep_searching']);
  assert.equal(goal.intention, undefined);
  assert.match(goal.intentionEnded.why, /^failed: fortress approach: every way it had from here rests/);

  // Arrived.
  const g2 = { kind: 'win' };
  await decide('fortress_visit', { client, bot, goal: g2, target: { x: -108, y: 77, z: 155 }, tree: { go_in: opt('Go in.'), leave_fortress: opt('Leave.') }, state: {} });
  bot.entity.position = new Vec3(-107, 77, 154);
  assert.equal(intention.holding(bot, g2), null);
  assert.equal(g2.intentionEnded.why, 'arrived');

  // A blow's worth of health lost since it began.
  const bot3 = netherBot(), g3 = { kind: 'win' };
  await decide('fortress_visit', { client, bot: bot3, goal: g3, target: { x: -108, y: 77, z: 155 }, tree: { go_in: opt('Go in.'), leave_fortress: opt('Leave.') }, state: {} });
  bot3.health = 14;
  assert.equal(intention.holding(bot3, g3), null);
  assert.equal(g3.intentionEnded.why, 'a real change: health 20 to 14 since it began');
});

test('a walk back to the portal is not turned round by the gathering: the gathering is its means, and going without is not offered (25591, note 678/689)', async () => {
  const bot = netherBot(), goal = { kind: 'win', portals: [{ dimension: 'nether', x: -20, y: 71, z: 19 }] };
  const { client, offered } = jev(['go_back', 'portal_trip', 'leg_west']);
  await decide('leave_nether', { client, bot, goal, tree: { go_back: opt('Go back through the portal.'), wait_here: opt('Wait here.') }, state: {} });
  assert.deepEqual(goal.intention.target, { x: -20, y: 71, z: 19 });
  assert.match(bot.said.at(-1), /^Going back through the portal for food at \(-20, 71, 19\): hunger 20, health 20\.$/);
  const d = await decide('nether_gather', { client, bot, goal, tree: {
    leg_west: opt('Search west.'), walk_to_1: opt('Walk to the stems.', { x: -300, y: 70, z: 150 }),
    portal_trip: opt('Back through the portal for wood.', { x: -20, y: 71, z: 19 }), without: opt('Go on without.'),
  }, state: {} });
  // Going on without the wood is not offered; the gathering is the trip's
  // means, and after it the trip goes on.
  assert.deepEqual(offered[1].filter(k => k !== 'none_good'), ['leg_west', 'walk_to_1', 'portal_trip']);
  assert.deepEqual(d.path, ['portal_trip']);
  assert.equal(goal.intention.choice, 'go_back');
  assert.equal(goal.intention.way, 'nether_gather/portal_trip');
  await decide('nether_gather', { client: jev(['leg_west']).client, bot, goal, tree: { leg_west: opt('Search west.'), without: opt('Go on without.') }, state: {} });
  assert.equal(goal.intention.choice, 'go_back');
  assert.equal(goal.intention.way, 'nether_gather/leg_west');
});

test('a question with nothing that carries it on sets it down and is asked whole; a stall\'s timed answer replaces it (note 689)', async () => {
  const bot = netherBot(), goal = { kind: 'win' };
  const { client, offered } = jev(['leg_west', 'go_in', 'return_for_food']);
  await decide('fortress_leg', { client, bot, goal, tree: { leg_west: opt('Go west.'), leg_east: opt('Go east.') }, state: {} });
  assert.equal(goal.intention.choice, 'leg_west');
  // A fortress seen mid-leg: its visit is about something else.
  await decide('fortress_visit', { client, bot, goal, target: { x: -200, y: 60, z: 150 }, tree: { go_in: opt('Go in.'), leave_fortress: opt('Leave.') }, state: {} });
  assert.deepEqual(offered[1].filter(k => k !== 'none_good'), ['go_in', 'leave_fortress']);
  assert.equal(goal.intention.choice, 'go_in');
  assert.match(goal.intentionEnded.why, /^replaced: Jev chose go in|^set down: fortress visit was asked/);
  // The stall's question is asked whole; its timed answer is the new intention.
  await decide('stillness_detour', { client, bot, goal, tree: { return_for_food: opt('Back through the portal for food.'), differently: opt('Try it differently.') }, state: {} });
  assert(offered[2].includes('return_for_food') && offered[2].includes('differently'));
  assert.equal(goal.intention.choice, 'return_for_food');
});

test('without a bot or a goal nothing is gated (the replay suite)', async () => {
  const { client, offered } = jev(['keep_searching']);
  const d = await decide('fortress_approach', { client, bot: null, goal: {}, tree: approachTree(), state: {} });
  assert.deepEqual(d.path, ['keep_searching']);
  assert(offered[0].includes('keep_searching'));
});
