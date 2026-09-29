'use strict';
// Note 655: the Nether bots that stood still, 2026-09-29 around 03:00Z.
//  - 25583 (mid-243-cg) stood thirty minutes on a cell of blackstone in a
//    basalt delta at 1.8 health, no food, no pickaxe and no block that holds
//    (test/fixtures/basalt-delta-mid-243-cg.json): every walk "no route"
//    (the Nether's walks took no cell with lava beside it, and in the delta
//    every cell has; priced since note 660), its unstuck moves single steps onto the cells beside it
//    and back, and 95% of fifteen minutes held waiting for rests to end.
//  - 25589 (mid-243-cd-nether-1) stood at the far end of its own span over
//    the lava sea, no block carried and an iron pickaxe with 170 uses
//    (test/fixtures/span-end-mid-243-cd.json): the restock looked within
//    sixteen blocks, found nothing, and was not offered; every leg rested
//    "out of blocks" and the one way to blocks offered was a portal 219 off.
//  - 25581, 25585, 25592 searched with no pickaxe at all, 25581 and 25592
//    with the makings of one in their pockets: the upkeep offered a spare
//    only beside a pickaxe carried, and 25592's restock, offered "a wooden
//    pickaxe is made first", dug basalt by hand and gained nothing.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { groundBot, registry } = require('./fixtures/saved-ground');
const { Task } = require('../src/skills');

const DELTA = require('./fixtures/basalt-delta-mid-243-cg.json');
const SPAN = require('./fixtures/span-end-mid-243-cd.json');

// 25583's pockets at 03:01Z.
const DELTA_KIT = [['water_bucket', 1], ['bucket', 9], ['leaf_litter', 32], ['coal', 128], ['flint_and_steel', 1], ['white_bed', 1], ['raw_copper', 16], ['leather', 2], ['raw_gold', 5], ['iron_ingot', 30], ['iron_boots', 1], ['raw_iron', 30], ['cauldron', 1], ['magma_cream', 1], ['flint', 1], ['gravel', 14], ['iron_sword', 1], ['stone_axe', 1]];
function deltaBot(items = DELTA_KIT) {
  return groundBot(DELTA, { at: new Vec3(-20.7, 101, -18.5), health: 1.84, food: 13, dimension: 'the_nether', worn: ['iron_helmet', 'iron_chestplate', 'iron_leggings', 'golden_boots'], held: 'iron_sword', items });
}

test('25583 in the basalt delta: the walks find no route, and working free offers the walk off with its cells beside lava said, a touch at 1.8 health said as death (note 655)', () => {
  const { localMoves, liveView, walkOffPlan } = require('../src/unstuck');
  const bot = deltaBot();
  // The pathfinder, with the Nether's rule of no cell beside lava, had no way to the dry ground eight blocks north; since
  // note 660 it prices those cells and finds one (nether-lava-660.test.js).
  const feet = new Vec3(-21, 101, -19);
  const view = liveView(bot);
  const { moves } = localMoves(view, feet, { goal: 'away', visits: {}, from: feet, breathS: 15 });
  const walk = moves.find(m => m.key === 'walk_off');
  assert(walk, `offered: ${moves.map(m => m.key).join(', ')}`);
  assert.deepEqual(walk.path.map(p => `${p.x},${p.y},${p.z}`), ['-21,100,-20', '-21,100,-21', '-22,98,-21', '-22,98,-22', '-22,98,-23', '-22,98,-24', '-22,98,-25', '-22,98,-26', '-22,98,-27']);
  assert.equal(walk.lavaSide, 2);
  assert.match(walk.does, /^Walk off this spot to \(-22, 98, -27\), 9 cells over the ground as it stands \(nothing dug or laid, 3 down in all\), onto dry ground with no lava in the eight cells round it, 8 blocks from where it got stuck\. 2 of its cells have lava beside it/);
  assert.match(walk.does, /walked crouched one cell at a time; a misstep or a push there is into the lava \(One touch of lava .* more than the 1\.8 health the bot has: a touch is death\.\)\. The walks the bot makes on its own in the Nether take a cell with lava round it at its cost, crouched, but none with the lava a block to a side while a touch of it is death, nor one in line with something that can push the bot\./);
  // The end is dry ground with no lava round it, and no drop of two onto a cell beside lava is on the way.
  const { lavaBeside } = require('../src/unstuck');
  assert.equal(lavaBeside(view, walk.to), false);
  let at = feet;
  for (const p of walk.path) { if (at.y - p.y >= 2 || p.y > at.y) assert.equal(lavaBeside(view, p), false, `airborne onto ${p}`); at = p; }
  // Only for the aim of getting off the spot, and not where the dry ground is the next step.
  assert.equal(localMoves(view, feet, { goal: 'sky', visits: {}, breathS: 15 }).moves.some(m => m.key === 'walk_off'), false);
  assert.equal(walkOffPlan(view, feet, null), null);
});

