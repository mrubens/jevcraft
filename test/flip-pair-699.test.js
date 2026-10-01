'use strict';
// Note 699: two steps that trade the turn rest together, said to the
// question above, and a walk under an intention carries its yield.
// Five of 44 trials since 20:00Z on 2026-09-29 ended as flip pairs: 25592
// mid-242-ia (mine and tunnel at a diamond ore, 20:04:57Z), 25594 mid-242-he
// (enter nether and cast portal, "8 standing, 2 to cast" with no lava or
// water carried, 20:16:08Z), 25585 mid-242-dh-fortress-22 (mine and the
// stall's detour, 20:38:25Z), 25589 mid-242-bb-fortress-14 (tunnel and stalk
// mob, 21:06:14Z) and 25597 mid-242-jd (hunt mob and stalk mob boxed in by
// a blaze, 22:07:19Z).
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { Vec3 } = require('vec3');
const registry = require('minecraft-data')('26.1');

function watchedBot(at, { dimension = 'overworld' } = {}) {
  const bot = new EventEmitter();
  Object.assign(bot, { entity: { position: at.clone() }, inventory: { items: () => [] }, game: { gameMode: 'survival', dimension }, placeBlock: async () => {} });
  const stillness = require('../src/stillness');
  stillness.watchStalls(bot, () => null);
  return { bot, stop: () => stillness.unwatchStalls(bot) };
}
const dig = (bot, cell) => bot.emit('diggingCompleted', { position: cell });
// The work's names as they came, from one spot.
function flips(bot, goal, steps, { t0 = 5_000_000, gap = 2500, between = () => {} } = {}) {
  const { flipWatch } = require('../src/stillness');
  let t = t0, raised = null;
  for (const s of steps) { t += gap; goal.step = typeof s === 'string' ? { action: s } : { ...s }; between(t); raised = flipWatch(bot, goal, t) || raised; }
  return { raised, t };
}

test('25592: mine and tunnel at one ore, blocks dug and the rung no nearer, rest together and go to the rung\'s question with the count', () => {
  const pairs = require('../src/flip-pairs');
  const { takeStall } = require('../src/stillness');
  const { bot, stop } = watchedBot(new Vec3(39.5, -9, 52.5));
  try {
    const goal = { kind: 'win', rungTime: { phase: 'reach_nether' }, survival: {} };
    const ore = { x: 40, y: -9, z: 55 };
    const steps = ['mine', 'tunnel', 'mine', 'tunnel', 'mine'].map(a => a === 'mine' ? { action: 'mine', block: 'diamond_ore', drops: 'diamond', count: 3 } : { action: 'tunnel', target: ore });
    let n = 0;
    const { raised, t } = flips(bot, goal, steps, { between: () => dig(bot, new Vec3(30 + n++, -9, 53)) });
    assert.match(raised?.why || '', /^turning between mine and tunnel 4 times in 10 seconds with nothing gained on the rung: no obsidian or flint and steel/);
    assert.deepEqual(raised.escalated && { from: raised.escalated.from, to: raised.escalated.to }, { from: 'flip', to: 'rung_progress' });
    assert.equal(raised.until, t + pairs.REST_MS);
    assert.match(raised.flip.says, /^the mine and the tunnel traded the turn 4 times in 10 seconds at \(39, -9, 52\), nothing gained on the rung: .*They rest together from here 5 more minutes: the two trading again within 5 blocks of here comes back to this question at the first trade\.$/);
    assert(pairs.resting(goal, ['tunnel', 'mine'], bot.entity.position, t), 'resting together from here');
    takeStall(bot);
    // The answer (a night mine, on 25592) led back into them: one trade here is raised at once.
    goal.tried = { entries: [{ q: 'stillness_detour', method: 'night_mine', at: t + 3000, outcome: 'pending' }] };
    const back = flips(bot, goal, [steps[0], steps[1]], { t0: t + 20000, gap: 1000 });
    assert.match(back.raised?.why || '', /^turning between mine and tunnel again within 5 blocks of where they rested together, 5 times in all here in \d+ seconds/);
    assert.match(back.raised.flip.says, /traded the turn again at \(39, -9, 52\) while they rested together, .*the 2nd time the two have traded here in \d+ seconds, 5 trades in all; the last answer here, night mine \(stillness detour\), led back into them/);
    takeStall(bot);
    // Eight blocks off (another way from fresh ground), the two may go on: one trade there is not raised.
    bot.entity.position = new Vec3(47.5, -9, 52.5);
    const off = flips(bot, goal, [steps[0], steps[1]], { t0: back.t + 5000, gap: 1000 });
    assert.equal(off.raised, null, off.raised?.why);
  } finally { stop(); }
});

