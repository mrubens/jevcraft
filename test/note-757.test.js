'use strict';
// Note 756: a pocket whose every way rests went up to a question that asks
// nothing about a pocket, and the turn was given back to the pocket on a
// promise that its question was asked next.
//
// 25592 (mid-242-wa, 2026-09-30 08:15:29 to 08:26:43Z): sealed against a
// ghast 34 blocks off, 3 blocks from a fortress, at full health. Leave and
// dig in traded places 4 times in 11 seconds and leaving was set aside ten
// minutes for it; stay waited for nothing (the ghast gone) and rested too.
// pocket_next escalated "every way it had from here rests" to
// survival_priority about ten thousand times, which asks about food,
// shelter and healing and never about a pocket, while turn_priority gave
// survival the turn each minute on "whether to stay, leave or do something
// else there is asked next". The bot sat eleven minutes until leaving's
// rest lapsed, then walked straight out: the pocket was never buried.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { EventEmitter } = require('node:events');
const { Task } = require('../src/skills');
const { Survival, claim, pocketRestsOf } = require('../src/survival');
const { Stalled } = require('../src/stillness');
const arbiter = require('../src/arbiter');

function netherPocket() {
  const origin = new Vec3(-174, 38, 147);
  const open = new Set([`${origin}`, `${origin.offset(0, 1, 0)}`]);
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'the_nether', gameMode: 'survival', difficulty: 'normal' }, entities: {}, health: 20, food: 20,
    registry: require('minecraft-data')('26.1'), time: { timeOfDay: 6000 }, entity: { position: origin.offset(0.5, 0, 0.5), onGround: true, velocity: new Vec3(0, 0, 0) }, oxygenLevel: 20,
    inventory: { items: () => [{ name: 'iron_pickaxe', count: 1 }, { name: 'iron_sword', count: 1 }, { name: 'netherrack', count: 43 }], emptySlotCount: () => 10, slots: [] },
    blockAt: p => ({ name: open.has(`${p}`) ? 'air' : 'netherrack', boundingBox: open.has(`${p}`) ? 'empty' : 'block', position: p }),
    world: { raycast: from => ({ intersect: from.offset(0.6, 0, 0) }) } });
  return { bot, origin };
}

const RESTS = 'pocket next: every way it had from here rests: leave: Tried 2 times from here in the last 1 minute, and it came to nothing: turning between leave shelter and dig in 4 times in 11 seconds without getting anywhere. It rests 9 minutes more from here.; stay: Held from about here 2 times in the last 21 seconds, 21 seconds in all, and nothing changed in any of them. It rests 5 minutes more from here.';

test('every pocket way resting is kept by the step when pocket_next goes up for it, and the pocket\'s claim says what rests and when the first comes back, not "asked next" (25592, note 757)', async () => {
  const { bot, origin } = netherPocket();
  const t0 = Date.parse('2026-09-30T08:15:46Z');
  const refuge = { kind: 'pocket', origin: { x: origin.x, y: origin.y, z: origin.z }, dimension: 'the_nether', verifiedAt: new Date(t0 - 17000).toISOString() };
  const goal = { kind: 'win', request: 'beat the game' };
  const survival = new Survival(bot, {}, { state: { shelters: [refuge] }, client: { systemOne: async () => ({}) } });
  survival.wait = async () => {};
  // pocket_next's own reading of the ledger (decisions/index.js escalateFrom):
  // every way rests, thrown up as a stall to its parent.
  survival.decide = async (task, g, save, { id }) => {
    assert.equal(id, 'pocket_next');
    throw new Stalled({ key: 'survival:pocket_next', why: RESTS, escalated: { from: 'pocket_next', to: 'survival_priority', says: RESTS }, until: t0 + 300000 });
  };
  const real = Date.now;
  Date.now = () => t0;
  try { await assert.rejects(survival.step(new Task('x'), goal, () => {}), err => err.name === 'Stalled'); } finally { Date.now = real; }
  const kept = survival.state.pocketRests;
  assert.ok(kept, 'the step keeps the rests when the question goes up');
  assert.deepEqual(kept.origin, refuge.origin);
  assert.equal(kept.until, t0 + 300000);
  assert.match(kept.says, /^leave: Tried 2 times from here .*turning between leave shelter and dig in 4 times in 11 seconds.*; stay: Held from about here 2 times/);

  // The claim read a minute later, as turn_priority's "a minute passed".
  const now = t0 + 60000;
  Date.now = () => now;
  let c;
  try { c = claim(bot, { kind: 'win', survival: survival.state }, survival); } finally { Date.now = real; }
  assert.equal(c.action, 'pocket_next');
  assert.equal(c.facts.pocketWaysRest.forSeconds, 240);
  const says = arbiter.claimSays(c);
  assert.doesNotMatch(says, /asked next/);
  assert.match(says, /^In a sealed pocket.*: every way it had there rests \(leave: Tried 2 times from here .*\), the first back in about 240 seconds; given the turn meanwhile, it waits sealed and nothing there is asked, while the work, given it, goes on from here \(its walk digs through the pocket's own blocks first\)\./);
  assert.equal(arbiter.promiseOf(c), null, 'no question is promised while every way rests');
});

test('the rests are said only for the pocket they were found in, only while they stand, and are dropped once the pocket is asked again or left (note 757)', async () => {
  const t0 = Date.parse('2026-09-30T08:15:46Z');
  const origin = { x: -174, y: 38, z: 147 };
  const state = { pocketRests: { origin, at: t0, until: t0 + 300000, says: 'leave: ...; stay: ...' } };
  assert.deepEqual(pocketRestsOf(state, { origin }, t0 + 1000), { says: 'leave: ...; stay: ...', forSeconds: 299 });
  assert.equal(pocketRestsOf(state, { origin: { ...origin, x: -170 } }, t0 + 1000), null, 'another pocket is not this one');
  assert.equal(pocketRestsOf(state, { origin }, t0 + 300000), null, 'rests lapsed: the question is what comes');

  // A pocket_next that is asked (a way came back) drops them: the claim
  // promises the question again.
  const { bot } = netherPocket();
  const refuge = { kind: 'pocket', origin, dimension: 'the_nether', verifiedAt: new Date(t0 - 17000).toISOString() };
  const survival = new Survival(bot, {}, { state: { shelters: [refuge], pocketRests: { ...state.pocketRests } }, client: { systemOne: async () => ({}) } });
  survival.wait = async () => {};
  survival.decide = async () => ({ path: ['stay'], stale: false });
  const real = Date.now;
  Date.now = () => t0 + 1000;
  try { await survival.step(new Task('x'), { kind: 'win', request: 'beat the game' }, () => {}); } finally { Date.now = real; }
  assert.equal(survival.state.pocketRests, undefined, 'asked again: the rests are not said any more');
  const c = claim(bot, { kind: 'win', survival: survival.state }, survival);
  assert.match(arbiter.claimSays(c), /whether to stay, leave or do something else there is asked next/);

  // Out of the pocket, they go with it.
  const left = { pocketRests: { ...state.pocketRests } };
  require('../src/pocket-wait').leftPocket(left, t0);
  assert.equal(left.pocketRests, undefined);
});
