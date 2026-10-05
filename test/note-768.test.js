'use strict';
// Note 768: climbing out through blocks that fall, a climb's quote against
// what it took, and the sky's height read the one way before and during.
// 25590 (mid-239-ai, 2026-09-30 20:04 to 20:14Z) under seven blocks of sand
// at y 56 with no pickaxe, 1 torch, 189 coal, 1 stick, 18 dirt and 128
// cobblestone: straight_up was never offered ("sand in it would fall on the
// head"), and an unstuck dig_up at 20:24:00Z brought five sand into its
// cells, 8 health "in wall". 25581 (mid-243-au, 23:38:01Z) was quoted a
// climb straight up for 72 uses and climbed the staircase it held, 106
// uses for 35 blocks.
// The physics here is the game's for falling blocks, simulated: a block
// that falls, with no block under it, comes down its column to the first
// block that holds it and lands in the cell over it; a body's cells do not
// hold it; a torch in the cell it lands in breaks it into an item.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');

const { sim } = require('./support/falling-world');

const task = { check() {} };
const digAction = async (bot, t, p) => { await bot.dig(bot.blockAt(p)); };

// 25590's column: sandstone over the head, five sand over that, open sky.
function column25590(opts = {}) {
  const cells = { '0,57,0': 'air', '0,58,0': 'sandstone' };
  for (let y = 59; y <= 63; y++) cells[`0,${y},0`] = 'sand';
  return sim({ cells, ...opts });
}
const POCKETS = [['cobblestone', 128], ['dirt', 18], ['coal', 189], ['stick', 1], ['torch', 1]];

