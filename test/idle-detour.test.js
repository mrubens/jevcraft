'use strict';
// Two trials on main at 4f147ba sat idle for the rest of their run (note
// 609). mid-243-af-nether-3-fortress-2 (25587): the errand set aside, the
// stall's question (stillness_detour) had every way resting (differently,
// work free, until rest ends, hoglin food), escalated to the rung's
// question, which answerStall does not ask for a rung set aside, and asked
// itself again at once, over twenty passes a second; the loop's spin line
// then threw (JSON.stringify of no survival action is undefined) and the
// game was parked "blocked". mid-242-ah-nether-1-fortress-1 (25586) spun the
// same way on its return-for-food step and was parked by the same line; its
// idle loop then went stillness_detour -> rung_progress 52,132 times, never
// asked, with the hold for the torch's rest sleeping five seconds at a time,
// "detours: none".
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { Task } = require('../src/skills');
const registry = require('minecraft-data')('26.1');
const { setAside } = require('../src/progress');
const tried = require('../src/tried');

const HERE = new Vec3(-111.5, 41, -237.4);
const DETOURS = ['differently', 'work_free', 'until_rest_ends', 'hoglin_food', 'return_for_food', 'mine_nearby', 'look_around', 'again', 'keep_on', ...[1, 2, 3, 4, 5, 6].map(n => `recover_${n}`)];
function recorded({ kind = 'win' } = {}) {
  const items = [{ name: 'iron_sword', count: 1 }, { name: 'netherrack', count: 20 }];
  const bot = { registry, game: { dimension: 'the_nether', gameMode: 'survival', difficulty: 'normal' }, health: 7.6, food: 12, isAlive: true, chat() {}, emit() {},
    entity: { id: 1, position: HERE.clone(), onGround: true }, time: { timeOfDay: 0 }, entities: {},
    inventory: { items: () => items, slots: [] }, findBlocks: () => [], clearControlStates() {}, setControlState() {},
    blockAt: p => ({ position: p, name: p.y < 41 ? 'netherrack' : 'air', boundingBox: p.y < 41 ? 'block' : 'empty' }),
    pathfinder: { movements: { blocksCantBreak: new Set() }, setGoal() {}, getPathTo: () => ({ status: 'noPath', path: [] }) } };
  const goal = kind === 'win'
    ? { kind: 'win', request: 'beat the game', from: 'TestPlayer', survival: {}, rungTime: { phase: 'errand' }, errand: { dimension: 'overworld', items: [{ item: 'oak_log', count: 1 }], at: Date.now(), for: 'a pickaxe' } }
    : { version: 1, kind: 'survive', request: 'Stay alive and prepare supplies between player requests', survival: {} };
  // Every detour tried twice from here in the last minutes, and each came to nothing; the trip back
  // for food (note 607, offered at a Nether stall since) among them, or it is the one way left and taken.
  for (const method of DETOURS) for (const ago of [240000, 60000]) tried.record(bot, goal, { q: 'stillness_detour', method, outcome: 'blocked', why: 'no new ground, nothing gained, no block dug or placed', now: Date.now() - ago });
  return { bot, goal };
}
async function ask(bot, goal, stall, { idle = false } = {}) {
  const { answerStall } = require('../src/work');
  const asked = [];
  const task = new Task('stall');
  const client = { model: 'jev', systemOne: async ({ state, questions }) => {
    for (const q of Object.values(questions)) asked.push({ state, options: q.criteria });
    // Recorded, then cancelled: what the answer would do is not this test's.
    task.cancel();
    const keys = Object.keys(Object.values(questions)[0].criteria || {});
    return { answers: Object.fromEntries(Object.keys(questions).map(b => [b, { choice: keys[0], confidence: 0.6 }])) };
  } };
  await answerStall(bot, task, goal, () => {}, stall, { client, idle }).catch(() => {});
  return asked;
}

