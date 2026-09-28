'use strict';
// mid-243-bd (25581, first-days 243, 2026-09-28 18:05 to 19:33Z, "loop: flipping enter_nether <-> tunnel"), note 630:
// a frame begun at (39, 110, -51), on a hilltop 43 blocks over its lava, nine lava buckets fetched, and no water
// bucket (dropped for room at 18:41 with the frame chosen). The cast asks for water first at every slot, so every pass
// walked back to the frame, found none, went for water (a leg or two of the search for it) and was walked back
// again: an hour within twenty blocks of the frame, a river seventy-two blocks off in the state of every question
// and in none of the ways' words; the rung, turned to a pickaxe rung and back, was never ten quiet minutes on one
// record; and the stairs to the frame, tried a walk first each pass, read as a flip.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { Task } = require('../src/skills');
const cast = require('../src/portal-cast');
const registry = require('minecraft-data')('26.1');
const { frameCells } = require('../src/ruined-portal');

const newFrame = (origin = new Vec3(39, 110, -51)) => ({ origin, axis: 'x', cast: true, castTemp: [], blocks: frameCells(origin, 'x').blocks.map(p => ({ x: p.x, y: p.y, z: p.z })) });
function fakeBot(carried, { at = new Vec3(8.5, 64, -30.5), dimension = 'overworld' } = {}) {
  const items = Object.entries(carried).map(([name, count]) => ({ name, count }));
  return { registry, entities: {}, oxygenLevel: 20, health: 20, food: 20, game: { gameMode: 'survival', dimension }, time: { timeOfDay: 6000 },
    entity: { position: at, height: 1.8, width: 0.6 }, inventory: { items: () => items, slots: [], emptySlotCount: () => 0 },
    findBlocks: () => [], blockAt: p => ({ name: p.y < 64 ? 'stone' : 'air', position: p.floored?.() || p, boundingBox: p.y < 64 ? 'block' : 'empty', getProperties: () => ({ level: 0 }) }),
    world: { raycast: () => null }, pathfinder: { movements: {}, setGoal() {} }, chat() {}, emit() {}, on() {}, removeListener() {} };
}
const withBiomes = (t, biomes) => {
  const exploration = require('../src/exploration');
  t.mock.method(exploration, 'biomeView', () => ({ biome: 'forest', biomesNearby: biomes }));
};
const RIVER = { biome: 'river', distance: 72, direction: 'south-west', x: -27, z: -21, has: 'water, sand, clay and gravel; squid and salmon spawn' };
const CAVES = { biome: 'dripstone_caves', distance: 45, direction: 'north-west', x: 16, z: -24, has: 'underground: pointed dripstone and copper ore; drowned in the water' };

test('a cast lacks water when none is carried, no obsidian is to be placed as it is, and none of its own stands to be scooped back', () => {
  const frame = newFrame();
  assert.equal(cast.castLacksWater(fakeBot({ lava_bucket: 9, bucket: 1 }), frame), true);
  assert.equal(cast.castLacksWater(fakeBot({ lava_bucket: 9, water_bucket: 1 }), frame), false);
  assert.equal(cast.castLacksWater(fakeBot({ lava_bucket: 9, obsidian: 4 }), frame), false, 'obsidian is placed as it is');
  assert.equal(cast.castLacksWater(fakeBot({ lava_bucket: 9 }), { ...frame, castWater: { x: 1, y: 2, z: 3 } }), false, 'the cast\'s own source is scooped back at the frame');
  assert.equal(cast.castLacksWater(fakeBot({ lava_bucket: 9 }), { ...frame, cast: false }), false, 'not a cast frame');
});

test('with lava in nine buckets and no water, the bot does not walk back to a frame it cannot cast at: the trip for water is made from where it is (note 630)', async () => {
  const { buildPortalFrame } = require('../src/work');
  const bot = fakeBot({ lava_bucket: 9, bucket: 1, cobblestone: 64 });
  const frame = newFrame(), goal = { portalFrame: frame };
  await buildPortalFrame(bot, new Task('cast'), goal, () => {}, frame).catch(() => {});
  assert.equal(bot._heading, undefined, 'no walk toward the frame was tried');
  assert.equal(goal.step?.action, 'fill_bucket');
  assert.equal(goal.step?.item, 'water_bucket');
  // With the water carried the walk back to the frame is tried, as before.
  const carrying = fakeBot({ lava_bucket: 9, water_bucket: 1, cobblestone: 64 });
  const goal2 = { portalFrame: newFrame() };
  await buildPortalFrame(carrying, new Task('cast'), goal2, () => {}, goal2.portalFrame).catch(() => {});
  assert.notEqual(carrying._heading, undefined, 'a walk toward the frame was tried');
});

