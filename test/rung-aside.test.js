'use strict';
// The rung's question from a stage's save, and a rung set aside (note 600):
// mid-242-af-fortress-1 (25583) was brought to the rung's question 58
// seconds into a trial from a fortress save, told "worked on this rung in 31
// minutes", set the rods aside at 11:33:56 and took them up again at
// 11:33:57 ("set aside 1 minutes ago"); mid-242-af-nether-2-fortress-1
// (25584) asked the rung's question fifteen times in two minutes as each
// pass met fortress_leg's resting ways again, set the rods aside, took them
// up in the same second three times over (leave_nether's search_on), and
// was brought to the rung's question at 11:40:00 and 11:42:33 while the
// rods waited, setting them aside again each time.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { Task } = require('../src/skills');
const registry = require('minecraft-data')('26.1');
const { setAside, isSetAside } = require('../src/progress');
const { observeProgress } = require('../src/game-progress');

const T0 = Date.parse('2026-09-28T11:33:56Z');
const HERE = new Vec3(-103.5, 41, 108.5);
const BELOW = 'fortress leg: every way it had from here rests: back to fortress: Tried 2 times from here in the last 8 seconds, and it came to nothing. It rests 5 minutes more from here.; return for blocks: Tried 2 times from here in the last 1 second, and it came to nothing. It rests 5 minutes more from here.';
function recorded({ rung = 'obtain_blaze_rods' } = {}) {
  const items = [{ name: 'iron_sword', count: 1 }, { name: 'gravel', count: 11 }, { name: 'iron_pickaxe', count: 1 }];
  const bot = { registry, game: { dimension: 'the_nether', gameMode: 'survival', difficulty: 'normal' }, health: 19.6, food: 16, isAlive: true, chat() {}, emit() {},
    entity: { id: 1, position: HERE.clone() }, time: { timeOfDay: 6000 }, entities: {},
    inventory: { items: () => items, slots: [] }, findBlocks: () => [], clearControlStates() {},
    blockAt: p => ({ position: p, name: p.y < 41 ? 'netherrack' : 'air', boundingBox: p.y < 41 ? 'block' : 'empty' }),
    pathfinder: { movements: { blocksCantBreak: new Set() }, setGoal() {}, getPathTo: () => ({ status: 'noPath', path: [] }) } };
  const goal = { kind: 'win', request: 'beat the game', from: 'TestPlayer', survival: {}, rungTime: { phase: rung },
    rungClocks: { obtain_blaze_rods: { activeMs: 883087, lastAt: T0 } },
    landmarks: [{ kind: 'warped_forest', x: -88, y: 32, z: 64, dimension: 'nether' }, { kind: 'nether_fortress', x: -103, y: 63, z: 106, dimension: 'nether' }],
    portals: [{ x: 17, y: 58, z: 1, dimension: 'nether' }] };
  observeProgress(bot, goal);
  return { bot, goal };
}
async function ask(bot, goal, stall, pick = null) {
  const { answerStall } = require('../src/work');
  const asked = [];
  const client = { model: 'jev', systemOne: async ({ state, questions }) => {
    const answers = {};
    for (const [b, q] of Object.entries(questions)) {
      const keys = Object.keys(q.criteria || {});
      asked.push({ state, options: q.criteria });
      answers[b] = { choice: pick && keys.includes(pick) ? pick : keys.includes('keep_at_it') ? 'keep_at_it' : keys[0], confidence: 0.6 };
    }
    return { answers };
  } };
  await answerStall(bot, new Task('stall'), goal, () => {}, stall, { client }).catch(() => {});
  return asked;
}

test('every way below resting until a time, the rung\'s question offers other work until the first comes off rest, keeping at it says it meets the same rests, and the set-aside keeps what it was for, from where, until when (note 600)', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: T0 });
  const { bot, goal } = recorded();
  const until = T0 + 270000;
  const stall = { key: 'step:rung:obtain_blaze_rods', work: 'step:rung:obtain_blaze_rods', layer: 'work', strikes: 1, escalated: { from: 'fortress_leg', to: 'rung_progress', says: BELOW }, until };
  const asked = await ask(bot, goal, stall, 'set_aside_rung');
  assert.equal(asked.length, 1);
  const { options } = asked[0];
  assert.match(options.until_rest_ends || '', /^Other work for the 5 minutes until the first of the fortress leg's ways comes off its rest here, .*the obtain blaze rods stays the work in hand and is taken up again when that rest ends\. Work on offer meanwhile from here: .*Mine netherrack for building blocks now: 0 carried/);
  assert.match(options.keep_at_it || '', /Every way the fortress leg had from here rests 5 minutes more: kept at from here now, the next pass meets the same rests and this question comes again\./);
  assert(isSetAside(goal, 'rung', 'obtain_blaze_rods', T0), 'set aside as Jev chose');
  assert.deepEqual(goal.rungAside, { phase: 'obtain_blaze_rods', at: T0, where: { x: -104, y: 41, z: 108 }, until, why: BELOW.slice(0, 300) });
});

