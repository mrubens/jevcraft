'use strict';
// What counts as progress on a rung: a change in the rung's own measure, not displacement (src/rung-measure.js, note 646).
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const RM = require('../src/rung-measure');
const tried = require('../src/tried');
const repeats = require('../src/decisions/repeats');
const registry = require('minecraft-data')('26.1');
const { WAIT_ANSWERS } = require('../src/decisions');

const item = (name, count = 1) => ({ name, count });
const mkBot = (x = 0, y = 64, z = 0, items = [], dimension = 'the_nether') => ({ entity: { position: new Vec3(x, y, z) }, game: { dimension, gameMode: 'survival' }, inventory: { items: () => items }, health: 20, food: 20, registry });
const rodsGoal = (extra = {}) => ({ kind: 'win', step: { action: 'find_fortress' }, gameProgress: { phase: 'obtain_blaze_rods', milestones: { nether_entered: { at: 1 } } }, fortressSearch: {}, mobHunt: { sightings: [] }, ...extra });
const partsOf = (bot, goal, rung = 'obtain_blaze_rods') => tried.measureOf(bot, goal, rung);
const v = p => RM.values(p);

// ---- each rung's measure ----
test('obtain blaze rods: rods carried, blazes killed, new ground, and the nearest fortress, cage and sighting known', () => {
  const bot = mkBot(0, 64, 0, [item('blaze_rod', 2), item('cooked_beef', 3)]);
  const coverage = { nether: { seen: { '0,0': 0b1011, '1,0': 0b1 }, stood: {} } };
  const goal = rodsGoal({ fortressSearch: { found: { x: 100, y: 64, z: 0 }, map: { spawners: [{ x: 60, y: 60, z: 0 }, { x: 0, y: 64, z: 300 }] }, coverage }, mobHunt: { sightings: [{ x: 0, y: 64, z: 40, dimension: 'the_nether' }, { x: 0, y: 64, z: -90, dimension: 'the_nether' }, { x: 5, y: 64, z: 5, dimension: 'overworld' }] } });
  const p = partsOf(bot, goal);
  assert.equal(p.items.v, 2); assert.equal(p.items.what, 'blaze rod');
  assert.equal(p.kills.v, 0);
  assert.equal(p.ground.v, 4, 'the columns looked over, counted from the masks');
  assert.equal(p['fortress@nether'].v, 100);
  assert(Math.abs(p['cage@nether'].v - 60) < 0.5, 'the nearest cage known');
  assert.equal(p['blazes@nether'].v, 40, 'the nearest sighting in this dimension');
  assert.equal(p.food.v, 3 * registry.foodsByName.cooked_beef.foodPoints);
  assert.equal(p.supplies, undefined, 'not anything worth keeping');
  assert.equal(p.milestones.v, 1);
  // A blaze dying within the fight's reach is a kill; one far off is not.
  bot.emit = undefined;
  const handlers = {};
  bot.on = (ev, fn) => { handlers[ev] = fn; };
  partsOf(bot, goal);
  handlers.entityDead({ name: 'blaze', position: new Vec3(3, 64, 3) });
  handlers.entityDead({ name: 'blaze', position: new Vec3(90, 64, 3) });
  handlers.entityDead({ name: 'pig', position: new Vec3(1, 64, 1) });
  assert.equal(partsOf(bot, goal).kills.v, 1);
});

test('reach nether: obsidian and flint carried, the frame\'s blocks standing, the nearest of the frame', () => {
  const bot = mkBot(10, 64, 0, [item('obsidian', 4), item('flint_and_steel')], 'overworld');
  bot.blockAt = p => ({ name: p.x < 3 ? 'obsidian' : 'air' });
  const goal = { kind: 'win', step: { action: 'build_portal' }, gameProgress: { phase: 'reach_nether', milestones: {} }, portalFrame: { origin: { x: 0, y: 64, z: 0 }, blocks: [{ x: 0, y: 64, z: 0 }, { x: 1, y: 64, z: 0 }, { x: 2, y: 64, z: 0 }, { x: 5, y: 64, z: 0 }] } };
  const p = partsOf(bot, goal, 'reach_nether');
  assert.equal(p.items.v, 5, 'obsidian and flint and steel');
  assert.equal(p.frame.v, 3);
  assert.equal(p['portal@overworld'].v, 10);
  assert.equal(p.kills, undefined, 'nothing is hunted');
});

