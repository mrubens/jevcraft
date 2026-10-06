'use strict';
// Note 791. What the Nether stays carried in, against what came of them
// (scripts/nether-kit.js over 2026-09-30T06:00Z to 2026-10-01T04:57Z: 111
// stays in 94 trials, 67 deaths): 108 crossed with a shield in the off hand
// and none with a spare; 24 shields broke there, and the Nether minutes after
// a break killed 4.4 an hour against 1.0 otherwise. The crossing's question
// was asked before all 99 crossings and never said a shield, armour or a
// ghast. Now each piece the record speaks to is offered at the crossing,
// priced from the pockets in Overworld minutes, with the stays with and
// without it; and in the Nether a spare shield is offered while the one held
// is worn, with its wear.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { EventEmitter } = require('node:events');
const { Task } = require('../src/skills');
const registry = require('minecraft-data')('26.1');
const kit = require('../src/entry-kit');

// A bot with what it carries, what it wears (slots 5 to 8) and the off hand (45).
function carrying(carried, { worn = {}, shieldUsed = 0, shield = true, dimension = 'overworld' } = {}) {
  const items = Object.entries(carried).filter(([, n]) => n > 0).map(([name, count], i) => ({ name, count, slot: 9 + i, type: registry.itemsByName[name].id, durabilityUsed: 0 }));
  const slots = [];
  for (const [slot, name] of Object.entries(worn)) slots[slot] = { name, count: 1, durabilityUsed: 0 };
  if (shield) slots[45] = { name: 'shield', count: 1, durabilityUsed: shieldUsed };
  return Object.assign(new EventEmitter(), {
    registry, health: 20, food: 20, oxygenLevel: 20,
    game: { gameMode: 'survival', dimension, difficulty: 'normal' }, time: { timeOfDay: 3000 },
    entity: { id: 1, position: new Vec3(0.5, 64, 0.5), height: 1.8, width: 0.6, onGround: true }, entities: {},
    inventory: { items: () => items, slots, emptySlotCount: () => 20 },
    findBlocks: () => [], blockAt: () => ({ name: 'air', boundingBox: 'empty', getProperties: () => ({}) }), world: { raycast: () => null },
    pathfinder: { movements: {}, setGoal() {} }, clearControlStates() {}, chat() {},
  });
}