test('a rung set aside seconds ago from here is not offered back while what it was set aside for stands, and says so; from elsewhere it is, said in seconds, from where and for what (25583, note 600)', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: T0 });
  const { bot, goal } = recorded({ rung: 'obtain_ender_pearls' });
  setAside(goal, 'rung', 'obtain_blaze_rods', 'Jev set it aside at the rung\'s question, worked on in 0.9 minutes on it', 1800000);
  goal.rungAside = { phase: 'obtain_blaze_rods', at: T0, where: { x: -104, y: 41, z: 108 }, until: T0 + 270000, why: BELOW };
  t.mock.timers.tick(1000);
  const stall = { key: 'step:go_to_landmark', work: 'step:rung:obtain_ender_pearls', layer: 'work', strikes: 1, error: 'The walk to the warped forest at (-88, 64), 48 blocks off, came no nearer: No path to the goal!' };
  let asked = await ask(bot, goal, stall);
  assert.equal(asked[0].options.take_up_obtain_blaze_rods, undefined, 'not offered back a second after');
  assert.match(asked[0].state.stalled.takeUpNotOffered[0], /^the obtain blaze rods taken up again: set aside 1 second ago from about here for this: fortress leg: every way it had from here rests: .*; that stands 4 minutes more from here, and taken up now it meets the same\./);
  assert.match(asked[0].state.stalled.takeUpNotOffered[0], /It is offered again once the bot is more than 4 blocks from there or that time is out\.$/);
  // Eight blocks off, ten seconds later: offered, with when, from where and for what.
  t.mock.timers.tick(9000);
  bot.entity.position = HERE.offset(8, 0, 0);
  asked = await ask(bot, goal, stall);
  assert.match(asked[0].options.take_up_obtain_blaze_rods || '', /^Take up the obtain blaze rods again now, its rest cut short: set aside 10 seconds ago from \(-104, 41, 108\), 8 blocks from here \(Jev set it aside at the rung's question, worked on in 0\.9 minutes on it\), for this: fortress leg: every way it had from here rests/);
});

test('a rung set aside is not brought to its own question while it waits: an escalation to it asks the stall\'s question, with no set-aside of what is already set aside, and its budget does not run (25584, note 600)', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: T0 });
  const tried = require('../src/tried');
  // The rods waiting in the Nether (game-progress.js rods_waiting): the rung in hand by its clock is still the rods.
  const { bot, goal } = recorded();
  setAside(goal, 'rung', 'obtain_blaze_rods', 'Jev set it aside at the rung\'s question', 1800000);
  assert.equal(tried.rungOf(goal), null, 'not the rung in hand while set aside');
  goal.tried = goal.tried || { entries: [], escalations: [] };
  goal.tried.rung = { rung: 'obtain_blaze_rods', since: T0 - 600000, lastAt: T0, bestAt: T0 - 600000, idleMs: 590000, origin: { x: -104, y: 41, z: 109 }, best: { items: 0, milestones: 1, far: 0, target: {} }, asked: 0 };
  t.mock.timers.tick(30000);
  assert.equal(tried.watchRung(bot, goal), null, 'its budget does not run while it waits');
  const stall = { key: 'step:none', work: 'step:rung:obtain_blaze_rods', layer: 'work', strikes: 1, escalated: { from: 'stillness_detour', to: 'rung_progress', says: 'stillness detour: every way it had from here rests' } };
  const asked = await ask(bot, goal, stall);
  assert.equal(asked.length, 1);
  assert.equal(asked[0].options.keep_at_it, undefined, 'the stall\'s question, not the rung\'s');
  assert.equal(asked[0].options.set_aside_rung, undefined, 'no setting aside what is already set aside');
});

test('the rods\' own question does not offer them back where what they were set aside for still stands, and says so (leave_nether, 25584, note 600)', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: T0 });
  const { leaveNetherStep } = require('../src/game-progress');
  const { bot, goal } = recorded();
  setAside(goal, 'rung', 'obtain_blaze_rods', 'Jev set it aside at the rung\'s question', 1800000);
  goal.rungAside = { phase: 'obtain_blaze_rods', at: T0, where: { x: -104, y: 41, z: 108 }, until: T0 + 270000, why: BELOW };
  const asked = [];
  const client = { model: 'jev', systemOne: async ({ state, questions }) => {
    const q = questions.branch_0; asked.push({ state, options: q.criteria });
    return { answers: { branch_0: { choice: Object.keys(q.criteria)[0], confidence: 0.6 } } };
  } };
  const stage = { phase: 'obtain_blaze_rods', action: 'rods_waiting', why: 'Jev set it aside at the rung\'s question', until: T0 + 1800000 };
  await leaveNetherStep(bot, new Task('leave'), goal, () => {}, stage, { client }).catch(() => {});
  assert.equal(asked.length, 1);
  assert.equal(asked[0].options.search_on, undefined);
  assert.match(asked[0].state.searchOnNotOffered, /^the obtain blaze rods taken up again: set aside 1 second ago from about here for this: fortress leg: every way it had from here rests/);
});

test('an escalation for every way resting says when the first comes off rest (decisions/index.js escalateFrom, note 600)', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: T0 });
  const { decide } = require('../src/decisions');
  const tried = require('../src/tried');
  const bot = { entity: { position: HERE.clone() }, game: { dimension: 'the_nether', gameMode: 'survival' }, inventory: { items: () => [] }, health: 19.6, food: 16 };
  const goal = { kind: 'win', step: { action: 'find_fortress' }, gameProgress: { phase: 'obtain_blaze_rods' } };
  for (const [method, at] of [['back_to_fortress', T0 - 60000], ['back_to_fortress', T0 - 50000], ['return_for_blocks', T0 - 20000], ['return_for_blocks', T0 - 10000]]) tried.record(bot, goal, { q: 'fortress_leg', method, outcome: 'blocked', why: 'came back at once', now: at });
  const client = { systemOne: async () => { throw new Error('not asked'); } };
  const tree = { back_to_fortress: { description: 'Go back into the fortress in view.' }, return_for_blocks: { description: 'Go back through the portal for stone.' } };
  await assert.rejects(decide('fortress_leg', { client, bot, goal, tree, state: {} }), { name: 'Stalled' });
  const stall = bot._stalls.stall;
  assert.equal(stall.escalated.to, 'rung_progress');
  assert.equal(stall.until, T0 - 50000 + tried.REST_MS, 'the first of the two ways off rest');
});