test('the errand set aside and every detour resting: the stall\'s question is asked with the rests and why nothing above is asked, not escalated to a rung\'s question that is never asked (25587, note 609)', async () => {
  const { bot, goal } = recorded();
  setAside(goal, 'rung', 'errand', 'No oak log in the nether: it is only found in the overworld', 600000);
  const stall = { key: 'step:rung:errand', work: 'step:rung:errand', layer: 'work', strikes: 3, error: 'No oak log in the nether: it is only found in the overworld', until: Date.now() + 23000 };
  for (let round = 0; round < 3; round++) {
    delete bot._stalls;
    const asked = await ask(bot, goal, stall);
    assert.equal(asked.length, 1, `round ${round}: asked, not escalated round again unasked`);
    assert.match(asked[0].state.nothingAbove || '', /^The errand is set aside, and a rung set aside is not brought to its own question while it waits: nothing above this question is asked/);
    assert(asked[0].options.until_rest_ends && asked[0].options.differently, 'every way stays on offer');
    assert.match(JSON.stringify(asked[0].options.differently), /It rests .* more from here/, 'with its rest said');
    assert.notEqual(bot._stalls?.stall?.escalated?.to, 'rung_progress', 'no escalation to a question that is not asked');
  }
  assert.equal((goal.tried.escalations || []).filter(e => e.to === 'rung_progress').length, 0);
});

test('between requests every detour resting is asked with the rests said, not escalated to the rung\'s question (25586\'s idle loop, note 609)', async () => {
  const { bot, goal } = recorded({ kind: 'survive' });
  const stall = { key: 'step:detour:until_rest_ends', layer: 'work', strikes: 1, until: Date.now() + 60000 };
  const asked = await ask(bot, goal, stall, { idle: true });
  assert.equal(asked.length, 1);
  assert.match(asked[0].state.nothingAbove || '', /^Between player requests/);
  assert.notEqual(bot._stalls?.stall?.escalated?.to, 'rung_progress');
});

test('with the rung in hand and not set aside, the escalation still goes to the rung\'s question (unchanged)', async () => {
  const { bot, goal } = recorded();
  goal.rungTime.phase = 'obtain_blaze_rods';
  const stall = { key: 'step:find_fortress', work: 'step:rung:obtain_blaze_rods', layer: 'work', strikes: 2, error: 'No path to the goal!', until: Date.now() + 23000 };
  const asked = await ask(bot, goal, stall);
  assert.equal(asked.length, 0, 'not asked here: the rung\'s question is');
  assert.equal(bot._stalls?.stall?.escalated?.to, 'rung_progress');
});

test('a loop pass that spins with no survival action says so and goes on: the spin line does not throw and park the game (note 609)', async () => {
  const { runGoal } = require('../src/work');
  const bot = { registry, inventory: { items: () => [] }, game: { dimension: 'overworld', gameMode: 'survival', difficulty: 'normal' },
    entity: { id: 1, position: new Vec3(0.5, 64, 0.5), onGround: true }, health: 20, food: 20, entities: {}, time: { timeOfDay: 1000 },
    pathfinder: { movements: { blocksCantBreak: new Set(), exclusionAreasBreak: [] }, setGoal() {} }, clearControlStates() {},
    blockAt: () => ({ name: 'air', boundingBox: 'empty' }), chat() {}, emit() {} };
  const goal = { kind: 'obtain', item: 'pumpkin', count: 1, request: 'get a pumpkin', from: 'Player', survival: {} };
  assert.equal(goal.survivalAction, undefined);
  // The survival layer acts at once each pass: thirty passes well inside a second.
  const survival = { state: goal.survival, step: async () => true };
  const logged = [], log = console.log;
  console.log = (...a) => logged.push(a.join(' '));
  try {
    const result = await runGoal(bot, new Task('spin', 'spin'), goal, { save() {} }, { survival, maxSteps: 30, backoffMs: 1 });
    assert.equal(result.reason, 'Action budget reached');
  } finally { console.log = log; }
  assert(logged.some(l => /^\[loop\] spinning: 21 passes in a second at .* survival=none/.test(l)), logged.join('\n'));
});

