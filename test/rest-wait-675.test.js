'use strict';
// Waiting out a rest (note 675): the wasted-minutes ledger's largest waste
// pattern before the first blaze fight (note 667), 12.4 bot-hours in the
// 'obtain blaze rods: detour' and 'obtain ender pearls: detour' steps. The
// hold for a rest (work.js holdForRest) asked for "other work" from a
// catalog that, in the Nether, had almost nothing, and stood still in
// five-second sleeps. From the windows' flight records
// (test/fixtures/rest-wait-675.json):
//   25598 mid-242-bb-nether-1-fortress-9, 00:26:05Z: an iron pickaxe, no
//     block carried, every leg of the fortress search "out of blocks (0
//     carried)"; rung_progress offered "other work ... chosen here a piece at
//     a time" (none good 0.40, until_rest_ends 0.35) and the hold had nothing
//     to offer: 45 seconds of standing, over and over.
//   25583 mid-243-cg, 02:58:53Z: 1.8 health, no pickaxe and no wood, on
//     blackstone in the lava of a basalt delta.
//   25585 mid-242-ca-nether-1, 01:32:27Z: leave_nether's wait_here, "other
//     work in the Nether ... what the work is, is asked then" (0.87), and
//     twenty minutes stood on a span with nothing on offer.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { Task } = require('../src/skills');
const registry = require('minecraft-data')('26.1');
const { observeProgress, leaveNetherStep } = require('../src/game-progress');
const fx = require('./fixtures/rest-wait-675.json');

const win = trial => fx.windows.find(w => w.trial === trial);
function recorded(w, { extra = {} } = {}) {
  const inv = { ...w.inventory, ...extra };
  const items = Object.entries(inv).map(([name, count], slot) => ({ name, count, type: registry.itemsByName[name]?.id ?? 0, slot: 9 + slot, durabilityUsed: 0 }));
  const here = new Vec3(w.position.x, w.position.y, w.position.z);
  const floorY = Math.floor(here.y);
  const bot = { registry, game: { dimension: 'the_nether', gameMode: 'survival', difficulty: 'normal' }, health: w.health, food: w.food, isAlive: true, chat() {}, emit() {},
    entity: { id: 1, position: here.clone(), onGround: true }, time: { timeOfDay: 6000 }, entities: {},
    inventory: { items: () => items, slots: [] }, findBlocks: () => [], clearControlStates() {},
    blockAt: p => ({ position: p, name: p.y < floorY ? 'netherrack' : 'air', boundingBox: p.y < floorY ? 'block' : 'empty' }),
    pathfinder: { movements: { blocksCantBreak: new Set() }, setGoal() {}, getPathTo: () => ({ status: 'noPath', path: [] }) } };
  const goal = { kind: 'win', request: 'beat the game', from: 'TestPlayer', survival: {}, rungTime: { phase: 'obtain_blaze_rods' },
    portals: [{ x: 2, y: 70, z: 7, dimension: 'nether' }] };
  observeProgress(bot, goal);
  return { bot, goal };
}
// The rung's question with every way of fortress_leg resting until `until`
// (an escalation), as the windows had it.
async function rungQuestion(bot, goal, until, pick = 'until_rest_ends', { holdClient = null } = {}) {
  const { answerStall } = require('../src/work');
  const asked = [];
  const client = { model: 'jev', systemOne: async ({ state, questions }) => {
    const answers = {};
    for (const [b, q] of Object.entries(questions)) {
      const keys = Object.keys(q.criteria || {});
      asked.push({ state, options: q.criteria });
      if (asked.length > 1 && holdClient) return holdClient({ state, questions });
      answers[b] = { choice: keys.includes(pick) ? pick : keys[0], confidence: 0.6 };
    }
    return { answers };
  } };
  const stall = { key: 'step:rung:obtain_blaze_rods', work: 'step:rung:obtain_blaze_rods', layer: 'work', strikes: 1,
    escalated: { from: 'fortress_leg', to: 'rung_progress', says: 'fortress leg: every way it had from here rests: go to blazes about: Tried 2 times toward the same place from about here in the last 2 seconds, and it came to nothing. It rests 5 minutes more from here.' }, until };
  await answerStall(bot, new Task('stall'), goal, () => {}, stall, { client }).catch(() => {});
  return asked;
}

