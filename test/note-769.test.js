'use strict';
// Note 769: pushed off footing one wide into the lava sea. A stance that
// stands still is not held on footing one wide over a drop that kills
// while something in reach can push the bot off it: the bot steps back to
// footing two wide or walls the open sides first (narrow-footing.js); the
// options say the footing, the pusher, what is done first, the game's
// rules on knocks and the bot's record (push-record.js); a span laid with
// a biter about is walled as it goes (bridging.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { Task } = require('../src/skills');
const { Survival } = require('../src/survival');
const { threats } = require('../src/danger');
const NF = require('../src/narrow-footing');
const bridging = require('../src/bridging');
const { groundBot } = require('./fixtures/saved-ground');

const noop = async () => {};
const WORN = ['iron_helmet', 'iron_chestplate', 'iron_leggings', 'iron_boots'];
// 25585 mid-239-cb as saved after its 15:31:24Z death: its own cobblestone
// span at y 48, x 122 to 142 along z 80, turning south at x 142, the lava
// sea's top at y 31.
const SPAN = require('./fixtures/span-hoglin-25585.json');
// At 15:31:15.2Z, as the flight has it: the bot at (135.44, 49, 80.5) with
// the shield in the off hand, seven blocks of wool, a hoglin on the span to
// the west (listed 6.8 off; it came along the span to arm's length).
function spanBot({ hoglin = new Vec3(129.5, 49, 80.5), items = null } = {}) {
  const bot = groundBot(SPAN, { at: new Vec3(135.44, 49, 80.5), health: 20, dimension: 'the_nether', worn: WORN, held: 'iron_sword',
    items: items || [['iron_sword', 1], ['white_wool', 6], ['black_wool', 1], ['gravel', 7], ['beef', 14], ['iron_pickaxe', 1]],
    mobs: hoglin ? [{ id: 7552, name: 'hoglin', at: hoglin, height: 1.4, width: 1.4 }] : [] });
  bot.inventory.slots[45] = { name: 'shield' };
  return bot;
}

// A made ground: a floor of cobblestone where `floor(x, z)` says, at y 48,
// over the lava at y 30 and under.
function madeBot({ floor, at, mobs = [], items = [] }) {
  const box = { x: [0, 24], y: [28, 52], z: [0, 12] }, palette = ['air', 'lava', 'cobblestone'], rows = [];
  for (let y = box.y[0]; y <= box.y[1]; y++) for (let z = box.z[0]; z <= box.z[1]; z++) {
    let r = '';
    for (let x = box.x[0]; x <= box.x[1]; x++) r += y <= 30 ? 'b' : y === 48 && floor(x, z) ? 'c' : 'a';
    rows.push(r);
  }
  const bot = groundBot({ box, palette, rows }, { at, health: 20, dimension: 'the_nether', worn: WORN, held: 'iron_sword', items, mobs });
  bot.inventory.slots[45] = { name: 'shield' };
  return bot;
}

