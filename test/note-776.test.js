'use strict';
// Note 776: pre-Nether minutes went to errands that did not buy the Nether
// (artifacts/fable/checkin-20261001T0239Z.md problem 1). From 2026-09-30
// 20:00Z to 2026-10-01 03:00Z, 107 fresh trials, 3,731 pre-Nether minutes:
// the food for the Nether 848 of them (23%), the bed 193, the blocks 113;
// first Nether stays with 80 food points or more died more often (67%)
// than those without (55%), with the same blaze rods (35% and 34%). Every
// rung that may wait was the ladder's default before the Nether. Now a rung
// that may wait is the ladder's only where its stays show a benefit; the
// rest are offered with their minutes and record, the level plan orders
// what is left so each level is visited once.
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { Vec3 } = require('vec3');
const { Task } = require('../src/skills');
const registry = require('minecraft-data')('26.1');
const record = require('../src/kit-record');
const gp = require('../src/game-progress');
const levels = require('../src/levels');

const GEAR = ['diamond_pickaxe', 'iron_sword', 'shield', 'water_bucket', 'golden_boots'];
function fixture(names = GEAR, extra = {}) {
  const items = [...names.map(name => ({ name, count: 1 })), ...Object.entries(extra).map(([name, count]) => ({ name, count }))];
  const bot = Object.assign(new EventEmitter(), { registry, _client: new EventEmitter(), game: { dimension: 'overworld', gameMode: 'survival', difficulty: 'normal' }, chat() {},
    health: 20, food: 20, isAlive: true, entities: {}, time: { timeOfDay: 1000 }, entity: { position: new Vec3(0.5, 64, 0.5) }, inventory: { items: () => items, slots: [] } });
  return { bot, items, goal: { version: 1, kind: 'win', request: 'beat the game' }, task: new Task('win') };
}

