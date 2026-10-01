'use strict';
// Note 777: answers that don't hold, and failed things retried (Fable's
// check-in artifacts/fable/checkin-20261001T0239Z.md problem 2; the critic's
// ~02:54Z item 5, 25592 mid-220-ac's night mine).
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const registry = require('minecraft-data')('26.1');
const { Task } = require('../src/skills');

function flatBot(at = new Vec3(0.5, 64, 0.5)) {
  return {
    registry, game: { gameMode: 'survival', dimension: 'overworld' }, entities: {}, entity: { position: at },
    inventory: { items: () => [{ name: 'iron_pickaxe', count: 1 }] },
    blockAt: p => ({ name: p.y < 64 ? 'stone' : 'air', position: p.clone(), boundingBox: p.y < 64 ? 'block' : 'empty' }),
  };
}

test('a walk to a goal that walks from about here have stalled going to twice is not begun a third time, said (note 777, 777b)', async () => {
  const { noteStallSpot, stallsToward, repeatStallSays, navigate } = require('../src/skills');
  const { goals } = require('mineflayer-pathfinder');
  const bot = flatBot(new Vec3(188.5, 61, 139.5));
  const now = Date.now();
  const from = { x: 188.5, y: 61, z: 139.5 };
  const table = { x: 199, y: 61, z: 141 };
  // One walk's stall and its stall again after the recovery are one.
  noteStallSpot(bot, new Vec3(193.4, 61, 139.6), now - 30000, { goal: table, walk: 1, from });
  noteStallSpot(bot, new Vec3(193.6, 61, 139.4), now - 28000, { goal: table, walk: 1, from });
  assert.equal(stallsToward(bot, table, now).length, 1);
  assert.equal(repeatStallSays(bot, new goals.GoalNear(table.x, table.y, table.z, 1), now), null, 'once is a stall');
  noteStallSpot(bot, new Vec3(193.5, 61, 139.5), now - 5000, { goal: { x: 198.5, y: 61, z: 141.5 }, walk: 2, from: { x: 189, y: 61, z: 140 } });
  const says = repeatStallSays(bot, new goals.GoalNear(table.x, table.y, table.z, 1), now);
  assert.match(says, /^walks to \(198, 61, 141\) begun from about here stalled 2 times in the last 28 seconds, at \(193, 61, 139\), the last 5 seconds ago: not walked a third time from here \(navigation timed out without reaching new ground each time\)$/);
  // Another goal is walked; so is the same one from another start.
  assert.equal(repeatStallSays(bot, new goals.GoalNear(220, 61, 141, 1), now), null);
  const other = flatBot(new Vec3(183.5, 61, 139.5)); other._stallSpots = bot._stallSpots;
  assert.equal(repeatStallSays(other, new goals.GoalNear(table.x, table.y, table.z, 1), now), null, 'from another start it is another walk');
  // The walk itself: thrown at once, as a stall, nothing walked.
  let walked = false;
  Object.assign(bot, { pathfinder: { movements: {}, goto: async () => { walked = true; }, setGoal: () => {}, isMoving: () => false },
    clearControlStates: () => {}, getControlState: () => false, setControlState: () => {}, food: 20 });
  // Note 785: refused by the walks' record (failed-places.js pacingSays),
  // until a question is answered.
  await assert.rejects(navigate(bot, new Task('walk'), new goals.GoalNear(table.x, table.y, table.z, 1), { timeoutMs: 2000 }),
    err => err.name === 'WalksFailing' && /failed 2 times/.test(err.message) && /the walk stalled 2 times/.test(err.message) && /until a question is answered/.test(err.message));
  assert.equal(walked, false);
  bot._lastAnswer = { id: 'stillness_detour', at: Date.now() };
  await navigate(bot, new Task('walk'), new goals.GoalNear(table.x, table.y, table.z, 1), { timeoutMs: 2000 }).catch(() => {});
  assert.equal(walked, true, 'walked once a question was answered');
  delete bot._lastAnswer; bot._walks = [];
  // Ten minutes on, walked again.
  for (const s of bot._stallSpots) for (const g of s.goals) g.at -= 10 * 60000;
  assert.equal(repeatStallSays(bot, new goals.GoalNear(table.x, table.y, table.z, 1)), null);
});

test('never refused with the bot already at the goal or within reach of it (25598 mid-241-br 04:18:34Z, note 777b)', async () => {
  const { noteStallSpot, repeatStallSays, navigate } = require('../src/skills');
  const { goals } = require('mineflayer-pathfinder');
  const now = Date.now();
  const lava = { x: -66, y: 5, z: -490 };
  // Two walks to the lava stalled nine blocks under it, begun down there.
  const bot = flatBot(new Vec3(-69.5, -4, -491.5));
  noteStallSpot(bot, new Vec3(-68, -4, -490), now - 60000, { goal: lava, walk: 1, from: { x: -69.5, y: -4, z: -491.5 } });
  noteStallSpot(bot, new Vec3(-68, -4, -490), now - 30000, { goal: lava, walk: 2, from: { x: -69.5, y: -4, z: -491.5 } });
  assert.match(repeatStallSays(bot, new goals.GoalNear(lava.x, lava.y, lava.z, 1), now) || '', /not walked a third time/, 'from the same start below: refused');
  // Stood a block from the lava: no walk is wanted, never refused.
  bot.entity.position = new Vec3(-64.5, 5, -488.5);
  assert.equal(repeatStallSays(bot, new goals.GoalNear(lava.x, lava.y, lava.z, 1), now), null);
  let walked = false;
  Object.assign(bot, { pathfinder: { movements: {}, goto: async () => { walked = true; }, setGoal: () => {}, isMoving: () => false },
    clearControlStates: () => {}, getControlState: () => false, setControlState: () => {}, food: 20 });
  await navigate(bot, new Task('walk'), new goals.GoalNear(lava.x, lava.y, lava.z, 1), { timeoutMs: 2000 }).catch(err => assert.notEqual(err.name, 'WalksFailing'));
  assert.equal(walked, true, 'walked (or found there)');
  // Ten blocks off, begun from a start the stalled walks did not: walked.
  bot.entity.position = new Vec3(-60.5, 5, -480.5);
  assert.equal(repeatStallSays(bot, new goals.GoalNear(lava.x, lava.y, lava.z, 1), now), null);
});

