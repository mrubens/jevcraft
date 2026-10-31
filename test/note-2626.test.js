'use strict';
// Note 2626: the run's clock against the ten-hour goal is said on every plan question in every phase (clock.js), not
// only before the Nether as strategy.js said it; the stance in a fight is left alone.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { clockSays, CLOCK_KINDS } = require('../src/clock');

const goalAt = (now, played, nether) => ({ kind: 'win', gameProgress: { startedAt: now - (played + 10) * 60000, clock: { playedMs: played * 60000, byDoing: {}, lastAt: now, startedAt: now - (played + 10) * 60000 }, milestones: nether === null ? {} : { nether_entered: { at: now - (played + 10 - nether) * 60000 } } } });
const bot = () => ({ entity: { position: new Vec3(0, 64, 0) }, game: { dimension: 'the_nether', gameMode: 'survival' }, inventory: { items: () => [] }, health: 20, food: 20, entities: {}, _stalls: { records: {}, marks: [], marked: 0 } });

test('the clock: the budget, the minutes played and left, the milestones reached with their minutes, and the next one due', () => {
  const now = Date.now();
  const s = clockSays(bot(), goalAt(now, 150, 59), now);
  assert.match(s, /^The goal is the ender dragon dead in under 10 hours of play from a fresh world; the run's budget: the Nether by 1 hour, seven blaze rods by 3 hours, the twelve eyes by 4 hours 30 minutes, the End by 7 hours, the dragon dead by 10 hours\. This run has played 2 hours 30 minutes, 7 hours 30 minutes left in all\. Reached: the Nether 59 minutes in/);
  assert.match(s, /Next by the budget: /);
  // Past a budget: said as past.
  const late = clockSays(bot(), goalAt(now, 95, 80), now);
  assert.match(late, /the Nether 1 hour 20 minutes in \(20 minutes past its budget of 1 hour\)/);
  // No fresh-world clock: nothing.
  assert.equal(clockSays(bot(), { kind: 'win' }, now), null);
  assert.equal(clockSays(bot(), { kind: 'survive', gameProgress: { startedAt: now, clock: { playedMs: 1000 } } }, now), null);
});

test('decide puts the clock on a plan question and not on a stance', async () => {
  const { decide } = require('../src/decisions');
  require('../src/decisions/travel'); require('../src/decisions/survival');
  const seen = {};
  const client = id => ({ systemOne: async ({ state, questions }) => { seen[id] = state; const k = Object.keys(questions.branch_0.criteria)[0]; return { answers: { branch_0: { choice: k, confidence: 0.6, probabilities: { [k]: 0.6 } } } }; } });
  const now = Date.now(), goal = goalAt(now, 150, 59);
  await decide('fortress_leg', { client: client('fortress_leg'), bot: bot(), goal, tree: { leg_east: { description: 'East.' }, leg_west: { description: 'West.' } }, state: {} });
  assert.match(seen.fortress_leg.theClock || '', /^The goal is the ender dragon dead in under 10 hours/);
  await decide('encounter_stance', { client: client('encounter_stance'), bot: bot(), goal, tree: { fight: { description: 'Fight.' }, retreat: { description: 'Retreat.' } }, state: {} });
  assert.equal(seen.encounter_stance.theClock, undefined);
  assert.ok(CLOCK_KINDS.has('fortress') && !CLOCK_KINDS.has('survival'));
});