test('ender pearls and eyes: what is carried, endermen killed; the step\'s own target for any rung', () => {
  const bot = mkBot(0, 64, 0, [item('ender_pearl', 2), item('ender_eye')], 'overworld');
  const goal = { kind: 'win', step: { action: 'hunt_endermen' }, gameProgress: { phase: 'obtain_ender_pearls', milestones: {} } };
  const p = tried.measureOf(bot, goal, 'obtain_ender_pearls');
  assert.equal(p.items.v, 3);
  assert.equal(p.kills.hunted, 'enderman');
  const gear = tried.measureOf(mkBot(0, 64, 0, [item('iron_ingot', 3), item('raw_iron', 2)], 'overworld'), { kind: 'win', step: { action: 'mine', item: 'raw_iron', drops: 'raw_iron', block: 'iron_ore', target: { x: 30, y: 64, z: 40 } }, gameProgress: { phase: 'iron_helmet' } }, 'iron_helmet');
  assert.equal(gear['step:8,16,10@overworld'].v, 50, 'the step\'s target, keyed by its place');
  assert.equal(gear.items.v, 2, 'the rung\'s own items: what the step is for and the piece');
  assert.equal(gear['step_items:iron_ore'].v, 0, 'and the step\'s block, when it is not one of them');
});

// ---- the judging ----
const judged = (before, bot, goal, store = {}, { rung = 'obtain_blaze_rods', since = Infinity, at = Date.now() } = {}) => RM.judge({ before: v(before), parts: partsOf(bot, goal, rung), store, since, at });

test('an answer that gained nothing on the rung came to nothing, in the rung\'s words, however far it walked', () => {
  const goal = rodsGoal({ fortressSearch: { found: { x: 100, y: 64, z: 0 }, coverage: { nether: { seen: { '0,0': 0b1111 } } } } });
  const bot = mkBot(0, 64, 0);
  const before = partsOf(bot, goal), store = {};
  RM.observe(before, store);
  // A tunnel dug 62 blocks the wrong way, ending at a wall (note 629's leg_east).
  bot.entity.position = new Vec3(-62, 64, 0);
  const r = judged(before, bot, goal, store);
  assert.equal(r.came, null);
  assert.equal(RM.says(r.nothing, 62), 'nothing gained on the rung: killed nothing, no rod, no new ground looked over, no nearer the fortress (162 blocks off, the nearest yet 100), ended 62 blocks from where it began');
  // Standing still, as the box did.
  bot.entity.position = new Vec3(0, 64, 0);
  assert.match(RM.says(judged(before, bot, goal, store).nothing, 0.4), /^nothing gained on the rung: killed nothing, no rod, .*, ended where it began$/);
});

test('a rod, a kill, new ground, more food or something worth keeping is something; eating, or spending blocks, is not', () => {
  const goal = rodsGoal({ fortressSearch: { coverage: { nether: { seen: { '0,0': 0b1 } } } } });
  const bot = mkBot(0, 64, 0, [item('cooked_beef', 4), item('oak_planks', 8)]);
  const before = partsOf(bot, goal);
  // Ate two, spent the planks on a box's walls: worse on the counts, and not a gain.
  bot.inventory = { items: () => [item('cooked_beef', 2)] };
  assert.equal(judged(before, bot, goal).came, null);
  bot.inventory = { items: () => [item('cooked_beef', 4), item('oak_planks', 8), item('blaze_rod')] };
  assert.match(judged(before, bot, goal).came, /^1 more blaze rod/);
  // Something worth keeping that is not what the rung or its step is for (a flint picked up on the way) is not the rung's.
  bot.inventory = { items: () => [item('cooked_beef', 4), item('oak_planks', 8), item('ender_pearl', 2), item('flint', 3)] };
  assert.equal(judged(before, bot, goal).came, null);
  bot.inventory = { items: () => [item('cooked_beef', 8), item('oak_planks', 8)] };
  assert.match(judged(before, bot, goal).came, /more food points/);
  bot.inventory = { items: () => [item('cooked_beef', 4), item('oak_planks', 8)] };
  bot._kills = { blaze: 1 };
  assert.match(judged(before, bot, goal).came, /^a blaze killed/);
  bot._kills = { blaze: 0 };
  goal.fortressSearch.coverage.nether.seen['0,0'] = 0b111111;
  assert.match(judged(before, bot, goal).came, /5 new columns of ground looked over/);
  goal.fortressSearch.coverage.nether.seen['0,0'] = 0b11;
  assert.equal(judged(before, bot, goal).came, null, 'one new column is not new ground');
});