test('the walk off is walked a cell at a time from where the move was read, and stops where the body is not in the cell (note 655)', async () => {
  const { localMoves, liveView, perform } = require('../src/unstuck');
  const bot = deltaBot();
  const feet = new Vec3(-21, 101, -19);
  const walk = localMoves(liveView(bot), feet, { goal: 'away', visits: {}, from: feet, breathS: 15 }).moves.find(m => m.key === 'walk_off');
  const stepped = [];
  // The body goes where each step is for; the first two steps, the third does not arrive.
  const motion = require('../src/motion');
  const move = motion.move;
  motion.move = async (b, task, o) => { const to = o.look.floored(); stepped.push({ to: `${to.x},${to.z}`, sneak: o.sneak }); if (stepped.length < 3) b.entity.position = new Vec3(to.x + 0.5, walk.path[stepped.length - 1].y, to.z + 0.5); };
  try {
    await assert.rejects(perform(bot, new Task('free'), walk, { dig: async () => {} }), /The walk off stopped at \(-21, 100, -21\), short of \(-22, 98, -21\)/);
  } finally { motion.move = move; }
  assert.deepEqual(stepped.map(s => s.to), ['-21,-20', '-21,-21', '-22,-21']);
});

// 25589's pockets at 03:05Z: no block that a span is laid with.
const SPAN_KIT = [['iron_pickaxe', 1], ['stone_pickaxe', 1], ['iron_sword', 1], ['stone_sword', 1], ['stone_axe', 1], ['raw_iron', 2], ['iron_nugget', 7], ['stick', 2]];
function jevStub(picks) {
  const asked = [];
  return { asked, systemOne: async ({ state, questions }) => { asked.push({ id: questions.branch_0, state, options: questions.branch_0.criteria }); return { answers: { branch_0: { choice: picks.shift(), confidence: 0.9 } } }; } };
}

test('25589 at the far end of its own span, no block carried: the restock is offered back along the span to the shore, where nothing lies within sixteen (note 655)', async () => {
  const { spanBlockSources } = require('../src/bridging');
  const bot = groundBot(SPAN, { at: new Vec3(-163.5, 38, 150.5), dimension: 'the_nether', items: SPAN_KIT, indexed: true });
  assert.equal(spanBlockSources(bot, { reach: 16, walk: 32 }).sources.length, 0, 'nothing within the near reach');
  const far = spanBlockSources(bot, { reach: 64, walk: 96, cells: 800 });
  assert(far.sources.length > 0);
  assert.equal(far.sources[0].walk, 30);
  assert.equal(`${far.sources[0].from}`, '(-139, 38, 155)');

  const { findFortressStep } = require('../src/mob-hunt');
  const client = jevStub(['return_for_blocks']);
  const now = Date.now(), from = { x: -163, y: 38, z: 150 };
  const rest = { from, until: now + 240000, at: now - 30000, made: 1, why: 'out of blocks (0 carried)' };
  const goal = { portals: [{ dimension: 'nether', x: 3, y: 42, z: 8 }], fortressSearch: { axis: 1, legs: 95, since: now - 165 * 60000, legRests: { east: rest, south: rest, west: rest, north: rest } } };
  await findFortressStep(bot, new Task('hunt'), goal, () => {}, { client, navigate: async () => { throw new Error('No path to the goal!'); }, mineAt: async () => {}, tunnel: async () => {}, returnOverworld: async () => {} });
  assert.equal(client.asked.length, 1);
  assert.equal(goal.decisions.at(-1).id, 'fortress_leg');
  const { options } = client.asked[0];
  assert(options.restock_blocks, `offered: ${Object.keys(options)}`);
  assert.match(options.restock_blocks, /^Dig \d+ blocks? to lay spans with here, one after another, from the \d+ that can be dug from ground walked to from here \([^)]*netherrack[^)]*\): the nearest \d+ blocks off, dug from a walk of 30 blocks from here, back along the floor the bot stands on \(nothing can be dug from ground within 16 blocks of here\)/);
  assert.match(options.return_for_blocks, /the nearest known 219 blocks off at 3, 42, 8/);
});

