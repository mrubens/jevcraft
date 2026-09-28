'use strict';
// Busy but not progressing, in the layer the ledger had left out (note 599):
// a wait is a ledger entry with an outcome, the rung's budget runs on the
// wall clock whoever holds the turn, none good said sure twice is the
// question spent there, a hold ends on divergence and not on the clock, and
// a mob that has held off is priced at what it has done on every option.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { Task } = require('../src/skills');
const registry = require('minecraft-data')('26.1');

// mid-242-ab-nether-3-fortress-1 (25592, note 597): sealed at (-275, 56, -174),
// 12.8 health, hunger 11, nothing to eat; nothing it could see changed.
const pocketBot = () => ({ entity: { position: new Vec3(-275.5, 56, -173.5) }, game: { dimension: 'the_nether', gameMode: 'survival' }, inventory: { items: () => [] }, health: 12.8, food: 11, entities: {} });
const answering = (asked, pick) => ({ systemOne: async ({ state, questions }) => {
  const criteria = questions.branch_0.criteria;
  asked.push({ state, keys: Object.keys(criteria), criteria });
  const choice = pick(criteria);
  return { answers: { branch_0: { choice, confidence: 0.6, probabilities: { [choice]: 0.6 } } } };
} });

test('a wait whose world did not change came to nothing: two pocket stays rest the stay, left out while two other ways are on offer, kept and said with fewer (note 599)', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-09-28T06:28:26Z') });
  const { decide } = require('../src/decisions');
  const bot = pocketBot();
  const goal = { kind: 'win', gameProgress: { phase: 'obtain_blaze_rods' }, step: { action: 'find_fortress' } };
  const asked = [];
  const client = answering(asked, c => c.stay ? 'stay' : Object.keys(c)[0]);
  const tree = (more = true) => ({ stay: { description: 'Stay in the pocket.' }, leave: { description: 'Open the pocket and go back to work.' },
    ...(more ? { tunnel_out: { description: 'Dig a passage out through the north wall.' }, go_for_food: { description: 'Open the pocket and go for food.' } } : {}) });
  for (let i = 0; i < 3; i++) {
    goal.survivalAction = { action: 'wait_in_shelter', at: new Date().toISOString() };
    await decide('pocket_next', { client, bot, goal, tree: tree(), state: { health: 12.8 } });
    t.mock.timers.tick(90000);
  }
  assert.deepEqual(asked[0].keys.sort(), ['go_for_food', 'leave', 'stay', 'tunnel_out']);
  assert.deepEqual(asked[2].keys.sort(), ['go_for_food', 'leave', 'tunnel_out'], 'the stay rests after two that came to nothing');
  assert.match(asked[2].state.waysResting[0], /^stay: Held from about here 2 times in the last 3 minutes, 3 minutes in all, and nothing changed in any of them: health 12\.8, nothing within 16 blocks, no swing throughout\. It rests 5 minutes more from here\.$/);
  const entries = goal.tried.entries.filter(e => e.q === 'pocket_next' && e.method === 'stay');
  assert.equal(entries[0].outcome, 'blocked');
  assert.equal(entries[0].wait, true);
  // With only the leave beside it, leaving the stay out would be the code's
  // choice: it stays on offer, its rest said on it.
  await decide('pocket_next', { client, bot, goal, tree: tree(false), state: { health: 12.8 } });
  assert.deepEqual(asked[3].keys.sort(), ['leave', 'stay']);
  assert.match(asked[3].criteria.stay, /Held from about here 2 times .* It rests \d minutes more from here, kept on offer: fewer than two other ways are open\./);
});

