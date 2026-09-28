'use strict';
// mid-242-aa-nether-1-fortress-4 (25590, note 605), begun 12:31:57 from the
// fortress save mid-242-aa-nether-1-014452 with note 600 live: the rods were
// set aside at the rung's question 3.2 minutes in, told "17 answers given, 1
// coming to nothing, 0 getting somewhere" with eleven of fortress_leg's
// twelve ways never tried, and the ladder's rods_waiting step then threw
// "The blaze rods step waits" every forty-five seconds (the watcher's "loop:
// 3x"), each round a stall of the set-aside rung and working free (41
// unstuck_move askings).
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { Task } = require('../src/skills');
const registry = require('minecraft-data')('26.1');
const { setAside } = require('../src/progress');

const T0 = Date.parse('2026-09-28T12:35:03.300Z');
const HERE = new Vec3(-82.7, 55, 142.5);
// fortress_leg as it was offered at 12:34:57 to 12:35:03 (the ledger's offered list).
const LEG_WAYS = ['leg_east', 'leg_south', 'leg_west', 'leg_north', 'floor_east', 'floor_south', 'floor_west', 'floor_north', 'seek_fortress_height', 'blocks_then_cross', 'restock_blocks', 'return_for_blocks'];
const legTree = () => Object.fromEntries(LEG_WAYS.map(k => [k, { description: `The way ${k.replaceAll('_', ' ')}.` }]));
const APPROACH_WAYS = ['cross_level', 'blocks_then_cross', 'tunnel', 'keep_searching'];
const approachTree = () => Object.fromEntries(APPROACH_WAYS.map(k => [k, { description: `The way in ${k.replaceAll('_', ' ')}.`, target: { x: -72, y: 59, z: 140 } }]));
const items = [{ name: 'iron_sword', count: 1 }, { name: 'iron_pickaxe', count: 1 }, { name: 'gravel', count: 17 }, { name: 'nether_bricks', count: 12 }];
function nether() {
  const bot = { registry, game: { dimension: 'the_nether', gameMode: 'survival', difficulty: 'normal' }, health: 20, food: 20, isAlive: true, chat() {}, emit() {},
    entity: { id: 1, position: HERE.clone() }, time: { timeOfDay: 6000 }, entities: {},
    inventory: { items: () => items, slots: [] }, findBlocks: () => [], clearControlStates() {},
    blockAt: p => ({ position: p, name: p.y < 55 && p.y > 31 ? 'netherrack' : p.y <= 31 ? 'lava' : 'air', boundingBox: p.y < 55 && p.y > 31 ? 'block' : 'empty' }),
    pathfinder: { movements: { blocksCantBreak: new Set() }, setGoal() {}, getPathTo: () => ({ status: 'noPath', path: [] }) } };
  const goal = { kind: 'win', request: 'beat the game', from: 'TestPlayer', survival: {}, rungTime: { phase: 'obtain_blaze_rods' },
    gameProgress: { phase: 'obtain_blaze_rods', milestones: { nether_entered: { at: T0 - 3600000 } } },
    step: { action: 'find_fortress', legs: 12 },
    landmarks: [{ kind: 'nether_fortress', x: -70, y: 32, z: 140, bricks: 128, dimension: 'nether' }, { kind: 'warped_forest', x: -77, y: 40, z: 26, dimension: 'nether' }],
    portals: [{ x: 60, y: 70, z: 100, dimension: 'nether' }] };
  return { bot, goal };
}
// Jev as recorded: blocks_then_cross to the leg's question, keep_searching to the approach's, while they are offered.
function recordedJev(asked, picks = {}) {
  return { model: 'jev', systemOne: async ({ state, questions }) => {
    const answers = {};
    for (const [b, q] of Object.entries(questions)) {
      const keys = Object.keys(q.criteria || {});
      const id = keys.includes('seek_fortress_height') ? 'fortress_leg' : keys.includes('keep_at_it') ? 'rung_progress' : keys.includes('keep_searching') ? 'fortress_approach' : 'other';
      asked.push({ id, state, options: q.criteria, at: Date.now() });
      // Each answer in order of preference, the first on offer taken.
      const wants = [].concat(picks[id] || (id === 'fortress_leg' ? 'blocks_then_cross' : id === 'fortress_approach' ? 'keep_searching' : keys[0]));
      answers[b] = { choice: wants.find(w => keys.includes(w)) || keys[0], confidence: 0.5 };
    }
    return { answers };
  } };
}

