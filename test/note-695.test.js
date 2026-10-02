'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { Task } = require('../src/skills');
const { groundBot } = require('./fixtures/saved-ground');

// Note 695: the check an action runs at once is the check it is offered by,
// what still ends in its first second rests with its reason and is said to
// the questions after, and the trip home is said for what it is for.
const SPAN = require('./fixtures/nether-span-mid-242-af.json');
const CARRIED = [['stone_sword', 1], ['coal', 17], ['crafting_table', 1], ['iron_sword', 1], ['cobblestone', 64]];
const STEMS = [[26, 65, 26], [26, 59, 26], [26, 58, 26], [25, 70, 12], [31, 69, 27]];
function spanBot({ items = CARRIED, at = new Vec3(-29.5, 72, 48.5) } = {}) {
  return groundBot(SPAN, { at, items: items.map(i => [...i]), health: 20, food: 20, dimension: 'the_nether', indexed: true });
}
function goalOf(now = Date.now()) {
  return { kind: 'win', request: 'beat the game',
    resourceMemory: Object.fromEntries(STEMS.map(([x, y, z]) => [`the_nether:${x},${y},${z}`, { name: 'crimson_stem', position: { x, y, z }, dimension: 'the_nether', seenAt: now - 60000 }])),
    landmarks: [{ kind: 'warped_forest', x: -73, y: 64, z: -32, biome: true, dimension: 'nether', firstAt: now, seenAt: now }],
    portals: [{ x: 29, y: 71, z: 31, dimension: 'overworld' }, { x: 17, y: 58, z: 1, dimension: 'nether' }],
    gameProgress: { phase: 'obtain_blaze_rods' } };
}
function jevStub(picks) {
  const asked = [];
  return { asked, systemOne: async ({ state, questions }) => { asked.push({ state, options: questions.branch_0.criteria }); const p = picks.find(k => questions.branch_0.criteria[k]) || Object.keys(questions.branch_0.criteria)[0]; return { answers: { branch_0: { choice: p, confidence: 0.9 } } }; } };
}
// A shooter in sight 17 blocks off. 25591 had a crossbow piglin there at
// 22:19:52Z; since note 913 a piglin that far is not counted (its bolts
// landed 3 times in 3,143 seconds from 8 to 12 blocks and never beyond), so
// the refusal is shown with a skeleton, whose arrows land at seventeen.
function piglinInSight(t, name = 'skeleton') {
  const danger = require('../src/danger');
  const threats = danger.threats;
  danger.threats = () => [{ entity: { name, type: 'hostile', heldItem: { name: name === 'piglin' ? 'crossbow' : 'bow' }, position: new Vec3(-12, 72, 48) }, distance: 17, visible: true }];
  t.after(() => { danger.threats = threats; });
}

test('a crossbow piglin 17 blocks off in sight does not refuse the span: its bolts hardly land from there (note 913)', t => {
  piglinInSight(t, 'piglin');
  assert.equal(require('../src/bridging').spanRefused(spanBot()), null);
});

test('with a piglin in sight the crossings are not offered: the span refuses its first cell, and the question says so (25591, note 695)', async t => {
  piglinInSight(t);
  const { netherGather } = require('../src/nether-gather');
  const bot = spanBot(), goal = goalOf();
  const client = jevStub(['leg_west', 'walk_to_1']);
  const bridging = require('../src/bridging');
  assert.match(bridging.spanRefused(bot).says, /^a skeleton 17 blocks off can see the bot, and no span is laid while something that shoots can$/);
  await netherGather(bot, new Task('work'), goal, () => {}, 'crimson_stem', { navigate: async () => {}, client }).catch(() => {});
  const { options, state } = client.asked[0];
  assert.deepEqual(Object.keys(options).filter(k => /^cross_to/.test(k)), [], 'no crossing offered');
  assert(state.waysResting.some(w => /^straight across to the .* at \(.*\): not now, a skeleton 17 blocks off can see the bot/.test(w)), state.waysResting.join('\n'));
  // The span itself stops with the same check, in its first cell.
  await assert.rejects(bridging.bridgeTo(Object.assign(bot, { setControlState() {} }), new Task('work'), new Vec3(-77, 72, 26), { maxBlocks: 4 }), /^Error: Not bridging with a skeleton 17 blocks off able to see me$/);
});

