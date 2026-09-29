'use strict';
// Note 603: two steps trading the turn, and two answers undoing each other,
// caught as the one failure they are, on the recorded states of the cohort
// started at 11:32Z.
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { Vec3 } = require('vec3');

// A bot whose digs and placements the stall watch counts (stillness.js
// watchStalls): diggingCompleted events and the placeBlock it wraps.
function watchedBot(at) {
  const bot = new EventEmitter();
  Object.assign(bot, { entity: { position: at.clone() }, inventory: { items: () => [] }, game: { gameMode: 'survival', dimension: 'the_nether' }, placeBlock: async () => {} });
  const stillness = require('../src/stillness');
  stillness.watchStalls(bot, () => null);
  return { bot, stop: () => stillness.unwatchStalls(bot) };
}
const place = (bot, cell) => bot.placeBlock({ position: cell.offset(0, -1, 0) }, new Vec3(0, 1, 0));
const dig = (bot, cell) => bot.emit('diggingCompleted', { position: cell });

test('a block put in a cell and dug out of it again is nothing done: the pair of moves that undo each other rest', async () => {
  // mid-243-af-fortress-1 (25589), 11:43:40 to 11:43:50: working free, place_north put a gravel at the feet north and
  // dig_north_feet dug it out, six times each, every answer "a block was dug or placed" and so getting somewhere in the
  // ledger; neither rested and nothing was asked above them until the trial was stopped.
  const tried = require('../src/tried');
  const here = new Vec3(-229.5, 53, -224.7), north = new Vec3(-230, 53, -226);
  const { bot, stop } = watchedBot(here);
  try {
    const goal = {};
    const outcomes = [];
    let t = Date.now();
    const answer = async (method, act) => {
      tried.settle(bot, goal, { q: 'unstuck_move', now: t });
      tried.begin(bot, goal, { q: 'unstuck_move', method, now: t });
      await act();
      t += 600;
    };
    for (let i = 0; i < 4; i++) {
      await answer('place_north', () => place(bot, north));
      await answer('dig_north_feet', () => dig(bot, north));
    }
    tried.settle(bot, goal, { q: 'unstuck_move', now: t });
    for (const e of goal.tried.entries) outcomes.push(`${e.method}:${e.outcome}`);
    assert.equal(outcomes[0], 'place_north:progressed', 'the first gravel put down is something done');
    assert.deepEqual(outcomes.slice(1), ['dig_north_feet:blocked', 'place_north:blocked', 'dig_north_feet:blocked', 'place_north:blocked', 'dig_north_feet:blocked', 'place_north:blocked', 'dig_north_feet:blocked']);
    const tree = { place_north: { description: 'Put a gravel into the space north, at the feet: a step up.' }, dig_north_feet: { description: 'Dig the gravel north, at feet height.' }, dig_down: { description: 'Dig underfoot.' } };
    const read = tried.read(bot, goal, 'unstuck_move', tree, { now: t });
    assert.deepEqual(Object.keys(read.tree), ['dig_down'], 'both rest, the way left offered');
    // A new cell is still something done.
    tried.begin(bot, goal, { q: 'unstuck_move', method: 'place_west', now: t });
    await place(bot, new Vec3(-231, 53, -225));
    tried.settle(bot, goal, { q: 'unstuck_move', now: t + 600 });
    assert.equal(goal.tried.entries.at(-1).outcome, 'progressed');
  } finally { stop(); }
});

// The work's names as they came, a second apart, from one spot.
function flips(bot, goal, names, { t0 = 5_000_000, gap = 2500, between = () => {} } = {}) {
  const { flipWatch } = require('../src/stillness');
  let t = t0, raised = null;
  for (const n of names) { t += gap; if (typeof n === 'function') n(goal); else goal.step = { action: n }; between(t); raised = flipWatch(bot, goal, t) || raised; }
  return raised;
}

test('a staircase digging a new step under the rung\'s own step is getting somewhere, not two steps trading the turn', () => {
  // mid-244-bd (25581), 11:54:04 to 11:54:19 and 12:13:34 to 12:15:05: the staircase to its frame dug a step every few
  // seconds, the ladder naming enter_nether and the staircase tunnel in turn, and it was raised three times as "turning
  // between enter nether and tunnel", each answered with a detour that dropped the shaft.
  const { bot, stop } = watchedBot(new Vec3(82, 43, 121));
  try {
    const goal = { kind: 'win', rungTime: { phase: 'reach_nether' } };
    const cells = [[81, 44, 121], [80, 45, 124], [79, 46, 124], [78, 47, 124], [77, 48, 124]].map(c => new Vec3(...c));
    let i = 0;
    // On the game's ladder the rung's measure judges it (note 699): the staircase's tunnel toward the frame at
    // (70, 60, 124) coming nearer a step at a time is getting somewhere; the blocks dug are the means.
    const frame = new Vec3(70, 60, 124);
    const raised = flips(bot, goal, ['enter_nether', 'tunnel', 'enter_nether', 'tunnel', 'enter_nether'], { between: () => {
      if (goal.step.action !== 'tunnel') return;
      goal.step.target = frame; dig(bot, cells[i]); bot.entity.position = cells[i++].offset(0.5, 0, 0.5);
    } });
    assert.equal(raised, null, raised?.why);
    // Blocks dug with nothing coming nearer are the flip, said with what did not change.
    const dug = watchedBot(new Vec3(82, 43, 121));
    try {
      let j = 0;
      const again = flips(dug.bot, { kind: 'win', rungTime: { phase: 'reach_nether' } }, ['enter_nether', 'tunnel', 'enter_nether', 'tunnel', 'enter_nether'], { between: () => { dig(dug.bot, cells[j++ % cells.length]); } });
      assert.match(again?.why || '', /turning between enter nether and tunnel 4 times in 10 seconds with nothing gained on the rung: no obsidian or flint and steel/);
    } finally { dug.stop(); }
    // The same names with nothing dug are the flip they always were.
    const still = watchedBot(new Vec3(82, 43, 121));
    try { assert.match(flips(still.bot, { kind: 'win', rungTime: { phase: 'reach_nether' } }, ['enter_nether', 'tunnel', 'enter_nether', 'tunnel', 'enter_nether'])?.why || '', /turning between enter nether and tunnel/); }
    finally { still.stop(); }
  } finally { stop(); }
});