test('a slow approach is a new nearest at each step, and the way back over the same ground is not', () => {
  const goal = rodsGoal({ fortressSearch: { found: { x: 300, y: 64, z: 0 } } });
  const bot = mkBot(0, 64, 0);
  const store = {};
  let before = partsOf(bot, goal);
  RM.observe(before, store);
  // Two hundred blocks toward the fortress in legs of thirty: each ends nearer than any before.
  for (let x = 30; x <= 210; x += 30) {
    bot.entity.position = new Vec3(x, 64, 0);
    const r = judged(before, bot, goal, store);
    assert.match(r.came, /^nearer the fortress/, `leg to ${x}`);
    before = partsOf(bot, goal);
  }
  // Taken back to the start, and walking to the same place again: no new nearest.
  bot.entity.position = new Vec3(0, 64, 0);
  before = partsOf(bot, goal);
  RM.observe(before, store);
  bot.entity.position = new Vec3(150, 64, 0);
  const again = judged(before, bot, goal, store);
  assert.equal(again.came, null, '150 blocks walked, 90 short of the nearest yet');
  assert.match(RM.says(again.nothing, 150), /no nearer the fortress \(150 blocks off, the nearest yet 90\), ended 150 blocks from where it began$/);
  // Past it, it is.
  bot.entity.position = new Vec3(240, 64, 0);
  assert.match(judged(partsOf(mkBot(0, 64, 0), goal), bot, goal, store).came, /^nearer the fortress, 60 blocks off/);
});

test('a place first learned is something; the same place lost and found again is not, and a nearest kept half an hour is stale', () => {
  const bot = mkBot(0, 64, 0);
  const goal = rodsGoal();
  const before = partsOf(bot, goal), store = {};
  RM.observe(before, store);
  goal.mobHunt.sightings.push({ x: 50, y: 64, z: 0, dimension: 'the_nether' });
  const t0 = Date.now();
  const found = judged(before, bot, goal, store, { at: t0 });
  assert.match(found.came, /the nearest place blazes were seen learned, 50 blocks off/);
  goal.mobHunt.sightings = [];
  const gone = partsOf(bot, goal);
  goal.mobHunt.sightings.push({ x: 50, y: 64, z: 0, dimension: 'the_nether' });
  assert.equal(judged(gone, bot, goal, store, { at: t0 + 60000 }).came, null, 'seen again five minutes on: the same place');
  // After a death, from the portal: 28 minutes later the nearest of the last life is still held against it; an hour later it is not.
  bot.entity.position = new Vec3(0, 64, 400);
  const far = partsOf(bot, goal);
  bot.entity.position = new Vec3(0, 64, 300);
  assert.equal(judged(far, bot, goal, store, { at: t0 + 28 * 60000 }).came, null, 'nearer than it began, not than the nearest yet');
  RM.observe(far, store, t0 + 28 * 60000);
  assert.match(judged(far, bot, goal, store, { at: t0 + 100 * 60000 }).came, /nearer the nearest place blazes were seen/, 'the old nearest has gone stale');
});

test('a nearest set while an answer was in force is credited to it, so answers that overlap are each judged fairly', () => {
  const bot = mkBot(0, 64, 0);
  const goal = rodsGoal({ fortressSearch: { found: { x: 200, y: 64, z: 0 } } });
  const store = {};
  const begun = partsOf(bot, goal);
  RM.observe(begun, store, 1000);
  bot.entity.position = new Vec3(60, 64, 0);
  const first = RM.judge({ before: v(begun), parts: partsOf(bot, goal), store, since: 1000, at: 5000 });
  assert.match(first.came, /nearer the fortress/);
  // A second answer that began with the first and ends at the same place: the nearest was set while it was in force.
  const second = RM.judge({ before: v(begun), parts: partsOf(bot, goal), store, since: 1000, at: 6000 });
  assert.match(second.came, /nearer the fortress/);
});

