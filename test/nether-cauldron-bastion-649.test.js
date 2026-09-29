'use strict';
// Note 649: two features made reachable inside the Nether, where the trials now begin.
//  - The cauldron set (note 634) was asked only at the Overworld crossing; it is now a line of the stay's
//    kit question (nether_food_kit) when the bot carries a water bucket and 7 iron and a table or wood.
//  - A bastion's chests (note 636) were asked only at the pearl step; they are now a way to food at
//    restock_food and nether_food_kit when a bastion is remembered within reach.
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');
const { Vec3 } = require('vec3');
const registry = require('minecraft-data')('26.1');
const { Task } = require('../src/skills');
const { stayCauldron } = require('../src/crossing-kit');
const nf = require('../src/nether-food');
const raid = require('../src/bastion-raid');

const item = (name, count = 1) => ({ name, count, type: registry.itemsByName[name].id, durabilityUsed: 0 });
function bot({ items = [], health = 20, food = 20, dimension = 'the_nether' } = {}) {
  const at = new Vec3(0.5, 41, 0.5);
  const slots = [];
  return Object.assign(new EventEmitter(), {
    registry, health, food, foodSaturation: 0, entity: { id: 1, position: at, height: 1.8, width: 0.6, onGround: true, velocity: new Vec3(0, 0, 0) },
    game: { dimension, gameMode: 'survival', difficulty: 'normal' }, time: { timeOfDay: 6000 },
    inventory: { items: () => items, slots, emptySlotCount: () => 20 }, entities: {}, world: { raycast: () => null },
    blockAt: p => (Math.floor(p.y) < 41 ? { name: 'netherrack', boundingBox: 'block', position: p } : { name: 'air', boundingBox: 'empty', position: p }),
    findBlocks: () => [], chat() {},
  });
}
const kit = [item('iron_ingot', 9), item('water_bucket'), item('crafting_table')];
const save = () => {};
const asks = picks => { const asked = []; return { asked, systemOne: async ({ questions, state }) => { asked.push({ options: questions.branch_0.criteria, state }); return { answers: { branch_0: { choice: picks.shift(), confidence: 0.8 } } }; } }; };
const bastion = { kind: 'bastion', x: 100, y: 41, z: 0, dimension: 'nether' };
const goalWith = extra => ({ kind: 'win', portals: [{ x: 20, y: 44, z: 7, dimension: 'nether' }], sightings: {}, survival: {}, landmarks: [], ...extra });

test('the cauldron set is offered in the Nether only when it can be made there: a water bucket, 7 iron, a table or wood for one', () => {
  assert.match(stayCauldron(bot({ items: kit })).says, /7 of the 9 iron ingots carried in a U at a crafting table.*a crafting table is carried/);
  // Wood for the table: a log makes four planks.
  assert.match(stayCauldron(bot({ items: [item('iron_ingot', 7), item('water_bucket'), item('crimson_stem')] })).says, /a crafting table is made first from a log or stem carried/);
  assert.match(stayCauldron(bot({ items: [item('iron_ingot', 7), item('water_bucket'), item('oak_planks', 4)] })).says, /from 4 of the planks carried/);
  // No water is to be had in the Nether: an empty bucket is not a set, nor is 6 iron, nor no table or wood.
  assert.equal(stayCauldron(bot({ items: [item('iron_ingot', 9), item('bucket'), item('crafting_table')] })), null);
  assert.equal(stayCauldron(bot({ items: [item('iron_ingot', 6), item('water_bucket'), item('crafting_table')] })), null);
  assert.equal(stayCauldron(bot({ items: [item('iron_ingot', 9), item('water_bucket')] })), null);
  // Already carried; the Overworld (the crossing kit's line); nothing is given.
  assert.equal(stayCauldron(bot({ items: [...kit, item('cauldron')] })), null);
  assert.equal(stayCauldron(bot({ items: kit, dimension: 'overworld' })), null);
  assert.equal(stayCauldron(bot({ items: [item('iron_sword')] })), null);
});