test('a step and its own persist are one step failing, not a flip; the work\'s flip is keyed to the work, not a stance a few seconds old', () => {
  // mid-243-af-nether-3-fortress-1 (25591), 12:05:24: the search for a crimson stem failed at once and went to persist
  // fifteen times in eighty seconds, raised besides as "turning between mine and persist" and struck against
  // survival:food_hunt_chosen. mid-242-ae-nether-3-fortress-3 (25584), 12:04:35: the legs and their crossings, each
  // ending at once, struck as survival:keep_working, the stance answered three seconds before.
  const { bot, stop } = watchedBot(new Vec3(-135, 74, -130));
  try {
    const mine = { action: 'mine', block: 'crimson_stem', drops: 'crimson_stem', count: 1 };
    const goal = { kind: 'win', rungTime: { phase: 'errand' } };
    const raised = flips(bot, goal, [g => { g.step = mine; }, g => { g.lastStruggleStep = mine; g.step = { action: 'persist', attempt: 1 }; }, g => { g.step = mine; },
      g => { g.step = { action: 'persist', attempt: 2 }; }, g => { g.step = mine; }], { gap: 400 });
    assert.equal(raised, null, raised?.why);
  } finally { stop(); }
  const other = watchedBot(new Vec3(-79, 40, 89));
  try {
    const goal = { kind: 'win', rungTime: { phase: 'obtain_blaze_rods' } };
    const raised = flips(other.bot, goal, ['find_fortress', 'cross_toward', 'find_fortress', 'cross_toward', 'find_fortress'],
      { gap: 400, between: t => { goal.survivalAction = { action: 'keep_working', at: new Date(t - 1000).toISOString() }; } });
    assert.match(raised?.why || '', /turning between find fortress and cross toward/);
    assert.equal(raised.key, 'step:rung:obtain_blaze_rods', 'struck against the rung, not the stance');
    assert.equal(require('../src/stillness').flipped(goal, 'survival:keep_working'), false);
  } finally { other.stop(); }
});

test('an answer undone at once by the work under it is marked come to nothing, and rests at the second: search_on and the rung set aside', () => {
  // mid-242-ae-nether-3-fortress-3 (25584), 12:07:08 to 12:07:09: rung_progress set the rods aside, leave_nether's
  // search_on took them up again a second later, the fortress legs' every way rested and escalated to the rung, and round
  // again, four times in a second, "turning between find fortress and rods waiting"; search_on was offered each time
  // as untried, and chosen at 0.58 and 0.38.
  const tried = require('../src/tried');
  const { netherLeaveHeld } = require('../src/game-progress');
  const { bot, stop } = watchedBot(new Vec3(-79, 64, 95));
  try {
    const goal = { kind: 'win', rungTime: { phase: 'obtain_blaze_rods' } };
    const tree = { go_back: { description: 'Go back to the Overworld while the rods wait.' }, search_on: { description: 'Take the rods step up again now, its rest lifted.' }, wait_here: { description: 'Other work in the Nether until the rest ends.' } };
    let t0 = Date.now() - 60000;
    for (let round = 1; round <= 2; round++) {
      // Asked by the ladder's rods_waiting stage (game-progress.js leaveNetherStep).
      goal.step = { action: 'rods_waiting', phase: 'obtain_blaze_rods' };
      tried.settle(bot, goal, { q: 'leave_nether', now: t0 });
      tried.begin(bot, goal, { q: 'leave_nether', method: 'search_on', now: t0 });
      const raised = flips(bot, goal, ['rods_waiting', 'find_fortress', 'rods_waiting', 'find_fortress', 'rods_waiting'], { t0, gap: 250 });
      // The second round is the pair trading again where it rests (note 699): raised at the first trade.
      assert.match(raised?.why || '', round === 1 ? /turning between rods waiting and find fortress 4 times/ : /turning between find fortress and rods waiting again within 5 blocks of where they rested together, 5 times in all here/, `round ${round}`);
      require('../src/stillness').takeStall(bot);
      t0 += 20000;
    }
    const search = goal.tried.entries.filter(e => e.q === 'leave_nether');
    assert.deepEqual(search.map(e => e.outcome), ['blocked', 'blocked']);
    assert.match(search[0].why, /the work was turning between rods waiting and find fortress/);
    assert(tried.owed(goal, 'leave_nether'), 'owed to leave_nether, said when it is next asked');
    const read = tried.read(bot, goal, 'leave_nether', tree);
    assert.deepEqual(Object.keys(read.tree).sort(), ['go_back', 'wait_here'], 'search_on rests');
    assert.match(read.resting[0], /^search on: Tried 2 times from here .* came to nothing: the work was turning between find fortress and rods waiting again/);
    // A go_back held for food is asked again once the way back fails below it (25589 and 25592's staircase back).
    goal.leaveNether = { reason: 'food', pick: 'go_back', at: Date.now() - 1000, until: 0 };
    assert.equal(netherLeaveHeld(goal, 'food'), false, 'owed: asked again, not held');
    tried.escalationsFor(goal, 'leave_nether');
    assert.equal(netherLeaveHeld(goal, 'food'), true, 'said, the hold stands again');
  } finally { stop(); }
});