test('a measure with the same parts twice is the repeat rule\'s look: changed() by values alone', () => {
  assert.equal(RM.changed({ items: 0, 'fortress@nether': 100 }, { items: 0, 'fortress@nether': 99 }), null);
  assert.match(RM.changed({ items: 0 }, { items: 1 }), /1 more/);
  assert.match(RM.changed({ 'fortress@nether': 100 }, { 'fortress@nether': 90 }), /nearer fortress/);
  assert.match(RM.changed({}, { 'blazes@nether': 50 }), /learned/);
  assert.equal(RM.changed({}, { 'step:1,2,3@nether': 50 }), null, 'a step\'s target seen is not a gain');
  assert.equal(RM.changed({ food: 10 }, { food: 4 }), null);
});

// ---- the ledger's cameOf (settle) ----
const goalAt = (extra = {}) => rodsGoal({ survival: {}, ...extra });
const begin = (bot, goal, q = 'fortress_leg', method = 'leg_east', extra = {}) => tried.begin(bot, goal, { q, method, offered: [{ key: method }], ...extra });

test('a fortress leg that walked 62 blocks and gained nothing on the rung came to nothing, and says why', t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-09-28T19:00:00Z') });
  const bot = mkBot(0, 64, 0);
  const goal = goalAt({ fortressSearch: { found: { x: 100, y: 64, z: 0 } } });
  const e = begin(bot, goal);
  assert.equal(e.rung, 'obtain_blaze_rods'); assert(e.measure);
  t.mock.timers.tick(90000); bot.entity.position = new Vec3(-62, 64, 0);
  tried.settle(bot, goal, { q: 'fortress_leg' });
  assert.equal(e.outcome, 'blocked');
  assert.match(e.why, /^nothing gained on the rung: killed nothing, no rod, no nearer the fortress \(162 blocks off, the nearest yet 100\), ended 62 blocks from where it began$/);
  assert.equal(e.measure, undefined, 'the beginning is dropped once judged');
  // Said on the option next time it is asked from about here.
  bot.entity.position = new Vec3(0, 64, 0);
  const again = begin(bot, goal);
  t.mock.timers.tick(60000); bot.entity.position = new Vec3(-30, 64, 0);
  tried.settle(bot, goal, { q: 'fortress_leg' });
  bot.entity.position = new Vec3(0, 64, 0);
  const tree = () => ({ leg_east: { description: 'A leg east.' }, leg_west: { description: 'A leg west.' }, leg_north: { description: 'A leg north.' } });
  const read = tried.read(bot, goal, 'fortress_leg', tree(), { now: Date.now() });
  assert.equal(again.outcome, 'blocked');
  assert.equal(read.tree.leg_east, undefined, 'blocked twice from here: it rests and is left out while others are on offer');
  assert.match(read.resting[0], /^leg east: Tried 2 times from here in the last .*, and it came to nothing: nothing gained on the rung: killed nothing, no rod/);
});

test('the same leg counted as getting somewhere under the old rule, where no rung is in hand', t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-09-28T19:00:00Z') });
  const bot = mkBot(0, 64, 0);
  const goal = { kind: 'win', step: { action: 'find_fortress' }, survival: {} };
  const e = begin(bot, goal);
  assert.equal(e.rung, undefined);
  t.mock.timers.tick(90000); bot.entity.position = new Vec3(-62, 64, 0);
  tried.settle(bot, goal, { q: 'fortress_leg' });
  assert.equal(e.outcome, 'progressed');
  assert.equal(e.gained, 'moved 62 blocks');
});

test('a walk that ended nearer the fortress, or with a rod, got somewhere; the ledger says what', t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-09-28T19:00:00Z') });
  const bot = mkBot(0, 64, 0);
  const goal = goalAt({ fortressSearch: { found: { x: 300, y: 64, z: 0 } } });
  const e = begin(bot, goal, 'fortress_approach', 'walk_route');
  t.mock.timers.tick(30000); bot.entity.position = new Vec3(40, 64, 0);
  tried.settle(bot, goal, { q: 'fortress_approach' });
  assert.equal(e.outcome, 'progressed');
  assert.match(e.gained, /^nearer the fortress, 260 blocks off from 300/);
  const rod = begin(bot, goal, 'fortress_approach', 'tunnel');
  bot.inventory = { items: () => [item('blaze_rod')] };
  tried.settle(bot, goal, { q: 'fortress_approach' });
  assert.equal(rod.outcome, 'progressed');
  assert.match(rod.gained, /^1 more blaze rod/);
});

