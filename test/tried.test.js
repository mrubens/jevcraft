'use strict';
// One ledger of what has been tried, escalation up the chain of questions,
// and the rung's own budget (src/tried.js, note 571).
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { Task } = require('../src/skills');
const registry = require('minecraft-data')('26.1');

// On 25592 (mid-242-ac-nether-2-fortress-1) the bot stood at (-167.5, 107, 60.1): the way to where blazes were
// seen was the one way, the walk found no route, the way there was asked (fortress_approach) and every way
// there came back at once. fortress_approach was answered 4,423 times.
const netherBot = () => ({ entity: { position: new Vec3(-167.5, 107, 60.1) }, game: { dimension: 'the_nether', gameMode: 'survival' }, inventory: { items: () => [] }, health: 8.4, food: 13 });
const SPOT = { x: -187, y: 74, z: 162 };

test('a way that fails at once is asked at most twice, then the question above is asked with the failure said, and the bot does something different', async () => {
  const { decide } = require('../src/decisions');
  const bot = netherBot();
  const goal = { kind: 'win', step: { action: 'find_fortress' }, gameProgress: { phase: 'obtain_blaze_rods' } };
  const asked = { fortress_leg: [], fortress_approach: [] };
  const client = { systemOne: async ({ state, questions }) => {
    const criteria = questions.branch_0.criteria;
    const q = criteria.leg_east ? 'fortress_leg' : 'fortress_approach';
    asked[q].push({ state, criteria });
    // Jev takes the way to the blazes while nothing is said against it, and the span on the way there.
    const choice = q === 'fortress_leg' ? (/Tried/.test(criteria.go_to_blazes || '') || !criteria.go_to_blazes ? 'leg_east' : 'go_to_blazes') : criteria.cross_level ? 'cross_level' : Object.keys(criteria)[0];
    return { answers: { branch_0: { choice, confidence: 0.6 } } };
  } };
  const search = { goTo: null, legs: [] };
  const legTree = () => ({
    go_to_blazes: { description: 'Go to where blazes were seen 109 blocks off and 33 down, 13 times, last 47 minutes ago.', target: SPOT },
    leg_east: { description: 'A leg east: 20 cells of netherrack, then open air.' },
  });
  const approachTree = () => ({ cross_level: { description: 'A span of blocks across the drop toward it, at this height.' }, tunnel: { description: 'A staircase dug down toward it.' } });
  const escalations = [];
  // The search's step, as findFortressStep and goToStep run it: the plan's question when no way is in hand,
  // else the way there, which fails at once and is asked again while the way is in hand.
  const pass = async () => {
    if (!search.goTo) {
      const d = await decide('fortress_leg', { client, bot, goal, tree: legTree(), state: { height: 107 } });
      if (d.path[0] === 'go_to_blazes') search.goTo = SPOT; else search.legs.push(d.path[0]);
      return;
    }
    await decide('fortress_approach', { client, bot, goal, tree: approachTree(), target: SPOT, state: { stretch: 'where blazes were seen, 109 blocks off; the walk there on foot failed: No path to the goal!' } });
    goal.lastFailure = { why: 'No path to the goal!', at: Date.now() };
  };
  for (let i = 0; i < 10; i++) {
    try { await pass(); }
    catch (err) {
      if (err.name !== 'Stalled') throw err;
      escalations.push(err.stall.escalated);
      // goToStep: a stall from inside the way ends it (note 570).
      search.goTo = null; delete bot._stalls.stall;
    }
    require('../src/tried').settle(bot, goal, { passEnd: true });
  }
  assert.equal(asked.fortress_approach.length, 2, 'the way that fails at once is asked twice, not again');
  assert.equal(escalations[0]?.to, 'fortress_leg', 'then the plan\'s question is asked');
  assert.match(escalations[0].says, /^fortress approach: every way it had from here rests: cross level: Tried 2 times toward the same place from about here .*No path to the goal/);
  // The plan's question, asked again, is told what failed below and says it on the way that led there.
  const again = asked.fortress_leg[1];
  assert(again, 'the plan\'s question is asked again');
  assert.match(again.state.whatFailedBelow[0], /^fortress approach: every way it had from here rests/);
  assert.match(again.criteria.go_to_blazes, /Tried once toward the same place from about here .*fortress approach: every way it had from here rests/);
  // And the bot does something different: a leg, not the way to the blazes again.
  assert.deepEqual(search.legs.slice(0, 1), ['leg_east']);
  // Nothing in this world ever moves, so the leg comes to nothing too, and the way to the blazes is offered
  // once more as the one way left; its way there escalates again at once, never asked.
  assert.equal(asked.fortress_approach.length, 2, 'never asked again in ten passes');
  assert(escalations.every(e => ['fortress_leg', 'rung_progress'].includes(e.to)), JSON.stringify(escalations.map(e => e.to)));
});

