'use strict';
// The pearls beside the rods in the Nether (note 788): the ladder took the
// rods first by rule and the pearls never came (no pearl carried in 1,521
// trials); a way to the pearls real from here is Jev's to weigh against the
// rods, asked and held, each said with its record and what it shares with the
// rods' trip.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const registry = require('minecraft-data')('26.1');
const { setAside } = require('../src/progress');
const { nextGameStage, observeProgress } = require('../src/game-progress');
const order = require('../src/pearl-order');
const record = require('../src/pearl-record');

const ITEMS = { iron_sword: 1, iron_pickaxe: 1, netherrack: 40, cooked_beef: 12, blaze_rod: 2 };
function nether({ items = ITEMS, entities = {}, landmarks = [], dimension = 'the_nether' } = {}) {
  const list = Object.entries(items).map(([name, count]) => ({ name, count, type: registry.itemsByName[name]?.id }));
  const bot = { registry, game: { dimension, gameMode: 'survival', difficulty: 'normal' }, health: 20, food: 20, isAlive: true, chat() {}, emit() {},
    entity: { id: 1, position: new Vec3(0, 64, 0) }, time: { timeOfDay: 6000 }, entities,
    inventory: { items: () => list, slots: [] }, findBlocks: () => [], clearControlStates() {},
    blockAt: p => ({ position: p, name: p.y < 64 ? 'netherrack' : 'air', boundingBox: p.y < 64 ? 'block' : 'empty' }),
    pathfinder: { movements: { blocksCantBreak: new Set() }, setGoal() {}, getPathTo: () => ({ status: 'noPath', path: [] }) } };
  const goal = { kind: 'win', request: 'beat the game', from: 'TestPlayer', survival: {},
    landmarks: [{ kind: 'nether_fortress', x: 200, y: 60, z: 0, dimension: 'nether' }, ...landmarks],
    portals: [{ x: 0, y: 70, z: 0, dimension: 'overworld' }, { x: 2, y: 64, z: 2, dimension: 'nether' }] };
  observeProgress(bot, goal);
  return { bot, goal };
}
const enderman = (id, x, z = 0) => ({ id, name: 'enderman', position: new Vec3(x, 64, z), isValid: true });
const forest = (x, z) => ({ kind: 'warped_forest', x, y: 64, z, dimension: 'nether' });
const client = (pick, asked) => ({ model: 'jev', systemOne: async ({ state, questions }) => {
  const answers = {};
  for (const [b, q] of Object.entries(questions)) { asked.push({ state, options: q.criteria }); answers[b] = { choice: Object.keys(q.criteria).includes(pick) ? pick : Object.keys(q.criteria)[0], confidence: 0.8 }; }
  return { answers };
} });
const task = { check() {}, opportunityClient: null };

test('the rods the step and short, the pearls short: with no way to the pearls real here the rods go on as before; with an enderman in reach the order is asked', () => {
  const quiet = nether();
  const before = nextGameStage(quiet.bot, quiet.goal);
  assert.equal(before.phase, 'obtain_blaze_rods'); assert.equal(before.action, 'acquire');
  const { bot, goal } = nether({ entities: { 9: enderman(9, 12) } });
  const stage = nextGameStage(bot, goal);
  assert.equal(stage.action, 'pearl_order');
  assert.equal(stage.because, 'not asked before');
});

test('not in the Overworld, and not while the rods rest (the ladder\'s pearl routes take it then, as before)', () => {
  const { bot, goal } = nether({ entities: { 9: enderman(9, 12) } });
  setAside(goal, 'rung', 'obtain_blaze_rods', 'the fortress search rests', 1800000);
  assert.notEqual(nextGameStage(bot, goal).action, 'pearl_order');
  assert.equal(order.orderStage({ ...bot, game: { dimension: 'overworld' } }, goal), null);
});