test('a walk toward a place of its own is judged by its nearest approach: nearer its target than it began, and than an earlier answer got', t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-09-28T19:00:00Z') });
  const STEMS = { x: -100, y: 64, z: 0 };
  const bot = mkBot(-20, 64, 0);
  const goal = goalAt();
  const walk = (from, to) => {
    bot.entity.position = new Vec3(from, 64, 0);
    const e = begin(bot, goal, 'nether_gather', 'walk_to_1', { target: STEMS });
    t.mock.timers.tick(30000); bot.entity.position = new Vec3(to, 64, 0);
    tried.settle(bot, goal, { q: 'nether_gather' });
    return e;
  };
  assert.match(walk(-20, -90).gained, /^moved 70 blocks toward its own target, 10 blocks off it$/);
  const back = walk(-45, -90);
  assert.equal(back.outcome, 'blocked', 'taken back and walked again to the same place');
  assert.equal(back.noNearer, true);
  assert.match(back.why, /^ended 10 blocks from it, no nearer than the 10 an answer toward it reached/);
  const away = walk(-60, 10);
  assert.equal(away.outcome, 'blocked', 'walked past it, away, 110 off');
});

test('answers outside the rung keep their own judgments: a stance that moved, a wait judged by its world, the stall\'s answers by the rung\'s best', t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-09-28T19:00:00Z') });
  const bot = mkBot(0, 64, 0);
  const goal = goalAt();
  const stance = tried.begin(bot, goal, { q: 'encounter_stance', method: 'retreat' });
  assert.equal(stance.rung, undefined, 'the survival layer\'s stance is not the rung\'s');
  t.mock.timers.tick(5000); bot.entity.position = new Vec3(12, 64, 0);
  tried.settle(bot, goal, { q: 'encounter_stance' });
  assert.equal(stance.outcome, 'progressed');
  const wait = tried.begin(bot, goal, { q: 'fortress_leg', method: 'stay_in_fortress', waiting: true });
  assert.equal(wait.rung, undefined, 'a wait is judged by its world');
  const detour = tried.begin(bot, goal, { q: 'stillness_detour', method: 'work_free' });
  assert.equal(detour.rung, 'obtain_blaze_rods', 'the stall\'s answers carry the measure, to say what did not change');
  tried.watchRung(bot, goal);
  t.mock.timers.tick(20000);
  tried.settle(bot, goal, { q: 'stillness_detour' });
  assert.equal(detour.outcome, 'blocked', 'judged by the rung\'s best: none set');
  assert.match(detour.why, /^nothing gained on the rung: killed nothing, no rod/, 'and the rung\'s measure says why');
  assert(WAIT_ANSWERS.has('stay_in_fortress'));
});

test('eating is not something come of an answer, and more carried is', () => {
  const bot = mkBot(0, 64, 0, [item('cooked_beef', 4)]);
  const a = repeats.mark(bot);
  bot.inventory = { items: () => [item('cooked_beef', 2)] };
  assert.equal(repeats.cameOf(a, repeats.mark(bot), 0), null, 'eaten: no progress');
  bot.inventory = { items: () => [item('cooked_beef', 6)] };
  assert.equal(repeats.cameOf(a, repeats.mark(bot), 0), 'what is carried changed');
});

test('the repeat rule judges a rung\'s own answers by the measure, and the rest as before', () => {
  const bot = mkBot(0, 64, 0);
  const goal = goalAt({ fortressSearch: { found: { x: 300, y: 64, z: 0 } } });
  const a = repeats.mark(bot, goal, 'fortress_leg');
  assert(a.m && a.m.rung === 'obtain_blaze_rods', 'a question of the work\'s own carries the measure');
  bot.entity.position = new Vec3(20, 64, 0);
  assert.match(repeats.cameOf(a, repeats.mark(bot, goal, 'fortress_leg'), 0), /nearer fortress/, 'twenty blocks nearer the fortress');
  bot.entity.position = new Vec3(-25, 64, 0);
  assert.equal(repeats.cameOf(a, repeats.mark(bot, goal, 'fortress_leg'), 0), null, 'twenty-five blocks walked away is nothing');
  const b = repeats.mark(bot, goal, 'encounter_stance');
  assert.equal(b.m, undefined, 'a stance keeps the old rule');
  bot.entity.position = new Vec3(0, 64, 0);
  assert.match(repeats.cameOf(b, repeats.mark(bot, goal, 'encounter_stance'), 0), /^moved 25 blocks/);
});