test('at the crossing: a spare shield, the cheapest armour piece not had and a stack of one ghast-proof kind, each priced from the pockets with its record', () => {
  const bot = carrying({ raw_iron: 5, furnace: 1, coal: 3, oak_planks: 10, crafting_table: 1, cobblestone: 30, netherrack: 100, iron_pickaxe: 1 },
    { worn: { 5: 'iron_helmet', 6: 'iron_chestplate' }, shieldUsed: 100 });
  const offers = kit.offers(bot);
  assert.deepEqual(offers.map(o => [o.key, o.item, o.count]), [['shield', 'shield', 1], ['armour', 'iron_boots', 1], ['stone', 'cobblestone', 64]]);
  const [shield, armour, stone] = offers;
  assert.deepEqual([shield.key, shield.item, shield.count], ['shield', 'shield', 1]);
  assert.match(shield.says, /^A spare shield, carried in: 1 smelted from the 5 raw iron carried \(10 seconds an ingot in the furnace carried, the coal carried for fuel\); 6 of the 10 planks carried, at the crafting table carried; about 15 seconds in all\./);
  assert.match(shield.says, /The shield in the off hand has 236 of its 336 uses left, about 39 blaze fireballs blocked/);
  assert.match(shield.says, /150 crossed with a shield in the off hand and 118 with a spare; 7 shields broke in the Nether, 1 of those bots dead within two minutes, and the Nether minutes after a break killed 12\.86 an hour \(7 deaths in 33 minutes, 2 a blaze's\) against 1\.65 an hour/);
  assert.match(shield.says, /A spare in the pockets goes into the off hand by itself when the one held breaks\./);
  // Boots are the cheapest piece not had (4 iron); the helmet and chestplate are worn.
  assert.deepEqual([armour.key, armour.item], ['armour', 'iron_boots']);
  assert.match(armour.says, /^Iron boots first, the cheapest of the 2 pieces not had \(boots, leggings; iron boots 4, leggings 7\): 4 iron, 4 smelted from the 5 raw iron carried/);
  assert.match(armour.says, /with four armour pieces worn, 81 stays \(34\.5 Nether hours\): 0\.99 deaths an hour, 0\.09 of them a blaze's, 1\.19 rods an hour; without, 263 stays \(32\.9 Nether hours\): 2\.53 deaths an hour, 0\.27 of them a blaze's, 0\.7 rods an hour/);
  // 130 blocks carried, the crossing's count met, but only 30 of one ghast-proof kind.
  assert.deepEqual([stone.key, stone.item, stone.count], ['stone', 'cobblestone', 64]);
  assert.match(stone.says, /^64 cobblestone, one kind a ghast's fireball does not break, for covers and bridges: 30 carried, 34 more mined/);
  assert.match(stone.says, /netherrack and dirt break under a fireball/);
  assert.match(stone.says, /without, 156 stays \(28 Nether hours\): 1\.97 deaths an hour, 0\.21 of them a blaze's/);
});

test('what is had is not offered: a spare carried, four pieces worn or carried, golden boots for the feet, 64 of one ghast-proof kind; the blocks short are the ladder\'s', () => {
  const full = carrying({ shield: 1, iron_leggings: 1, golden_boots: 1, cobbled_deepslate: 64, netherrack: 64 }, { worn: { 5: 'iron_helmet', 6: 'diamond_chestplate' } });
  assert.deepEqual(kit.offers(full), []);
  // Under the crossing's 128 blocks the blocks rung is the ladder's (note 673): not offered here.
  const few = carrying({ shield: 1, iron_leggings: 1, iron_boots: 1, iron_helmet: 1, iron_chestplate: 1, cobblestone: 10 });
  assert.deepEqual(kit.offers(few), []);
  // Nothing in the Nether, in Creative or on Peaceful.
  const there = carrying({}, { dimension: 'the_nether' });
  assert.deepEqual(kit.offers(there), []);
});

test('with no iron at all the spare shield is priced with the mining, the record\'s minutes for iron said', () => {
  const bot = carrying({ oak_log: 1, iron_pickaxe: 1 }, { worn: { 5: 'iron_helmet', 6: 'iron_chestplate', 7: 'iron_leggings', 8: 'iron_boots' } });
  const [shield] = kit.offers(bot);
  assert.equal(shield.key, 'shield');
  assert.equal(shield.mined, true);
  assert.match(shield.says, /^A spare shield, carried in: 1 more mined and smelted, trials that chose it/);
  assert.match(shield.says, /; the 1 log carried and 2 more logs cut \(about 10\.4 seconds a log within a tree, plus the walk to one; note 787\), 4 of them for a crafting table; about 35 seconds beside the mining in all\./);
});

test('the crossing question offers them, cross_now says what going without means, and a top-up chosen is worked', async () => {
  const { crossingKitReady } = require('../src/work');
  const bot = carrying({ stick: 4, cooked_beef: 10, iron_ingot: 2, oak_planks: 10, crafting_table: 1, stone_pickaxe: 2, cobblestone: 140, golden_boots: 1, chest: 1, oak_log: 8 },
    { worn: { 5: 'iron_helmet', 6: 'iron_chestplate', 7: 'iron_leggings' } });
  let asked = null, pick = 'cross_now';
  const client = { systemOne: async ({ questions }) => { asked = questions.branch_0.criteria; return { answers: { branch_0: { choice: pick, confidence: 0.9 } } }; } };
  const goal = { kind: 'win', survival: {} };
  assert.equal(await crossingKitReady(bot, new Task('kit'), goal, () => {}, client), true);
  assert.deepEqual(Object.keys(asked).sort(), ['cross_now', 'top_up_shield']);
  assert.match(asked.cross_now, /Crossing now goes with no spare shield \(after a break the Nether killed 12\.86 an hour, 1\.65 otherwise\)\./);
  assert.match(asked.top_up_shield, /^A spare shield, carried in: 1 of the 2 iron ingots carried; 6 of the 10 planks carried, at the crafting table carried; about 5 seconds in all\./);
  assert.match(asked.top_up_shield, /Nothing has gone to it yet at this crossing\./);
  // Chosen: the step is the shield's, worked as any acquire is.
  asked = null; pick = 'top_up_shield'; delete goal.crossingKit;
  try { await crossingKitReady(bot, new Task('kit'), goal, () => {}, client); } catch (_) { /* the craft needs a live bot */ }
  assert.equal(goal.step.item, 'shield', 'the acquire for the shield took the step');
  assert.ok(goal.crossingKit.spent.shield, 'its minutes are counted at this crossing');
});

test('in the Nether a spare shield is offered from the pockets while the one held is worn: at two-thirds, again at a third, said with the wear', () => {
  const makings = { iron_ingot: 1, crimson_planks: 6, crafting_table: 1, iron_pickaxe: 1 };
  const at = used => kit.netherSpare(carrying(makings, { dimension: 'the_nether', shieldUsed: used }));
  assert.equal(at(100), null, '236 of 336 left: more than two-thirds');
  const one = at(120);
  assert.equal(one.band, 1);
  assert.match(one.says, /^Make a spare shield now, from what is carried \(an iron ingot: 1 of the 1 iron ingots carried; 6 of the 6 planks carried, at the crafting table carried\), about 5 seconds standing here: The shield in the off hand has 216 of its 336 uses left/);
  assert.match(one.says, /The worn one stays in the off hand until it breaks, and the spare goes on by itself then\. Of the 7 shields that broke in the Nether in the record, the pockets made a spare at 0 breaks and none was made/);
  assert.equal(at(230).band, 2, '106 left: a third or fewer');
  // A spare carried, no shield in hand, or no makings: nothing offered.
  assert.equal(kit.netherSpare(carrying({ ...makings, shield: 1 }, { dimension: 'the_nether', shieldUsed: 300 })), null);
  assert.equal(kit.netherSpare(carrying(makings, { dimension: 'the_nether', shield: false })), null);
  assert.equal(kit.netherSpare(carrying({ crimson_planks: 6, crafting_table: 1 }, { dimension: 'the_nether', shieldUsed: 300 })), null);
  // Raw iron with a furnace and coal: smelted first.
  const raw = kit.netherSpare(carrying({ raw_iron: 2, furnace: 1, coal: 1, crimson_planks: 10 }, { dimension: 'the_nether', shieldUsed: 300 }));
  assert.match(raw.says, /an iron ingot: 1 smelted from the 2 raw iron carried .*4 of them for a crafting table/);
  // Not in the Overworld.
  assert.equal(kit.netherSpare(carrying(makings, { shieldUsed: 300 })), null);
});

test('upkeep in the Nether offers spare_shield, and the decision specs carry the new options', async () => {
  const { upkeepOffers } = require('../src/work');
  const bot = carrying({ iron_ingot: 1, crimson_planks: 6, crafting_table: 1, iron_pickaxe: 1, netherrack: 64 }, { dimension: 'the_nether', shieldUsed: 250 });
  const { options } = await upkeepOffers(bot, new Task('upkeep'), { kind: 'win' }, () => {});
  assert.ok(options.spare_shield, Object.keys(options).join(','));
  assert.equal(options.spare_shield.band, 2);
  assert.match(options.spare_shield.description, /86 of its 336 uses left/);
  const { all } = require('../src/decisions');
  const spec = id => all().find(s => s.id === id);
  const keys = id => spec(id).options.map(o => o.key).filter(Boolean);
  for (const k of ['top_up_shield', 'top_up_armour', 'top_up_stone']) assert.ok(keys('crossing_kit').includes(k), k);
  assert.ok(keys('upkeep').includes('spare_shield'));
  assert.ok(spec('upkeep').commit.only.test('spare_shield'));
});

test('a carry-on over the spare shield at two-thirds is asked again when the shield comes to a third', async () => {
  const { upkeepStep } = require('../src/work');
  const bot = carrying({ iron_ingot: 1, crimson_planks: 6, crafting_table: 1, iron_pickaxe: 1, netherrack: 64 }, { dimension: 'the_nether', shieldUsed: 250 });
  let asked = null;
  const client = { systemOne: async ({ questions }) => { asked = questions.branch_0.criteria; return { answers: { branch_0: { choice: 'carry_on', confidence: 0.9 } } }; } };
  const goal = { kind: 'win', upkeepHold: { keys: 'spare_pickaxe,spare_shield:shield2', until: Date.now() + 60000 } };
  assert.equal(await upkeepStep(bot, new Task('upkeep'), goal, () => {}, client), false);
  assert.equal(asked, null, 'held at the same band');
  goal.upkeepHold = { keys: 'spare_pickaxe,spare_shield:shield1', until: Date.now() + 60000 };
  await upkeepStep(bot, new Task('upkeep'), goal, () => {}, client);
  assert.ok(asked?.spare_shield, 'asked again at the next band');
  assert.match(asked.spare_shield, /^Make a spare shield now/);
});