test('a target the ways to have failed twice, whatever asked, is said on the option going there and rests it (note 777)', () => {
  const tried = require('../src/tried');
  const bot = flatBot(new Vec3(0.5, 64, 0.5));
  const now = Date.now();
  const lava = { x: 30, y: 60, z: 0 };
  // Two different questions' ways to the same lava, each failed.
  const goal = { tried: { entries: [
    { q: 'portal_method', method: 'cast_at_lava', target: lava, place: { x: 0, y: 64, z: 0 }, at: now - 200000, settledAt: now - 190000, outcome: 'blocked', why: 'No route from here to (30, 60, 0) (noPath)' },
    { q: 'lava_way', method: 'pool_0', target: { x: 31, y: 60, z: 1 }, place: { x: 10, y: 64, z: 0 }, at: now - 100000, settledAt: now - 90000, outcome: 'blocked', why: 'The staircase toward (31, 60, 1) is set aside (no safe step toward it)' },
  ], escalations: [] } };
  const tree = { pool_0: { description: 'Go to the lava pool at (30, 60, 0).', target: lava }, pool_1: { description: 'Go to the lava pool at (-40, 60, 0).', target: { x: -40, y: 60, z: 0 } }, none_good: { description: 'none' } };
  const r = tried.read(bot, goal, 'lava_way', tree, { now });
  assert.equal(r.tree.pool_0, undefined, 'rested while another way is open');
  assert.ok(r.tree.pool_1);
  assert.match(r.resting[0], /^pool 0: Tried once toward the same place from about here in the last 2 minutes, and it came to nothing: .*\. Ways to about \(30, 60, 0\) have failed 2 times in the last 3 minutes, whatever was asked \(no route, no safe step\), the last 2 minutes ago\. It rests 4 minutes more from here\.$/);
  // A failure for another reason (a threat cut it) is not a way that failed.
  goal.tried.entries[1].why = 'Threat nearby: zombie at 4 blocks';
  assert.ok(tried.read(bot, goal, 'lava_way', tree, { now }).tree.pool_0);
});

test('a run of ways from about here to other targets each failing: the place is said and the walks from it rest (25592 mid-220-ac 02:51-02:54Z, note 777)', () => {
  const tried = require('../src/tried');
  const { noteStallSpot } = require('../src/skills');
  const bot = flatBot(new Vec3(-77.5, 34, 573.5));
  const now = Date.now();
  const goal = { tried: { entries: [], escalations: [] } };
  // Two ores' walks stalled about here, each a different ore.
  noteStallSpot(bot, new Vec3(-78, 35, 576), now - 60000, { goal: { x: -78, y: 35, z: 574 }, walk: 1, from: { x: -77.5, y: 34, z: 573.5 } });
  noteStallSpot(bot, new Vec3(-77, 34, 573), now - 20000, { goal: { x: -70, y: 34, z: 569 }, walk: 2 });
  const tree = {
    ore_21: { description: 'Dig to the coal ore 5 blocks off.', target: { x: -72, y: 35, z: 578 } },
    ore_25: { description: 'Dig to the iron ore 9 blocks off.', target: { x: -84, y: 34, z: 568 } },
    branch: { description: 'Dig a branch down to a working depth.' },
    none_good: { description: 'none' },
  };
  const r = tried.read(bot, goal, 'night_mine_target', tree, { now });
  assert.deepEqual(Object.keys(r.tree), ['branch', 'none_good'], 'the walks from here rest; the branch is the way left');
  assert.match(r.resting.join(' | '), /ore 21: From about here, ways to 2 other places have failed in the last 60 seconds \(the walk stalled 2 times; \(-78, 35, 574\), \(-70, 34, 569\)\): the place may be what fails, not the target\./);
  // Walked off (more than four blocks), the place no longer bears.
  bot.entity.position = new Vec3(-60.5, 34, 573.5);
  assert.ok(tried.read(bot, goal, 'night_mine_target', tree, { now }).tree.ore_21);
  // The stance and the body's ways only say theirs: never rested here.
  bot.entity.position = new Vec3(-77.5, 34, 573.5);
  assert.ok(tried.read(bot, goal, 'night_mine_target', tree, { now, sayOnly: true }).tree.ore_21);
});

test('ask-loops puts each turn within a minute to what came between and counts stalls at a spot stalled at twice (note 777)', () => {
  const src = require('fs').readFileSync(require.resolve('../scripts/ask-loops.js'), 'utf8');
  for (const k of ['--turns', '--stalls', 'turnCause', 'stallsMeasure', 'goal still open: only carried changed']) assert(src.includes(k), k);
});
