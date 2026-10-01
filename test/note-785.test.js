'use strict';
// Note 785: a walk that fails, stalls or paces becomes a fact the next
// question sees. Every walk's end is recorded once with its kind and start
// (failed-places.js noteWalk, skills.js navigate); an option going to a
// place a way there failed says it, with what coming at it straight costs;
// walks from about here that keep failing with no question answered are not
// walked again until one is (pacingSays).
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const registry = require('minecraft-data')('26.1');
const { goals } = require('mineflayer-pathfinder');
const { Task } = require('../src/skills');

// Level ground at y 63, open air from y 64.
function flatBot(at = new Vec3(0.5, 64, 0.5), { goto = async () => {} } = {}) {
  const events = [];
  return {
    registry, game: { gameMode: 'survival', dimension: 'overworld' }, entities: {}, entity: { position: at, onGround: true },
    inventory: { items: () => [{ name: 'iron_pickaxe', count: 1, type: registry.itemsByName.iron_pickaxe.id }] },
    blockAt: p => ({ name: p.y < 64 ? 'stone' : 'air', type: p.y < 64 ? 1 : 0, position: p.clone(), boundingBox: p.y < 64 ? 'block' : 'empty', shapes: p.y < 64 ? [[0, 0, 0, 1, 1, 1]] : [] }),
    pathfinder: { movements: {}, goto, setGoal: () => {}, isMoving: () => false },
    clearControlStates: () => {}, getControlState: () => false, setControlState: () => {}, food: 20, health: 20,
    emit: (name, detail) => events.push({ name, detail }), events,
  };
}
const fp = () => require('../src/failed-places');

test('every walk is recorded once when it ends, with its kind, where it began and where it was going, and framed in the flight record (note 785)', async () => {
  const { navigate } = require('../src/skills');
  // Arrived: the goal's own end test at the feet.
  const bot = flatBot(new Vec3(10.5, 64, 10.5));
  await navigate(bot, new Task('walk'), new goals.GoalNear(10, 64, 10, 1), { timeoutMs: 2000 });
  assert.equal(bot._walks.length, 1);
  assert.equal(bot._walks[0].kind, 'arrived');
  assert.deepEqual(bot._walks[0].from, { x: 10.5, y: 64, z: 10.5 });
  assert.equal(bot.events.filter(e => e.name === 'walk_end').length, 1, 'one walk_end frame');
  // The pathfinder's own search out of time: its own kind, not a stall and
  // not no route (25593's lava, 27 blocks off at its own height).
  const timeout = Object.assign(new Error('Took to long to decide path to goal!'), { name: 'Timeout' });
  const b2 = flatBot(new Vec3(0.5, 64, 0.5), { goto: async () => { throw timeout; } });
  await assert.rejects(navigate(b2, new Task('walk'), new goals.GoalNear(27, 64, 0, 1), { timeoutMs: 2000 }), /Took to long/);
  assert.equal(b2._walks.at(-1).kind, 'search_timeout');
  assert.deepEqual(b2._walks.at(-1).goal, { x: 27.5, y: 64, z: 0.5 });
  assert.equal(b2._walks.at(-1).walk, b2._walkSeq);
  // Each kind by what the walk threw.
  const k = fp().kindOf;
  assert.equal(k(Object.assign(new Error('No route from here to (1, 2, 3) (noPath)'), { name: 'NoRoute' })), 'no_route');
  assert.equal(k(Object.assign(new Error('No path to the goal!'), { name: 'NoPath' })), 'no_route');
  assert.equal(k(new Error('navigation timed out without reaching new ground')), 'stall');
  assert.equal(k(new Error('navigation timed out')), 'timed_out');
  assert.equal(k(new Error('Navigation ended before reaching the destination')), 'ended_short');
  assert.equal(k(Object.assign(new Error('task cancelled: x'), { name: 'Cancelled' })), 'interrupted');
  assert.equal(k(Object.assign(new Error('Threat nearby: zombie at 4 blocks'), { name: 'Threat' })), 'interrupted');
});