// Note 624: mid-243-bc had no pickaxe and stood by nether quartz in the wall
// of the lava sea; the stall offered "Dig the nether quartz ore", dig() said
// "Missing harvest tool", and the way rested five minutes for nothing.
test('the stall offers ore to dig only where a tool carried can harvest it (mid-243-bc, note 624)', async () => {
  const { breakStillness } = require('../src/work');
  const ORE = new Vec3(-79, 34, 370);
  const quartz = registry.blocksByName.nether_quartz_ore;
  const offered = async items => {
    const bot = { registry, game: { dimension: 'the_nether', gameMode: 'survival', difficulty: 'normal' }, health: 20, food: 17, isAlive: true, chat() {}, emit() {},
      entity: { id: 1, position: new Vec3(-77.5, 33, 365.1), onGround: true }, time: { timeOfDay: 0 }, entities: {},
      inventory: { items: () => items, slots: [] }, findBlocks: ({ matching }) => (matching.includes(quartz.id) ? [ORE] : []), clearControlStates() {}, setControlState() {},
      blockAt: p => p.equals(ORE) ? { position: p, name: 'nether_quartz_ore', boundingBox: 'block', harvestTools: { [registry.itemsByName.iron_pickaxe.id]: true, [registry.itemsByName.stone_pickaxe.id]: true, [registry.itemsByName.wooden_pickaxe.id]: true } }
        : { position: p, name: p.y < 33 ? 'netherrack' : 'air', boundingBox: p.y < 33 ? 'block' : 'empty' },
      pathfinder: { movements: { blocksCantBreak: new Set() }, setGoal() {}, getPathTo: () => ({ status: 'noPath', path: [] }) } };
    const goal = { version: 1, kind: 'survive', request: 'Stay alive', survival: {} };
    const task = new Task('stall'), lines = [];
    // With one way offered it is taken without asking: the log's line says what was on offer.
    const client = { model: 'jev', systemOne: async () => { task.cancel(); throw new Error('cancelled'); } };
    const log = console.log; console.log = (...a) => lines.push(a.join(' '));
    try { await breakStillness(bot, task, goal, () => {}, { client, reason: 'step:rung:obtain_blaze_rods' }); } catch (_) { /* the way taken has no ore to dig in this mock */ } finally { console.log = log; }
    return (lines.find(l => l.startsWith('[still]'))?.match(/detours: (.*)$/)?.[1] || '').split(', ');
  };
  assert(!(await offered([{ name: 'iron_sword', count: 1, type: registry.itemsByName.iron_sword.id }])).includes('mine_nearby'), 'no pickaxe: the quartz is not on offer');
  assert((await offered([{ name: 'stone_pickaxe', count: 1, type: registry.itemsByName.stone_pickaxe.id }])).includes('mine_nearby'), 'a stone pickaxe harvests it');
});

test('the idle loop is paced: an escalation thrown and caught every pass does not go round with no pause (25586, note 609)', async () => {
  const { runIdle } = require('../src/work');
  const { bot } = recorded({ kind: 'survive' });
  const idle = { version: 1, kind: 'survive', request: 'Stay alive', survival: {} };
  let calls = 0;
  const survival = { state: idle.survival, step: async () => { calls++; throw Object.assign(new Error('stillness detour: every way it had from here rests'), { name: 'Stalled' }); } };
  const end = Date.now() + 1000;
  const log = console.log; console.log = () => {};
  try { await runIdle(bot, new Task('idle', 'idle'), idle, { save() {} }, { survival, backoffMs: 1, until: () => Date.now() > end }); }
  finally { console.log = log; }
  assert(calls <= 30, `${calls} passes in a second`);
});

test('a hold for a rest with nothing on offer says what it waits for and until when, once, and keeps it on the step (25586\'s torch, note 609)', async () => {
  const { holdForRest } = require('../src/work');
  const { bot } = recorded({ kind: 'survive' });
  const goal = { version: 1, kind: 'survive', request: 'Stay alive', survival: {}, step: { action: 'detour', choice: 'until_rest_ends', from: 'step:torch' } };
  const logged = [], log = console.log;
  console.log = (...a) => logged.push(a.join(' '));
  const until = Date.now() + 600;
  try { await holdForRest(bot, new Task('hold', 'hold'), goal, () => {}, { reason: 'step:torch', until, why: 'Tried 2 times from here in the last 3 minutes, and it came to nothing' }); }
  finally { console.log = log; }
  const waits = logged.filter(l => l.startsWith('[wait]'));
  assert.equal(waits.length, 1, logged.join('\n'));
  assert.match(waits[0], /^\[wait\] waiting for the torch's rest to end, 1 seconds more \(at \d\d:\d\d:\d\dZ\), set for: Tried 2 times .*; nothing else is on offer from here meanwhile$/);
  assert.match(goal.step.waitingFor, /^the torch's rest to end/);
});