test('a wait whose world changed did not come to nothing: health coming back, a mob come or gone, a swing', () => {
  const tried = require('../src/tried');
  const now = Date.parse('2026-09-28T06:30:00Z');
  const a = { at: now, health: 12, food: 18, pos: { x: 0, y: 64, z: 0 }, nearest: { id: 1, name: 'blaze', distance: 10, visible: false }, inSight: 0, swingAt: 0 };
  assert.deepEqual(tried.sceneChanges(a, { ...a, at: now + 90000 }), []);
  assert.deepEqual(tried.sceneChanges(a, { ...a, health: 14 }), ['health 12 to 14']);
  assert.deepEqual(tried.sceneChanges(a, { ...a, nearest: null }), ['nothing within 16 blocks now (the blaze was 10 off)']);
  assert.deepEqual(tried.sceneChanges(a, { ...a, nearest: { ...a.nearest, distance: 5 } }), ['the nearest mob nearer, 10 to 5 blocks off']);
  assert.deepEqual(tried.sceneChanges(a, { ...a, nearest: { ...a.nearest, distance: 8 } }), [], 'two blocks of drift is not a change');
  assert.deepEqual(tried.sceneChanges(a, { ...a, swingAt: now + 1000 }), ['a swing made']);
});

test('a stance held to nothing twice rests like a way: the pillar left out while two others are on offer, the stance never escalated for it (note 599)', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-09-28T05:24:02Z') });
  const { decide } = require('../src/decisions');
  const bot = { entity: { position: new Vec3(-38.5, 46, 60.5) }, game: { dimension: 'the_nether', gameMode: 'survival' }, inventory: { items: () => [] }, health: 7.9, food: 17, entities: {} };
  const goal = { kind: 'win', gameProgress: { phase: 'obtain_blaze_rods' }, step: { action: 'find_fortress' } };
  const asked = [];
  const client = answering(asked, c => c.pillar ? 'pillar' : 'come_down');
  const tree = () => ({ pillar: { description: 'Hold on the pillar\'s top.' }, fight: { description: 'Fight here.' }, come_down: { description: 'Come down the pillar.' }, retreat: { description: 'Run for footing.' } });
  for (let i = 0; i < 3; i++) { await decide('encounter_stance', { client, bot, goal, tree: tree(), state: { health: 7.9 } }); t.mock.timers.tick(4 * 60000); }
  assert.deepEqual(asked[2].keys.sort(), ['come_down', 'fight', 'retreat']);
  assert.match(asked[2].state.waysResting[0], /^pillar: Held from about here 2 times in the last 8 minutes, 8 minutes in all, and nothing changed in any of them: health 7\.9, nothing within 16 blocks, no swing throughout\./);
});

// The rung test of note 571, with the survival layer holding the turn the
// whole time, sealed in and still: the waits had not counted.
test('the rung\'s budget runs on the wall clock whoever holds the turn: ten minutes sealed in a pocket without a new best asks the rung\'s question (note 599)', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-09-28T06:28:26Z') });
  const { runGoal } = require('../src/work');
  const bot = { registry, inventory: { items: () => [], slots: [] }, game: { dimension: 'the_nether', gameMode: 'survival', difficulty: 'normal' },
    entity: { id: 1, position: new Vec3(-275.5, 56, -173.5) }, health: 12.8, food: 11, entities: {}, time: { timeOfDay: 3000 },
    pathfinder: { movements: { blocksCantBreak: new Set() }, setGoal() {} }, clearControlStates() {}, findBlocks: () => [],
    blockAt: () => ({ name: 'netherrack' }), chat() {}, emit() {} };
  const goal = { kind: 'obtain', item: 'blaze_rod', count: 1, request: 'get a blaze rod', from: 'Player', survival: {} };
  const asked = [];
  const decisionClient = { model: 'jev', systemOne: async ({ state, questions }) => {
    const answers = {};
    for (const [id, q] of Object.entries(questions)) { const keys = Object.keys(q.criteria || {}); asked.push({ state, keys }); answers[id] = { choice: keys.includes('keep_at_it') ? 'keep_at_it' : keys[0], confidence: 0.9 }; }
    return { answers };
  } };
  // The survival layer holds the turn every pass, sealed in: a wait in the
  // shelter, the bot not moving. Each pass is thirty seconds.
  let passes = 0;
  const survival = { state: goal.survival, step: async () => {
    passes++; t.mock.timers.tick(30000);
    goal.survivalAction = { action: 'wait_in_shelter', at: new Date().toISOString() };
    return true;
  } };
  const store = { save() {} };
  const task = new Task('rung', 'get a blaze rod');
  let rung = null;
  const stop = setInterval(() => { rung = asked.find(a => a.keys.includes('keep_at_it')); if (rung) task.cancel?.(); }, 5);
  try { await runGoal(bot, task, goal, store, { survival, decisionClient, maxSteps: 30 }); }
  catch (err) { if (err.name !== 'Cancelled') throw err; }
  finally { clearInterval(stop); }
  rung = asked.find(a => a.keys.includes('keep_at_it'));
  assert(rung, `the rung's question is asked while the survival layer holds the turn (${passes} passes)`);
  assert(passes >= 20 && passes <= 23, `after ten minutes on the clock (${passes} passes of thirty seconds)`);
  assert.match(rung.state.stalled.rung, /^10 minutes on the blaze rod request without a new best/);
});