test('repeat and ledger together: a question under the rung whose answer walks and gains nothing is asked twice from here, then escalated', async () => {
  const { decide } = require('../src/decisions');
  const run = async withRung => {
    const bot = mkBot(-114, 52, 138);
    const goal = withRung ? goalAt({ fortressSearch: { found: { x: -66, y: 73, z: 140 } } }) : { kind: 'win', step: { action: 'find_fortress' }, survival: {} };
    let asked = 0;
    const client = { systemOne: async ({ questions }) => { asked++; return { answers: { branch_0: { choice: Object.keys(questions.branch_0.criteria)[0], confidence: 0.7 } } }; } };
    const tree = () => ({ leg_west: { description: 'A leg west.' }, leg_east: { description: 'A leg east.' } });
    let escalated = null;
    for (let pass = 0; pass < 14 && !escalated; pass++) {
      // The blaze room's walk: eight blocks out and eight back, ending where it began, each pass.
      bot.entity.position = new Vec3(-114 + (pass % 2 ? 8 : 0), 52, 138);
      try { await decide('fortress_leg', { client, bot, goal, tree: tree(), state: { pass } }); }
      catch (err) { if (err.name !== 'Stalled') throw err; escalated = err.stall.escalated; }
    }
    return { asked, escalated };
  };
  const now = await run(true);
  assert(now.escalated, 'escalated');
  assert.equal(now.escalated.to, 'rung_progress');
  assert(now.asked <= 10, `${now.asked} askings before it was sent up`);
  const old = await run(false);
  // Without the rung's measure every walk out and back was getting somewhere by the ledger's rule; since note 749b
  // the question's own spell sends it up at its twelfth asking going nowhere, however quick (loops.js).
  assert.equal(old.asked, 11, 'the ledger alone never sent it up: the spell did');
  assert.match(old.escalated?.says || '', /12 askings over \d+ seconds? have gone nowhere/);
});

// ---- 25598, mid-242-bb-nether-1-fortress-9 (23:22 to 00:03Z, 2026-09-28) ----
// A bot beside a blaze room walked 352 blocks with a net of 55, was answered `detour` for 83% of forty minutes, asked unstuck_move 86 times,
// fortress_leg 53 times and rung_progress 68, with the measure not moving: the ledger called the walks getting somewhere.
function play(t, fixture, { rung }) {
  const T0 = Date.parse(fixture.from);
  t.mock.timers.reset();
  t.mock.timers.enable({ apis: ['Date'], now: T0 });
  const bot = mkBot(0, 64, 0);
  const goal = { kind: 'win', request: 'beat the game', from: 'TestPlayer', step: { action: 'find_fortress' }, survival: {}, mobHunt: { sightings: [] }, fortressSearch: {},
    ...(rung ? { gameProgress: { phase: 'obtain_blaze_rods', milestones: { nether_entered: { at: 1 } } }, rungTime: { phase: 'obtain_blaze_rods' } } : {}) };
  const resting = [], made = [];
  for (const r of fixture.rows) {
    t.mock.timers.setTime(T0 + r.t);
    bot.entity.position = new Vec3(...r.p);
    bot.inventory = { items: () => Object.entries(r.inv).map(([name, count]) => item(name, count)) };
    goal.mobHunt.sightings = fixture.sightings.slice(0, r.blazes).map(([x, y, z]) => ({ x, y, z, dimension: 'the_nether' }));
    goal.fortressSearch = r.found ? { found: { x: r.found[0], y: r.found[1], z: r.found[2] } } : {};
    tried.watchRung(bot, goal);
    tried.settle(bot, goal, { q: r.q });
    const waiting = WAIT_ANSWERS.has(r.method.split('/').at(-1));
    made.push(tried.begin(bot, goal, { q: r.q, method: r.method, waiting, offered: [{ key: r.method }] }));
    if (r.q === 'fortress_leg' || r.q === 'fortress_approach') {
      const list = tried.about(goal, { q: r.q, method: r.method, here: { x: r.p[0], y: r.p[1], z: r.p[2] }, now: Date.now() });
      if (tried.restsUntil(list, Date.now())) resting.push(r.q);
    }
  }
  t.mock.timers.setTime(T0 + fixture.rows.at(-1).t + 60000);
  tried.settle(bot, goal, { passEnd: false });
  return { goal, resting, made };
}
const tally = (entries, qs) => {
  const list = entries.filter(e => qs.includes(e.q) && e.outcome !== 'pending');
  return { n: list.length, progressed: list.filter(e => e.outcome === 'progressed').length, blocked: list.filter(e => e.outcome === 'blocked').length };
};

