'use strict';
// A held answer holds until something it depends on changes (note 611).
// The audit's cohort from 13:55Z counted 880 askings within two minutes of
// a repeat hold (note 560), 102.7 an hour; 894 of the 973 it read by 17:50
// were the held answer offered again from where it was held. Four ways the
// hold leaked, each reproduced here from its trial:
// mid-243-af-fortress-4, survival_priority held on obtain food/return for
// food 362 times and asked again with it on offer 769 times (a nested
// answer: the ledger read the top level only); mid-242-bb, rung_progress
// held on keep at it and asked again with it on offer 91 times (every way
// resting at a question with nothing above kept all on offer, the held one
// too); the replay of mid-243-af, a hold dropped from the ledger within a
// minute and a half by the one way taken at every pass after it; and
// mid-242-bb and mid-243-ah-fortress-5, fortress_approach held on tunnel,
// keep searching and cross level, then asked again at once about a
// fortress place found 15 to 40 blocks off the last, the bot standing still.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');

const netherBot = (x, y, z) => ({ entity: { position: new Vec3(x, y, z) }, game: { dimension: 'the_nether', gameMode: 'survival' }, inventory: { items: () => [] }, health: 2.8, food: 8 });
const offeredIn = questions => Object.values(questions).flatMap(q => Object.keys(q.criteria || {}));

test('mid-243-af-fortress-4: a nested answer held is not offered again from here; before, obtain food/return for food was asked again 769 times', async () => {
  const { decide } = require('../src/decisions');
  const bot = netherBot(-204.5, 61, -200.5);
  const goal = { kind: 'win', step: { action: 'return_to_portal', portal: { x: 3, y: 42, z: 8 } } };
  const offered = [];
  // Jev as recorded: obtain food, return for food, while it is offered (0.81 and 0.8 each time).
  const client = { systemOne: async ({ questions }) => {
    const keys = offeredIn(questions); offered.push(keys);
    const answers = {};
    for (const [b, q] of Object.entries(questions)) {
      const k = Object.keys(q.criteria);
      answers[b] = { choice: k.includes('return_for_food') ? 'return_for_food' : k.includes('obtain_food') && keys.includes('return_for_food') ? 'obtain_food' : k.includes('continue_request') ? 'continue_request' : k[0], confidence: 0.7 };
    }
    return { answers };
  } };
  const tree = () => ({
    continue_request: { description: 'Spend the next action on the player request.' },
    obtain_food: { description: 'Obtain safe food.', children: {
      return_for_food: { description: 'Go back through the portal to the Overworld, 293 blocks off.' },
      hoglin_food: { description: 'Hunt a hoglin for its meat (none in view).' },
    } },
  });
  const ask = () => decide('survival_priority', { client, bot, goal, tree: tree(), state: { health: 2.8, food: 8 } });
  const paths = [];
  for (let i = 0; i < 8; i++) {
    try { const d = await ask(); paths.push(d.path.join('/')); } catch (err) { if (err.name !== 'Stalled') throw err; paths.push('stall'); delete bot._stalls.stall; }
    // Each ended at once: "The nether portal at (3, 42, 8) is 293 blocks off and cannot be reached from here".
    goal.lastFailure = { why: 'The nether portal at (3, 42, 8) is 293 blocks off and cannot be reached from here', at: Date.now() };
  }
  const withIt = offered.filter(k => k.includes('return_for_food')).length;
  assert.ok(withIt <= 2, `offered ${withIt} times: ${paths.join(', ')}`);
  assert.equal(paths.slice(2).filter(p => p === 'obtain_food/return_for_food').length, 0, `not taken again: ${paths.join(', ')}`);
  const read = require('../src/tried').read(bot, goal, 'survival_priority', tree());
  assert.equal(read.tree.obtain_food?.children?.return_for_food, undefined, 'it rests from here');
  assert.match(read.resting.join(' '), /obtain food\/return for food: Tried \d+ times from here in the last \d+ seconds?, and it came to nothing/);
});