test('stairs begun toward the frame go on without the walk tried first each pass while each pass brings the bot nearer (note 630)', async () => {
  const { buildPortalFrame } = require('../src/work');
  const now = Date.now();
  const bot = fakeBot({ lava_bucket: 9, water_bucket: 1, cobblestone: 64, stone_pickaxe: 1 }, { at: new Vec3(37.5, 27, -26.5) });
  const frame = newFrame(), goal = { portalFrame: frame };
  // A pass ago the stairs began from farther off: no walk this pass.
  frame.stairs = { at: now - 5000, distance: bot.entity.position.distanceTo(frame.origin) + 1.5, walk: 'No path to the goal!' };
  await buildPortalFrame(bot, new Task('cast'), goal, () => {}, frame).catch(() => {});
  assert.equal(bot._heading, undefined, 'the walk is not tried again while the stairs gain');
  assert.equal(goal.step?.action, 'return_to_frame');
  // Stairs that gained nothing: the walk is tried again.
  const stuck = fakeBot({ lava_bucket: 9, water_bucket: 1, cobblestone: 64, stone_pickaxe: 1 }, { at: new Vec3(37.5, 27, -26.5) });
  const frame2 = newFrame(), goal2 = { portalFrame: frame2 };
  frame2.stairs = { at: now - 5000, distance: stuck.entity.position.distanceTo(frame2.origin) - 1, walk: 'No path to the goal!' };
  await buildPortalFrame(stuck, new Task('cast'), goal2, () => {}, frame2).catch(() => {});
  assert.notEqual(stuck._heading, undefined, 'walk tried: the stairs had not brought it nearer');
});