test('the same failing question asked ten times: at most two askings, then escalation, and the hold stays held (note 573\'s audit)', async () => {
  // 25592: 1,266 of 1,272 other_way answers came within two minutes of one of its 589 repeat holds; the
  // hold was forgotten as it fired and the next asking began afresh.
  const { decide } = require('../src/decisions');
  const bot = netherBot();
  const goal = { kind: 'win', step: { action: 'find_fortress' }, gameProgress: { phase: 'obtain_blaze_rods' } };
  let asks = 0;
  const client = { systemOne: async () => { asks++; return { answers: { branch_0: { choice: 'other_way', confidence: 0.6 } } }; } };
  const tree = () => ({ other_way: { description: 'Leave this way for now.' }, tunnel: { description: 'A staircase dug toward it.' } });
  const outcomes = [];
  for (let i = 0; i < 10; i++) {
    try { const d = await decide('fortress_approach', { client, bot, goal, tree: tree(), target: SPOT, state: { stretch: 'where blazes were seen' } }); outcomes.push(d.only ? `one way ${d.path[0]}` : d.path[0]); }
    catch (err) { assert.equal(err.name, 'Stalled'); outcomes.push(`escalated to ${err.stall.escalated?.to ?? 'the stall question'}`); delete bot._stalls.stall; }
    goal.lastFailure = { why: 'No path to the goal!', at: Date.now() };
  }
  assert(asks <= 2, `asked ${asks} times`);
  assert.deepEqual(outcomes.slice(0, 5), ['other_way', 'other_way', 'one way tunnel', 'one way tunnel', 'escalated to fortress_leg']);
  // Held: every asking after escalates (up the chain while the one above has not been asked), never asked again.
  assert(outcomes.slice(4).every(o => /^escalated/.test(o)), outcomes.join(', '));
  assert.equal(outcomes[5], 'escalated to rung_progress', 'the plan never asked in between: the rung\'s question');
  assert.equal(asks, 2);
});

test('a hold by the repeat rule rests the answer held: asked again, it is left out (note 573)', async () => {
  // The same answer to the same facts, each time toward a place six blocks on, so no place in the ledger
  // matches: the repeat rule holds it at the third asking, and the hold is kept in the ledger.
  const { decide } = require('../src/decisions');
  const bot = { entity: { position: new Vec3(0.5, 12, 0.5) }, game: { dimension: 'overworld' }, inventory: { items: () => [] } };
  const goal = { kind: 'obtain', item: 'iron_ingot', step: { action: 'night_mine' } };
  let asks = 0;
  const client = { systemOne: async () => { asks++; return { answers: { branch_0: { choice: 'ore_0', confidence: 0.9 } } }; } };
  const tree = n => ({ ore_0: { description: 'Iron ore in the wall.', target: { x: 6 * n, y: 12, z: 5 } }, branch: { description: 'A branch tunnel.' } });
  await decide('night_mine_target', { client, bot, goal, tree: tree(1), state: {} });
  await decide('night_mine_target', { client, bot, goal, tree: tree(2), state: {} });
  await assert.rejects(decide('night_mine_target', { client, bot, goal, tree: tree(3), state: {} }), err => err.name === 'Stalled' && err.stall.escalated?.to === 'survival_priority');
  delete bot._stalls.stall;
  const next = await decide('night_mine_target', { client, bot, goal, tree: tree(3), state: {} });
  assert.deepEqual(next.path, ['branch'], 'the held answer rests; the one way left is taken');
  assert.equal(asks, 2);
});

