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
  // The plan never asked in between (nothing here asks it): it is owed the failure twice, and only then passed
  // over to the rung's question, said (note 583: a parent with ways left is asked, not passed).
  assert.equal(outcomes[5], 'escalated to fortress_leg', 'owed once: the plan is still the one to ask');
  assert.equal(outcomes[6], 'escalated to rung_progress', 'owed twice and never asked: passed over to the rung');
  assert.equal(asks, 2);
});

test('the same answer to the same facts, having changed nothing, is held and then asked with that said, not rested unasked (notes 573, 724)', async () => {
  // The same answer to the same facts, each time toward a place six blocks on, so no place in the ledger
  // matches. The repeat rule used to hold it at the third asking and rest it, the one way left taken unasked
  // (note 573); an answer that changed nothing is now held until something changes or its wait passes, and
  // asked with it said (unchanged.js, note 724).
  const { decide } = require('../src/decisions');
  const bot = { entity: { position: new Vec3(0.5, 12, 0.5) }, game: { dimension: 'overworld' }, inventory: { items: () => [] } };
  const goal = { kind: 'obtain', item: 'iron_ingot', step: { action: 'night_mine' } };
  const seen = [];
  const client = { systemOne: async ({ state, questions }) => { seen.push({ state, options: questions.branch_0 }); return { answers: { branch_0: { choice: 'ore_0', confidence: 0.9 } } }; } };
  const tree = n => ({ ore_0: { description: 'Iron ore in the wall.', target: { x: 6 * n, y: 12, z: 5 } }, branch: { description: 'A branch tunnel.' } });
  await decide('night_mine_target', { client, bot, goal, tree: tree(1), state: {} });
  await decide('night_mine_target', { client, bot, goal, tree: tree(2), state: {} });
  assert.match(seen[1].state.answerChangedNothing, /^ore 0 was chosen \d+ seconds? ago and changed nothing .*; this question was held/);
  const third = await decide('night_mine_target', { client, bot, goal, tree: tree(3), state: {} });
  assert.deepEqual(third.path, ['ore_0'], 'Jev\'s answer, told it changed nothing');
  assert.match(seen[2].state.answerChangedNothing, /the last 2 answers to this question in a row changed nothing/);
  // Said on the option once: by the ledger's words where it has them, else the rule's.
  assert.match(JSON.stringify(seen[2].options), /Iron ore in the wall\. .*(came to nothing|Chosen \d+ seconds? ago, and it changed nothing)/);
  assert.equal(bot._stalls?.stall, undefined);
  assert.equal(seen.length, 3);
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

// mid-242-ae-nether-2-fortress-1 (25583), begun 04:47:12 from a fortress stage's save: in thirty seconds fortress_leg
// was answered back_to_fortress (04:47:29, back within a second), leg_east (ended at once, out of blocks) and
// back_to_fortress again (04:47:33); the walk of the fortress's floors that followed went to a floor two blocks up with
// no way to it, thirty passes in three seconds, "No measurable progress" (04:47:36, 04:47:41, 04:47:44). The second
// failure escalated to fortress_leg; the step walked the same floor again without asking it, and the third went past
// it to the rung's question, "Every way the find fortress had from here has been tried", and the rods were set aside.
const AE_FAILED = 'No measurable progress on {"action":"find_fortress","found":{"x":-106,"y":53,"z":106},"exploring":{"x":-106,"y":55,"z":106},"steps":2,"walked":2,"seen":3,"legs":16}';
const aeLegs = (east = true) => ({
  ...(east ? { leg_east: { description: 'Go east 96 blocks at y 55: of the 96 cells ahead, 66 of open air.' } } : {}),
  seek_fortress_height: { description: 'Dig a staircase up toward y 64 heading south, 10 blocks of height.' },
  back_to_fortress: { description: 'Go back into the fortress in view: 4096 of its bricks, the nearest 1 blocks off.' },
  restock_blocks: { description: 'Dig 6 blocks to lay spans with here, from the 6 that can be dug from ground walked to from here (6 netherrack).' },
  return_for_blocks: { description: 'Go back through the portal to the Overworld, the nearest known 157 blocks off, for stone to lay spans with.' },
});
const aeBot = () => ({ registry, inventory: { items: () => [], slots: [] }, game: { dimension: 'the_nether', gameMode: 'survival', difficulty: 'normal' },
  entity: { id: 1, position: new Vec3(-105.5, 54, 106.5) }, health: 20, food: 16, entities: {}, time: { timeOfDay: 6000 },
  pathfinder: { movements: { blocksCantBreak: new Set() }, setGoal() {} }, clearControlStates() {}, findBlocks: () => [],
  blockAt: () => ({ name: 'nether_bricks', boundingBox: 'block' }), chat() {}, emit() {} });
// The recorded thirty seconds, to the third failure; `asksWhenOwed` is the step asking the leg's question when an
// escalation is owed to it (mob-hunt.js findFortressStep), or walking the same floor again as it did live.
async function aeTrial(t, { asksWhenOwed, answer = () => null, landmarks = [] }) {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-09-28T04:47:12.700Z') });
  const { decide } = require('../src/decisions');
  const { persist } = require('../src/work');
  const tried = require('../src/tried');
  const bot = aeBot();
  const goal = { kind: 'win', request: 'beat the game', from: 'TestPlayer', rungTime: { phase: 'obtain_blaze_rods' }, gameProgress: { phase: 'obtain_blaze_rods', milestones: {} },
    step: { action: 'find_fortress', legs: 15 }, survival: {}, landmarks };
  tried.watchRung(bot, goal);
  const asked = [];
  const recorded = ['back_to_fortress', 'leg_east', 'back_to_fortress'];
  const client = { model: 'jev', systemOne: async ({ state, questions }) => {
    const answers = {};
    for (const [b, q] of Object.entries(questions)) {
      const keys = Object.keys(q.criteria || {});
      const id = keys.includes('seek_fortress_height') ? 'fortress_leg' : keys.includes('keep_at_it') ? 'rung_progress' : 'stillness_detour';
      asked.push({ id, state, options: q.criteria, at: Date.now() });
      const pick = answer(id, keys, asked) || (id === 'fortress_leg' ? recorded.shift() : keys[0]);
      answers[b] = { choice: keys.includes(pick) ? pick : keys[0], confidence: 0.6 };
    }
    return { answers };
  } };
  const at = iso => t.mock.timers.setTime(Date.parse(`2026-09-28T${iso}Z`));
  const leg = async () => decide('fortress_leg', { client, bot, goal, tree: aeLegs(!goal.tried?.entries?.some(e => e.method === 'leg_east')), state: { legsSoFar: 15 } });
  const passEnd = error => tried.settle(bot, goal, { passEnd: true, error });
  at('04:47:29.321'); await leg(); passEnd(null);
  at('04:47:29.600'); await leg(); passEnd('no way on (out of blocks (0 carried))');
  at('04:47:33.435'); await leg(); passEnd(null);
  const fail = async iso => {
    at(iso);
    // The pass that ends the walk of the floors: the step asks the leg's question when one is owed, else walks.
    if (asksWhenOwed && tried.owed(goal, 'fortress_leg')) { await leg(); passEnd(null); return 'asked'; }
    goal.step = { action: 'find_fortress', found: { x: -106, y: 53, z: 106 }, exploring: { x: -106, y: 55, z: 106 }, steps: 2, walked: 2, seen: 3, legs: 16 };
    goal.lastStruggleStep = goal.step;
    const lines = [];
    const log = t.mock.method(console, 'log', (...a) => lines.push(a.join(' ')));
    try { await persist(bot, new Task('persist'), goal, () => {}, Object.assign(new Error(AE_FAILED), { name: 'Blocked' }), () => {}, { client }); }
    finally { log.mock.restore(); }
    passEnd(AE_FAILED);
    goal.step = { action: 'find_fortress', legs: 16 };
    return lines.find(l => l.startsWith('[escalate]')) || 'no escalation';
  };
  return { asked, goal, fail, tried };
}

test('the recorded thirty seconds of mid-242-ae-nether-2-fortress-1: a failed walk escalates to fortress_leg, which is asked with its other ways, not passed over to the rung (note 583)', async t => {
  const { asked, goal, fail } = await aeTrial(t, { asksWhenOwed: true, answer: (id, keys, list) => id === 'fortress_leg' && list.filter(a => a.id === 'fortress_leg').length > 3 ? 'seek_fortress_height' : null });
  const first = await fail('04:47:36.169');
  assert.match(first, /^\[escalate\] step -> fortress leg: step: the find fortress step failed: No measurable progress/, 'the walk that failed goes to the question whose answer it was');
  // The next pass: the leg's question, told what failed, with its ways not yet tried.
  assert.equal(await fail('04:47:37.041'), 'asked');
  const ask = asked.at(-1);
  assert.equal(ask.id, 'fortress_leg');
  assert.match(ask.state.whatFailedBelow[0], /^step: the find fortress step failed: No measurable progress/);
  // Its last three answers came back at once (the repeat rule): they rest, said, and the question is asked with
  // the ways left rather than passed to the rung.
  assert.match(ask.state.lastAnswersCameToNothing, /^the last 3 answers to this question in a row \(back to fortress 2 times, leg east 1 time/);
  assert.equal(ask.options.back_to_fortress, undefined);
  assert.match(ask.state.waysResting[0], /^back to fortress: Tried 3 times from here in the last 8 seconds, and it came to nothing/);
  for (const k of ['seek_fortress_height', 'restock_blocks', 'return_for_blocks']) assert(ask.options[k] && !/Tried/.test(ask.options[k]), `${k} offered, untried`);
  assert(!asked.some(a => a.id === 'rung_progress'), 'the rung is not asked while the leg has ways left');
  assert.deepEqual(goal.decisions.at(-1).path, ['seek_fortress_height']);
});

test('a step that never asks its plan passes the plan over only after two failures sent to it, and the rung\'s question says how little was tried and for how long, and what setting it aside goes on with (note 583)', async t => {
  // The warped forest the pearls went to on 25583 and 25587: seen across the lava sea, its walk failed at once.
  const forest = { kind: 'warped_forest', x: -77, y: 58, z: -4, dimension: 'nether',
    lastWalk: { at: Date.parse('2026-09-28T04:40:00Z'), from: { x: -106, y: 54, z: 106 }, began: 114, ended: 114, why: 'No path to the goal!' } };
  const { asked, fail, goal } = await aeTrial(t, { asksWhenOwed: false, answer: id => id === 'rung_progress' ? 'keep_at_it' : null, landmarks: [forest] });
  require('../src/progress').setAside(goal, 'landmark_trip', 'warped_forest:-77,-4', 'the walk there came no nearer than before (114 blocks off to 114): No path to the goal!', 1800000);
  assert.match(await fail('04:47:36.169'), /^\[escalate\] step -> fortress leg/);
  // Owed once, and fortress_leg has ways left: the failure is sent to it again, not past it.
  assert.match(await fail('04:47:41.021'), /^\[escalate\] step -> fortress leg/);
  assert(!asked.some(a => a.id === 'rung_progress'), 'not the rung after two failures of one walk');
  // Owed twice and never asked: passed over, said.
  assert.equal(await fail('04:47:44.196'), 'no escalation');
  const rung = asked.find(a => a.id === 'rung_progress');
  assert(rung, 'then the rung\'s question');
  const s = rung.state.stalled;
  assert.match(s.whatFailedBelow, /passed over fortress leg: not asked since 2 failures below were sent to it; the work carried on without asking it/);
  assert.doesNotMatch(rung.state.situation, /Every way/);
  // No pickaxe carried and a leg out of blocks for want of one: the rung's
  // question leads with getting one (note 687), then says what failed below.
  assert.match(rung.state.situation, /^No pickaxe is carried: .*tried lately and came to nothing for want of one: leg east: no way on \(out of blocks \(0 carried\)\)\. fetch_stems gets one first\. The find fortress could not go on below this question: step: the find fortress step failed 3 times running/);
  assert.match(s.workedOnRung, /^in 0\.5 minutes on it: 3 answers given to 2 different ways of the 5 its questions offered, 3 coming to nothing, 0 getting somewhere; the step failed 3 times; not yet tried from here: fortress leg \(asked \d+ seconds ago\): seek fortress height, restock blocks, return for blocks; brought to this question by a failure below 0\.5 minutes into the rung's ten, not by its ten minutes running out$/);
  // Brought here by a failure below with the leg's ways untried, the rung is not set aside (note 605): said, and
  // keeping at it sends the work back to the leg's question with them.
  assert.equal(rung.options.set_aside_rung, undefined);
  assert.match(s.setAsideNotOffered, /^setting the obtain blaze rods aside is not offered: it was brought here by a failure below, and ways below it have not been tried from here: fortress leg \(seek fortress height, restock blocks, return for blocks\)$/);
  assert.match(rung.options.keep_at_it, /The fortress leg question is asked next, with the ways not yet tried from here: fortress leg \(seek fortress height, restock blocks, return for blocks\)\./);
  assert.match(rung.options.keep_at_it, /Tried lately: /, 'what was tried is read from the rung\'s own work, not the step\'s');
  // What setting it aside would go on with is still said, for the question once the ways below are spent.
  assert.match(s.setAsideGoesOnWith, /^Set aside, the ladder goes on with obtain ender pearls \(warped pearls, 13 ender pearl\); the nearest warped forest known is 114 blocks off and 4 up at \(-77, -4\), and the walk there is set aside: the walk there came no nearer than before \(114 blocks off to 114\): No path to the goal!; with the walk to it set aside, its work begins with a search for another\./);
  assert.match(require('../src/tried').owed(goal, 'fortress_leg')?.at(-1) || '', /^the rung's question sent the work back here/);
});

test('a saved ledger is judged by its own times: a trial begun from a stage\'s save twenty minutes old sees what was tried a minute before the save as a minute old (note 583)', () => {
  const tried = require('../src/tried');
  const saved = Date.parse('2026-09-28T04:26:00Z'), now = Date.parse('2026-09-28T04:47:12Z');
  const bot = netherBot();
  const goal = { kind: 'win', gameProgress: { phase: 'obtain_blaze_rods' }, step: { action: 'find_fortress' } };
  for (const at of [saved - 60000, saved - 30000]) tried.record(bot, goal, { q: 'fortress_approach', method: 'tunnel', target: SPOT, outcome: 'blocked', why: 'came no nearer', now: at });
  tried.escalate(goal, { from: 'fortress_approach', to: 'fortress_leg', why: 'every way rests', now: saved - 20000 });
  goal.tried.rung = { rung: 'obtain_blaze_rods', since: saved - 17 * 60000, lastAt: saved, bestAt: saved - 5 * 60000, idleMs: 0, best: { items: 0, milestones: 0, far: 0, target: {} }, asked: 0 };
  // Read by the wall clock, the tries and the escalation had lapsed while the save lay unplayed.
  const here = bot.entity.position;
  assert.equal(tried.restsUntil(tried.about(goal, { q: 'fortress_approach', method: 'tunnel', target: SPOT, here, now }), now), 0);
  assert.equal(tried.owed(goal, 'fortress_leg', now), null);
  const gap = tried.resumed(goal, { savedAt: saved, now });
  assert.equal(gap, now - saved);
  const until = tried.restsUntil(tried.about(goal, { q: 'fortress_approach', method: 'tunnel', target: SPOT, here, now }), now);
  assert.equal(until, now + 4.5 * 60000, 'resting four and a half more minutes, as it was at the save');
  assert(tried.owed(goal, 'fortress_leg', now), 'the escalation is still owed');
  // A save that lay unplayed longer than the rung's budget is a new session
  // on the rung: its budget and its count start at the resume, and the
  // minutes before the save are said beside them (note 600).
  assert.match(tried.workedOn(goal, { now }).says, /^in 0\.0 minutes on it in this session \(and 17 minutes before the save it was taken up from\): 0 answers given/);
  assert.equal(goal.tried.rung.idleMs, 0); assert.equal(goal.tried.rung.bestAt, now);
});

test('an answer cut short by the survival layer is not a try that came to nothing (note 583)', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-09-28T04:47:12Z') });
  const { decide } = require('../src/decisions');
  const tried = require('../src/tried');
  const bot = netherBot();
  const goal = { kind: 'win', step: { action: 'find_fortress' }, gameProgress: { phase: 'obtain_blaze_rods' } };
  const client = { systemOne: async () => ({ answers: { branch_0: { choice: 'tunnel', confidence: 0.6 } } }) };
  const tree = () => ({ tunnel: { description: 'A staircase dug toward it.' }, cross_level: { description: 'A span.' } });
  for (let i = 0; i < 3; i++) {
    await decide('fortress_approach', { client, bot, goal, tree: tree(), target: SPOT, state: { i } });
    tried.cut(goal, 'cut short: a blaze in view');
    t.mock.timers.tick(20000);
  }
  const d = await decide('fortress_approach', { client, bot, goal, tree: tree(), target: SPOT, state: { i: 4 } });
  assert.deepEqual(d.path, ['tunnel'], 'not resting: none of the three came to nothing');
  assert.deepEqual(goal.tried.entries.filter(e => e.q === 'fortress_approach').map(e => e.outcome), ['cut', 'cut', 'cut', 'pending']);
});

test('mid-244-ad-nether-3: the pearl step failing every two seconds with nothing above it, the stall\'s answers come to nothing and rest, and the rung\'s question follows instead of the stall\'s question for ever (note 583)', async t => {
  // 04:55:51 the rods were set aside; the walk to the warped forest 127 blocks off failed once, and warped_pearls then
  // came back at once twenty times a second: "No measurable progress" every two seconds, persist asking the stall's
  // question, answered differently, recover_5, recover_4, recover_6, ... 24 times in eight minutes, each answer
  // recorded as a wait, so none came to nothing, none rested, and nothing above was ever asked.
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-09-28T04:55:53.000Z') });
  const { decide } = require('../src/decisions');
  const tried = require('../src/tried');
  const bot = netherBot();
  const goal = { kind: 'win', rungTime: { phase: 'obtain_ender_pearls' }, gameProgress: { phase: 'obtain_ender_pearls' },
    step: { action: 'persist', attempt: 1, retrying: 'warped_pearls' }, lastStruggleStep: { action: 'warped_pearls', phase: 'obtain_ender_pearls', item: 'ender_pearl', count: 16 } };
  const recorded = ['differently', 'recover_relocate_5', 'recover_relocate_4', 'recover_relocate_6', 'recover_relocate_3', 'differently', 'recover_relocate_1', 'recover_relocate_2'];
  let asks = 0;
  const client = { systemOne: async ({ questions }) => {
    asks++;
    const keys = Object.keys(questions.branch_0.criteria);
    return { answers: { branch_0: { choice: recorded.find(k => keys.includes(k)) || keys[0], confidence: 0.6 } } };
  } };
  const tree = () => Object.fromEntries(['differently', 'recover_relocate_1', 'recover_relocate_2', 'recover_relocate_3', 'recover_relocate_4', 'recover_relocate_5', 'recover_relocate_6'].map(k => [k, { description: `${k}: a way on from the stall.` }]));
  let escalated = null, n = 0;
  for (; n < 30 && !escalated; n++) {
    try {
      const d = await decide('stillness_detour', { client, bot, goal, tree: tree(), state: { situation: 'ender pearl keeps failing' } });
      recorded.splice(recorded.indexOf(d.path[0]), 1);
    } catch (err) {
      if (err.name !== 'Stalled') throw err;
      escalated = err.stall.escalated; delete bot._stalls.stall;
    }
    // The pass fails: the pearl step again, no measurable progress, two seconds on.
    t.mock.timers.tick(2000);
    goal.lastFailure = { why: 'No measurable progress on {"action":"warped_pearls","phase":"obtain_ender_pearls","item":"ender_pearl","count":16}', at: Date.now() };
    tried.settle(bot, goal, { passEnd: true, error: goal.lastFailure.why });
  }
  const outcomes = goal.tried.entries.filter(e => e.q === 'stillness_detour').map(e => e.outcome);
  assert(outcomes.length > 0 && outcomes.every(o => o === 'blocked'), `the stall's answers came to nothing, not waits: ${outcomes}`);
  assert(escalated, `the rung's question is asked (after ${n} failures, ${asks} askings)`);
  assert.equal(escalated.to, 'rung_progress');
  assert.match(escalated.says, /^stillness detour: /);
  assert(n <= 16, `within sixteen failures of the step, not twenty-four and on: ${n}`);
});