test('25594: a cast that walls the same slot with nothing standing more is a flip; a staircase whose step comes nearer its target is not', () => {
  const cast = watchedBot(new Vec3(-14.5, 82, 293.5));
  try {
    const goal = { kind: 'win', rungTime: { phase: 'reach_nether' }, survival: {} };
    let n = 0;
    const { raised } = flips(cast.bot, goal, ['enter_nether', { action: 'cast_portal', item: 'obsidian', slot: { x: -15, y: 84, z: 292 } }, 'enter_nether', { action: 'cast_portal', item: 'obsidian', slot: { x: -15, y: 84, z: 292 } }, 'enter_nether'],
      { gap: 9000, between: () => dig(cast.bot, new Vec3(-16, 84 + (n++ % 3), 292)) });
    // Note 763: enter_nether is the ladder's label, written before every pass
    // of the crossing; with no portal lit it claims no turn, and a cast
    // traded with it is the cast's own work, judged by its own stall.
    assert.equal(raised, null, raised?.why);
  } finally { cast.stop(); }
  const stairs = watchedBot(new Vec3(82.5, 43, 121.5));
  try {
    // The frame the staircase climbs to is the rung's own place: the portal, nearer by more than two blocks.
    const frame = { x: 70, y: 43, z: 121 };
    const goal = { kind: 'win', rungTime: { phase: 'reach_nether' }, survival: {}, portalFrame: { origin: frame, blocks: [] } };
    let n = 0;
    const { raised } = flips(stairs.bot, goal, ['enter_nether', { action: 'tunnel', target: frame }, 'enter_nether', { action: 'tunnel', target: frame }, 'enter_nether'],
      { between: () => { n++; dig(stairs.bot, new Vec3(82 - n, 43, 121)); stairs.bot.entity.position = new Vec3(82.5 - 0.55 * n, 43, 121.5); } });
    assert.equal(raised, null, raised?.why);
  } finally { stairs.stop(); }
});

test('25585: a pair with the stall\'s own detour in it is said, not held: its answers are how the work goes on', () => {
  const pairs = require('../src/flip-pairs');
  const { bot, stop } = watchedBot(new Vec3(-122.1, 39, 81.5), { dimension: 'the_nether' });
  try {
    const goal = { kind: 'win', rungTime: { phase: 'obtain_blaze_rods' }, survival: {} };
    const mine = { action: 'mine', block: 'warped_stem', drops: 'warped_stem', count: 3 };
    const detour = { action: 'detour', choice: 'until_rest_ends' };
    const { raised, t } = flips(bot, goal, [mine, detour, mine, detour, mine], { gap: 5000 });
    assert.match(raised?.why || '', /^turning between mine and detour 4 times in 20 seconds/);
    assert.match(raised.flip.says, /One of the two is an answer to the stall itself, so the pair is said, not held\.$/);
    assert.equal(pairs.resting(goal, ['mine', 'detour'], bot.entity.position, t), null);
  } finally { stop(); }
});