test('a rung with no new best for ten working minutes raises the rung\'s question, with what was tried; busy going nowhere does not reset it', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-09-28T02:40:00Z') });
  const { runGoal } = require('../src/work');
  const items = [];
  const bot = { registry, inventory: { items: () => items, slots: [] }, game: { dimension: 'overworld', gameMode: 'survival', difficulty: 'normal' },
    entity: { id: 1, position: new Vec3(0.5, 64, 0.5) }, health: 20, food: 20, entities: {}, time: { timeOfDay: 3000 },
    pathfinder: { movements: { blocksCantBreak: new Set() }, setGoal() {} }, clearControlStates() {}, findBlocks: () => [],
    blockAt: () => ({ name: 'air' }), chat() {}, emit() {} };
  const goal = { kind: 'obtain', item: 'diamond', count: 1, request: 'get a diamond', from: 'Player', survival: {} };
  const asked = [];
  const decisionClient = { model: 'jev', systemOne: async ({ state, questions }) => {
    const answers = {};
    for (const [id, q] of Object.entries(questions)) { const keys = Object.keys(q.criteria || {}); asked.push({ state, keys }); answers[id] = { choice: keys.includes('keep_at_it') ? 'keep_at_it' : keys[0], confidence: 0.9 }; }
    return { answers };
  } };
  // Busy the whole time: the survival layer acts every pass, back and forth by eight blocks, and nothing comes
  // nearer the diamond. Each pass is thirty seconds.
  let passes = 0;
  const survival = { state: goal.survival, step: async () => {
    passes++; t.mock.timers.tick(30000);
    bot.entity.position = new Vec3(passes % 2 ? 8.5 : 0.5, 64, 0.5);
    goal.struggles = 3;
    return true;
  } };
  let rung = null;
  const store = { save() {} };
  const task = new Task('rung', 'get a diamond');
  const stop = setInterval(() => { rung = asked.find(a => a.keys.includes('keep_at_it')); if (rung) task.cancel?.(); }, 5);
  try { await runGoal(bot, task, goal, store, { survival, decisionClient, maxSteps: 30 }); }
  catch (err) { if (err.name !== 'Cancelled') throw err; }
  finally { clearInterval(stop); }
  rung = asked.find(a => a.keys.includes('keep_at_it'));
  assert(rung, 'the rung\'s question is asked');
  assert(passes >= 20 && passes <= 22, `after ten working minutes (${passes} passes of thirty seconds)`);
  assert.match(rung.state.stalled.rung, /^10 minutes on the diamond request without a new best: 0 diamond carried, none more/);
  assert(rung.keys.includes('keep_at_it'));
  assert.equal(goal.struggles, 3, 'walking back and forth is not progress against the goal: the struggle is not reset');
});