test('the work\'s own questions answered in the seconds after the survival layer backed off an edge are not waits: they come to nothing and rest like any way (25590, note 605)', async t => {
  // 12:34:55 to 12:35:03: off_the_edge was the survival action in the last eight seconds at every asking, and the
  // leg's blocks_then_cross and the approach's keep_searching, each coming back within a second, were recorded as
  // waits eight times each: none came to nothing, none rested, and the rung's question later read "17 answers
  // given, 1 coming to nothing, 0 getting somewhere".
  t.mock.timers.enable({ apis: ['Date'], now: T0 - 6000 });
  const { decide } = require('../src/decisions');
  const { bot, goal } = nether();
  const asked = [];
  const client = recordedJev(asked);
  for (let i = 0; i < 3; i++) {
    goal.survivalAction = { action: 'off_the_edge', at: new Date(Date.now() - 500).toISOString() };
    await decide('fortress_approach', { client, bot, goal, tree: approachTree(), target: { x: -72, y: 59, z: 140 }, state: {} }).catch(() => {});
    t.mock.timers.tick(400);
    await decide('fortress_leg', { client, bot, goal, tree: legTree(), state: {} }).catch(() => {});
    t.mock.timers.tick(500);
  }
  const legs = goal.tried.entries.filter(e => e.q === 'fortress_leg' && e.method === 'blocks_then_cross');
  assert(legs.length >= 2);
  assert(legs.slice(0, 2).every(e => e.outcome === 'blocked'), `came to nothing, not waited: ${legs.map(e => e.outcome).join(', ')}`);
  const lastLeg = asked.filter(a => a.id === 'fortress_leg').at(-1);
  assert.equal(lastLeg.options.blocks_then_cross, undefined, 'blocks then cross rests after two, and the leg\'s other ways are asked');
  assert(lastLeg.options.seek_fortress_height && lastLeg.options.leg_west);
  // A wait by what it is stays a wait (note 599): the stance's take_cover.
  const { begin } = require('../src/tried');
  goal.survivalAction = { action: 'off_the_edge', at: new Date().toISOString() };
  await decide('encounter_stance', { client: { systemOne: async () => ({ answers: { branch_0: { choice: 'take_cover', confidence: 0.9 } } }) }, bot, goal, tree: { take_cover: { description: 'Into cover.' }, fight: { description: 'Fight.' } }, state: {} }).catch(() => {});
  assert.equal(typeof begin, 'function');
  assert.equal(goal.tried.entries.filter(e => e.q === 'encounter_stance').at(-1)?.waiting, true, 'the stance answered during the emergency is still a wait');
});