test('going on without is said, not offered, when no other step of the game is open (25591, note 695)', async () => {
  const { netherGather } = require('../src/nether-gather');
  const bot = spanBot(), goal = goalOf();
  // The pearls rest too (the sweep for a warped forest got nowhere): no
  // other step of the ladder is open.
  goal.landmarks = [];
  require('../src/progress').setAside(goal, 'rung', 'warped_search', 'the sweep for a warped forest got nowhere', 30 * 60000);
  const client = jevStub(['leg_west']);
  await netherGather(bot, new Task('work'), goal, () => {}, 'crimson_stem', { navigate: async () => {}, client }).catch(() => {});
  const { options, state } = client.asked[0];
  assert.equal(options.without, undefined);
  assert.match(state.without, /^Going on without the crimson stem is not offered: no other step of the game is open now, so leaving the obtain blaze rods would only be waiting for it to come back\.$/);
});

test('a floor way the pathfinder finds no route down to is said, not offered (note 695)', async () => {
  const travel = require('../src/nether-travel');
  const bot = spanBot();
  bot.pathfinder = { movements: { maxDropDown: 3 }, getPathFromTo: function* () { yield { result: { status: 'noPath', path: [] } }; } };
  const down = { way: { end: new Vec3(-30, 40, 48), maxDrop: 6 } };
  const r = await travel.downRoute(bot, new Task('work'), down);
  assert.deepEqual(r, { found: false, why: 'the pathfinder finds no route to the foot of the way down at (-30, 40, 48)' });
  assert.equal(bot.pathfinder.movements.maxDropDown, 3, 'the movements are put back');
});

test('an answer that ends in its first second rests from where it was chosen, and the next questions say it (the 25591 cascade, note 695)', async () => {
  const { decide } = require('../src/decisions');
  const bot = spanBot(), goal = goalOf();
  const opt = (d, target) => ({ description: d, ...(target ? { target } : {}) });
  const tree = () => ({ cross_to_1: opt('Cross to the stems.', { x: 119, y: 68, z: 105 }), floor_to_1: opt('Down to the floor and along it.', { x: 119, y: 68, z: 105 }), leg_west: opt('Search west.'), leg_east: opt('Search east.') });
  const client = jevStub(['cross_to_1', 'floor_to_1']);
  await decide('nether_gather', { client, bot, goal, tree: tree(), state: {} });
  // The crossing ends at once: the work loop notes the failure (work.js noteError).
  goal.lastFailure = { why: 'Not bridging with a skeleton 17 blocks off able to see me', at: Date.now(), by: require('../src/tried').answerNow(goal) };
  const d = await decide('leave_nether', { client: jevStub(['search_on']), bot, goal, tree: { search_on: opt('Search on.'), wait_here: opt('Wait here.') }, state: {} });
  assert.equal(d.path[0], 'search_on');
  assert.match(goal.decisions.at(-1).state.failedAtOnce, /^cross to 1 \(nether gather\), chosen [\d.]+ seconds ago, ended [\d.]+ seconds after: Not bridging with a skeleton 17 blocks off able to see me; it rests from where it was chosen for 5 minutes$/);
  // Asked again, the crossing rests and the others are offered.
  const again = jevStub(['floor_to_1']);
  await decide('nether_gather', { client: again, bot, goal, tree: tree(), state: {} });
  assert.equal(again.asked[0].options.cross_to_1, undefined);
  assert(again.asked[0].options.floor_to_1 && again.asked[0].options.leg_west);
  // The floor way ends at once too ("no route"), and upkeep is asked next.
  goal.lastFailure = { why: 'No route from here to the foot of the way down', at: Date.now(), by: require('../src/tried').answerNow(goal) };
  const up = jevStub(['carry_on']);
  await decide('upkeep', { client: up, bot, goal, tree: { carry_on: opt('Carry on.'), fetch_stems: opt('Fetch stems.') }, state: {} });
  assert.match(up.asked[0].state.failedAtOnce, /^2 answers in the last \d+ seconds each ended within 2 seconds of being chosen, each now resting from where it was chosen: cross to 1 .*; floor to 1 \(nether gather\), .*No route from here to the foot of the way down/);
  const third = jevStub(['leg_west']);
  await decide('nether_gather', { client: third, bot, goal, tree: tree(), state: {} });
  assert.deepEqual(Object.keys(third.asked[0].options).sort(), ['leg_east', 'leg_west']);
});