test('a wait something is bringing to an end is not counted: asleep, health coming back, the night in a shelter in the Overworld', () => {
  const { waitEnds } = require('../src/stillness');
  const now = Date.parse('2026-09-28T06:00:00Z'), at = new Date(now).toISOString();
  assert.equal(waitEnds({ isSleeping: true }, {}, now), 'asleep');
  assert.equal(waitEnds({ health: 12, food: 20 }, { step: { action: 'recover_before_nether' } }, now), 'health coming back');
  assert.equal(waitEnds({ health: 12, food: 11 }, { step: { action: 'recover_before_nether' } }, now), null, 'no health comes back at hunger 11');
  assert.equal(waitEnds({ game: { dimension: 'overworld' }, time: { timeOfDay: 15000 } }, { survivalAction: { action: 'wait_in_shelter', at } }, now), 'daylight coming');
  assert.equal(waitEnds({ game: { dimension: 'the_nether' }, time: { timeOfDay: 15000 } }, { survivalAction: { action: 'wait_in_shelter', at } }, now), null, 'no daylight comes to the Nether');
  assert.equal(waitEnds({}, { step: { action: 'hold_bunker' } }, now), null, 'a stand held is minutes on the rung');
});

// mid-244-ad-nether-2 (25590), 02:54 to 03:00: encounter_stance answered none
// good 1,392 times in a row, a sword piglin and a crossbow piglin thirteen
// blocks off, every asking the same situation but for the list of its own
// failures just now.
test('none good said sure twice running to the same situation spends the question there: not asked again, the best listed taken, the question above told (note 599)', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-09-28T02:57:44Z') });
  const env = process.env.JEV_NONE_GOOD; process.env.JEV_NONE_GOOD = '1';
  t.after(() => { if (env === undefined) delete process.env.JEV_NONE_GOOD; else process.env.JEV_NONE_GOOD = env; });
  const { decide } = require('../src/decisions');
  const bot = { entity: { position: new Vec3(40.5, 70, -60.5) }, game: { dimension: 'the_nether', gameMode: 'survival' }, inventory: { items: () => [] }, health: 20, food: 18, entities: {}, _stalls: { records: {}, marks: [] } };
  const goal = { kind: 'win', gameProgress: { phase: 'obtain_blaze_rods' }, step: { action: 'find_fortress' } };
  let calls = 0;
  const client = { systemOne: async () => { calls++; return { answers: { branch_0: { choice: 'none_good', confidence: 0.6, probabilities: { none_good: 0.6, fight: 0.28, retreat: 0.05, keep_working: 0.07 } } } }; } };
  const tree = () => ({ fight: { description: 'Fight here: about 8.6 seconds.' }, retreat: { description: 'Run for footing.' }, keep_working: { description: 'Carry on with the work.' } });
  const state = n => ({ health: 20, threats: [{ name: 'piglin', distance: 13.3, held: 'golden_sword' }, { name: 'piglin', distance: 13.4, held: 'crossbow' }],
    failedHereJustNow: Array.from({ length: n }, (_, i) => ({ choice: i % 2 ? 'retreat' : 'fight', secondsAgo: i })) });
  const took = [];
  for (let i = 0; i < 6; i++) {
    const d = await decide('encounter_stance', { client, bot, goal, tree: tree(), state: state(20 + i) });
    took.push(d.path.join('/'));
    t.mock.timers.tick(300);
  }
  assert.equal(calls, 2, 'asked twice, then spent here');
  assert.deepEqual(took, ['fight', 'fight', 'fight', 'fight', 'fight', 'fight'], 'the best listed is taken meanwhile');
  const esc = goal.tried.escalations.find(e => e.from === 'encounter_stance');
  assert.equal(esc.to, 'survival_priority');
  assert.match(esc.why, /^encounter stance: none of its options was good, 2 times running with the same facts from here \(none good at 0\.6 and 0\.6\); the best listed, fight, was taken meanwhile/);
  assert.equal(bot._stalls.stall?.escalated?.to, 'survival_priority', 'raised, not thrown: the stance goes on');
  // The world moves: a new situation is asked.
  await decide('encounter_stance', { client, bot, goal, tree: tree(), state: { ...state(3), threats: [{ name: 'piglin', distance: 6.1, held: 'golden_sword' }] } });
  assert.equal(calls, 3);
  // Not sure (none good at 0.3, under the fight): not a run.
  const unsure = { systemOne: async () => { calls++; return { answers: { branch_0: { choice: 'fight', confidence: 0.4, probabilities: { none_good: 0.3, fight: 0.4 } } } }; } };
  const bot2 = { ...bot, _noneGood: undefined };
  for (let i = 0; i < 3; i++) await decide('encounter_stance', { client: unsure, bot: bot2, goal, tree: tree(), state: state(1) });
  assert.equal(calls, 6);
});