test('where water is known is said to every way into the Nether when none is carried, and a cave\'s drowned water is not a place to fill a bucket', async t => {
  const { waterKnown } = require('../src/water');
  withBiomes(t, [CAVES, RIVER]);
  const bot = fakeBot({ lava_bucket: 9, bucket: 1 });
  const known = waterKnown(bot);
  assert.equal(known.kind, 'biome');
  assert.match(known.says, /^no water in view within 48 blocks; the nearest seen is the river 72 blocks south-west \(water, sand, clay and gravel/);
  bot.findBlocks = () => [new Vec3(20, 64, -30)];
  assert.match(waterKnown(bot).says, /^water in view \d+ blocks off$/);
  withBiomes(t, [CAVES]);
  bot.findBlocks = () => [];
  assert.match(waterKnown(bot).says, /^no water is known/);
});

test('the way into the Nether says where water is and how far when no bucket of it is carried, and says nothing of it when one is (note 630)', async t => {
  const { portalMethod } = require('../src/work');
  withBiomes(t, [RIVER]);
  const ask = async carried => {
    const bot = fakeBot(carried);
    let offered;
    const task = new Task('nether');
    task.opportunityClient = { systemOne: async ({ questions }) => { offered = questions.branch_0.criteria; return { answers: { branch_0: { choice: 'cast_frame', confidence: 0.7 } } }; } };
    await portalMethod(bot, task, {}, () => {}).catch(() => {});
    return offered;
  };
  const without = await ask({ bucket: 1, lava_bucket: 9, cobblestone: 64 });
  assert.match(without.cast_frame, /Water, for a bucket of it: no water in view within 48 blocks; the nearest seen is the river 72 blocks south-west/);
  assert.match(without.build_new, /Water, for a bucket of it: no water in view within 48 blocks; the nearest seen is the river 72 blocks south-west/);
  const carrying = await ask({ bucket: 1, water_bucket: 1, lava_bucket: 9, cobblestone: 64 });
  assert.doesNotMatch(carrying.cast_frame, /Water, for a bucket of it/);
});

test('the stall\'s question says what the cast is waiting for, and the walk to a river says it has the water (note 630)', async t => {
  const { answerStall } = require('../src/work');
  withBiomes(t, [CAVES, RIVER, { biome: 'plains', distance: 64, direction: 'west', x: -27, z: -53, has: 'grass, few trees; sheep, cows, pigs and chickens spawn' }]);
  const bot = fakeBot({ lava_bucket: 9, bucket: 1, cobblestone: 64, iron_pickaxe: 1 }, { at: new Vec3(35.5, 106, -43.5) });
  const frame = newFrame(), goal = { kind: 'win', request: 'beat the game', from: 'TestPlayer', survival: {}, rungTime: { phase: 'reach_nether' }, gameProgress: { phase: 'reach_nether', milestones: {} },
    portalFrame: frame, portalMethod: { kind: 'cast' }, step: { action: 'fill_bucket', item: 'water_bucket' } };
  const asked = [];
  const client = { model: 'jev', systemOne: async ({ state, questions }) => {
    const answers = {};
    for (const [b, q] of Object.entries(questions)) { const keys = Object.keys(q.criteria || {}); asked.push({ state, options: q.criteria }); answers[b] = { choice: keys[0], confidence: 0.6 }; }
    return { answers };
  } };
  const stall = { key: 'step:rung:reach_nether', work: 'step:rung:reach_nether', layer: 'work', strikes: 2 };
  await answerStall(bot, new Task('stall'), goal, () => {}, stall, { client }).catch(() => {});
  assert(asked.length >= 1, 'asked');
  const { state, options } = asked[0];
  assert.match(state.stalled.lacking, /The portal frame is being cast from lava and water, and its next block cannot be poured: no water bucket is carried \(1 empty bucket carried, filled at any water; 9 of lava carried\)\. Water: no water in view within 48 blocks; the nearest seen is the river 72 blocks south-west/);
  if (options.travel_river) {
    assert.match(options.travel_river, /It has water, which is what the portal frame's cast is waiting for: no water bucket is carried/);
    assert.doesNotMatch(options.travel_plains || '', /waiting for/);
  }
  // With the water carried, or on another rung, it says nothing.
  const other = { ...goal, rungTime: { phase: 'iron_pickaxe' }, gameProgress: { phase: 'iron_pickaxe', milestones: {} } };
  asked.length = 0;
  await answerStall(bot, new Task('stall'), other, () => {}, stall, { client }).catch(() => {});
  assert.equal(asked[0]?.state.stalled.lacking, undefined);
});

test('a rung the ladder turned from and came back to keeps its record: the minutes without a new best go on, the minutes away are not counted (note 630)', () => {
  const tried = require('../src/tried');
  const bot = fakeBot({ lava_bucket: 9 }, { at: new Vec3(39.5, 110, -49.5) });
  bot.game.dimension = 'overworld';
  const goal = { kind: 'win', request: 'beat the game', survival: {}, rungTime: { phase: 'reach_nether' }, gameProgress: { phase: 'reach_nether', milestones: {} } };
  const T0 = Date.parse('2026-09-28T18:33:00Z'), min = n => n * 60000;
  const on = (phase, ms) => { goal.rungTime.phase = phase; goal.gameProgress.phase = phase; return tried.watchRung(bot, goal, { now: T0 + ms }); };
  assert.equal(on('reach_nether', 0), null);
  for (let m = 0.5; m <= 9; m += 0.5) assert.equal(on('reach_nether', min(m)), null, `quiet at ${m}`);
  // The ladder turns to a pickaxe rung for eight minutes: its own record, and the nether's left as it was.
  assert.equal(on('iron_pickaxe', min(9.5)), null);
  for (let m = 10; m <= 17; m += 0.5) assert.equal(on('iron_pickaxe', min(m)), null);
  assert.equal(goal.tried.left.reach_nether.rung, 'reach_nether');
  // Back on it: 9 minutes without a new best before, so a minute more is its ten.
  assert.equal(on('reach_nether', min(17.5)), null);
  assert.equal(goal.tried.rung.rung, 'reach_nether');
  assert.equal(goal.tried.left?.reach_nether, undefined, 'taken back');
  assert.equal(on('reach_nether', min(18)), null);
  const due = on('reach_nether', min(18.5)) || on('reach_nether', min(19));
  assert(due, 'the rung\'s ten minutes ran out across the turn');
  assert.match(due.says, /minutes on the reach nether without a new best/);
});

test('a rung left for longer than three of its budgets begins a new record when it is come back to, and one that shows a new best does not go due', () => {
  const tried = require('../src/tried');
  const bot = fakeBot({}, { at: new Vec3(39.5, 110, -49.5) });
  const goal = { kind: 'win', request: 'beat the game', survival: {}, rungTime: { phase: 'reach_nether' }, gameProgress: { phase: 'reach_nether', milestones: {} } };
  const T0 = Date.parse('2026-09-28T18:33:00Z'), min = n => n * 60000;
  const on = (phase, ms) => { goal.rungTime.phase = phase; goal.gameProgress.phase = phase; return tried.watchRung(bot, goal, { now: T0 + ms }); };
  on('reach_nether', 0);
  for (let m = 0.5; m <= 9; m += 0.5) on('reach_nether', min(m));
  on('iron_pickaxe', min(9.5));
  on('iron_pickaxe', min(45));
  on('reach_nether', min(45.5));
  assert.equal(goal.tried.rung.idleMs, 0, 'a new record');
  assert.equal(goal.tried.rung.since, T0 + min(45.5));
});

test('the search\'s legs on each heading are kept when a stall turns it, so the next asking says where the bot has already been (note 630)', () => {
  const { turnSearch } = require('../src/work');
  const turned = turnSearch({ water: { attempts: 5, origin: { x: 1, y: 2, z: 3 }, frontier: { heading: 4, legs: 3, target: { x: 0, z: 0 }, legsByHeading: { 3: 2, 4: 1 } } } });
  assert.equal(turned.water.frontier.heading, 5);
  assert.deepEqual(turned.water.frontier.legsByHeading, { 3: 2, 4: 1 });
  assert.equal(turned.water.attempts, 0);
  const none = turnSearch({ water: { attempts: 1, frontier: { heading: 0, legs: 1 } } });
  assert.equal(none.water.frontier.legsByHeading, undefined);
});