test('persist does not put a failed step back in hand: the answer it carried out is asked again with the failure said; "again" alone restores it', async () => {
  const { decide } = require('../src/decisions');
  const { persist } = require('../src/work');
  const bot = Object.assign(netherBot(), { chat() {}, pathfinder: { setGoal() {} }, clearControlStates() {} });
  const goal = { kind: 'win', gameProgress: { phase: 'obtain_blaze_rods' }, step: { action: 'find_fortress' } };
  const client = { systemOne: async () => ({ answers: { branch_0: { choice: 'tunnel', confidence: 0.7 } } }) };
  await decide('fortress_approach', { client, bot, goal, tree: { tunnel: { description: 'A staircase dug toward it.' }, cross_level: { description: 'A span.' } }, target: SPOT, state: {} });
  const failed = { action: 'find_fortress', phase: 'tunnel', target: SPOT };
  goal.step = failed;
  await persist(bot, new Task('persist'), goal, () => {}, new Error('No path to the goal!'), () => {}, {});
  assert.equal(goal.step, undefined, 'not put back in hand');
  const entry = goal.tried.entries.find(e => e.q === 'fortress_approach');
  assert.equal(entry.outcome, 'blocked');
  assert.match(entry.why, /^the find fortress step failed: No path to the goal!/);
  let said = null;
  await decide('fortress_approach', { client: { systemOne: async ({ state, questions }) => { said = { state, questions }; return { answers: { branch_0: { choice: 'cross_level', confidence: 0.7 } } }; } },
    bot, goal, tree: { tunnel: { description: 'A staircase dug toward it.' }, cross_level: { description: 'A span.' } }, target: SPOT, state: {} });
  assert.match(said.state.whatFailedBelow[0], /^step: the find fortress step failed: No path to the goal!/);
  assert.match(said.questions.branch_0.criteria.tunnel, /Tried once toward the same place from about here .*No path to the goal/);
});

test('with no answer to go back to, persist asks the stall\'s question with the failure; only "again" puts the step back, and not once it rests from here', async () => {
  const { persist } = require('../src/work');
  const makeBot = () => ({ registry, inventory: { items: () => [], slots: [] }, game: { dimension: 'overworld', gameMode: 'survival', difficulty: 'normal' },
    entity: { id: 1, position: new Vec3(0.5, 64, 0.5) }, health: 20, food: 20, entities: {}, time: { timeOfDay: 3000 },
    pathfinder: { movements: { blocksCantBreak: new Set() }, setGoal() {} }, clearControlStates() {}, findBlocks: () => [],
    blockAt: () => ({ name: 'air' }), chat() {}, emit() {} });
  const bot = makeBot();
  const goal = { kind: 'obtain', item: 'iron_ingot', request: 'get iron', survival: {} };
  const offered = [];
  const client = pick => ({ model: 'jev', systemOne: async ({ questions }) => {
    const answers = {};
    for (const [id, q] of Object.entries(questions)) { const keys = Object.keys(q.criteria || {}); offered.push(q.criteria); answers[id] = { choice: keys.includes(pick) ? pick : keys[0], confidence: 0.9 }; }
    return { answers };
  } });
  const step = { action: 'mine', block: 'iron_ore', target: { x: 9, y: 60, z: 4 } };
  goal.step = step;
  await persist(bot, new Task('persist'), goal, () => {}, new Error('No route to the ore'), () => {}, { client: client('again') });
  assert.equal(goal.step, step, 'Jev chose to try it again: back in hand');
  assert.match(offered.at(-1).again, /^Try the mine step again as it was \(iron ore\), from here\. Tried once toward the same place from about here .*No route to the ore/);
  // Failed again from here: it rests, is not offered, and the step is not put back whatever is chosen.
  await persist(bot, new Task('persist'), goal, () => {}, new Error('No route to the ore'), () => {}, { client: client('again') });
  assert.equal(offered.at(-1).again, undefined, 'resting from here: not offered');
  assert.equal(goal.step, undefined, 'not put back in hand');
});

test('every question about playing the game names the question next up, and each one named is a question', () => {
  const { all, question } = require('../src/decisions');
  const gameplay = all().filter(q => q.tree && Object.hasOwn(q, 'parent'));
  assert(gameplay.length >= 40, `${gameplay.length} declare a parent`);
  for (const q of gameplay) if (q.parent) assert.doesNotThrow(() => question(q.parent), `${q.id}'s parent ${q.parent}`);
  assert.equal(question('fortress_approach').parent, 'fortress_leg');
  assert.equal(question('fortress_leg').parent, 'rung_progress');
  assert.equal(question('portal_way').parent, 'rung_progress');
  assert.equal(question('stillness_detour').parent, 'rung_progress');
  assert.equal(question('rung_progress').parent, null);
});