const FAILED = 'No measurable progress on {"action":"find_fortress","target":{"x":-70,"y":32,"z":140},"legs":12}';
// The recorded escalation: the trial's rung clock from 12:31:57, the approach and the leg answered as recorded, the
// approach's every way resting at 12:35:04 (escalated to fortress_leg), and the step's two failures at 12:35:09.3
// and 12:35:11.5 with the leg's question never asked between (the walk to the remembered fortress, unasked).
async function recordedEscalation(t, picks = {}) {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-09-28T12:31:57.600Z') });
  const { decide } = require('../src/decisions');
  const { persist } = require('../src/work');
  const tried = require('../src/tried');
  const { bot, goal } = nether();
  tried.watchRung(bot, goal);
  const asked = [];
  const client = recordedJev(asked, picks);
  const at = iso => t.mock.timers.setTime(Date.parse(`2026-09-28T${iso}Z`));
  at('12:35:02.900'); await decide('fortress_approach', { client, bot, goal, tree: approachTree(), target: { x: -72, y: 59, z: 140 }, state: {} });
  at('12:35:03.300'); await decide('fortress_leg', { client, bot, goal, tree: legTree(), state: {} });
  // The approach's ways as the ledger had them by 12:35:04.5: tunnel twice, blocks then cross and cross level each
  // come to nothing twice (the repeat rule and the one way), keep searching held after eight.
  const toward = { x: -72, y: 59, z: 140 };
  for (const [iso, method] of [['12:35:03.400', 'tunnel'], ['12:35:03.500', 'tunnel'], ['12:35:03.600', 'blocks_then_cross'], ['12:35:03.700', 'blocks_then_cross'],
    ['12:35:03.800', 'cross_level'], ['12:35:03.900', 'cross_level'], ['12:35:04.000', 'keep_searching']]) {
    at(iso); tried.record(bot, goal, { q: 'fortress_approach', method, target: toward, outcome: 'blocked', why: 'came back within a second and nothing measurable came of it' });
  }
  at('12:35:04.500');
  tried.escalate(goal, { from: 'fortress_approach', to: 'fortress_leg', why: 'every way it had from here rests: cross level: Tried 2 times toward the same place from about here in the last 1 second, and it came to nothing', parentOf: require('../src/decisions').parentOf, here: bot.entity.position });
  const lines = [];
  const fail = async iso => {
    at(iso);
    goal.step = { action: 'find_fortress', target: { x: -70, y: 32, z: 140 }, legs: 12 };
    const log = t.mock.method(console, 'log', (...a) => lines.push(a.join(' ')));
    try { await persist(bot, new Task('persist'), goal, () => {}, Object.assign(new Error(FAILED), { name: 'Blocked' }), () => {}, { client }); }
    finally { log.mock.restore(); }
    tried.settle(bot, goal, { passEnd: true, error: FAILED });
  };
  await fail('12:35:09.300');
  await fail('12:35:11.470');
  return { asked, goal, lines, tried, bot };
}