test('a plan\'s question spent by none good escalates to the rung\'s question, which the loop asks (note 599)', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-09-28T02:57:44Z') });
  const env = process.env.JEV_NONE_GOOD; process.env.JEV_NONE_GOOD = '1';
  t.after(() => { if (env === undefined) delete process.env.JEV_NONE_GOOD; else process.env.JEV_NONE_GOOD = env; });
  const { decide } = require('../src/decisions');
  const bot = { entity: { position: new Vec3(40.5, 70, -60.5) }, game: { dimension: 'the_nether', gameMode: 'survival' }, inventory: { items: () => [] }, health: 20, food: 18, entities: {}, _stalls: { records: {}, marks: [] } };
  const goal = { kind: 'win', gameProgress: { phase: 'obtain_blaze_rods' }, step: { action: 'find_fortress' } };
  const client = { systemOne: async () => ({ answers: { branch_0: { choice: 'none_good', confidence: 0.7, probabilities: { none_good: 0.7, return_for_blocks: 0.2, leg_east: 0.1 } } } }) };
  const tree = () => ({ return_for_blocks: { description: 'Back to the Overworld for blocks.' }, leg_east: { description: 'A leg east.' } });
  for (let i = 0; i < 2; i++) await decide('fortress_leg', { client, bot, goal, tree: tree(), state: { height: 70 } });
  assert.equal(bot._stalls.stall?.escalated?.to, 'rung_progress');
  assert.equal(bot._stalls.stall?.escalated?.from, 'fortress_leg');
});