test('25585\'s span: one wide, open north and south over the lava 17 down, the hoglin able to reach it; the walls go up first (4 blocks, 2.4 s), no footing two wide within eight steps (the span\'s corner is one wide)', () => {
  const bot = spanBot();
  const plan = NF.planAt(bot, new Vec3(135, 49, 80), threats(bot, 24), { health: 20, carried: 7 });
  assert.ok(plan, 'the rule fires');
  assert.equal(plan.footing.width, 1);
  assert.deepEqual(plan.footing.deadly.map(d => d.side).sort(), ['north', 'south']);
  assert.equal(plan.footing.worst.into, 'lava');
  assert.equal(plan.pushers[0].name, 'hoglin'); assert.equal(plan.pushers[0].how, 'blow');
  assert.equal(plan.back, null, 'the turn at x 142 is a corner, one wide');
  assert.equal(plan.choice, 'walls');
  assert.equal(plan.walls.need, 4); assert.equal(plan.walls.seconds, 2.4);
  const says = NF.planSays(plan, 'shield_guard');
  assert.match(says, /The footing here is one block wide \(it runs 4 or more east to west\), open (north and south|south and north) over lava 1[67] down\./);
  assert.match(says, /What can push the bot off it: the hoglin 6 blocks off \(its blow's knock \(and its throw when the blow lands\), which the shield does not stop\)\./);
  assert.match(says, /the bot first walls the 2 open sides at its feet \(4 blocks, 2 of them floors under a wall, about 2\.4 seconds/);
  assert.match(says, /a blow the shield takes does no harm but still knocks the bot back, about half a block with a hop; crouching stops the bot's own steps at an edge, not a knock/);
  assert.match(says, /Held as shield guard: 6 of them, all on footing one wide/);
});

test('the rule does not fire on footing two wide, with nothing that pushes about, or with the hoglin past its charge', () => {
  const wide = madeBot({ floor: (x, z) => x >= 4 && x <= 5 && z >= 4 && z <= 5, at: new Vec3(4.5, 49, 4.5), mobs: [{ id: 1, name: 'hoglin', at: new Vec3(5.5, 49, 5.5), height: 1.4, width: 1.4 }] });
  assert.equal(NF.footingAt(wide, new Vec3(4, 49, 4)).width, 2);
  assert.equal(NF.planAt(wide, new Vec3(4, 49, 4), threats(wide, 24), { carried: 10 }), null, 'two by two');
  assert.equal(NF.planAt(spanBot({ hoglin: null }), new Vec3(135, 49, 80), threats(spanBot({ hoglin: null }), 24), { carried: 7 }), null, 'nothing about');
  const far = spanBot({ hoglin: new Vec3(124.5, 49, 80.5) });
  assert.equal(NF.planAt(far, new Vec3(135, 49, 80), threats(far, 24), { carried: 7 }), null, 'a hoglin 11 blocks off is past its charge');
});

test('with no blocks, the step back to footing two wide on the side away from the hoglin; none toward it, and none at all said as the fall', () => {
  // A span along z = 6 to x 12, a three by three floor at x 13 to 15 (east) and one at x 0 (west, past the hoglin, ten steps off).
  const ground = (x, z) => (z === 6 && x <= 12) || (x >= 13 && x <= 15 && z >= 5 && z <= 7) || (x <= 0 && z >= 5 && z <= 7);
  const bot = madeBot({ floor: ground, at: new Vec3(10.5, 49, 6.5), mobs: [{ id: 1, name: 'hoglin', at: new Vec3(6.5, 49, 6.5), height: 1.4, width: 1.4 }] });
  const plan = NF.planAt(bot, new Vec3(10, 49, 6), threats(bot, 24), { carried: 0 });
  assert.equal(plan.choice, 'back');
  assert.deepEqual([plan.back.cell.x, plan.back.cell.z], [13, 6]);
  assert.equal(plan.back.steps, 3);
  assert.match(NF.planSays(plan, 'eat'), /the bot first steps back 3 cells, crouched, to footing 3 wide at \(13, 49, 6\), about 2\.5 seconds, and holds there/);
  // The hoglin to the east: the platform there is toward it, the west one ten steps off.
  const toward = madeBot({ floor: ground, at: new Vec3(10.5, 49, 6.5), mobs: [{ id: 1, name: 'hoglin', at: new Vec3(15.5, 49, 6.5), height: 1.4, width: 1.4 }] });
  const none = NF.planAt(toward, new Vec3(10, 49, 6), threats(toward, 24), { carried: 0 });
  assert.equal(none.choice, 'none');
  assert.match(NF.planSays(none, 'shield_guard'), /No footing two wide is within 8 steps and the blocks carried \(0\) do not wall the 2 open sides \(4\): held here, a knock toward (north or south|south or north) is the fall\./);
});

test('a ghast in sight is a pusher by its blast, a magma cube by its hop, a blaze in its line; a skeleton\'s arrow within sixteen', () => {
  const ps = NF.pushersAt([
    { name: 'ghast', position: new Vec3(0, 60, 0), distance: 55, visible: true },
    { name: 'ghast', position: new Vec3(0, 60, 0), distance: 50, visible: false },
    { name: 'magma_cube', position: new Vec3(0, 49, 0), distance: 5 },
    { name: 'magma_cube', position: new Vec3(0, 49, 0), distance: 9 },
    { name: 'blaze', position: new Vec3(0, 49, 0), distance: 12, visible: true },
    { name: 'zombified_piglin', position: new Vec3(0, 49, 0), distance: 7 },
  ]);
  assert.deepEqual(ps.map(p => `${p.name}:${p.how}`), ['magma_cube:blow', 'zombified_piglin:blow', 'blaze:shot', 'ghast:blast']);
});

test('the options on 25585\'s span: the shield guard says the footing, the walls first, the knock its blocked blows still give, and the record; the span\'s hold and the rail say the footing and their record', () => {
  const bot = spanBot({ hoglin: new Vec3(130.5, 49, 80.5) });
  const survival = new Survival(bot, { place: noop, dig: noop, navigate: noop }, { state: { shelters: [] } });
  const options = survival.stanceOptions(new Task('x'), { step: { action: 'cross_toward' } }, () => {}, survival.encounterDanger(), false);
  const guard = options.shield_guard?.description || '';
  assert.match(guard, /a blocked blow knocks the mob back half a block\. It knocks the bot back too: the game gives every blow its knockback whether or not the shield takes the damage/);
  assert.match(guard, /The footing here is one block wide/);
  assert.match(guard, /So it is not held here open: the bot first walls the 2 open sides at its feet/);
  for (const k of ['hold_on_span', 'rail_and_fight'].filter(k => options[k])) assert.match(options[k].description, /The footing here is one block wide.*What can push the bot off it: the hoglin/, k);
  assert.ok(options.hold_on_span || options.rail_and_fight, `neither the span's hold nor the rail: ${Object.keys(options).join(', ')}`);
});

test('chosen on 25585\'s span, the shield guard walls the open sides before it holds, and the rule is quiet once they stand', async () => {
  const bot = spanBot({ hoglin: new Vec3(130.5, 49, 80.5) });
  const placed = [];
  const place = async (b, task, p, material) => { placed.push(`${p.x},${p.y},${p.z}:${material}`); b.changed.set(`${p.x},${p.y},${p.z}`, material); };
  const survival = new Survival(bot, { place, dig: noop, navigate: noop }, { state: { shelters: [] } });
  const danger = threats(bot, 24);
  assert.equal(await survival.secureFooting(new Task('x'), { step: { action: 'cross_toward' } }, () => {}, danger, 'shield_guard'), true);
  assert.equal(placed.length, 4, placed.join(' '));
  assert.ok(placed.some(p => p.startsWith('135,49,79')) && placed.some(p => p.startsWith('135,49,81')), placed.join(' '));
  assert.equal(NF.planAt(bot, new Vec3(135, 49, 80), threats(bot, 24), { carried: 3 }), null, 'walled: no side open over the drop');
});

test('with no blocks, the shield guard steps back to footing two wide first, walked by the pathfinder', async () => {
  const ground = (x, z) => (z === 6 && x <= 12) || (x >= 13 && x <= 15 && z >= 5 && z <= 7);
  const bot = madeBot({ floor: ground, at: new Vec3(10.5, 49, 6.5), mobs: [{ id: 1, name: 'hoglin', at: new Vec3(5.5, 49, 6.5), height: 1.4, width: 1.4 }] });
  const walked = [];
  const navigate = async (b, task, goal) => { walked.push([goal.x, goal.y, goal.z]); b.entity.position = new Vec3(goal.x + 0.5, goal.y, goal.z + 0.5); };
  const survival = new Survival(bot, { place: noop, dig: noop, navigate }, { state: { shelters: [] } });
  assert.equal(await survival.secureFooting(new Task('x'), { step: { action: 'find_fortress' } }, () => {}, threats(bot, 24), 'shield_guard'), true);
  assert.deepEqual(walked, [[13, 49, 6]]);
  // A stance the rule leaves be: one that walks, or the span's own hold.
  assert.ok(!NF.STATIONARY.has('retreat') && !NF.STATIONARY.has('hold_on_span') && NF.STATIONARY.has('eat'));
});

test('a span laid with a hoglin about is walled on both sides as it goes, priced in the survey; with none about, as before', () => {
  const ground = (x, z) => z === 6 && x <= 6;
  const hog = madeBot({ floor: ground, at: new Vec3(6.5, 49, 6.5), items: [['cobblestone', 64]], mobs: [{ id: 1, name: 'hoglin', at: new Vec3(1.5, 49, 6.5), height: 1.4, width: 1.4 }] });
  assert.equal(bridging.spanPusher(hog)?.name, 'hoglin');
  const walls = bridging.spanWallsAt(hog, new Vec3(7, 49, 6), new Vec3(1, 0, 0));
  assert.deepEqual(walls.map(w => `${w.wall.x},${w.wall.z}:${!!w.floor}`).sort(), ['7,5:true', '7,7:true']);
  const s = bridging.surveyCrossing(hog, new Vec3(16, 49, 6), { cells: 8 });
  assert.equal(s.bridge, 8); assert.equal(s.wallBlocks, 32); assert.equal(s.walledFor.name, 'hoglin');
  assert.match(require('../src/nether-travel').crossingSays(s, 'the fortress'), /walling the open sides of each cell over the drop as it goes, the hoglin 5 blocks off being able to knock the bot off a span one wide \(32 blocks more\)/);
  // Short of blocks for the walls, the survey stops where they run out.
  const short = madeBot({ floor: ground, at: new Vec3(6.5, 49, 6.5), items: [['cobblestone', 12]], mobs: [{ id: 1, name: 'hoglin', at: new Vec3(1.5, 49, 6.5), height: 1.4, width: 1.4 }] });
  const s2 = bridging.surveyCrossing(short, new Vec3(16, 49, 6), { cells: 8 });
  assert.equal(s2.bridge + s2.wallBlocks <= 12, true); assert.match(s2.stoppedBy, /out of blocks to wall the span's sides with the hoglin/);
  const calm = madeBot({ floor: ground, at: new Vec3(6.5, 49, 6.5), items: [['cobblestone', 64]] });
  const s3 = bridging.surveyCrossing(calm, new Vec3(16, 49, 6), { cells: 8 });
  assert.equal(s3.wallBlocks, 0); assert.equal(s3.bridge, 8);
});

test('the push scene reads the footing from a saved world: one wide, laid, open over the lava; a span\'s corner one wide', () => {
  const { footingOf } = require('../scripts/lib/push-scene');
  const at = (x, y, z) => y <= 31 ? 'lava' : y === 48 && ((z === 80 && x <= 142) || (x === 142 && z >= 80)) ? 'cobblestone' : 'air';
  const w = { blockAt: at };
  const f = footingOf(w, { x: 135.44, y: 49, z: 80.5 });
  assert.equal(f.width, 1); assert.equal(f.laid, true); assert.deepEqual(f.open.sort(), ['north', 'south']); assert.equal(f.overLava, 17);
  assert.equal(footingOf(w, { x: 142.5, y: 49, z: 80.5 }).width, 1, 'the corner');
});

test('stanceStep runs the rule before a stance that stands still, and not before one that walks', async () => {
  for (const [choice, expected] of [['shield_guard', 1], ['retreat', 0]]) {
    const bot = spanBot({ hoglin: new Vec3(130.5, 49, 80.5) });
    const survival = new Survival(bot, { place: noop, dig: noop, navigate: noop }, { state: { shelters: [] } });
    survival.client = {};
    const called = [];
    survival.secureFooting = async (task, goal, save, danger, c) => { called.push(c); return false; };
    survival.decide = async () => ({ path: [choice] });
    const options = survival.stanceOptions.bind(survival);
    survival.stanceOptions = (...a) => { const o = options(...a); for (const k of Object.keys(o)) { o[k].run = async () => true; } o[choice] ||= { description: '', run: async () => true }; return o; };
    await Promise.race([survival.stanceStep(new Task('x'), { step: { action: 'cross_toward' } }, () => {}, threats(bot, 24), false).catch(() => {}), new Promise(r => setTimeout(r, 3000))]);
    assert.equal(called.length, expected, `${choice}: ${called.join(',')}`);
  }
});
