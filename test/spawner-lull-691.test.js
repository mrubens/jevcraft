'use strict';
const { oldOrder } = require('./support/jev-stand-in');
// Note 691 (1): the lull at a live blaze spawner is the time to prepare.
// 25589 (mid-242-ch-nether-1-fortress-12) stood three blocks from the cage at
// (-152, 83, 168) with every blaze about out of its sight at 21:17:28Z
// (test/fixtures/spawner-lull-frame-25589.json, the frame; the room from a
// copy of the region as saved at the world's stop, 21:18:55Z, the cage put
// back where the spawns came: test/fixtures/spawner-lull-25589.json).
// encounter_stance was answered charge_nearest at 0.17 with box_here at
// 0.14; the next blazes came at 21:17:37, the fight was in the open, and the
// bot died at 21:18:24.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { groundBot } = require('./fixtures/saved-ground');
const clock = require('../src/spawner-clock');
const es = require('../src/empty-spawner');
const room = require('./fixtures/spawner-lull-25589.json');
const rec = require('./fixtures/spawner-lull-frame-25589.json');
require('../src/decisions/travel');
const { question } = require('../src/decisions');

const CAGE = new Vec3(rec.cage.x, rec.cage.y, rec.cage.z);
function frameBot({ at = rec.position, health = rec.health, food = rec.food, blazes = rec.blazes, items = null } = {}) {
  const carried = items || Object.entries(rec.inventory);
  const bot = groundBot(room, { at: new Vec3(at.x, at.y, at.z), health, food, items: carried, worn: ['iron_helmet', 'iron_chestplate'], dimension: 'the_nether', indexed: true,
    mobs: blazes.map(b => ({ id: b.id, name: 'blaze', at: new Vec3(b.position.x, b.position.y, b.position.z), height: 1.8 })) });
  bot.changed.set(`${CAGE.x},${CAGE.y},${CAGE.z}`, 'spawner');
  bot.inventory.slots[45] = { name: 'shield' };
  bot._spawnClock = { tries: {}, near: {} };
  return bot;
}
const T0 = Date.parse('2026-09-29T21:17:28.131Z');
// The tries seen before the frame: the blazes that came beside the cage.
const triesBefore = (bot, now) => { for (const t of rec.tries.map(Date.parse).filter(t => t < T0)) clock.noteTry(bot, CAGE, now - (T0 - t)); };