test('a hold is judged by what it was chosen on: nearer by four, into or out of sight, gone, a shot, a new way, or more damage than priced end it; otherwise it is held on 15, 30, 60 seconds to its cap (note 599)', () => {
  const holds = require('../src/holds');
  const t0 = Date.parse('2026-09-28T05:15:17Z');
  const piglin = { entity: { id: 7, name: 'piglin' }, distance: 8.1, visible: true };
  const h = holds.begin({ choice: 'pillar', at: t0, health: 20, expects: { damage: 0, seconds: 15, oneHit: 4 }, mobs: [piglin], offered: ['pillar', 'fight', 'come_down', 'none_good'] });
  const at = s => t0 + s * 1000;
  assert.equal(holds.diverged(h, { now: at(20), health: 20, mobs: [piglin], offered: ['pillar', 'fight', 'come_down'] }), null);
  assert.equal(holds.diverged(h, { now: at(20), health: 20, mobs: [{ ...piglin, distance: 4 }], offered: [] }), 'the piglin it was chosen against came from 8 to 4 blocks off');
  assert.equal(holds.diverged(h, { now: at(20), health: 20, mobs: [{ ...piglin, visible: false }], offered: [] }), 'the piglin it was chosen against went out of sight, 8 blocks off');
  assert.equal(holds.diverged(h, { now: at(20), health: 20, mobs: [], offered: [] }), 'the piglin it was chosen against is gone');
  assert.equal(holds.diverged(h, { now: at(20), health: 20, mobs: [piglin], offered: [], shot: { name: 'arrow' } }), 'a shot came at the bot (arrow)');
  assert.equal(holds.diverged(h, { now: at(20), health: 20, mobs: [piglin], offered: ['pillar', 'fight', 'come_down', 'shoot_7'] }), 'a way not on offer when it was chosen is on offer now: shoot 7');
  assert.equal(holds.diverged(h, { now: at(20), health: 15, mobs: [piglin], offered: [] }), '5 health lost in 20 seconds, more than the 0 it was priced at by then');
  assert.deepEqual(holds.extend(h, at(15)), { extend: 15000 });
  assert.deepEqual(holds.extend(h, at(30)), { extend: 30000 });
  assert.deepEqual(holds.extend(h, at(60)), { extend: 60000 });
  assert.deepEqual(holds.extend(h, at(120)), { extend: 60000 });
  assert.deepEqual(holds.extend(h, at(300)), { capped: 'held 5 minutes and nothing it was chosen on changed' });
});

// mid-242-af (25598, note 590): on its pillar at 20 health, a crossbow
// piglin 8.1 blocks off in sight for twelve minutes without a shot. The
// ways off were priced as if it shot (the fight 59, the work 50) and the
// pillar at nothing.
test('a mob that has held off for minutes is priced at what it has done on every option: the hold and the ways off alike (note 599)', () => {
  const heldOff = require('../src/held-off');
  const ce = require('../src/combat-estimate');
  const t0 = Date.parse('2026-09-28T05:15:17Z');
  const bot = { _hurtBy: { piglin: t0 - 1000 }, inventory: { slots: {} } };
  const piglin = { entity: { id: 7, name: 'piglin', heldItem: { name: 'crossbow' } }, distance: 8.1, visible: true };
  for (let s = 0; s <= 240; s += 5) heldOff.observe(bot, [piglin], t0 + s * 1000);
  assert.equal(heldOff.quiet(bot, piglin, { now: t0 + 170000 }), null, 'under three minutes since its last hit');
  assert.deepEqual(heldOff.quiet(bot, piglin, { now: t0 + 240000 }), { minutes: 4, inSight: true });
  // One that came nearer, or came into sight, is not held off.
  const b2 = { inventory: { slots: {} } }, zombie = { entity: { id: 8, name: 'zombie' }, distance: 12, visible: false };
  for (let s = 0; s <= 240; s += 5) heldOff.observe(b2, [{ ...zombie, distance: 12 - s / 40 }], t0 + s * 1000);
  assert.equal(heldOff.quiet(b2, { ...zombie, distance: 6 }, { now: t0 + 240000 }), null);
  const b3 = { inventory: { slots: {} } };
  for (let s = 0; s <= 240; s += 5) heldOff.observe(b3, [{ ...zombie, visible: s >= 200 }], t0 + s * 1000);
  assert.equal(heldOff.quiet(b3, { ...zombie, visible: true }, { now: t0 + 240000 }), null);
  // Priced: a way off (anything that does not go at it) costs nothing from
  // it with it held off, as the hold does; the fight that goes at it is
  // priced as that fight.
  const est = q => ce.fightEstimate({ threats: [{ name: 'piglin', distance: 8.1, shoots: true, held: 'crossbow', visible: true, ...(q ? { quiet: 4 } : {}) }], armour: [], weapon: 'iron_sword', health: 20 });
  assert.equal(est(true).fightHere.damageTaken, est(false).fightHere.damageTaken);
  assert(est(true).fightHere.damageTaken > 0);
  assert(ce.stanceCost({ mobs: est(false).mobs, reaches: () => true }).damage > 0);
  assert.equal(ce.stanceCost({ mobs: est(true).mobs, reaches: () => true }).damage, 0);
  assert.equal(ce.stanceCost({ mobs: est(true).mobs, fight: {}, reaches: () => true }).damage, ce.stanceCost({ mobs: est(false).mobs, fight: {}, reaches: () => true }).damage);
  assert.match(heldOff.says(bot, [{ t: piglin, q: { minutes: 4, inSight: true } }]), /^ Held off: the piglin 8 blocks off \(4 minutes, in sight all that while; about \d+(\.\d)? a hit should it come\)\. It has been about that long without coming nearer, coming into sight or hurting the bot, so it is priced at what it has done, nothing, on every option here that does not go at it, the hold and the ways off alike; a fight that goes at it is priced as that fight\.$/);
});