test('the record and its rule: a rung that may wait is the ladder\'s before the Nether only with a benefit in the first stays', () => {
  // Golden boots: 42% of stays with them ended in a death against 67%
  // without, rods 32% and 35%. The iron sword: a rod 37% of stays against 9%.
  assert.equal(record.needBeforeNether('golden_boots'), true);
  assert.equal(record.needBeforeNether('iron_sword'), true);
  // No benefit: the food (67% died against 55%), the bed (rods 26% against
  // 41%), the armour (rods 23% against 42%), the kit's blocks and pickaxe.
  for (const p of ['nether_food', 'bed', 'home_bed', 'iron_armour', 'iron_helmet', 'nether_blocks', 'nether_pickaxe', 'nether_chest', 'bow']) assert.equal(record.needBeforeNether(p), false, p);
  // Too few stays without it to measure: no benefit shown.
  assert.deepEqual([record.benefitOf('shield').measured, record.benefitOf('shield').benefit], [false, false]);
  const food = record.rungRecordSays('nether_food');
  assert.match(food, /79 of 107 worked on it before the Nether, a median 10\.7 minutes each \(848 minutes in all, 23% of every pre-Nether minute\), and 20 of the 79 begun without it had it by the Nether/);
  assert.match(food, /with it 48, 67% ended in a death, 35% got a blaze rod; without it 65, 55% and 34%/);
  assert.match(food, /No benefit in the record: optional before the Nether, made only if chosen \(a rung that may wait is made before the Nether unasked only where/);
  assert.match(record.rungRecordSays('golden_boots'), /A benefit in the record: made before the Nether unless set aside/);
  assert.match(record.rungRecordSays('shield'), /Too few stays on a side to measure/);
});

test('the ladder goes on to the portal past the optional rungs; chosen, one is the ladder\'s until made; after a first Nether the ladder is as it was', () => {
  const { bot, goal } = fixture(GEAR, { cobblestone: 10 });
  // No bed, no armour, no food, ten blocks, one pickaxe: all optional.
  assert.equal(gp.nextGameStage(bot, goal).action, 'enter_nether', 'the portal next');
  assert.deepEqual(gp.openRungs(bot, goal), []);
  const optional = gp.optionalRungs(bot, goal).map(r => r.phase);
  // (The golden boots worn count for the feet: the armour's first piece missing is the helmet.)
  for (const p of ['bed', 'iron_helmet', 'nether_pickaxe', 'nether_blocks', 'nether_food']) assert(optional.includes(p), `${p} in ${optional}`);
  // Chosen: the ladder's next, until it is made.
  gp.optIn(goal, 'nether_food');
  assert.equal(gp.nextGameStage(bot, goal).phase, 'nether_food');
  assert(!gp.optionalRungs(bot, goal).some(r => r.phase === 'nether_food'), 'chosen, no longer offered as optional');
  bot.inventory.items().push({ name: 'cooked_beef', count: 12 });
  gp.settleOptIns(bot, goal);
  assert.equal(goal.rungOptIn, undefined, 'made, the choice is spent');
  bot.inventory.items().pop();
  assert.equal(gp.nextGameStage(bot, goal).action, 'enter_nether', 'eaten again, optional again: not handed back on the old choice');
  // A choice older than half an hour is spent too.
  goal.rungOptIn = { bed: Date.now() - gp.OPT_IN_MS - 1 };
  assert.notEqual(gp.nextGameStage(bot, goal).phase, 'bed');
  // After a first Nether entry the ladder rebuilds what a death took, as before.
  gp.observeProgress(bot, goal);
  goal.gameProgress.milestones.nether_entered = { at: Date.now(), dimension: 'nether' };
  assert.equal(gp.nextGameStage(bot, goal).phase, 'bed');
  assert.deepEqual(gp.optionalRungs(bot, goal), []);
});

test('a tool that may not wait still comes first, and the golden boots stay on the ladder', () => {
  const { bot, goal } = fixture(['stone_pickaxe', 'stone_sword']);
  assert.equal(gp.nextGameStage(bot, goal).phase, 'iron_pickaxe', 'the bed is no longer before the mine');
  const g2 = fixture(['diamond_pickaxe', 'iron_sword', 'shield', 'water_bucket']);
  assert.equal(gp.nextGameStage(g2.bot, g2.goal).phase, 'golden_boots');
});

test('win_strategy offers each optional rung with its record beside the Nether, and a choice of one holds', async () => {
  const { strategyStep, strategyOptions } = require('../src/strategy');
  const { bot, goal, task } = fixture(GEAR, { cobblestone: 10 });
  const stage = gp.nextGameStage(bot, goal);
  const options = strategyOptions(bot, goal, stage, {});
  assert(options.stage_reach_nether?.ladderNext, Object.keys(options).join(','));
  assert(options.rung_nether_food && options.rung_bed && options.rung_iron_helmet, Object.keys(options).join(','));
  assert.equal(options.rung_nether_food.ladderNext, false);
  assert.match(options.rung_nether_food.description, /^Get food carried for the Nether stay\./);
  assert.match(options.rung_nether_food.description, /No benefit in the record: optional before the Nether, made only if chosen/);
  const asked = [];
  const decide = async (id, args) => { asked.push(args); return { path: ['rung_nether_food'] }; };
  let now = Date.now();
  const r = await strategyStep(bot, task, goal, () => {}, stage, { decide, now: () => now });
  assert.equal(r.stage.phase, 'nether_food');
  assert.match(asked[0].state.beforeTheNether, /Optional before the Nether, not on the ladder unless chosen \(no benefit for them in the first Nether stays' record, kit-record\.js\): [^.]*nether food/);
  assert(gp.optedIn(goal, 'nether_food'));
  // The ladder's next is now the food; asked again a minute on, held.
  now += 60000;
  const again = await strategyStep(bot, task, goal, () => {}, gp.nextGameStage(bot, goal), { decide, now: () => now });
  assert.equal(asked.length, 1, 'held');
  assert.equal(again, null, 'the rung chosen is the ladder\'s own stage');
  // The Nether first leaves it and spends the choice.
  const nf = strategyOptions(bot, goal, gp.nextGameStage(bot, goal), {}).nether_first;
  await nf.run();
  assert.equal(goal.rungOptIn, undefined);
  assert.equal(gp.nextGameStage(bot, goal).action, 'enter_nether');
});

// mid-237-bc at 14:53:53Z, 86 blocks under open sky, the food and the
// diamond sword chosen: the plan by level puts the surface first, once, and
// the depth with the portal's lava last.
function deepBot(extra = {}) {
  const items = Object.entries({ iron_pickaxe: 3, coal: 125, iron_ingot: 29, cobblestone: 128, mutton: 5, iron_sword: 1, shield: 1, bucket: 1, golden_boots: 1, furnace: 1, ...extra })
    .map(([name, count]) => ({ name, count }));
  return {
    registry, health: 20, food: 18, game: { gameMode: 'survival', dimension: 'overworld', difficulty: 'normal' }, time: { timeOfDay: 1000 },
    entity: { position: new Vec3(110.5, -7, 40.5), height: 1.8, width: 0.6, onGround: true }, entities: {},
    inventory: { items: () => items.filter(i => i.count > 0), slots: [], emptySlotCount: () => 10 },
    blockAt: p => { const q = p.floored(); const solid = q.y < 79 && !(q.x === 110 && q.z === 40 && q.y >= -7 && q.y <= -6); return { name: solid ? 'stone' : 'air', position: q, boundingBox: solid ? 'block' : 'empty', getProperties: () => ({}) }; },
    findBlocks: () => [], world: { raycast: () => null }, pathfinder: { movements: {} },
  };
}

test('the plan by level: the surface\'s needs in one visit, the depth with the portal\'s lava last, the ladder ordered so (mid-237-bc)', () => {
  const bot = deepBot(), goal = { rungOptIn: { nether_food: Date.now(), diamond_sword: Date.now() } };
  assert.deepEqual(gp.openRungs(bot, goal, Date.now(), { ordered: false }).map(r => r.phase), ['diamond_sword', 'nether_food'], 'the ladder\'s own order');
  assert.deepEqual(gp.openRungs(bot, goal).map(r => r.phase), ['nether_food', 'diamond_sword'], 'the surface first, the depth last');
  assert.equal(gp.nextGameStage(bot, goal).phase, 'nether_food');
  const plan = levels.levelPlan(bot, goal);
  assert.deepEqual([plan.here, plan.last], ['down', 'down']);
  assert.match(plan.says, /The plan by level: the surface first, once, for all of it \(nether food, wood\); then depth, once \(diamond sword, the portal's lava\), the portal cast there beside its lava\./);
  assert.match(plan.says, /The bot is at depth now: the surface's needs are one trip there and back before the portal, all of them in it\./);
  // Water for the cast, owed at either level (25590 mid-218-ab, 02:53Z: a
  // climb of 31 blocks for one water bucket beside its lava).
  assert.match(plan.says, /On the way, at either level: water for the cast \(no water bucket carried; an empty bucket carried to fill\): water lies in lakes and rivers at the surface and in springs and aquifers underground, and is filled at whichever level is passed first on the way to the lava, not on a trip of its own\./);
  assert.match(levels.levelsSays(bot, goal), /The plan by level:/);
  // With the lava at the surface, the depth goes first and the surface last.
  const real = levels.levelPlan;
  levels.levelPlan = () => ({ here: 'down', last: 'up', of: { nether_food: 'up', diamond_sword: 'down', reach_nether: 'up' } });
  try { assert.deepEqual(gp.openRungs(bot, goal).map(r => r.phase), ['diamond_sword', 'nether_food']); }
  finally { levels.levelPlan = real; }
});

test('the wood kept for spare pickaxes is said as owed at the surface, taken while up there (25598 mid-241-bp)', () => {
  // 25598 at 02:50Z: on the iron pickaxe's step underground at night for one
  // oak log, its stone pickaxe at 3 uses, the surface left with no wood.
  const bot = deepBot({ cobblestone: 0 }), goal = {};
  const { up } = levels.owed(bot, goal);
  assert(up.some(x => /^wood toward the 6 logs' worth kept for spare pickaxes and a crafting table \(0 carried; trees grow at the surface\): taken while up there/.test(x)), up.join(' | '));
  const logs = deepBot({ oak_log: 6 });
  assert(!levels.owed(logs, {}).up.some(x => /^wood toward/.test(x)));
});

test('the per-rung measure: what each rung makes, how it came to be worked on, and what the new ladder would not have spent', () => {
  const pt = require('../scripts/portal-time');
  assert.equal(pt.hasRung('nether_food', { cooked_beef: 10 }), true);
  assert.equal(pt.hasRung('iron_armour', {}, { head: 'iron_helmet', torso: 'iron_chestplate', legs: 'iron_leggings' }), false);
  assert.equal(pt.hasRung('golden_boots', {}, { feet: 'golden_boots' }), true);
  const t0 = Date.parse('2026-09-30T21:00:00Z'), f = (s, o) => ({ t: t0 + s * 1000, dim: 'overworld', action: null, sa: null, decision: null, inventory: null, equipment: null, rung: null, ...o });
  const frames = [
    f(0, { decision: { id: 'win_strategy', answer: 'rung_nether_food', offered: ['rung_nether_food', 'nether_first'] } }),
    f(1, { rung: 'nether_food', action: 'hunt_food_for_nether', inventory: {} }),
    f(31, { rung: 'nether_food', action: 'ascend_to_surface' }),
    f(61, { rung: 'bed', action: 'gather_wool' }),
    f(121, { rung: 'reach_nether', action: 'fill_bucket', inventory: { cooked_beef: 10 } }),
    f(150, { rung: 'reach_nether', action: 'fill_bucket' }),
  ];
  const r = pt.rungsPursued(frames);
  assert.deepEqual(r.nether_food.by, { 'chosen, the Nether on offer': 1 });
  assert.equal(r.nether_food.climbMinutes, 0.5);
  assert.equal(r.nether_food.finished, true);
  assert.deepEqual(r.bed.by, { 'handed by the ladder': 1 });
  const sim = pt.simulateLevels({ rungsPursued: r, height: { climbs: [] } });
  assert.equal(sim.handed, 1, 'the bed the ladder handed is not handed now');
  assert.equal(sim.chosen, 1);
  assert(sim.chosenSaved > 0 && sim.chosenSaved < 1, 'the food named by Jev, weighed at the probe\'s rate');
});