test('25598: every way resting, the rung\'s question says the work the hold has on offer from here, the blocks the legs ran out of among it (note 675)', async t => {
  const w = win('mid-242-bb-nether-1-fortress-9');
  const T0 = Date.parse(w.at);
  t.mock.timers.enable({ apis: ['Date'], now: T0 });
  const { bot, goal } = recorded(w);
  // Recorded: offered differently, until_rest_ends and none good; the hold had nothing.
  assert.deepEqual(w.offered, ['differently', 'until_rest_ends', 'none_good']);
  assert.match(w.untilSaid, /^Other work for the 2 minutes .* chosen here a piece at a time/);
  const asked = await rungQuestion(bot, goal, T0 + 67000, 'keep_at_it');
  const said = asked[0].options.until_rest_ends;
  assert.match(said, /^Other work for the 2 minutes until the first of the fortress leg's ways comes off its rest here, chosen a piece at a time; the obtain blaze rods stays the work in hand/);
  assert.match(said, /Work on offer meanwhile from here: .*Mine netherrack for building blocks now: 2 carried/);
  assert(said.length < 900, `short: ${said.length} characters`);
  // And the gather offered beside the wait as its own answer.
  assert.match(asked[0].options.block_reserve || '', /^Mine netherrack for building blocks now: 2 carried\. .* The obtain blaze rods is taken up again after it; the rest runs on meanwhile\.$/);
});

test('25598 with the blocks carried: nothing is on offer, and the wait is said as standing idle, why, and until when (note 675)', async t => {
  const w = win('mid-242-bb-nether-1-fortress-9');
  const T0 = Date.parse(w.at);
  t.mock.timers.enable({ apis: ['Date'], now: T0 });
  const { bot, goal } = recorded(w, { extra: { netherrack: 32 } });
  const asked = await rungQuestion(bot, goal, T0 + 67000, 'keep_at_it');
  assert.equal(asked[0].options.until_rest_ends,
    "Wait here for the 2 minutes until the first of the fortress leg's ways comes off its rest here. Nothing else is on offer from here meanwhile (the Nether, where the day work of the Overworld is not on offer; no ore within 16 blocks that a carried tool takes; 34 building blocks and a pickaxe carried): chosen, this is standing here idle about 2 minutes, until about 00:27Z. The obtain blaze rods stays the work in hand and is taken up again then; waiting does not end the rest sooner, and ground eight blocks off (another way) leaves these rests behind.");
});

test('25598: the hold chosen, it offers the blocks as work while the rest runs; that work run out, the hold ends and the question above is asked again, not a silent wait (note 675)', async t => {
  const w = win('mid-242-bb-nether-1-fortress-9');
  const { bot, goal } = recorded(w);
  const { holdForRest } = require('../src/work');
  const { setAside } = require('../src/progress');
  // The one way on offer is taken without asking (decide's one way): the
  // gather runs to the hold's end on this fixture's ground.
  const client = { model: 'jev', systemOne: async () => assert.fail('one way: not asked') };
  const logs = []; const log = console.log; console.log = (...a) => logs.push(a.join(' '));
  let done;
  try { done = await holdForRest(bot, new Task('hold'), goal, () => {}, { client, reason: 'step:rung:obtain_blaze_rods', until: Date.now() + 400, idle: false }); }
  finally { console.log = log; }
  assert(logs.some(l => /^\[still\] holding step:rung:obtain_blaze_rods until its rest ends; detours: block_reserve$/.test(l)), logs.join('\n'));
  assert.equal(done, true);
  // The gather set aside (gained nothing twice): nothing is left on offer.
  setAside(goal, 'block_reserve', 'gather', 'netherrack sought twice in ten minutes and none gained', 600000);
  logs.length = 0; console.log = (...a) => logs.push(a.join(' '));
  const t0 = Date.now();
  try { done = await holdForRest(bot, new Task('hold'), goal, () => {}, { client, reason: 'step:rung:obtain_blaze_rods', until: Date.now() + 3000, idle: false }); }
  finally { console.log = log; }
  assert.equal(done, false, 'ended early, not stood out');
  assert(Date.now() - t0 < 1000);
  assert(logs.some(l => /^\[wait\] the work on offer while rung:obtain blaze rods rests has run out; the question above is asked again/.test(l)), logs.join('\n'));
  assert(!logs.some(l => /^\[wait\] waiting for/.test(l)), 'no silent wait in the work\'s name');
});

test('25598: the wait chosen as idle is held to the rest\'s end, said once (note 609 kept)', async t => {
  const w = win('mid-242-bb-nether-1-fortress-9');
  const { bot, goal } = recorded(w, { extra: { netherrack: 32 } });
  const { holdForRest } = require('../src/work');
  const logs = []; const log = console.log; console.log = (...a) => logs.push(a.join(' '));
  const until = Date.now() + 600;
  let done;
  try { done = await holdForRest(bot, new Task('hold'), goal, () => {}, { client: null, reason: 'step:rung:obtain_blaze_rods', until, idle: true }); }
  finally { console.log = log; }
  assert.equal(done, true);
  assert(Date.now() >= until);
  assert.equal(logs.filter(l => /^\[wait\] waiting for the obtain blaze rods's rest to end/.test(l)).length, 1);
});

test('25583 mid-243-cg: 1.8 health, no pickaxe and no wood: the stems for one are the work said on offer, not an unnamed "other work" (note 675)', async t => {
  const w = win('mid-243-cg');
  const T0 = Date.parse(w.at);
  t.mock.timers.enable({ apis: ['Date'], now: T0 });
  const { bot, goal } = recorded(w);
  const asked = await rungQuestion(bot, goal, T0 + 4 * 60000 + 30000, 'keep_at_it');
  const said = asked[0].options.until_rest_ends;
  assert.match(said, /^Other work for the 5 minutes .* Work on offer meanwhile from here: Fetch \d+ stems of the Nether's forests now/);
  assert.doesNotMatch(said, /Mine netherrack/, 'no netherrack offered without a pickaxe to dig it');
});

test('25585 mid-242-ca-nether-1: leave_nether\'s wait_here says what the hold has on offer; with nothing, "wait here" and the idle minutes; the answer passes the idle to the hold, and a hold whose work ran out asks again (note 675)', async t => {
  const w = win('mid-242-ca-nether-1');
  const T0 = Date.parse(w.at);
  t.mock.timers.enable({ apis: ['Date'], now: T0 });
  assert.match(w.waitHereSaid, /^Other work in the Nether until the rods step's rest ends, taken up again in 27 minutes, then the rods again; what the work is, is asked then\.$/);
  const { gameHandlers } = require('../src/work');
  const stage = { phase: 'obtain_blaze_rods', action: 'rods_waiting', until: T0 + 27 * 60000 - 30000, why: 'Jev set it aside at the rung\'s question' };
  for (const [extra, idle] of [[{}, false], [{ iron_pickaxe: 1, stone_pickaxe: 1, crimson_stem: 8, netherrack: 32 }, true]]) {
    const { bot, goal } = recorded(w, { extra });
    const asked = [], holds = [];
    const client = { systemOne: async ({ questions }) => { asked.push(questions.branch_0.criteria); return { answers: { branch_0: { choice: 'wait_here', confidence: 0.87 } } }; } };
    const actions = { client, rest_work: gameHandlers(bot, client).rest_work, hold_for_rest: async (b, tk, g, sv, opts) => { holds.push(opts); return false; } };
    await leaveNetherStep(bot, new Task('rods'), goal, () => {}, stage, actions, T0);
    const said = asked[0].wait_here;
    if (idle) assert.equal(said, 'Wait here until the rods step\'s rest ends, taken up again in 27 minutes, then the rods again. Nothing else is on offer from here meanwhile (the Nether, where the day work of the Overworld is not on offer; no ore within 16 blocks that a carried tool takes; 33 building blocks and a pickaxe carried): chosen, this is standing here idle about 27 minutes, until about 01:58Z.');
    else assert.match(said, /^Other work in the Nether, chosen a piece at a time, until the rods step's rest ends, taken up again in 27 minutes, then the rods again\. Work on offer meanwhile from here: Fetch \d+ stems/);
    assert.equal(holds[0].idle, idle);
    // The hold came back early (its work run out): the answer is not kept, so the question comes again.
    assert.equal(goal.leaveNether, undefined);
  }
});