// mid-242-ab-nether-3 (25584, note 585): back_to_wall held two minutes at a
// time, three blazes about behind the corridor's corners, none in sight,
// nothing swung, nothing killed.
test('a hunt\'s stand is a wait by what it is: held twice with nothing changed, it rests, and the hunt is asked with the other ways (note 599)', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-09-28T04:34:53Z') });
  const { decide } = require('../src/decisions');
  const bot = { entity: { position: new Vec3(-203.5, 54, -210.5) }, game: { dimension: 'the_nether', gameMode: 'survival' }, inventory: { items: () => [] }, health: 20, food: 17, entities: {} };
  // The stand's own step in hand, as it was each time the hunt was asked
  // again: a hold, so each answer was a wait that never came to nothing.
  const goal = { kind: 'win', gameProgress: { phase: 'obtain_blaze_rods' }, step: { action: 'hold_bunker' } };
  const asked = [];
  const client = answering(asked, c => c.back_to_wall ? 'back_to_wall' : 'defer');
  const tree = () => ({ back_to_wall: { description: 'Walk to footing with a wall at its back and fight there.' }, dig_in_and_fight: { description: 'Dig a hole into the brick.' }, close_in: { description: 'Go at the blazes.' }, defer: { description: 'Leave them for now.' } });
  for (let i = 0; i < 3; i++) { await decide('hunt_target', { client, bot, goal, tree: tree(), state: { blazes: 3 } }); t.mock.timers.tick(2 * 60000); }
  assert.deepEqual(asked[2].keys.sort(), ['close_in', 'defer', 'dig_in_and_fight']);
  assert.match(asked[2].state.waysResting[0], /^back to wall: Held from about here 2 times in the last 4 minutes, 4 minutes in all, and nothing changed in any of them/);
});

test('a resting wait is left out for two open ways, not for ways that rest themselves: every way resting still escalates', () => {
  const tried = require('../src/tried');
  const now = Date.parse('2026-09-28T06:40:00Z');
  const bot = pocketBot(), here = { x: -275.5, y: 56, z: -173.5 };
  const entry = (method, wait) => ({ q: 'pocket_next', method, place: here, at: now - 120000, settledAt: now - 30000, outcome: 'blocked',
    ...(wait ? { wait: true, heldMs: 90000, why: 'held 2 minutes and nothing changed: health 12.8, nothing within 16 blocks, no swing throughout' } : { why: 'No path to the goal!' }) });
  const goal = { tried: { entries: [entry('stay', true), entry('stay', true), entry('leave'), entry('leave'), entry('tunnel_out'), entry('tunnel_out')], escalations: [] } };
  const tree = { stay: { description: 'Stay.' }, leave: { description: 'Leave.' }, tunnel_out: { description: 'Tunnel.' } };
  const all = tried.read(bot, goal, 'pocket_next', tree, { now });
  assert.equal(all.allResting, true, 'nothing open: the question above is asked');
  const open = tried.read(bot, goal, 'pocket_next', { ...tree, go_for_food: { description: 'Food.' }, work_here: { description: 'Work.' } }, { now });
  assert.deepEqual(Object.keys(open.tree).sort(), ['go_for_food', 'work_here'], 'the resting wait and ways left out, two open');
});
