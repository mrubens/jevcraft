'use strict';
// Note 768b: 25597 (mid-236-ab, 2026-10-01 00:41:36 to 00:43:50Z, 768 live)
// chose a staircase over straight up (0.54 against 0.41, said 45 s against
// 15) under sand at y 51 to 57: it rose 6 blocks, then walked 77 s across at
// y 57, its stairs under sand the staircase does not dig beneath; asked again
// when its pickaxes changed, nothing said what it had done, and it chose the
// staircase again (0.57); that one came back in a second, "not gaining on
// it", walked six blocks across, and was listed first a third time, judged
// changed for having moved. Straight up then took 4 seconds.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { sim } = require('./support/falling-world');

const task = { check() {} };
// The beach over 25597's climb: stone, sandstone to y 59, sand to y 63, open over it.
const ground = y => (y <= 56 ? 'stone' : y <= 59 ? 'sandstone' : y <= 63 ? 'sand' : 'air');
const POCKETS = [['cobblestone', 300], ['dirt', 85], ['coal', 40], ['stick', 2], ['iron_pickaxe', 1, { durabilityUsed: 1 }]];
const pocket = () => sim({ ground, feet: new Vec3(0, 57, 0), cells: { '0,57,0': 'air', '0,58,0': 'air' }, items: POCKETS });

test('25597: a staircase under sand says it does not dig there, with the record, and is not the quicker by its figure', () => {
  const { straightUpColumn, climbOptions } = require('../src/surface');
  const { bot } = pocket();
  const feet = bot.entity.position.floored();
  const target = new Vec3(0, 64, 1);
  const { options } = climbOptions(bot, target, straightUpColumn(bot, feet, { throughFalls: true }), { landing: true });
  assert(options.staircase.underFalls > 0, `${options.staircase.underFalls}`);
  assert.match(options.staircase.description, /were they dug as planned.*the staircase does not dig a stair under falling blocks \(dug out, they come down on the head\): it goes round at its own height instead/);
  assert.match(options.staircase.description, /114 staircases with a pickaxe chosen with sand or gravel on their way took 5\.8 seconds a block risen, 16 of them rising nothing; 570 others took 4\.8; 319 climbs straight up with a pickaxe took 1\.9/);
  assert.equal(options.straight_up.drain, 'torch');
  // The trip's quote leads with straight up; the staircase is said beside it.
  const { tripCost } = require('../src/surface');
  const trip = tripCost(bot, {});
  assert.equal(trip.way, 'straight_up');
  assert.match(trip.says, /Or a staircase/);
});

test('a climb is judged by its height: moved across and carrying more, it rose nothing and is recorded failed', () => {
  const outcome = require('../src/decisions/outcome');
  const { bot, inv } = pocket();
  const goal = {};
  const spec = { id: 'climb_out', options: [] };
  const node = { quote: { kind: 'staircase/pickaxe', seconds: 26, rise: 7, uses: 26 }, description: 'about 40 seconds' };
  outcome.begin(bot, goal, spec, ['staircase'], node, { now: 1_000_000 });
  bot.entity.position = new Vec3(6.5, 57, 0.5);
  inv.push({ name: 'sand', count: 4, type: 0 });
  const j = outcome.judge(bot, goal, 'climb_out', { asked: true, now: 1_025_000 });
  assert(j?.failed, JSON.stringify(j));
  assert.match(j.failed.says, /staircase was chosen 25 seconds ago and changed nothing within 25 seconds \(its own time 90 seconds\): it rose nothing: 6 blocks across at y 57, 7 blocks short of open sky as it was said/);
  // Under fifteen seconds a run that moved is not judged by its height yet.
  outcome.begin(bot, goal, spec, ['staircase'], node, { now: 2_000_000 });
  bot.entity.position = new Vec3(0.5, 57, 0.5);
  assert.ok(outcome.judge(bot, goal, 'climb_out', { asked: true, now: 2_010_000 })?.changed);
  // A climb that rose is changed.
  outcome.begin(bot, goal, spec, ['staircase'], node, { now: 3_000_000 });
  bot.entity.position = new Vec3(1.5, 59, 0.5);
  assert.ok(outcome.judge(bot, goal, 'climb_out', { asked: true, now: 3_030_000 })?.changed);
});

test('a way held that has not risen in a minute is asked again, with what it did', async () => {
  const decisions = require('../src/decisions');
  const { chooseClimb } = require('../src/surface');
  const { bot } = pocket();
  const asked = [];
  const real = decisions.decide;
  decisions.decide = async (id, { state }) => { asked.push({ id, state }); return { path: ['straight_up'] }; };
  try {
    const now = Date.now(), at = new Date(now - 85000).toISOString();
    const held = best => ({ climb: { method: 'staircase', tools: 'iron_pickaxe', offered: ['staircase', 'straight_up'], estimate: 45, fromY: 51, at, best } });
    // Rose to y 57 twenty seconds ago: kept, nothing asked.
    let state = held({ y: 57, at: now - 20000 });
    let r = await chooseClimb(bot, task, {}, () => {}, state, new Vec3(0, 64, 1), { landing: true });
    assert.equal(r.method, 'staircase'); assert.equal(asked.length, 0);
    // The same height for 77 seconds: asked, and said.
    state = held({ y: 57, at: now - 77000 });
    r = await chooseClimb(bot, task, { intention: { q: 'climb_out' } }, () => {}, state, new Vec3(0, 64, 1), { landing: true });
    assert.equal(asked.length, 1);
    assert.match(asked[0].state.climbSoFar, /^the staircase chosen 85 seconds ago, said then as 45 seconds, has risen 6 blocks since, none in the last 77 seconds \(best y 57\)$/);
    assert.equal(r.method, 'straight_up');
  } finally { decisions.decide = real; }
});

test('the record is one basis for every way: every second of every run against the quote for the blocks it rose', () => {
  const { PRIOR, ratioOf, record } = require('../src/quote-record');
  assert.deepEqual([PRIOR['staircase/pickaxe'].seconds, PRIOR['straight_up/pickaxe'].seconds], [1.61, 1.18]);
  const goal = {};
  // Two runs that rose 10 in twice their time and one that rose nothing in 60 s.
  for (const [rise, now] of [[10, 50000], [10, 50000], [0, 60000]]) record(goal, { at: 0, mark: { p: { x: 0, y: 0, z: 0 } }, quote: { kind: 'staircase/pickaxe', seconds: 25, rise: 10 } }, { p: { x: 0, y: rise, z: 0 } }, { now });
  const r = ratioOf(goal, 'staircase/pickaxe');
  assert.equal(r.own, true);
  assert.equal(r.seconds, 3, '160 s taken against 50 given: 3.2, at the clamp');
});