test('25590: straight up through the sand is offered, drained with the torch, priced by each block\'s own time', () => {
  const { straightUpColumn, climbOptions } = require('../src/surface');
  const { bot } = column25590({ items: POCKETS });
  const feet = bot.entity.position.floored();
  assert.match(straightUpColumn(bot, feet).blocked, /sand in it would fall on the head/, 'the column as the pillar reads it');
  const column = straightUpColumn(bot, feet, { throughFalls: true });
  assert.equal(column.up, 8); assert.equal(column.falls, 5);
  const { options, estimate } = climbOptions(bot, feet.offset(0, 8, 0), column);
  assert(options.straight_up, `offered: ${Object.keys(options)}`);
  assert.equal(options.straight_up.drain, 'torch');
  assert.match(options.straight_up.description, /5 blocks of sand in it come down once the block holding them is dug, through the body's cells onto its floor: a torch goes on the floor at the feet first \(1 torch carried\)/);
  // By hand: the sandstone holding the run 4 s, the run's fall, the torch
  // put down, a second a block risen; the sand is never dug.
  const own = 4 + 0.7 + 5 * 0.1 + 1.5 + 8;
  assert.equal(options.straight_up.quote.seconds, Math.round(own));
  assert(Math.abs(estimate.straight_up - own * 1.2) < 0.01, `${estimate.straight_up} against ${own} times the record's 1.2`);
  assert(estimate.straight_up < estimate.staircase, JSON.stringify(estimate));
  // The staircase does not dig a stair under falling blocks (note 768b): said, with the record.
  assert.match(options.staircase.description, /were they dug as planned.* But 1 of these stairs has sand or gravel over the head, and the staircase does not dig a stair under falling blocks .*it goes round at its own height instead, so the time is not what it digs\. The record: 114 staircases/);
  assert.equal(options.staircase.underFalls, 1);
});

test('the dig guard: a dig that brings falling blocks into the body\'s cells is refused, with a torch at the feet it is not', async () => {
  const { digGuardPlugin } = require('../src/skills');
  const { digExposes, atOf } = require('../src/terrain');
  const { bot, log, set } = column25590({ items: POCKETS });
  const pos = bot.entity.position, over = new Vec3(0, 58, 0);
  assert.match(digExposes(atOf(bot), pos, over), /^5 blocks of sand over \(0, 58, 0\) would come down through the body onto its floor, into the feet and head cells: buried, it suffocates/);
  digGuardPlugin(bot);
  await assert.rejects(bot.dig(bot.blockAt(over)), /Not dug: the sandstone at \(0, 58, 0\): 5 blocks of sand/);
  assert.equal(log.buried, 0);
  // The column beside, dug at head height: nothing comes into the body.
  assert.equal(digExposes(atOf(bot), pos, new Vec3(1, 57, 0)), null);
  set(new Vec3(0, 56, 0), 'torch');
  assert.equal(digExposes(atOf(bot), pos, over), null, 'the torch breaks what comes down');
});

test('physics: the torch drain empties the column standing still, nothing lands in the body, and the pillar then climbs to open sky', async () => {
  const { climbStraightUp, straightUpColumn, surfaceReturnComplete } = require('../src/surface');
  const { digGuardPlugin } = require('../src/skills');
  const { bot, log, nameAt } = column25590({ items: POCKETS });
  digGuardPlugin(bot);
  const goal = { step: {} }, state = { climb: { method: 'straight_up' } }, save = () => {};
  const start = bot.entity.position.floored();
  const column = straightUpColumn(bot, start, { throughFalls: true });
  let pillared = 0;
  const pillar = async (b, t, targetY) => {
    // Up a block at a time, a block put under the feet, as pillarUp does:
    // it digs nothing that falls (climbStop), so only open cells rise here.
    while (b.entity.position.y < targetY - 0.5) {
      const f = b.entity.position.floored();
      if (b.blockAt(f.offset(0, 2, 0)).boundingBox === 'block') break;
      b.entity.position = b.entity.position.offset(0, 1, 0); pillared++;
    }
  };
  await climbStraightUp(bot, task, goal, save, state, column, start, { dig: digAction, pillar });
  assert.equal(goal.step.drain, 'torch');
  assert.equal(log.buried, 0, 'nothing landed in the body');
  assert.equal(log.broken, 5, 'each sand broke on the torch');
  // The whole run comes down when the sandstone holding it goes, onto the torch.
  assert.deepEqual(log.digs.map(d => d.name), ['sandstone', 'torch'], 'the sandstone, then the torch taken up');
  for (let y = 57; y <= 63; y++) assert.equal(nameAt(new Vec3(0, y, 0)), 'air', `open at y ${y}`);
  assert.equal(nameAt(start), 'air', 'the torch taken up, the cell free for the block under the feet');
  // The next call climbs.
  await climbStraightUp(bot, task, goal, save, state, straightUpColumn(bot, start, { throughFalls: true }) || { top: 64 }, start, { dig: digAction, pillar });
  assert(pillared >= 7, `rose ${pillared}`);
  assert(surfaceReturnComplete(bot, {}), 'under open sky');
});

test('physics: with no torch to be had, the column beside is drained at head height and stepped into', async () => {
  const { drainPlan, drainOverhead } = require('../src/fall-column');
  const { digGuardPlugin } = require('../src/skills');
  // A pocket at y 56 under sand; the column east is sandstone at the feet and sand from the head up.
  const cells = { '0,57,0': 'air', '0,58,0': 'sand', '0,59,0': 'sand', '1,56,0': 'sandstone' };
  for (let y = 57; y <= 63; y++) cells[`1,${y},0`] = 'sand';
  const { bot, log, nameAt } = sim({ cells, items: [['dirt', 18], ['cobblestone', 64]] });
  digGuardPlugin(bot);
  const feet = bot.entity.position.floored();
  const plan = drainPlan(bot, feet, { up: 8, top: 63, canDig: () => true, digSeconds: () => 0.75 });
  assert.equal(plan.mode, 'side');
  assert.deepEqual(plan.side.dir, new Vec3(1, 0, 0));
  const navigate = async (b, t, goalBlock) => { b.entity.position = new Vec3(goalBlock.x + 0.5, goalBlock.y, goalBlock.z + 0.5); };
  const done = await drainOverhead(bot, task, plan, { dig: digAction, navigate });
  assert.equal(log.buried, 0);
  assert.equal(done.stepped, true);
  assert.equal(log.digs.filter(d => d.at === '1,57,0').length, 7, 'the cell beside the head dug seven times, a sand each');
  for (let y = 56; y <= 63; y++) assert.equal(nameAt(new Vec3(1, y, 0)), 'air');
  assert.equal(nameAt(new Vec3(0, 58, 0)), 'sand', 'its own column untouched');
});

test('neither a torch nor a column beside: not offered, and said why', () => {
  const { straightUpColumn, climbOptions } = require('../src/surface');
  // Bedrock round the pocket: no column beside to dig from, and no coal or torch.
  const cells = { '0,57,0': 'air' };
  for (let y = 58; y <= 63; y++) cells[`0,${y},0`] = 'sand';
  for (const [x, z] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { cells[`${x},56,${z}`] = 'bedrock'; cells[`${x},57,${z}`] = 'bedrock'; }
  const { bot } = sim({ cells, items: [['dirt', 18]] });
  const feet = bot.entity.position.floored();
  const column = straightUpColumn(bot, feet, { throughFalls: true });
  const { options, state } = climbOptions(bot, feet.offset(0, 8, 0), column);
  assert(!options.straight_up);
  assert.match(String(state.straightUpBlocked), /^sand in it would fall on the head, no torch carried or makeable to break it, and no column beside to dig from the side$/);
});

test('25581: the trip is quoted by the way held, with the stairs\' own digs and where they come out', () => {
  const { tripCost, straightUpColumn, climbOptions } = require('../src/surface');
  // Stone to y 99 over the start (a hill), the ground at y 70 fifteen blocks east.
  const ground = (y, p) => (p && p.x >= 6 ? (y <= 69 ? 'stone' : 'air') : (y <= 99 ? 'stone' : 'air'));
  const cells = { '0,27,0': 'air', '0,28,0': 'air' };
  const pick = ['iron_pickaxe', 1, { durabilityUsed: 250 - 153 }];
  const { bot } = sim({ cells, ground, feet: new Vec3(0, 27, 0), items: [['cobblestone', 200], pick] });
  const feet = bot.entity.position.floored();
  const fresh = tripCost(bot, {});
  assert.equal(fresh.way, 'straight_up', 'the quicker, with nothing held');
  assert.match(fresh.says, /Or a staircase, the stairs coming out 41 up, about \d+ (seconds|minutes), wearing about 123: which way is asked when the climb begins\./);
  assert.equal(fresh.quote, null, 'no way held: the climb_out answer carries its own quote');
  const { options } = climbOptions(bot, feet.offset(0, 73, 0), straightUpColumn(bot, feet, { throughFalls: true }));
  const goal = { surfaceReturn: { climb: { method: 'staircase', tools: 'iron_pickaxe', offered: Object.keys(options), at: new Date(Date.now() - 70000).toISOString() } } };
  const held = tripCost(bot, goal);
  assert.equal(held.way, 'staircase');
  assert.equal(held.quote.kind, 'staircase/pickaxe');
  assert.doesNotMatch(held.says, /which way is asked/);
  assert.match(held.says, /a staircase \(the way chosen 1 minute ago and kept/);
  assert(held.digs > 72, `the stairs' own digs: ${held.digs}`);
  // As 25581's staircase did: 35 blocks for 106 uses, three a block.
  assert.match(held.says, /It wears 123 of the 153 uses/);
  assert(held.up < 73, `the stairs come out where the ground is open (${held.up} up), not under the hill over the start`);
  assert.match(held.says, new RegExp(`^${held.up} blocks up to open sky, the stairs coming out ${held.up} up \\(73 over this cell\\)`));
});

test('the quote against what it took: recorded when judged, and the next quote of its kind is its own figure times the median', () => {
  const outcome = require('../src/decisions/outcome');
  const { ratioOf, record } = require('../src/quote-record');
  const { bot, inv } = sim({ feet: new Vec3(0, 27, 0), cells: { '0,27,0': 'air', '0,28,0': 'air' }, items: [['cobblestone', 64], ['iron_pickaxe', 1, { durabilityUsed: 0 }]] });
  const goal = {};
  const spec = { id: 'climb_out', options: [] };
  // Before any of its own: the record's.
  assert.equal(ratioOf(goal, 'staircase/pickaxe').own, false);
  assert.equal(ratioOf(goal, 'staircase/pickaxe').seconds, 1.61);
  for (let i = 0; i < 3; i++) {
    const t0 = 1_000_000 + i * 1_000_000;
    bot.entity.position = new Vec3(0.5, 27, 0.5);
    outcome.begin(bot, goal, spec, ['staircase'], { quote: { kind: 'staircase/pickaxe', seconds: 25, rise: 10, uses: 25 }, description: 'about 25 seconds' }, { now: t0 });
    // Ten blocks up in 50 seconds (twice its figure), 30 uses (1.2 times).
    bot.entity.position = new Vec3(0.5, 37, 0.5);
    inv.find(x => x.name === 'iron_pickaxe').durabilityUsed += 30;
    outcome.judge(bot, goal, 'climb_out', { asked: true, now: t0 + 50000 });
  }
  assert.equal(goal.quoteRecord['staircase/pickaxe'].length, 3);
  assert.deepEqual(goal.quoteRecord['staircase/pickaxe'][0].quoted, { seconds: 25, uses: 25, rise: 10 });
  const r = ratioOf(goal, 'staircase/pickaxe');
  assert.equal(r.own, true); assert.equal(r.seconds, 2); assert.equal(r.uses, 1.2);
  // A run under ten seconds does not count; one that ran and rose nothing
  // counts its seconds with no quoted time against them.
  record(goal, { at: 0, mark: { p: { x: 0, y: 0, z: 0 } }, quote: { kind: 'straight_up/hand', seconds: 10, rise: 10 } }, { p: { x: 0, y: 1, z: 0 } }, { now: 5000 });
  assert.equal(ratioOf(goal, 'straight_up/hand').own, false);
  for (let i = 0; i < 3; i++) record(goal, { at: 0, mark: { p: { x: 0, y: 56, z: 0 } }, quote: { kind: 'staircase/hand', seconds: 35, rise: 7 } }, { p: { x: 5, y: 56, z: 0 } }, { now: 180000 });
  assert.deepEqual([ratioOf(goal, 'staircase/hand').own, ratioOf(goal, 'staircase/hand').seconds], [true, 3], '25590\'s level staircase: at the clamp');
  // The next climb's staircase: its own figure times two, said.
  const { climbOptions, straightUpColumn } = require('../src/surface');
  bot.entity.position = new Vec3(0.5, 27, 0.5);
  const feet = bot.entity.position.floored();
  const { options, estimate } = climbOptions(bot, feet.offset(0, 72, 0), straightUpColumn(bot, feet, { throughFalls: true }), { goal });
  assert(Math.abs(estimate.staircase - options.staircase.quote.seconds * 2) <= 1, `${estimate.staircase} against ${options.staircase.quote.seconds} times 2`);
  assert.match(options.staircase.description, /the time said is that times 2: the last 3 of this bot's staircases with a pickaxe took 2 times the seconds their figures gave for the blocks they rose and 1.2 times the pickaxe uses/);
});

test('the climb record reads what a question offered and what it cost', () => {
  const { saidSeconds, overheadOf } = require('../scripts/climb-record');
  assert.equal(saidSeconds('...; about 35 seconds with bare hands'), 35);
  assert.equal(saidSeconds('...; about 3 minutes with the pickaxe'), 180);
  assert.equal(overheadOf('sand in it would fall on the head'), 'falls: sand');
  assert.equal(overheadOf('water or lava in or beside it'), 'water or lava in or beside it');
  assert.equal(overheadOf('amethyst block in the way'), 'in the way: amethyst block');
});

test('25597: two sandstone under the sand in the column beside are dug from below, the sand drained where it lands, and the column stepped into (note 1287)', async () => {
  const { drainPlan, drainOverhead } = require('../src/fall-column');
  const { digGuardPlugin } = require('../src/skills');
  // Feet at y 56 (25597's 64): its own column sandstone at 58, sand 59 to 62,
  // open at 63; east, the foot open, sandstone at the head and over it, sand on that.
  const cells = { '0,57,0': 'air', '0,58,0': 'sandstone', '1,56,0': 'air', '1,57,0': 'sandstone', '1,58,0': 'sandstone' };
  for (let y = 59; y <= 62; y++) { cells[`0,${y},0`] = 'sand'; cells[`1,${y},0`] = 'sand'; }
  const { bot, log, nameAt } = sim({ cells, ground: y => (y <= 55 ? 'andesite' : y <= 62 ? 'sandstone' : 'air'), items: [['cobblestone', 37]] });
  digGuardPlugin(bot);
  const feet = bot.entity.position.floored();
  const plan = drainPlan(bot, feet, { up: 7, top: 63, canDig: () => true, digSeconds: () => 4 });
  assert.equal(plan.mode, 'side');
  assert.deepEqual(plan.side.dir, new Vec3(1, 0, 0));
  const navigate = async (b, t, goalBlock) => { b.entity.position = new Vec3(goalBlock.x + 0.5, goalBlock.y, goalBlock.z + 0.5); };
  const done = await drainOverhead(bot, task, plan, { dig: digAction, navigate });
  assert.equal(log.buried, 0, 'nothing in the body');
  assert.deepEqual(log.digs.slice(0, 2).map(d => d.at), ['1,57,0', '1,58,0'], 'the two sandstone, from below');
  assert.equal(log.digs.filter(d => d.at === '1,56,0').length, 4, 'the sand dug where it lands, at the foot, a sand each');
  for (let y = 56; y <= 63; y++) assert.equal(nameAt(new Vec3(1, y, 0)), 'air', `open at y ${y}`);
  assert.equal(done.stepped, true);
  assert.equal(nameAt(new Vec3(0, 58, 0)), 'sandstone', 'its own column untouched');
});