test('a question asked as the answer\'s own means is not its end: the approach under go_in (note 695)', async () => {
  const { decide } = require('../src/decisions');
  const bot = spanBot(), goal = goalOf();
  const opt = d => ({ description: d });
  await decide('fortress_visit', { client: jevStub(['go_in']), bot, goal, target: { x: -108, y: 77, z: 155 }, tree: { go_in: opt('Go in.'), leave_fortress: opt('Leave.') }, state: {} });
  const way = jevStub(['walk_route']);
  await decide('fortress_approach', { client: way, bot, goal, tree: { walk_route: opt('Walk.'), tunnel: opt('Tunnel.') }, state: {} });
  assert.equal(way.asked[0].state.failedAtOnce, undefined);
  assert.equal(goal.intention.choice, 'go_in');
});

test('the trip home is not offered where it cannot begin, and is said for what is missing (25591, note 695)', () => {
  const mh = require('../src/mob-hunt');
  const bot = spanBot({ items: [['netherrack', 146], ['iron_sword', 1]] }), goal = goalOf();
  const homeBy = { portal: { x: 150, y: 64, z: 217 }, says: 'the one it came through, not seen since, worked out from its Overworld side as near (150, 217), 247 blocks off' };
  // A leg toward it made no ground a moment ago, and a shooter can see the bot (a skeleton: a piglin that far is not counted since note 913).
  require('../src/progress').setAside(goal, 'portal_leg', new Vec3(150, 64, 217), 'a walk toward it made no ground', 120000);
  const danger = require('../src/danger'), threats = danger.threats;
  danger.threats = () => [{ entity: { name: 'skeleton', type: 'hostile', heldItem: { name: 'bow' } }, distance: 17, visible: true }];
  try {
    const start = mh.portalTripStart(bot, goal, homeBy);
    assert.equal(start.ok, false);
    assert.match(start.why, new RegExp(`^the way back to it cannot begin from here: a leg of 32 blocks on foot toward it made no ground a moment ago \\(resting\\); no crossing now: a skeleton 17 blocks off can see the bot.*; no stair to it by hand from here \\((more than ${require('../src/tunneling').STAIR_ACROSS} blocks across|no step toward it gains)\\), and no pickaxe is carried or can be made from what is carried$`));
  } finally { danger.threats = threats; }
  // With the leg not resting the trip can begin.
  assert.equal(mh.portalTripStart(bot, goalOf(), homeBy).ok, true);
  // 146 blocks carried: the trip is for a pickaxe and wood, said the same in chat.
  assert.match(mh.returnForKitSays(bot, homeBy), /^Go back through the portal \(.*\) for a pickaxe and wood: /);
  const intention = require('../src/intention');
  const g = { kind: 'win' };
  intention.after(Object.assign(bot, { chat(m) { this.said = m; } }), g, 'fortress_approach', ['return_for_blocks'], { target: { x: 0, y: 64, z: 27 }, state: {}, chosen: true });
  assert.match(bot.said, /^Going back through the portal for a pickaxe and wood at \(0, 64, 27\): no pickaxe, 146 blocks carried\.$/);
});

test('the rock last stood on is kept while the search runs: wide ground, not a span (25588, note 695)', () => {
  const coverage = require('../src/nether-coverage');
  const state = {};
  const blocks = new Map();
  const bot = { game: { dimension: 'the_nether' }, entity: { position: new Vec3(204.5, 35, 45.5) },
    blockAt: p => { const n = blocks.get(`${p.x},${p.y},${p.z}`); return n ? { name: n, boundingBox: 'block' } : { name: 'air', boundingBox: 'empty' }; } };
  // A one-wide basalt span: not ground.
  for (let x = 200; x <= 210; x++) blocks.set(`${x},34,45`, 'basalt');
  coverage.groundStood(bot, state);
  assert.equal(coverage.lastGround(state, bot), null);
  // Netherrack all round: ground.
  for (let x = 202; x <= 206; x++) for (let z = 43; z <= 47; z++) blocks.set(`${x},34,${z}`, 'netherrack');
  coverage.groundStood(bot, state);
  assert.deepEqual({ ...coverage.lastGround(state, bot), at: 0 }, { key: '204,35,45', x: 204, y: 35, z: 45, name: 'netherrack', at: 0 });
});