// The rung's question for a raised pair (work.js answerStall).
function overworldBot(at) {
  const items = [['iron_pickaxe', 1], ['cobblestone', 64], ['cooked_mutton', 5]].map(([name, count], slot) => ({ name, count, type: registry.itemsByName[name].id, slot: 9 + slot, durabilityUsed: 0 }));
  const floorY = Math.floor(at.y);
  return { registry, game: { dimension: 'overworld', gameMode: 'survival', difficulty: 'normal' }, health: 20, food: 20, isAlive: true, chat() {}, emit() {}, on() {},
    entity: { id: 1, position: at.clone(), onGround: true }, time: { timeOfDay: 6000 }, entities: {},
    inventory: { items: () => items, slots: [] }, findBlocks: () => [], clearControlStates() {},
    blockAt: p => ({ position: p, name: p.y < floorY ? 'deepslate' : 'air', boundingBox: p.y < floorY ? 'block' : 'empty' }),
    pathfinder: { movements: { blocksCantBreak: new Set() }, setGoal() {}, getPathTo: () => ({ status: 'noPath', path: [] }) } };
}
test('the rung\'s question is told the pair, the count and the rest; keeping at it from here is not offered while they rest', async t => {
  const T0 = Date.parse('2026-09-29T20:05:14Z');
  t.mock.timers.enable({ apis: ['Date'], now: T0 });
  const { answerStall } = require('../src/work');
  const { Task } = require('../src/skills');
  const pairs = require('../src/flip-pairs');
  const bot = overworldBot(new Vec3(39.5, -9, 52.5));
  const goal = { kind: 'win', request: 'beat the game', from: 'TestPlayer', survival: {}, rungTime: { phase: 'reach_nether', since: T0 - 600000, activeMs: 300000 },
    step: { action: 'tunnel', target: { x: 40, y: -9, z: 55 } } };
  const e = pairs.note(goal, { names: ['mine', 'tunnel'], trades: 4, seconds: 16, where: bot.entity.position, rungSays: 'nothing gained on the rung: no obsidian or flint and steel, no nearer the step\'s target (4 blocks off, the nearest yet 5)', now: T0 });
  const says = pairs.says(e, T0);
  const stall = { key: 'step:rung:reach_nether', layer: 'work', name: 'tunnel', strikes: 1, why: 'turning between mine and tunnel 4 times in 16 seconds with nothing gained on the rung',
    flip: { pair: e.pair, trades: e.trades, times: e.times, where: e.where, until: e.until, says }, escalated: { from: 'flip', to: 'rung_progress', says }, until: e.until };
  const asked = [];
  const client = { model: 'jev', systemOne: async ({ state, questions, context }) => {
    const answers = {};
    for (const [b, q] of Object.entries(questions)) { asked.push({ state, options: q.criteria, context }); answers[b] = { choice: 'none_good', confidence: 0.6 }; }
    return { answers };
  } };
  await answerStall(bot, new Task('stall'), goal, () => {}, stall, { client }).catch(() => {});
  assert(asked.length, 'asked');
  const { state, options } = asked[0];
  assert.match(state.stalled.flipPair, /^the mine and the tunnel traded the turn 4 times in 16 seconds at \(39, -9, 52\), nothing gained on the rung: no obsidian or flint and steel, no nearer the step's target \(4 blocks off, the nearest yet 5\)\. They rest together from here 5 more minutes/);
  assert.equal(state.stalled.whatFailedBelow, undefined, 'said once, as the pair');
  assert.equal(options.keep_at_it, undefined);
  assert.match(state.stalled.keepAtItNotOffered, /^keeping at the reach nether from here is not offered: its steps here are the mine and tunnel, which rest together 5 minutes more$/);
  assert.match(options.until_rest_ends || '', /until the mine and tunnel come off their rest here/);
  assert(options.differently, 'another way from fresh ground is offered');
});

// A walk under an intention carries its yield (note 699): 25583 walked 2,532 blocks in 77 minutes and ended 32 from where
// it began.
function netherBot(at) {
  const inv = [['iron_sword', 1], ['netherrack', 64], ['iron_pickaxe', 1]].map(([name, count]) => ({ name, count, type: registry.itemsByName[name].id, durabilityUsed: 0 }));
  return Object.assign(new EventEmitter(), {
    registry, version: '26.1', health: 20, food: 20, game: { dimension: 'the_nether', gameMode: 'survival', difficulty: 'normal' }, said: [],
    entity: { position: at.clone(), onGround: true, height: 1.8, width: 0.6, velocity: new Vec3(0, 0, 0) }, entities: {},
    inventory: { items: () => inv, slots: [] }, chat(m) { this.said.push(m); }, blockAt: () => null,
  });
}
test('a walk that brings nothing for three minutes ends and says so; its answer came to nothing and its question is asked again', async t => {
  const T0 = Date.parse('2026-09-29T22:00:00Z');
  t.mock.timers.enable({ apis: ['Date'], now: T0 });
  const { decide } = require('../src/decisions');
  const intention = require('../src/intention');
  const { takeStall } = require('../src/stillness');
  const client = { systemOne: async () => ({ answers: { branch_0: { choice: 'back_to_fortress', confidence: 0.9, probabilities: { back_to_fortress: 0.9 } } } }) };
  const bot = netherBot(new Vec3(-140, 70, 150));
  const goal = { kind: 'win', rungTime: { phase: 'obtain_blaze_rods' }, survival: {} };
  const fortress = { x: -40, y: 70, z: 150 };
  await decide('fortress_leg', { client, bot, goal, target: fortress, tree: { back_to_fortress: { description: 'Walk back to the fortress.', target: fortress }, leg_west: { description: 'A leg west.' } }, state: { health: 20 } });
  assert.equal(goal.intention?.choice, 'back_to_fortress');
  // Two minutes nearer: a gain, and it holds.
  t.mock.timers.tick(120000); bot.entity.position = new Vec3(-120, 70, 150);
  assert(intention.holding(bot, goal, Date.now()), 'nearer its target: holds');
  // Then back and forth, no nearer, for three minutes.
  for (let i = 0; i < 18; i++) { t.mock.timers.tick(10000); bot.entity.position = new Vec3(i % 2 ? -125 : -121, 70, 150); intention.holding(bot, goal, Date.now()); if (!goal.intention) break; }
  assert.equal(goal.intention, undefined);
  assert.match(goal.intentionEnded.why, /^no yield: 3 minutes with nothing gained on the rung: killed nothing, no rod, no nearer its target \(\d+ blocks off, the nearest yet 80\)/);
  // The watch's look ends it and throws the stall to the work, with the answer marked come to nothing.
  const walk = await decide('fortress_leg', { client, bot, goal, target: fortress, tree: { back_to_fortress: { description: 'Walk back to the fortress.', target: fortress }, leg_west: { description: 'A leg west.' } }, state: { health: 20 } });
  assert.deepEqual(walk.path, ['back_to_fortress']);
  const began = Date.now();
  for (let i = 0; i < 20 && goal.intention; i++) { t.mock.timers.tick(10000); bot.entity.position = new Vec3(i % 2 ? -125 : -121, 70, 150); intention.yieldWatch(bot, goal, Date.now()); }
  const stall = takeStall(bot);
  assert.match(stall?.why || '', /^back to fortress \(fortress leg\) ended, no yield: 3 minutes with nothing gained on the rung/);
  assert.deepEqual({ from: stall.escalated.from, to: stall.escalated.to }, { from: 'intention', to: 'fortress_leg' });
  const own = goal.tried.entries.filter(e => e.q === 'fortress_leg' && e.at >= began - 1000).at(-1);
  assert.equal(own.outcome, 'blocked');
  assert.match(own.why, /no yield/);
  // A wait by a spawner is not a walk: it is not ended for want of yield.
  goal.intention = { q: 'fortress_leg', choice: 'wait_at_spawner', path: 'wait_at_spawner', at: Date.now(), dimension: 'the_nether', health: 20 };
  t.mock.timers.tick(5 * 60000);
  assert(intention.holding(bot, goal, Date.now()), 'a wait holds');
});

test('a trip held that is no walk by name (portal_way\'s around_right) ends the same after three minutes with nothing gained (25589, note 811)', async t => {
  const T0 = Date.parse('2026-10-01T13:14:00Z');
  t.mock.timers.enable({ apis: ['Date'], now: T0 });
  const { decide } = require('../src/decisions');
  const intention = require('../src/intention');
  const client = { systemOne: async () => ({ answers: { branch_0: { choice: 'around_right', confidence: 0.9, probabilities: { around_right: 0.9 } } } }) };
  const bot = netherBot(new Vec3(289, 65, 106));
  const goal = { kind: 'win', rungTime: { phase: 'obtain_blaze_rods' }, survival: {} };
  const portal = { x: 52, y: 39, z: 21 };
  await decide('portal_way', { client, bot, goal, target: portal, tree: { around_right: { description: 'Round the lava to the right.', target: portal }, around_left: { description: 'Round to the left.', target: portal } }, state: { health: 20 } });
  assert.equal(goal.intention?.choice, 'around_right');
  assert.ok(goal.intention?.trip, 'a trip');
  for (let i = 0; i < 24; i++) { t.mock.timers.tick(10000); bot.entity.position = new Vec3(i % 2 ? 293 : 291, 64, 106); intention.holding(bot, goal, Date.now()); if (!goal.intention) break; }
  assert.equal(goal.intention, undefined);
  assert.match(goal.intentionEnded.why, /^no yield: 3 minutes with nothing gained/);
});