test('the price says what it saves, what it costs and where it must be used, and that no trial has played it', () => {
  const s = stayCauldron(bot({ items: kit })).says;
  assert.match(s, /fire is about 40% of the damage taken in the blaze fights that killed the bot, 44 of 70 blaze deaths were alight at the end, and a fireball that lands costs its hit plus about four ticks of fire/);
  assert.match(s, /set down near the fight before the bot is alight, or carried and set down when it is \(the way set_down_cauldron/);
  assert.match(s, /an iron pickaxe is 3 of them/);
  assert.match(s, /about a second in the open/);
  assert.match(s, /the water bucket is spent filling it/);
  assert.match(s, /Not yet played: no trial has carried the set/);
});

test('the stay kit is asked for the cauldron alone when food is not short; the pick crafts it, and the question is not asked again for an hour', async () => {
  const b = bot({ items: [item('cooked_beef', 12), ...kit] }), goal = goalWith();
  assert.equal(nf.stayKitDue(b, goal).short, 0);
  const crafted = []; const actions = { acquire: async (bb, t, name, n) => { crafted.push([name, n]); }, navigate: async () => {} };
  const client = asks(['top_up_cauldron']);
  assert.equal(await nf.askStayKit(b, new Task('t'), goal, save, { actions, client }), 'top_up_cauldron');
  assert.deepEqual(Object.keys(client.asked[0].options).sort(), ['go_on', 'top_up_cauldron']);
  assert.match(client.asked[0].options.go_on, /food is not short/);
  assert.match(client.asked[0].options.top_up_cauldron, /^Make the cauldron set for the Nether's fire now: A cauldron for the fire, made here/);
  assert.match(client.asked[0].state.note, /food and cauldron lines/);
  assert.deepEqual(crafted, [['cauldron', 1]]);
  assert.equal(nf.stayKitDue(b, goal), null, 'asked once an hour whatever the answer');
  // Go on: nothing is crafted.
  const b2 = bot({ items: [item('cooked_beef', 12), ...kit] }), g2 = goalWith(), c2 = asks(['go_on']), made = [];
  assert.equal(await nf.askStayKit(b2, new Task('t'), g2, save, { actions: { acquire: async () => made.push(1) }, client: c2 }), 'go_on');
  assert.deepEqual(made, []);
  // No set to make and food enough: not asked at all.
  assert.equal(nf.stayKitDue(bot({ items: [item('cooked_beef', 12)] }), goalWith()), null);
});

test('a craft that fails is said and the stay goes on; the fallback never makes the cauldron', async () => {
  const b = bot({ items: [item('cooked_beef', 12), ...kit] }), goal = goalWith();
  const actions = { acquire: async () => { throw new Error('no crafting table could be put down here'); } };
  assert.equal(await nf.askStayKit(b, new Task('t'), goal, save, { actions, client: asks(['top_up_cauldron']) }), 'top_up_cauldron');
  assert.match(goal.netherFoodKit.cauldronFailed, /no crafting table could be put down/);
  const { question } = require('../src/decisions');
  assert.equal(question('nether_food_kit').fallback({ go_on: {}, top_up_cauldron: {}, raid_bastion: {} }), 'go_on');
});

test('with food short the kit carries the cauldron beside the food ways, and a bastion route when one is remembered', async () => {
  const b = bot({ items: [item('mutton', 2), ...kit] }), goal = goalWith({ landmarks: [bastion] });
  const actions = { returnOverworld: async () => {}, navigate: async () => {}, acquire: async () => {} };
  const client = asks(['go_on']);
  await nf.askStayKit(b, new Task('t'), goal, save, { actions, client });
  assert.deepEqual(Object.keys(client.asked[0].options).sort(), ['go_on', 'raid_bastion', 'return_for_food', 'top_up_cauldron']);
  const d = client.asked[0].options.raid_bastion;
  assert.match(d, /^Raid the chests of the bastion at \(100, 0\), 100 blocks off, 1 leg, for their food/);
  assert.match(d, /hoglin stable's chest about 17 food points on average.*housing units' chests about 12.*the bridge's none/);
  assert.match(d, /Lifting a lid angers every piglin within 16 blocks that sees it, gold armor or not, and a brute attacks on sight within 12/);
  assert.match(d, /Priced from the game's numbers, not measured on a bastion/);
  assert.match(d, /not yet tried/);
  assert.equal(goal.bastionRaid, undefined, 'asking chooses nothing');
});

test('restock_food offers the bastion route when one is remembered and not otherwise; choosing it is the raid Jev chose', async () => {
  const b = bot({ health: 12, food: 15, items: [item('iron_sword')] });
  const walked = [];
  const actions = { returnOverworld: async () => {}, navigate: async (bb, t, g) => { walked.push([g.x, g.z]); bb.entity.position = new Vec3(g.x, 41, g.z); } };
  // No bastion: no route.
  let found = nf.foodRoutes(b, new Task('t'), goalWith(), save, { actions });
  assert.ok(!found.routes.raid_bastion);
  assert(found.notOffered.some(s => /a bastion's chests: none remembered within 384 blocks/.test(s)));
  // Remembered: on offer, with keep_on beside it, so the raid is never the only thing to take.
  const goal = goalWith({ landmarks: [bastion] });
  found = nf.foodRoutes(b, new Task('t'), goal, save, { actions });
  assert.ok(found.routes.raid_bastion);
  const client = asks(['raid_bastion']);
  assert.equal(await nf.askRestockFood(b, new Task('t'), goal, save, { actions, client }), true);
  assert.deepEqual(Object.keys(client.asked[0].options).sort(), ['keep_on', 'raid_bastion', 'return_for_food']);
  assert.equal(goal.bastionRaid.via, 'food');
  assert.equal(goal.bastionRaids[0].pick, 'raid_chests'); assert.equal(goal.bastionRaids[0].via, 'food');
  // The walk arrived and no chest was in reach: the raid closes as the gold rung's does, nothing opened.
  assert.equal(goal.bastionRaids[0].outcome, 'nothing'); assert.equal(raid.raidOn(goal), false);
  // Chosen and not yet arrived, the chests are opened by the loot pass while it is on (looting.js).
  const far = goalWith({ landmarks: [bastion] });
  const stuck = { navigate: async () => { throw new Error('no path'); } };
  const b3 = bot({ health: 12, food: 15, items: [item('iron_sword')] });
  await nf.foodRoutes(b3, new Task('t'), far, save, { actions: stuck }).routes.raid_bastion.run();
  assert.equal(raid.raidOn(far), true);
  assert.equal(walked.length, 1); assert.equal(walked[0][0] > 60, true, 'a leg toward the bastion');
  // A raid already on: not offered again.
  assert.ok(!nf.foodRoutes(b3, new Task('t'), far, save, { actions }).routes.raid_bastion);
  // Without a way to walk: not offered.
  assert.ok(!nf.foodRoutes(b, new Task('t'), goalWith({ landmarks: [bastion] }), save, { actions: {} }).routes.raid_bastion);
  const { question } = require('../src/decisions');
  assert.equal(question('restock_food').fallback({ raid_bastion: {}, keep_on: {} }), 'keep_on');
});

test('the step offered at the stalls names the bastion among the ways', () => {
  const b = bot({ health: 12, food: 15, items: [item('iron_sword')] });
  const opt = nf.restockFoodOption(b, new Task('t'), goalWith({ landmarks: [bastion] }), save, { actions: { navigate: async () => {} } });
  assert.match(opt.description, /the food in a bastion's chests \(a hoglin stable's chest about 17 points, the others about 12, piglins and brutes at the lids; never tried by this bot\)/);
});
