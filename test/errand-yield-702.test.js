'use strict';
// Errands and holds said with what they are for and what they have come to
// (note 702): a food stock-up with its hunger, points and reserve, rested when
// three minutes keep nothing; a hold at a live cage with its minutes, kills,
// rods and health lost; a fetch away from a known fortress with the distances
// and the health it walks with; a hoglin as food when food is lacking.
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { Vec3 } = require('vec3');
const registry = require('minecraft-data')('26.1');

const stack = (name, count = 1) => ({ name, count, type: registry.itemsByName[name]?.id ?? 0 });
function bareBot({ items = [], food = 20, health = 20, dimension = 'overworld', position = new Vec3(0, 64, 0), entities = {} } = {}) {
  const inv = items.map(i => Array.isArray(i) ? stack(...i) : stack(i));
  return Object.assign(new EventEmitter(), { registry, version: '26.1', health, food, game: { dimension, gameMode: 'survival', difficulty: 'normal' },
    entity: { position, onGround: true, height: 1.8, velocity: new Vec3(0, 0, 0) }, entities, inventory: { items: () => inv, slots: [] },
    world: { raycast: () => null }, blockAt: () => null, findBlocks: () => [], chat() {} });
}

// 25595 (mid-242-mb) at 23:48:10Z: hunger 20, 15 beef, 14 mutton and 4 cooked
// mutton carried, the Nether's 80 wanted (the flight record's frame).
const STOCKED = [['beef', 15], ['mutton', 14], ['cooked_mutton', 4]];

test('the food option says the hunger, the points carried of the reserve and what it is for, and what cooking the raw adds', () => {
  const fe = require('../src/food-errand');
  const bot = bareBot({ items: STOCKED, food: 20 });
  const supply = require('../src/foraging').foodSupply(bot);
  assert.equal(supply, 15 * 3 + 14 * 2 + 4 * 6);
  const says = fe.says(bot, { preparingNether: true }, { supply, desired: 80, hungry: false });
  assert.match(says, /^Get food\. Hunger 20, full: health is full; the 97 points carried are eaten as it falls\. This trip is for the reserve alone\. 97 food points carried of the 80 kept for the Nether stay \(about 40 hunger an hour there, and health comes back only at hunger 18 or more\): 0 short\./);
  assert.match(says, /Cooking the raw meat carried \(15 beef, 14 mutton\) adds 131 points\./);
  // Hungry, with what is carried filling the bar: eating meets it.
  const hungry = bareBot({ items: [['bread', 3]], food: 12 });
  assert.match(fe.says(hungry, {}, { supply: 15, desired: 24, hungry: true }), /Hunger 12, health full: nothing waits on the hunger now; the 15 food points carried bring it to eighteen or more when eaten, in seconds\. This trip is for the reserve alone \(the hunger is a meal of what is carried\)\. 15 food points carried of the 24 kept for healing and the night: 9 short\./);
  assert.match(fe.says(bareBot({ food: 10 }), {}, { supply: 0, desired: 12, hungry: true }), /Hunger 10, health full: nothing waits on the hunger now; nothing carried to eat\. This is for the hunger\./);
  assert.match(fe.says(bareBot({ food: 10, health: 15 }), {}, { supply: 0, desired: 12, hungry: true }), /Hunger 10, under eighteen: health does not come back until it is eaten back to eighteen, 8 points short; nothing carried covers any of it\. This is for the hunger\./);
});

test('a stock-up that keeps nothing in three minutes has no yield; a gain measures it again from there', () => {
  const fe = require('../src/food-errand');
  const t0 = Date.parse('2026-09-29T23:41:19Z'), holder = {};
  // 25595's reserve: 76, eaten to 64 by the healing, hunted back to 74.
  let e = fe.track(holder, { supply: 76, desired: 80, now: t0 });
  e = fe.track(holder, { supply: 64, desired: 80, now: t0 + 50000 });
  e = fe.track(holder, { supply: 74, desired: 80, now: t0 + 108000 });
  assert.equal(fe.noYield(e, 74, t0 + 108000), false, 'under three minutes');
  e = fe.track(holder, { supply: 74, desired: 80, now: t0 + 180000 });
  assert.equal(fe.noYield(e, 74, t0 + 180000), true);
  assert.match(fe.restWhy(e, 74, t0 + 180000), /^3 minutes of the food errand kept nothing: 76 points carried then, 74 now$/);
  assert.match(fe.yieldSays(e, 74, t0 + 180000), /^ This errand so far: 3 minutes, asked 4 times, 76 points carried at its start and 74 now\.$/);
  // A gain kept is getting somewhere: the three minutes run from it.
  const h2 = {};
  fe.track(h2, { supply: 60, desired: 80, now: t0 });
  const g = fe.track(h2, { supply: 70, desired: 80, now: t0 + 120000 });
  assert.equal(fe.noYield(g, 70, t0 + 200000), false);
  assert.equal(fe.noYield(g, 70, t0 + 300000), true);
  // Ten minutes apart, or another reserve, it is a new errand.
  assert.equal(fe.track(h2, { supply: 70, desired: 80, now: t0 + 20 * 60000 }).asks, 1);
  assert.equal(fe.track(h2, { supply: 70, desired: 12, now: t0 + 20 * 60000 + 1 }).asks, 1);
});