test('the recorded 25590 escalation: brought to the rung\'s question with fortress_leg\'s ways untried, the rods are not set aside, how little was tried is said, and keeping at it asks the leg\'s question next (note 605)', async t => {
  // Jev as recorded: set_aside_rung (0.42) if offered, else keeping at it.
  const { asked, goal, lines, tried } = await recordedEscalation(t, { rung_progress: ['set_aside_rung', 'keep_at_it'] });
  assert.match(lines.find(l => l.startsWith('[escalate]')) || '', /^\[escalate\] step -> fortress leg/, 'the first failure goes to the leg\'s question');
  const rung = asked.find(a => a.id === 'rung_progress');
  assert(rung, 'the second, the leg never asked between, passes it over to the rung\'s question (note 583)');
  assert.equal(rung.options.set_aside_rung, undefined, 'not set aside with the leg\'s ways untried');
  const s = rung.state.stalled;
  assert.match(s.setAsideNotOffered, /^setting the obtain blaze rods aside is not offered: it was brought here by a failure below, and ways below it have not been tried from here: fortress leg \(leg east, leg south, leg west, leg north, floor east, floor south, floor west, floor north, seek fortress height, restock blocks, return for blocks\)/);
  // How little: 3.2 minutes, five different ways of the sixteen offered, by a failure below, not the ten minutes.
  assert.match(s.workedOnRung, /^in 3\.2 minutes on it: 9 answers given to 5 different ways of the 16 its questions offered, 9 coming to nothing, 0 getting somewhere; the step failed 2 times; not yet tried from here: fortress leg \(asked 8 seconds ago\): leg east, /);
  assert.match(s.workedOnRung, /brought to this question by a failure below 3\.2 minutes into the rung's ten, not by its ten minutes running out$/);
  assert.match(rung.state.situation, /setting the rung aside is not offered here, and why is said\.$/);
  assert.match(rung.options.keep_at_it, /The fortress leg question is asked next, with the ways not yet tried from here: fortress leg \(leg east, /);
  assert.equal(require('../src/progress').isSetAside(goal, 'rung', 'obtain_blaze_rods'), false);
  assert.deepEqual(goal.decisions.at(-1).path, ['keep_at_it']);
  assert.match(tried.owed(goal, 'fortress_leg')?.at(-1) || '', /^the rung's question sent the work back here: step: the find fortress step failed 2 times running/);
});

// The rods set aside at 12:35:11 as recorded, the pearls' forest walk and sweep resting (12:35:12, 12:35:13), and
// leave_nether answered wait_here at 12:35:13.6: the ladder's stage is the rods waiting.
function rodsWaiting(t) {
  const T = Date.parse('2026-09-28T12:35:13.900Z');
  t.mock.timers.enable({ apis: ['Date'], now: T });
  const { observeProgress, nextGameStage } = require('../src/game-progress');
  const { bot, goal } = nether();
  observeProgress(bot, goal);
  setAside(goal, 'rung', 'obtain_blaze_rods', 'Jev set it aside at the rung\'s question, worked on in 3.2 minutes on it: 17 answers given, 1 coming to nothing, 0 getting somewhere', 1800000);
  setAside(goal, 'rung', 'warped_search', 'The sweep for a warped forest got nowhere from (-83, 55, 142)', 1800000);
  setAside(goal, 'landmark_trip', 'warped_forest:-77,26', 'The walk to the warped forest at (-77, 26), 118 blocks off, came no nearer', 1800000);
  const stage = nextGameStage(bot, goal);
  return { bot, goal, stage, T };
}

test('the rods waiting in the Nether with Jev\'s wait_here: the ladder runs the other work until the rest ends, not the rods step thrown as a failure every pass, and the stall watch keys it by the wait, not the set-aside rung (25590, note 605)', async t => {
  // 12:35:13.9 to 12:41:25: "The blaze rods step waits (...)" thrown by leaveNetherStep at every pass, each to
  // persist and a hold; the stall watch, keyed step:rung:obtain_blaze_rods while the hold was step:rods_waiting,
  // struck the set-aside rung every 45 seconds, and working free followed (41 unstuck_move askings).
  const { gameStep } = require('../src/game-progress');
  const { actionOf } = require('../src/stillness');
  const { bot, goal, stage, T } = rodsWaiting(t);
  assert.equal(stage.action, 'rods_waiting');
  const holds = [], asked = [];
  const client = { model: 'jev', systemOne: async ({ questions }) => { const keys = Object.keys(questions.branch_0.criteria); asked.push(keys); return { answers: { branch_0: { choice: 'wait_here', confidence: 0.81 } } }; } };
  const actions = { client, hold_for_rest: async (b, tk, g, sv, opts) => { holds.push({ ...opts, key: actionOf(g).key, rung: g.rungTime?.phase || null }); },
    return_overworld: async () => assert.fail('not back through the portal'), acquireStep: async () => assert.fail('the rods wait') };
  // Asked once: wait_here, and the other work runs at once, not a second question (the stall's until_rest_ends).
  await gameStep(bot, new Task('game'), goal, () => {}, actions);
  assert.equal(asked.length, 1); assert(asked[0].includes('wait_here'));
  assert.equal(holds.length, 1, 'the other work until the rest ends is the stage\'s work');
  assert(holds[0].until > T + 29 * 60000, 'until the rods\' rest ends');
  assert.equal(holds[0].reason, 'step:rods_waiting');
  assert.equal(holds[0].key, 'step:rods_waiting', 'the stall watch sees the wait, not the set-aside rung');
  assert.equal(holds[0].rung, null, 'the set-aside rung is not timed as the rung in hand');
  // The next pass, the answer held: the hold again, no question and nothing thrown.
  t.mock.timers.tick(45000);
  await gameStep(bot, new Task('game'), goal, () => {}, actions);
  assert.equal(asked.length, 1, 'the same rest is not asked again');
  assert.equal(holds.length, 2);
  assert.equal(require('../src/tried').rungOf(goal), null);
});