test('with no pickaxe carried and none to be made, no restock is offered: rock dug by hand drops nothing (25585, note 655)', async () => {
  const { findFortressStep } = require('../src/mob-hunt');
  const bot = groundBot(SPAN, { at: new Vec3(-136.5, 38, 155.5), dimension: 'the_nether', items: [['iron_sword', 1], ['oak_planks', 1], ['crafting_table', 1]], indexed: true });
  const client = jevStub(['none_good']);
  const now = Date.now(), from = { x: -137, y: 38, z: 155 };
  const rest = { from, until: now + 240000, at: now - 30000, made: 1, why: 'out of blocks (0 carried)' };
  const goal = { portals: [{ dimension: 'nether', x: 3, y: 42, z: 8 }], fortressSearch: { axis: 1, legs: 95, since: now - 165 * 60000, legRests: { east: rest, south: rest, west: rest, north: rest } } };
  await findFortressStep(bot, new Task('hunt'), goal, () => {}, { client, navigate: async () => { throw new Error('No path to the goal!'); }, mineAt: async () => {}, tunnel: async () => {}, returnOverworld: async () => {} }).catch(() => {});
  assert(client.asked.length > 0);
  for (const a of client.asked) assert.equal(a.options.restock_blocks, undefined, Object.keys(a.options).join(', '));
});

test('the restock chosen with no pickaxe carried makes the one it said first, then digs with it (25592, note 655)', async () => {
  const { findFortressStep } = require('../src/mob-hunt');
  const bot = groundBot(SPAN, { at: new Vec3(-136.5, 38, 155.5), dimension: 'the_nether', items: [], indexed: true });
  const inv = [['iron_sword', 1], ['oak_log', 3], ['oak_planks', 6], ['stick', 2], ['crafting_table', 1]].map(([name, count]) => ({ name, count, type: registry.itemsByName[name].id }));
  bot.inventory.items = () => inv;
  const client = jevStub(['restock_blocks']);
  const now = Date.now(), from = { x: -137, y: 38, z: 155 };
  const rest = { from, until: now + 240000, at: now - 30000, made: 1, why: 'out of blocks (0 carried)' };
  const goal = { fortressSearch: { axis: 1, legs: 60, since: now - 60 * 60000, legRests: { east: rest, south: rest, west: rest, north: rest } } };
  const made = [], dugWith = [];
  const acquireStep = async (b, t, item) => { made.push(item); inv.push({ name: item, count: 1, type: registry.itemsByName[item].id }); return true; };
  const mineAt = async () => { dugWith.push(inv.find(i => /_pickaxe$/.test(i.name))?.name || 'hand'); inv.push({ name: 'netherrack', count: 1, type: registry.itemsByName.netherrack.id }); };
  await findFortressStep(bot, new Task('hunt'), goal, () => {}, { client, acquireStep, mineAt, navigate: async () => {}, tunnel: async () => {} });
  assert.match(client.asked[0].options.restock_blocks, /No pickaxe is carried, and netherrack dug by hand drops nothing: a wooden pickaxe is made first from what is carried \(3 logs, 6 planks, 2 sticks, a crafting table\)/);
  assert.deepEqual(made, ['wooden_pickaxe']);
  assert(dugWith.length > 0 && dugWith.every(t => t === 'wooden_pickaxe'), dugWith.join(', '));
});

test('no pickaxe carried and one in the pockets: the upkeep offers making it, with what digging by hand costs in the Nether (note 655)', async () => {
  const { upkeepStep } = require('../src/work');
  let offered = null;
  const client = { systemOne: async ({ questions }) => { offered = questions.branch_0.criteria; return { answers: { branch_0: { choice: 'carry_on', confidence: 0.7 } } }; } };
  // 25581's pockets.
  const items = [['oak_log', 2], ['oak_planks', 4], ['iron_ingot', 12], ['raw_iron', 40], ['iron_sword', 1], ['stone_axe', 1], ['netherrack', 20]];
  const bot = { game: { gameMode: 'survival', dimension: 'the_nether' }, time: { timeOfDay: 3000 }, entity: { isInWater: false, position: new Vec3(0.5, 60, 0.5) },
    registry, inventory: { items: () => items.map(([name, count]) => ({ name, count, type: registry.itemsByName[name].id })) }, health: 20, food: 20 };
  await upkeepStep(bot, { check() {} }, { kind: 'win', step: { action: 'find_fortress' } }, () => {}, client);
  assert(offered?.make_pickaxe, `offered: ${offered && Object.keys(offered)}`);
  assert.match(offered.make_pickaxe, /^Make an iron pickaxe now from what is carried \(3 of the 12 iron ingots; 2 logs, 4 planks\), a few seconds at a crafting table: 250 uses\. No pickaxe is carried: rock dug by hand takes about two seconds a block for netherrack and six to seven and a half for basalt and blackstone, and drops nothing, so no block comes back to lay over a gap or lava/);
  // The decision's own record knows the option.
  const { question } = require('../src/decisions');
  assert(question('upkeep').options.some(o => o.key === 'make_pickaxe'));
});