test('one failed way to a place is said on the option going there, with what coming at it straight costs, and not rested; two rest it, whatever kind (note 785)', () => {
  const tried = require('../src/tried');
  const bot = flatBot(new Vec3(0.5, 64, 0.5));
  const now = Date.now();
  const goal = { tried: { entries: [], escalations: [] } };
  const lava = { x: 27, y: 64, z: 0 };
  // The walk's search ran out of time; nothing reached the ledger.
  fp().noteWalk(bot, { kind: 'search_timeout', goal: lava, from: { x: 0.5, y: 64, z: 0.5 }, to: { x: 1.5, y: 64, z: 0.5 }, blocks: 1, at: now - 30000, why: 'Took to long to decide path to goal!' });
  const tree = { to_known_lava: { description: 'Go to the lava pool.', target: lava }, explore: { description: 'Explore.' }, none_good: { description: 'none' } };
  const r = tried.read(bot, goal, 'stillness_detour', tree, { now });
  assert.ok(r.tree.to_known_lava, 'once is said, not rested');
  const says = r.tree.to_known_lava.description;
  assert.match(says, /The last way to about \(27, 64, 0\) from about here failed 30 seconds ago: the pathfinder's search for a route ran out of time, 1 blocks walked, ending 26 blocks from it\./);
  assert.match(says, /Straight at it at this height instead: \d+ blocks, over open ground, about \d+ seconds, ending at it\./);
  // A second failure of another kind (a stall) rests it while another way is open.
  fp().noteWalk(bot, { kind: 'stall', goal: lava, from: { x: 1.5, y: 64, z: 0.5 }, to: { x: 6.5, y: 64, z: 0.5 }, blocks: 5, at: now - 5000 });
  const r2 = tried.read(bot, goal, 'stillness_detour', tree, { now });
  assert.equal(r2.tree.to_known_lava, undefined);
  assert.match(r2.resting.join(' | '), /Ways to about \(27, 64, 0\) have failed 2 times in the last 30 seconds, whatever was asked \(the pathfinder's search for a route ran out of time, the walk stalled\)/);
  // From 20 blocks off it is another way there.
  bot.entity.position = new Vec3(-20.5, 64, 0.5);
  assert.ok(tried.read(bot, goal, 'stillness_detour', tree, { now }).tree.to_known_lava.description.match(/^Go to the lava pool\.$/));
});

test("25589's night mine: an ore whose walk stalled inside the mine's own step is said at the next asking and rests at the second (note 785)", () => {
  const tried = require('../src/tried');
  const bot = flatBot(new Vec3(-77.5, 34, 573.5));
  bot.blockAt = p => ({ name: 'stone', position: p.clone(), boundingBox: 'block' });
  const now = Date.now();
  const goal = { tried: { entries: [], escalations: [] } };
  const ore = { x: -70, y: 34, z: 569 };
  fp().noteWalk(bot, { kind: 'stall', goal: ore, from: { x: -77.5, y: 34, z: 573.5 }, to: { x: -75, y: 34, z: 572 }, blocks: 3, at: now - 20000, walk: 7 });
  const tree = { ore_0: { description: 'Dig to the iron ore 9 blocks off.', target: ore }, ore_1: { description: 'Dig to the coal ore 6 blocks off.', target: { x: -82, y: 34, z: 576 } }, branch: { description: 'A branch.' } };
  const r = tried.read(bot, goal, 'night_mine_target', tree, { now });
  assert.match(r.tree.ore_0.description, /The last way to about \(-70, 34, 569\) from about here failed 20 seconds ago: the walk stalled, 3 blocks walked, ending 6 blocks from it\./);
  assert.doesNotMatch(r.tree.ore_1.description, /failed/);
  // The same walk's stall in the stall memory too is one failure, not two.
  require('../src/skills').noteStallSpot(bot, new Vec3(-75, 34, 572), now - 20000, { goal: ore, walk: 7, from: { x: -77.5, y: 34, z: 573.5 } });
  assert.ok(tried.read(bot, goal, 'night_mine_target', tree, { now }).tree.ore_0, 'one walk, one failure');
  fp().noteWalk(bot, { kind: 'no_route', goal: ore, from: { x: -77, y: 34, z: 573 }, at: now - 2000 });
  assert.equal(tried.read(bot, goal, 'night_mine_target', tree, { now }).tree.ore_0, undefined, 'rests at the second');
});

test("walks from about here that keep failing with no question answered are not walked again until one is (25595's seven stalls in two minutes, note 785)", async () => {
  const { navigate } = require('../src/skills');
  let walked = 0;
  const bot = flatBot(new Vec3(50.5, 64, 50.5), { goto: async () => { walked++; } });
  const now = Date.now();
  const from = { x: 50.5, y: 64, z: 50.5 };
  // Two failed walks to two places: walked again.
  fp().noteWalk(bot, { kind: 'stall', goal: { x: 70, y: 64, z: 50 }, from, at: now - 60000 });
  fp().noteWalk(bot, { kind: 'search_timeout', goal: { x: 50, y: 64, z: 80 }, from, at: now - 40000 });
  assert.equal(fp().pacingSays(bot, { x: 30, y: 64, z: 50 }, { now }), null);
  fp().noteWalk(bot, { kind: 'no_route', goal: { x: 30, y: 64, z: 30 }, from, at: now - 10000 });
  const says = fp().pacingSays(bot, { x: 30, y: 64, z: 50 }, { now });
  assert.match(says, /^3 walks begun from about here failed in the last 60 seconds with no question answered \(the walk stalled, the pathfinder's search for a route ran out of time, no route; going to \(70, 64, 50\), \(50, 64, 80\), \(30, 64, 30\)\), the last 10 seconds ago: not walked again from here until a question is answered$/);
  // The walk itself: thrown at once as a stall, recorded as refused, not walked.
  await assert.rejects(navigate(bot, new Task('walk'), new goals.GoalNear(30, 64, 50, 1), { timeoutMs: 2000 }),
    err => err.name === 'WalksFailing' && err instanceof Error && /The walk is not begun: 3 walks/.test(err.message));
  assert.equal(walked, 0);
  assert.equal(bot._walks.at(-1).kind, 'refused');
  assert.equal(fp().FAILED.has('refused'), false, 'a refusal is not a failure of its own');
  // From five blocks on it is another place.
  bot.entity.position = new Vec3(56.5, 64, 50.5);
  assert.equal(fp().pacingSays(bot, { x: 30, y: 64, z: 50 }), null);
  bot.entity.position = new Vec3(50.5, 64, 50.5);
  // A question answered since: walked.
  bot._lastAnswer = { id: 'stillness_detour', at: Date.now() };
  assert.equal(fp().pacingSays(bot, { x: 30, y: 64, z: 50 }), null);
  delete bot._lastAnswer;
  // The body's walks never: at the goal, a mob within eight blocks, the vitals' turn.
  assert.equal(fp().pacingSays(bot, { x: 52, y: 64, z: 51 }), null, 'within reach of the goal');
  bot._turn = { holder: 'vitals', phase: 'eat', since: Date.now() };
  assert.equal(fp().pacingSays(bot, { x: 30, y: 64, z: 50 }), null);
  delete bot._turn;
  assert.ok(fp().pacingSays(bot, { x: 30, y: 64, z: 50 }));
});

test('two failed walks toward one goal from about here: the third not begun until a question (note 777 subsumed, 785)', () => {
  const bot = flatBot(new Vec3(0.5, 64, 0.5));
  const now = Date.now();
  const from = { x: 0.5, y: 64, z: 0.5 };
  fp().noteWalk(bot, { kind: 'search_timeout', goal: { x: 27, y: 64, z: 0 }, from, to: { x: 1, y: 64, z: 0 }, at: now - 50000 });
  assert.equal(fp().pacingSays(bot, { x: 27, y: 64, z: 0 }, { now }), null, 'once is a failure');
  fp().noteWalk(bot, { kind: 'search_timeout', goal: { x: 27.5, y: 64, z: 0.5 }, from, to: { x: 1, y: 64, z: 0 }, at: now - 20000 });
  assert.match(fp().pacingSays(bot, { x: 27, y: 64, z: 0 }, { now }), /^walks to \(27, 64, 0\) begun from about here failed 2 times .*the pathfinder's search for a route ran out of time 2 times/);
  assert.equal(fp().pacingSays(bot, { x: -27, y: 64, z: 0 }, { now }), null, 'another goal is walked');
});

test("the stall's question offers the way straight at where the failed walk was going, priced, in the Overworld (note 785)", () => {
  const { straightToward } = require('../src/work');
  const bot = flatBot(new Vec3(0.5, 64, 0.5));
  const now = Date.now();
  const walk = fp().noteWalk(bot, { kind: 'search_timeout', goal: { x: 27, y: 64, z: 0 }, from: { x: 0.5, y: 64, z: 0.5 }, to: { x: 0.5, y: 64, z: 0.5 }, blocks: 0, at: now - 8000 });
  assert.deepEqual(fp().lastFailedWalk(bot, { now }), walk);
  const answer = straightToward(bot, new Task('x'), {}, () => {}, walk, now);
  assert.ok(answer, 'offered');
  assert.deepEqual(answer.target, { x: 27, y: 64, z: 0 });
  assert.match(answer.description, /^The walk there from about here failed 8 seconds ago: the pathfinder's search for a route ran out of time, 0 blocks walked, ending 27 blocks from it\. Go straight at where the last walk was going, \(27, 64, 0\), 27 blocks off at the height the bot stands/);
  // Far below or far off: not this way.
  assert.equal(straightToward(bot, new Task('x'), {}, () => {}, { ...walk, goal: { x: 27, y: 40, z: 0 } }, now), null);
  assert.equal(straightToward(bot, new Task('x'), {}, () => {}, { ...walk, goal: { x: 90, y: 64, z: 0 } }, now), null);
  // An interrupted walk is no failed route.
  bot._walks = [];
  fp().noteWalk(bot, { kind: 'interrupted', goal: { x: 27, y: 64, z: 0 }, from: { x: 0.5, y: 64, z: 0.5 }, at: now - 8000 });
  assert.equal(fp().lastFailedWalk(bot, { now }), null);
});

test('scripts/walk-outcomes.js measures walks by kind, displacement, failed targets walked again, and replays the rules (note 785)', () => {
  const src = require('fs').readFileSync(require.resolve('../scripts/walk-outcomes.js'), 'utf8');
  for (const k of ['walk_end', 'search_timeout', 'pacingSays', 'failedThenAgain', 'saidBefore', 'saidAfter', 'pacingMinutesAfterThird', 'jevDown']) assert(src.includes(k), k);
});