test('25598\'s forty minutes at the blaze room: the walks that gained nothing on the rung came to nothing, and the options rested', t => {
  const fixture = require('./fixtures/ledger-25598-detour.json');
  const qs = ['fortress_leg', 'fortress_approach'];
  const before = play(t, fixture, { rung: false });
  const after = play(t, fixture, { rung: true });
  const o = tally(before.made, qs), n = tally(after.made, qs);
  // The old rule: the walks about the room were getting somewhere about half the time; the new: rarely, and only for a real nearer approach.
  assert(o.n >= 90 && n.n === o.n, `${o.n} and ${n.n} answers judged`);
  assert(o.progressed / o.n > 0.25, `old: ${o.progressed} of ${o.n} getting somewhere`);
  assert(n.progressed / n.n < 0.12, `new: ${n.progressed} of ${n.n} getting somewhere`);
  assert(n.blocked >= o.blocked + 15, `${o.blocked} came to nothing before, ${n.blocked} now`);
  // Each said why, in the rung's words.
  const why = after.made.filter(e => qs.includes(e.q) && e.outcome === 'blocked' && /^nothing gained on the rung: killed nothing, no rod/.test(e.why || ''));
  assert(why.length >= 60, `${why.length} said why`);
  const summary = tried.summary(after.goal, { now: Date.now() }).join('\n');
  assert.match(summary, /coming to nothing/);
});

// ---- the replay script (scripts/ledger-replay.js) ----
test('the replay judges recorded answers by both rules: a leg walked 50 blocks to nothing on the rung, and a nearer approach with no walk', () => {
  const { classify } = require('../scripts/ledger-replay.js');
  const dec = (t, id, method, x, z, extra = {}) => ({ t, at: t + 100, id, method, last: method, p: { x, y: 64, z }, dim: 'nether', inv: {}, step: null, found: null, ...extra });
  const run = { file: 'flight/127_0_0_1-25599-Jev-2026-09-28T10-00-00-000Z.jsonl', start: 0, first: 0, last: 10 * 60000, phases: [{ phase: 'obtain_blaze_rods', at: 0 }], stood: [],
    decisions: [dec(1000, 'fortress_leg', 'leg_east', 0, 0, { found: { x: 300, y: 64, z: 0 } }), dec(60000, 'fortress_leg', 'leg_west', -50, 0, { found: { x: 300, y: 64, z: 0 } }),
      dec(120000, 'fortress_leg', 'leg_east', -50, 0, { found: { x: 300, y: 64, z: 0 } }), dec(180000, 'fortress_leg', 'leg_east', -50, 1, { found: { x: 300, y: 64, z: 0 } }), dec(240000, 'fortress_leg', 'go_on', 40, 1, { found: { x: 300, y: 64, z: 0 } })] };
  const rows = classify([run]);
  const at = t => rows.find(r => r.t === t);
  const wrong = at(1000);
  assert.equal(wrong.oldKind, 'progressed', 'the walk of 50 blocks the wrong way: old rule');
  assert.equal(wrong.newKind, 'nothing');
  assert.match(wrong.reason, /^nothing gained on the rung: killed nothing, no rod, no new ground looked over, no nearer the fortress \(350 blocks off, the nearest yet 300\), ended 50 blocks from where it began$/);
  assert.equal(at(60000).newKind, 'nothing', 'standing still');
  const toward = at(180000);
  assert.equal(toward.oldKind, 'progressed');
  assert.equal(toward.newKind, 'progressed', '90 blocks toward the fortress from where it stood: a new nearest');
  assert.match(toward.now, /^nearer the fortress, 260 blocks off from 350/);
  assert(rows.every(r => r.owned), 'a question below the rung, in a rung with a measure');
});