test('the recorded frame is a lull: no blaze in sight, three behind rock within sixteen, the next try due within seven seconds of the last seen 33 seconds before', () => {
  const bot = frameBot(), now = Date.now();
  triesBefore(bot, now);
  const l = clock.lull(bot, { now });
  assert.ok(l, 'a lull');
  assert.deepEqual({ x: l.cage.x, y: l.cage.y, z: l.cage.z }, rec.cage);
  assert.equal(l.within16, 3);
  assert.match(l.says, /^No blaze sees the bot now \(3 within sixteen out of its sight, behind rock\); the spawner 3\.2 blocks off tries up to 4 more every 10 to 40 seconds/);
  assert.match(l.says, /Its last try was seen 33\.\d seconds ago \(a blaze\), so the next comes within 6\.\d seconds from now/);
  assert.match(l.says, /with a box held 15 fights, 33% died, 27% brought a rod; in the open 341 fights, 34% died, 49% brought a rod/);
  // The job's words: its seconds and the chance it is done first.
  assert.match(clock.jobSays(l, 4), /About 4 seconds of it; done before the spawner's next try about \d+ times in 100/);
  assert.equal(clock.doneBefore({ from: 0, to: 40 }, 4), 0.9);
  assert.equal(clock.doneBefore({ from: 5, to: 20 }, 4), 1);
  assert.equal(clock.doneBefore({ from: 0, to: 0 }, 4), 0);
});

test('not a lull: a blaze in sight, a blaze at a sword\'s reach, or beyond sixteen of the cage', () => {
  const inSight = frameBot({ blazes: [...rec.blazes, { id: 9, position: { x: -151.5, y: 81, z: 162.5 } }] });
  assert.equal(clock.lull(inSight), null);
  const atReach = frameBot({ blazes: [{ id: 9, position: { x: -151.5, y: 81, z: 165.3 } }] });
  assert.equal(clock.lull(atReach), null);
  const far = frameBot({ at: { x: -151.5, y: 76, z: 152.5 }, blazes: [] });
  assert.equal(clock.lull(far), null);
});

test('in the lull the stance\'s box is said as built out of their fire, with its clock', () => {
  const bot = frameBot(), now = Date.now();
  triesBefore(bot, now);
  const stand = require('../src/blaze-stand');
  const danger = require('../src/danger').threats(bot, 48);
  const blazes = danger.filter(t => t.entity.name === 'blaze');
  assert.ok(blazes.length && !blazes.some(t => t.visible));
  const mid = blazes.reduce((s, t) => s.plus(t.entity.position), new Vec3(0, 0, 0)).scaled(1 / blazes.length);
  delete process.env.BLAZE_TACTICS_ALL;
  const opts = stand.tacticOptions(bot, danger, { blazes, biting: [], from: mid, aboutAll: blazes.map(t => t.entity), hp: bot.health, pocket: false, dig: true });
  // The record's box_here, three from the cage (the cage's raised floor is two
  // above the bot's: no cell by it takes a box from here, as the record had it).
  assert.ok(opts.box_here, `offered: ${Object.keys(opts).join(', ')}`);
  assert.match(opts.box_here.description, /Now no blaze sees the bot: the walls go up out of their fire\. About [\d.]+ seconds of it; done before the spawner's next try about \d+ times in 100/);
  // With a blaze in sight it is not offered outside the arena, as before.
  const seen = frameBot({ blazes: [...rec.blazes, { id: 9, position: { x: -151.5, y: 81, z: 162.5 } }] });
  const d2 = require('../src/danger').threats(seen, 48), b2 = d2.filter(t => t.entity.name === 'blaze');
  const o2 = stand.tacticOptions(seen, d2, { blazes: b2, biting: [], from: mid, aboutAll: b2.map(t => t.entity), hp: 20, pocket: false, dig: true });
  assert.ok(o2.box_here && !/Now no blaze sees the bot/.test(o2.box_here.description));
});

// The replay case's scene: full health, a wave cleared (none about), 60
// blocks carried, the spawner 8 blocks off.
const cleared = () => frameBot({ at: { x: -151.5, y: 80, z: 160.5 }, blazes: [], items: [['netherrack', 60], ['cooked_beef', 8], ['iron_sword', 1], ['iron_pickaxe', 1]] });

test('the hunt at a cleared spawner 8 blocks off: the ways to prepare are offered with their seconds against the clock', () => {
  const bot = cleared(), goal = { kind: 'win', survival: { deaths: [] }, fortressSearch: { legs: 1, map: { cells: {}, failed: {}, spawners: [{ ...rec.cage }], chests: [] } } };
  const known = es.knownSpawner(bot, goal);
  assert.equal(known.off, 9);
  known.lull = clock.lull(bot, { cage: known.cage });
  assert.ok(known.lull);
  const nav = async () => {};
  const tree = es.options(bot, { check() {} }, goal, () => {}, { navigate: nav }, known);
  for (const k of ['box_here', 'stand_by_spawner', 'step_out']) assert.ok(tree[k], `${k} offered: ${Object.keys(tree).join(', ')}`);
  // The cage stands on a raised floor the walk from here does not reach: no box beside it.
  assert.equal(tree.box_at_spawner, undefined);
  assert.match(tree.box_here.description, /wall it in, \d+ blocks of the 60 carried, one open at head height toward the spawner/);
  assert.match(tree.box_here.description, /done before the spawner's next try about \d+ times in 100 \(its last try not seen\)/);
  assert.match(tree.stand_by_spawner.description, /^Take a stand in the open at .* and fight its next blazes as they come; each that sees the bot shoots at it\. Nothing is built\./);
  assert.match(tree.step_out.description, /past 16: the spawner makes none and its clock stops/);
  // Full health, fed: the outage default builds.
  assert.equal(oldOrder('empty_spawner')(tree), 'box_here');
});

test('the box chosen in the lull is built without a blaze from the spawner cutting it, then held; the commit ends with the build', async () => {
  const bot = cleared(), goal = { kind: 'win', survival: { deaths: [] }, mobHunt: { item: 'blaze_rod' }, fortressSearch: { legs: 1, map: { cells: {}, failed: {}, spawners: [{ ...rec.cage }], chests: [] } } };
  const stand = require('../src/blaze-stand');
  const real = stand.huntFromStand;
  let during = null, option = null;
  stand.huntFromStand = async (b, task, g, save, actions, o) => { during = b._buildCommit; option = o; return 0; };
  try {
    const client = { systemOne: async ({ questions }) => ({ answers: { branch_0: { choice: Object.keys(questions.branch_0.criteria).find(k => /^box_/.test(k)), confidence: 0.6 } } }) };
    const done = await es.atSpawner(bot, { check() {} }, goal, () => {}, { client, navigate: async () => {} });
    assert.equal(done, true);
  } finally { stand.huntFromStand = real; }
  assert.equal(option.kind, 'box');
  assert.deepEqual(during.kinds, ['blaze']);
  assert.equal(bot._buildCommit, undefined);
  assert.match(goal.emptySpawner.built.key, /^box_/);
});

test('the arbiter: a blaze come out of the spawner does not cut a build begun in the lull; one at its reach, or another kind, does', () => {
  const arbiter = require('../src/arbiter');
  const look = mobs => ({ inLava: () => false, burning: () => false, headInBlock: () => false, mobs: () => mobs });
  const mob = (name, distance, id) => ({ entity: { name, id }, distance, visible: true });
  const botAt = () => ({ entity: { position: new Vec3(0, 64, 0) }, health: 20, food: 20, oxygenLevel: 20, entities: {}, stopDigging() {}, clearControlStates() {}, pathfinder: { setGoal() {} },
    _arbiter: { holder: { layer: 'work', action: 'box_in', since: 0, ids: [] } }, _buildCommit: { until: Date.now() + 10000, kinds: ['blaze'] } });
  assert.equal(arbiter.watchOnce(botAt(), { live: true, look: look([mob('blaze', 4, 5)]), log: () => {} }), null);
  assert.equal(arbiter.watchOnce(botAt(), { live: true, look: look([mob('blaze', 2.5, 5)]), log: () => {} })?.by, 'newcomer');
  assert.equal(arbiter.watchOnce(botAt(), { live: true, look: look([mob('wither_skeleton', 5, 6)]), log: () => {} })?.by, 'newcomer');
  const over = botAt(); over._buildCommit.until = Date.now() - 1;
  assert.equal(arbiter.watchOnce(over, { live: true, look: look([mob('blaze', 4, 5)]), log: () => {} })?.by, 'newcomer');
});

test('the clock: a blaze that comes into being beside the cage, the bot near it five seconds or more, is the spawner\'s try; one seen on coming near is not', () => {
  const bot = frameBot({ blazes: [] });
  delete bot._spawnClock;
  clock.watch(bot);
  assert.ok(bot._spawnClock, 'watching');
  const blaze = id => ({ id, name: 'blaze', position: new Vec3(-151.2, 83, 167.3) });
  bot.emit('entitySpawn', blaze(1));
  assert.equal(clock.nextTry(bot, CAGE).seen, 0, 'seen on coming near: already there');
  bot._spawnClock.near[`${CAGE.x},${CAGE.y},${CAGE.z}`].since -= 6000;
  bot.emit('entitySpawn', blaze(2)); bot.emit('entitySpawn', blaze(3));
  const next = clock.nextTry(bot, CAGE);
  assert.equal(next.seen, 1); assert.equal(next.lastBlazes, 2);
  assert.equal(next.from, 10); assert.equal(next.to, 40);
  // Far from the cage: not a try.
  bot.emit('entitySpawn', { id: 4, name: 'blaze', position: new Vec3(-140, 83, 150) });
  assert.equal(clock.nextTry(bot, CAGE).seen, 1);
});