test('food looked for while not hungry is said as stocking up, never "I\'m hungry"', () => {
  const n = require('../src/narration');
  const fed = bareBot({ items: STOCKED, food: 20 });
  const goal = { survivalAction: { action: 'search_food', at: '2026-09-29T23:48:30Z' } };
  const line = n.narrate(fed, goal, { now: Date.parse('2026-09-29T23:48:30Z') });
  assert.doesNotMatch(line, /hungry/i);
  assert.match(line, /stock|Topping up/i);
  // Hunger 17 with 97 points carried: eating fills it, so still not hungry.
  assert.doesNotMatch(n.narrate(bareBot({ items: STOCKED, food: 17 }), { survivalAction: { action: 'search_food', at: 'x' } }, { now: 1 }), /hungry/i);
  // Hungry with nothing to eat: said as hunger.
  const lines = n.survivalLines('search_food', { fed: false });
  assert(lines.some(l => /hungry/.test(l)));
});

test('cooking toward the Nether\'s reserve counts what cooking adds over the raw', async () => {
  const { forageChoices } = require('../src/foraging');
  const bot = bareBot({ items: [['beef', 15]], food: 20 });
  bot.pathfinder = { movements: {}, getPathTo: () => ({ status: 'success', path: [] }), setGoal() {} };
  let choices = {};
  choices = await forageChoices(bot, { check() {} }, {}, () => {}, { navigate: async () => {} }, {}, { target: 80 });
  assert(choices.cook_cooked_beef, 'the cooking offered');
  // 45 carried raw, 35 short, 5 more a steak: seven cooked.
  assert.equal(choices.cook_cooked_beef.description.amount, 7);
  assert.equal(choices.cook_cooked_beef.description.pointsAdded, 35);
});

// 25591 (mid-242-jb) at 23:49:57Z: at (160, 62, 356), the cage at (158, 64,
// 356), 20 health, an iron sword, 6 rods still needed, blazes 2 to 5 blocks off
// out of sight.
const CAGE = new Vec3(158, 64, 356);
function cageBot({ mobs = [] } = {}) {
  const entities = {};
  mobs.forEach((p, i) => { entities[i + 1] = { id: i + 1, name: 'blaze', type: 'hostile', position: p, height: 1.8, width: 0.6, isValid: true }; });
  const bot = bareBot({ items: ['iron_sword', ['blaze_rod', 1], ['netherrack', 145]], food: 18, dimension: 'the_nether', position: new Vec3(160.5, 62, 356.5), entities });
  bot.blockAt = p => {
    const f = new Vec3(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z));
    const name = f.equals(CAGE) ? 'spawner' : f.y < 62 ? 'nether_bricks' : 'air';
    return { name, position: f, boundingBox: name === 'air' ? 'empty' : 'block', hardness: registry.blocksByName[name]?.hardness };
  };
  // A wall between: every blaze out of sight.
  bot.world.raycast = (from, dir) => ({ position: from.plus(dir.scaled(0.5)).floored(), intersect: from.plus(dir.scaled(0.5)), name: 'netherrack' });
  return bot;
}
const rodsGoal = () => ({ kind: 'win', mobHunt: { entity: 'blaze', item: 'blaze_rod', targetCount: 7 }, fortressSearch: { map: { spawners: [{ x: CAGE.x, y: CAGE.y, z: CAGE.z }] } } });