test('mid-242-bb: at a question with nothing above and every way resting, the held answer is left out while one not held stays on offer; before, keep at it was asked again 91 times', async () => {
  const { decide } = require('../src/decisions');
  const tried = require('../src/tried');
  const bot = netherBot(-74.5, 46, 139.5);
  const goal = { kind: 'win', step: { action: 'find_fortress', legs: 33 }, gameProgress: { phase: 'obtain_blaze_rods' } };
  // The ledger at 14:46:00: work free and until rest ends each come to nothing twice from here, keep at it held by the repeat rule.
  for (const method of ['work_free', 'work_free', 'until_rest_ends', 'until_rest_ends']) tried.record(bot, goal, { q: 'rung_progress', method, outcome: 'blocked', why: 'fortress leg: every way it had from here rests' });
  tried.hold(bot, goal, 'rung_progress', ['keep_at_it'], 'the last 3 answers to this question in a row (keep at it 3 times, in the last 1 second) each came back within a second', { anyTarget: true });
  let said = null;
  const client = { systemOne: async ({ state, questions }) => { said = { state, keys: offeredIn(questions), questions }; return { answers: { branch_0: { choice: offeredIn(questions)[0], confidence: 0.6 } } }; } };
  const tree = { keep_at_it: { description: 'Keep at the obtain blaze rods as it is going.' }, work_free: { description: 'Work free of the terrain one move at a time.' }, until_rest_ends: { description: 'Other work for the 1 minute until the first of the fortress leg\'s ways comes off its rest here.' } };
  await decide('rung_progress', { client, bot, goal, tree, state: { stalled: { what: 'obtain blaze rods' } } });
  assert.deepEqual(said.keys.sort(), ['until_rest_ends', 'work_free'], 'keep at it is not offered again');
  assert.match(JSON.stringify(said.questions), /Work free.*It rests \d+ minutes? more from here/, 'the ways kept say their rests');
  assert.match(said.state.waysResting.join(' '), /^keep at it: Tried once from here .*It rests 5 minutes more from here\.$/);
  // Every way held: all stay on offer, each with its rest said (note 609), nothing left to ask otherwise.
  const allHeld = { kind: 'win', step: { action: 'find_fortress' }, gameProgress: { phase: 'obtain_blaze_rods' } };
  tried.hold(bot, allHeld, 'rung_progress', ['keep_at_it', 'work_free', 'until_rest_ends'], 'held', {});
  await decide('rung_progress', { client, bot, goal: allHeld, tree, state: { stalled: { what: 'obtain blaze rods' } } });
  assert.deepEqual(said.keys.sort(), ['keep_at_it', 'until_rest_ends', 'work_free']);
});

test('the replay of mid-243-af: a hold still in force stays in the ledger whatever comes after it; before, 160 answers after dropped it', () => {
  const tried = require('../src/tried');
  const bot = netherBot(-204.5, 61, -200.5);
  const goal = { kind: 'win', step: { action: 'find_fortress' } };
  tried.hold(bot, goal, 'fortress_leg', ['leg_north'], 'leg north was chosen 2 times in the last 1 second with these same facts');
  // The one way taken at every pass after it, each an entry: 160 in about eighty seconds on mid-243-af.
  for (let i = 0; i < 200; i++) tried.record(bot, goal, { q: 'survival_priority', method: 'continue_request', outcome: 'progressed' });
  const read = tried.read(bot, goal, 'fortress_leg', { leg_north: { description: 'A leg north.' }, leg_south: { description: 'A leg south.' } });
  assert.deepEqual(Object.keys(read.tree), ['leg_south']);
  assert.match(read.resting[0], /^leg north: Tried once from here/);
  assert.ok(goal.tried.entries.length <= 162, 'the rest is still pruned');
});

test('mid-242-bb: answers held whatever the facts are held whatever their target from here; before, each fortress place found anew was asked again at once', async () => {
  const { decide } = require('../src/decisions');
  const bot = netherBot(-70.5, 48, 141.5);
  const goal = { kind: 'win', step: { action: 'find_fortress', legs: 15 }, gameProgress: { phase: 'obtain_blaze_rods' } };
  const picks = ['tunnel', 'keep_searching', 'cross_level', 'tunnel', 'keep_searching', 'cross_level'];
  let asked = 0;
  const client = { systemOne: async ({ questions }) => { asked++; const k = offeredIn(questions); return { answers: { branch_0: { choice: k.includes(picks[0]) ? picks.shift() : k[0], confidence: 0.6 } } }; } };
  const tree = { tunnel: { description: 'A staircase dug toward it.' }, keep_searching: { description: 'Keep searching.' }, cross_level: { description: 'A span across the drop.' } };
  // The places found at 14:37:55 to 14:38:33, the bot within a block and a half of where it stood.
  const places = [[-67, 69, 143], [-106, 76, 153], [-121, 73, 143], [-100, 46, 105], [-140, 44, 153], [-169, 45, 141]];
  const outcomes = [];
  for (const [x, y, z] of places) {
    try { const d = await decide('fortress_approach', { client, bot, goal, tree, target: { x, y, z }, state: { fortress: `(${x}, ${y}, ${z})` } }); outcomes.push(d.only ? `one way ${d.path[0]}` : d.path[0]); }
    catch (err) { if (err.name !== 'Stalled') throw err; outcomes.push(`to ${err.stall.escalated?.to}`); delete bot._stalls.stall; }
    goal.lastFailure = { why: 'No path to the goal!', at: Date.now() };
  }
  assert.deepEqual(outcomes.slice(0, 4), ['tunnel', 'keep_searching', 'cross_level', 'to fortress_leg'], 'held at the fourth, the leg asked');
  // Not asked again: escalated, to the leg and, owed twice there unasked, past it (note 583).
  assert.ok(outcomes.slice(4).every(o => /^to (fortress_leg|rung_progress)$/.test(o)), `a place found anew is not a way not held: ${outcomes.join(', ')}`);
  assert.equal(asked, 3);
  // Seven blocks on, it is asked afresh.
  bot.entity.position = new Vec3(-77.5, 48, 141.5);
  picks.length = 0;
  const d = await decide('fortress_approach', { client, bot, goal, tree, target: { x: -169, y: 45, z: 141 }, state: { fortress: '(-169, 45, 141)' } });
  assert.equal(d.only, undefined);
  assert.equal(asked, 4);
});