test('every way is said with its record and what it shares with the rods\' trip; the enderman chosen is the step while one is in view, then the rods, and the answer stands until a new kind of way is real', async () => {
  const ender = enderman(9, 12);
  const { bot, goal } = nether({ entities: { 9: ender }, items: { ...ITEMS, gold_ingot: 9, golden_boots: 1 } });
  const asked = [];
  const pick = await order.ask(bot, task, goal, () => {}, { client: client('hunt_enderman', asked) });
  assert.equal(pick, 'hunt_enderman');
  const o = asked[0].options;
  assert.deepEqual(Object.keys(o).filter(k => k !== 'none_good').sort(), ['hunt_enderman', 'rods_first']);
  assert.match(o.rods_first, /never carried a pearl/);
  assert.match(o.rods_first, /a fortress known 200 blocks off/);
  assert.match(o.hunt_enderman, /median 8\.9 s, 5 pearls from 8 kills/);
  assert.match(o.hunt_enderman, /none was ever struck/);
  assert.match(o.hunt_enderman, /This run: not chosen yet/);
  assert.match(JSON.stringify(asked[0].state), /rods.*2 carried of 7 wanted/);
  // Held: the hunt is the step.
  let stage = nextGameStage(bot, goal);
  assert.equal(stage.phase, 'obtain_ender_pearls'); assert.equal(stage.action, 'acquire'); assert.equal(stage.item, 'ender_pearl'); assert.equal(stage.count, 1);
  // The enderman gone past 48: the rods again, not asked again.
  ender.position = new Vec3(80, 64, 0);
  stage = nextGameStage(bot, goal);
  assert.equal(stage.phase, 'obtain_blaze_rods'); assert.equal(stage.action, 'acquire');
  assert.match(goal.pearlOrder.ended.why, /no enderman left within 48/);
  // Back within 24: a kind already offered, the answer stands (the rods).
  ender.position = new Vec3(10, 64, 0);
  assert.equal(nextGameStage(bot, goal).action, 'acquire');
  // A warped forest found: a way not on offer at the answer, asked again.
  goal.landmarks.push(forest(150, 120));
  stage = nextGameStage(bot, goal);
  assert.equal(stage.action, 'pearl_order');
  assert.match(stage.because, /a warped forest known and open/);
});

test('rods first held: the rods go on; a death since, or the half hour out, asks again', async () => {
  const { bot, goal } = nether({ entities: { 9: enderman(9, 12) } });
  const asked = [];
  assert.equal(await order.ask(bot, task, goal, () => {}, { client: client('rods_first', asked) }), 'rods_first');
  assert.equal(nextGameStage(bot, goal).action, 'acquire');
  goal.survival.deaths = [{ at: new Date(Date.now() + 1000).toISOString() }];
  assert.match(order.orderStage(bot, goal, { now: Date.now() + 2000 }).because, /died since/);
  goal.survival.deaths = [];
  assert.match(order.orderStage(bot, goal, { now: Date.now() + order.HOLD_MS + 1 }).because, /has run its time/);
});

test('the forest and the barter: said with the forest\'s distance from the fortress, the gold\'s pearls, and the measured barter; the forest chosen is the warped hunt until it rests', async () => {
  const piglin = { id: 5, name: 'piglin', position: new Vec3(8, 64, 0), isValid: true, metadata: [] };
  const { bot, goal } = nether({ entities: { 5: piglin }, landmarks: [forest(150, 120)], items: { ...ITEMS, gold_ingot: 18, golden_boots: 1 } });
  const asked = [];
  assert.equal(await order.ask(bot, task, goal, () => {}, { client: client('warped_forest', asked) }), 'warped_forest');
  const o = asked[0].options;
  assert.match(o.warped_forest, /warped forest at \(150, 120\), 192 blocks off/);
  assert.match(o.warped_forest, /130 blocks from the warped forest known/);
  assert.match(o.warped_forest, /5 pearls \(about 5\.6 minutes a pearl in the forest/);
  assert.match(o.barter_gold, /gold for 18 ingots carried, 18 to throw.*about 2 pearls/);
  assert.match(o.barter_gold, /160 ingots thrown bought 18 pearls/);
  assert.equal(nextGameStage(bot, goal).action, 'warped_pearls');
  setAside(goal, 'rung', 'warped_pearls', 'fifteen minutes in the warped forest without a pearl', 1800000);
  const stage = nextGameStage(bot, goal);
  assert.equal(stage.phase, 'obtain_blaze_rods'); assert.equal(stage.action, 'acquire');
});

test('this run\'s record: a way held is settled at the next asking, its minutes, pearls and deaths said on its option', () => {
  const goal = { survival: {} };
  const at = Date.now() - 12 * 60000;
  record.settle(goal, { pick: 'hunt_enderman', at, until: at + 30 * 60000, pearlsAt: 0 }, { pearls: 3, deaths: 0, now: Date.now() });
  assert.match(record.runSays(goal, 'hunt_enderman'), /chosen 1 time, held 12 minutes, 3 pearls brought \(4 minutes a pearl\), 0 deaths/);
});