test('a hold at a live cage says its minutes, kills, rods and health lost; three minutes with none and blazes in reach said plainly; cover at full health says what it gives up', () => {
  const cy = require('../src/cage-yield');
  const bot = cageBot({ mobs: [new Vec3(158.5, 63, 358.5), new Vec3(158.5, 64, 354.5)] });
  const goal = rodsGoal();
  const t0 = Date.parse('2026-09-29T23:41:00Z');
  const fresh = () => ({ box_here: { description: 'Box.' }, take_cover: { description: 'Cover.' }, close_in: { description: 'Close in.' }, fight: { description: 'Fight.' } });
  let o = fresh();
  const f0 = cy.annotate(bot, goal, o, t0);
  assert.equal(f0.minutes, 1);
  assert.match(o.box_here.description, /^Box\. At this cage 1 minute so far: 0 blazes killed, 0 rods, 0 health lost\.$/);
  assert.equal(o.fight.description, 'Fight.', 'a strike is not a hold');
  assert.match(o.take_cover.description, /At full health, cover gives up the strike close in offers on the blaze \d+(\.\d)? blocks off: a blaze out of the bot's line brings no rod\.$/);
  // A hit: health lost is counted as it goes.
  bot.health = 16; bot.emit('health'); bot.health = 20; bot.emit('health');
  // Asked every minute or so, as the stance and the stand are.
  for (let m = 1; m < 8; m++) cy.annotate(bot, goal, fresh(), t0 + m * 60000);
  o = fresh();
  const f8 = cy.annotate(bot, goal, o, t0 + 8 * 60000);
  assert.equal(f8.healthLost, 4);
  assert.match(o.box_here.description, /At this cage 8 minutes so far: 0 blazes killed, 0 rods, 4 health lost\. Nothing has come of it for 8 minutes while 2 blazes were within 5 blocks \(2 out of sight\): held like this, they stay out of its line\.$/);
  // Eleven minutes with no kill and no rod at full health, strikes on offer: the holds rest (note 884).
  for (let m = 9; m < 11; m++) cy.annotate(bot, goal, fresh(), t0 + m * 60000);
  o = fresh();
  const f11 = cy.annotate(bot, goal, o, t0 + 11 * 60000 - 30000);
  assert.deepEqual(Object.keys(o), ['close_in', 'fight']);
  assert.match(f11.holdsResting, /^The holds here \(box here, take cover\) rest: 1[01] minutes at this cage brought no kill and no rod\./);
  // Under twelve health a hold is shelter: offered.
  bot.health = 10; o = fresh();
  cy.annotate(bot, goal, o, t0 + 11 * 60000 - 20000);
  assert.ok(o.box_here && o.take_cover);
  bot.health = 20;
  // No strike or way out beside them: offered.
  o = { box_here: { description: 'Box.' }, take_cover: { description: 'Cover.' } };
  cy.annotate(bot, goal, o, t0 + 11 * 60000 - 10000);
  assert.ok(o.box_here && o.take_cover);
  // A kill and a rod: yield, and the plain line goes.
  bot._kills = { blaze: 1 }; bot.inventory.items().find(i => i.name === 'blaze_rod').count = 2;
  o = fresh();
  cy.annotate(bot, goal, o, t0 + 11 * 60000);
  assert.match(o.box_here.description, /1 blaze killed, 1 rod, \d+ health lost\.$/);
  // Away from the cage five minutes: a new stay.
  o = fresh();
  cy.annotate(bot, goal, o, t0 + 17 * 60000);
  assert.match(o.box_here.description, /At this cage 1 minute so far: 0 blazes killed/);
  // No cage known: nothing said.
  o = fresh();
  assert.equal(cy.annotate(bot, { kind: 'win', mobHunt: rodsGoal().mobHunt }, o, t0), null);
  assert.equal(o.box_here.description, 'Box.');
});

test('a fetch away from a known fortress says the distances and the health it walks with; a hoglin is food when food is lacking', () => {
  const fa = require('../src/fortress-away');
  // 25590 (mid-242-kb) at 23:43:44Z: 14 health, hunger 10, nothing to eat, the
  // stems at (145, 43, 105).
  const bot = bareBot({ items: ['iron_sword', ['netherrack', 145]], food: 10, health: 14.16, dimension: 'the_nether', position: new Vec3(217.7, 43, 254.4) });
  const goal = { kind: 'win', mobHunt: { entity: 'blaze', item: 'blaze_rod', targetCount: 7 }, fortressSearch: { approach: { found: { x: 244, y: 61, z: 212 } } } };
  const says = fa.awaySays(bot, goal, new Vec3(145, 43, 105));
  assert.match(says, /^It takes the bot from the fortress 53 blocks off now to 147 blocks from it, and the way back after is as far\. It walks with 14\.2 health and hunger 10; nothing to eat carried: health does not come back on the way\.$/);
  assert.equal(fa.awayFacts(bot, goal).blocksOff, 53);
  // No rods wanted, or no fortress known: nothing said.
  assert.equal(fa.awaySays(bot, { kind: 'win', fortressSearch: goal.fortressSearch }, new Vec3(145, 43, 105)), null);
  assert.equal(fa.awaySays(bot, { ...goal, fortressSearch: {} }), null);
  // The hoglin at (163, 35, 114) three blocks off.
  const hog = { entity: { name: 'hoglin', position: new Vec3(163, 35, 117) }, distance: 3 };
  assert.match(fa.hoglinFoodSays(bot, [hog]), /^ The hoglin 3 blocks off is food: 2 to 4 porkchops \(3 hunger each raw, 8 cooked\) when killed; nothing to eat carried at hunger 10, and health does not come back until something is eaten\.$/);
  // Fed and carrying food: a hoglin is not said as food.
  const fed = bareBot({ items: [['cooked_beef', 10]], food: 19, dimension: 'the_nether', position: bot.entity.position });
  assert.equal(fa.hoglinFoodSays(fed, [hog]), null);
});

test('25595\'s stock-up: met at full hunger with food carried, it is not asked (note 761); under eighteen the question says the reserve, and three minutes that keep nothing rest the errand', async () => {
  const { Survival } = require('../src/survival');
  const { Task } = require('../src/skills');
  const { isSetAside } = require('../src/progress');
  const items = [stack('iron_sword'), stack('beef', 12), stack('mutton', 8), stack('cooked_mutton', 4)];
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'overworld', difficulty: 'normal', gameMode: 'survival' }, time: { timeOfDay: 6000, age: 100000 },
    entities: {}, entity: { position: new Vec3(0.5, 64, 0.5) }, health: 20, food: 20, oxygenLevel: 20, registry,
    inventory: { items: () => items, slots: {} }, heldItem: null, pathfinder: { movements: {}, setGoal() {} },
    blockAt: p => ({ name: p.y < 64 ? 'grass_block' : 'air', boundingBox: p.y < 64 ? 'block' : 'empty', position: p }), findBlocks: () => [], chat() {},
    world: { raycast: () => null } });
  const survival = new Survival(bot, { navigate: async () => {}, dig: async () => {}, place: async () => {}, explore: async () => {} }, { client: { systemOne: async () => ({}) } });
  const trees = [];
  survival.decide = async (task, goal, save, q) => { trees.push(q.tree); return { path: ['obtain_food', Object.keys(q.tree.obtain_food.children)[0]], action: { run: async () => {} }, stale: false }; };
  const goal = { kind: 'win', request: 'beat the game', preparingNether: true, stockFood: true };
  const realNow = Date.now, t0 = realNow();
  try {
    Date.now = () => t0;
    // Hunger 20 with 76 points carried: met, nothing to ask.
    await survival.step(new Task('t', 'food'), goal, () => {});
    assert.equal(trees.length, 0, 'met: hunger 20 with food carried');
    // Hunger 17 met by the 76 carried: the Nether's reserve for the reserve
    // alone is the ladder's food rung's, not asked here (note 771).
    bot.food = 17;
    await survival.step(new Task('t', 'food'), goal, () => {});
    assert.equal(trees.length, 0, 'the crossing\'s reserve, the hunger met: the ladder\'s');
    assert.match(require('../src/food-errand').cookSays(bot), /Cooking the raw meat carried \(12 beef, 8 mutton\) adds 92 points\./);
    // The night's reserve (12 points) with a bread carried at hunger 17: asked.
    items.splice(0, items.length, stack('iron_sword'), stack('bread', 1));
    const night = { kind: 'win', request: 'beat the game', stockFood: true };
    await survival.step(new Task('t', 'food'), night, () => {});
    assert.equal(trees.length, 1);
    assert.match(trees[0].obtain_food.description, /^Get food\. Hunger 17, health full: nothing waits on the hunger now; the 5 food points carried bring it to eighteen or more when eaten, in seconds\. This trip is for the reserve alone \(the hunger is a meal of what is carried\)\. 5 food points carried of the 12 kept for healing and the night/);
    // Three and a half minutes on, the reserve no higher: it rests.
    delete survival.state.foodPlan; delete survival.state.searchFoodHold;
    Date.now = () => t0 + 210000;
    await survival.step(new Task('t', 'food'), night, () => {});
    assert.equal(trees.length, 1, 'not asked: the errand rests');
    assert(isSetAside(survival, 'food_search', 'stock', t0 + 210000));
    assert.equal(survival.state.foodErrand, undefined);
  } finally { Date.now = realNow; }
});
