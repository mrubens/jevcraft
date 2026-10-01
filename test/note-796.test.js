'use strict';
// Note 796: the food reserve, one number priced from the record
// (src/food-reserve.js). From 2026-09-30 06:00Z to 2026-10-01 04:57:47Z
// (scripts/food-stock.js, 658 records, 237 bot-hours, Jev up): 21.7% of
// the played time with no food carried that heals; 50 of 177 low-health
// moments (health falling under 8) and 39 of 105 deaths with none. 259 of
// the spells with none began with the last food eaten, and in 163 of them
// no food answer came while the food ran down from under twelve. Of the
// played minutes in the Overworld with none carried, 18.4% were followed
// within half an hour by health under 8 with nothing that heals; with 1 to
// 11 points 3.9% to 6.5%; with 12 or more at most 1.5%.
// The cases: 25590 (2026-09-30 15:33Z) respawned at hunger 20 with nothing,
// no food asked, health under 8 twice within two minutes; 25588 (17:16Z)
// back at hunger 18 with one beef, the errand "met"; 25594 (00:30Z) down to
// none on the surface with the work held.
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { Vec3 } = require('vec3');
const registry = require('minecraft-data')('26.1');
const { Task } = require('../src/skills');
const fr = require('../src/food-reserve');
const fp = require('../src/food-plan');

const stack = (name, count = 1) => ({ name, count, type: registry.itemsByName[name]?.id ?? 0 });
// Open ground at y 70 (the surface), or a cell in rock at y 14.
function makeBot({ items = [['iron_sword', 1]], food = 20, health = 20, dimension = 'overworld', underground = false, timeOfDay = 4000 } = {}) {
  const inv = items.map(i => stack(...i));
  const at = underground ? new Vec3(-203.5, 14, -511.5) : new Vec3(-259.5, 70, -500.5);
  const floorY = Math.floor(at.y);
  const blockAt = p => {
    const f = new Vec3(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z));
    const solid = underground ? !(f.x === Math.floor(at.x) && f.z === Math.floor(at.z) && (f.y === floorY || f.y === floorY + 1)) : f.y < floorY;
    const name = solid ? (dimension === 'overworld' ? (underground ? 'stone' : 'grass_block') : 'netherrack') : 'air';
    return { name, position: f, boundingBox: solid ? 'block' : 'empty', hardness: registry.blocksByName[name]?.hardness, skyLight: solid || underground ? 0 : 15 };
  };
  return Object.assign(new EventEmitter(), { registry, version: '26.1', health, food, foodSaturation: 0, oxygenLevel: 20,
    game: { dimension, gameMode: 'survival', difficulty: 'normal' }, time: { timeOfDay, age: 200000 },
    entity: { position: at, onGround: true, height: 1.8, width: 0.6, velocity: new Vec3(0, 0, 0) }, entities: {},
    inventory: { items: () => inv, slots: {}, emptySlotCount: () => 20 }, heldItem: null,
    pathfinder: { movements: {}, setGoal() {}, getPathTo: () => ({ status: 'noPath', path: [] }) },
    world: { raycast: () => null }, blockAt, findBlocks: () => [], chat() {} });
}
const survivalOf = bot => new (require('../src/survival').Survival)(bot, { navigate: async () => {}, dig: async () => {}, place: async () => {}, explore: async () => {} }, { client: { systemOne: async () => ({}) } });
const winGoal = (more = {}) => ({ kind: 'win', request: 'beat the game', step: { action: 'mine', block: 'iron_ore' }, ...more });

test('the floor is read from the record: the least food carried from which no level came to health under 8 with nothing to eat more than one time in fifty', () => {
  assert.equal(fr.FLOOR.overworld, 12);
  assert.equal(fr.FLOOR.nether, 36);
  // The rule on a table of its own: 30 of 100 at none, 3 of 100 at 1 to 11,
  // 1 of 100 from 12 up -> 12; one bad level above makes the floor above it.
  assert.equal(fr.floorOf([[0, 0, 100, 30], [1, 11, 100, 3], [12, 23, 100, 1], [24, Infinity, 100, 0]]), 12);
  assert.equal(fr.floorOf([[0, 0, 100, 30], [1, 11, 100, 1], [12, 23, 100, 5], [24, Infinity, 100, 0]]), 24);
  assert.match(fr.says(7), /^In the record \(2026-09-30 06:00Z to 2026-10-01 04:57Z\), the share of played minutes in the Overworld followed within half an hour by health under 8 with nothing that heals carried: 3\.9% with 6 to 11 food points carried \(71 of 1828\), 18\.4% with none \(503 of 2735\), at most 1\.5% at any level from 12 up\. The reserve kept in the Overworld is 12 food points: the least from which no level carried came to that more than one time in fifty\.$/);
  assert.match(fr.says(0, 'nether'), /19\.6% with none \(74 of 378\), at most 0\.9% at any level from 36 up/);
});

test('one reserve: the floor on the ladder, the crossing\'s stay never under the Nether\'s floor, the stash and the kit\'s rung reading the same', () => {
  const bot = makeBot();
  assert.deepEqual([fr.wanted(bot, winGoal()).points, fr.floorFor(bot, winGoal())], [12, 12]);
  assert.equal(fr.floorFor(bot, { kind: 'request' }), 1, 'no ladder: any food carried meets it, as before');
  assert.equal(fr.wanted(bot, winGoal({ preparingEnd: true })).points, 64);
  // A stay counted short (30 minutes: 24 points) still crosses with 36.
  assert.equal(fr.crossingWant(bot, null, { points: 24 }), 36);
  assert.equal(fr.crossingWant(bot, null, { points: 96 }), 96);
  const crossing = winGoal({ preparingNether: true });
  assert.equal(fr.wanted(bot, crossing).points, fr.crossingWant(bot, crossing));
  assert.equal(require('../src/home-stash').KIT_FOOD_POINTS, fr.FLOOR.overworld);
  assert.equal(fr.short(bot, winGoal(), 11), true);
  assert.equal(fr.short(bot, winGoal(), 12), false);
  assert.equal(require('../src/food-errand').met({ food: 18 }, 3, 12), false, 'one beef at hunger 18 is not met on the ladder');
  assert.equal(require('../src/food-errand').met({ food: 18 }, 12, 12), true);
});

test('25590 at 15:33Z: respawned at hunger 20 with nothing carried, the reserve is asked at once as the reserve alone, the record said, the work beside it', async () => {
  const bot = makeBot({ items: [['iron_sword', 1]], food: 20 });
  const { claim } = require('../src/survival');
  const survival = survivalOf(bot);
  const c = claim(bot, winGoal(), survival);
  assert.equal(c?.action, 'obtain_food', 'claimed: under the floor');
  let asked = null;
  survival.decide = async (task, goal, save, q) => { asked = q; return { path: ['continue_request'], action: { run: async () => {} }, stale: false }; };
  await survival.step(new Task('t', 'food'), winGoal(), () => {});
  assert(asked?.tree?.obtain_food, 'asked');
  assert(asked.tree.continue_request, 'the work on offer beside it');
  const said = asked.tree.obtain_food.description;
  assert.match(said, /This trip is for the reserve alone\. 0 food points carried of the 12 kept for healing and the night: 12 short\. In the record .*18\.4% with none \(503 of 2735\)/);
  assert.match(asked.state.foodOrWork.foodReserve, /^0 food points carried\. In the record/);
  // The work chosen: held, and no claim while it holds.
  assert.equal(survival.state.foodChoice?.choice, 'work');
  assert.equal(claim(bot, winGoal(), survival), null);
  // With the floor carried at full hunger nothing is asked: met.
  const fed = makeBot({ items: [['cooked_beef', 2]], food: 20 });
  assert.equal(claim(fed, winGoal(), survivalOf(fed)), null);
});

test('under rock at hunger 16 with nothing carried and full health: asked now (before, nothing until hunger 12)', () => {
  const bot = makeBot({ underground: true, food: 16 });
  const { claim } = require('../src/survival');
  assert.equal(claim(bot, winGoal(), survivalOf(bot))?.action, 'obtain_food');
  // Not where the ladder keeps no reserve.
  assert.equal(claim(bot, { kind: 'request', request: 'build a house' }, survivalOf(bot)), null);
});

test('the work over food ends when the food carried falls under the reserve, said; chosen under it, that end is not offered', () => {
  const bot = makeBot({ food: 20 });
  const holder = {}, goal = winGoal(), now = Date.now();
  fp.begin(holder, bot, { choice: 'work', by: 'turn_priority', supply: 20, goal, now });
  assert.match(fp.untilSays(holder.foodChoice), /the food carried falls under the 12 points kept/);
  assert.equal(fp.holding(holder, bot, { goal, supply: 14, now: now + 1000 })?.choice, 'work');
  assert.equal(fp.holding(holder, bot, { goal, supply: 8, now: now + 2000 }), null);
  assert.equal(holder.foodChoiceEnded.why, 'the food carried fell under the reserve: 20 to 8 food points, under the 12 kept');
  fp.begin(holder, bot, { choice: 'work', by: 'turn_priority', supply: 5, goal, now });
  assert.doesNotMatch(fp.untilSays(holder.foodChoice), /under the 12 points kept/);
  assert.equal(fp.holding(holder, bot, { goal, supply: 2, now: now + 1000 })?.choice, 'work');
});

test('the food carried within the reserve stays in the pockets on the ladder, said; over it, it may go as before', () => {
  const { foodStays } = require('../src/food-keep');
  const bot = makeBot({ items: [['cooked_beef', 1], ['bread', 0]] });
  assert.match(foodStays(bot, winGoal()), /^the 8 food points carried are within the 12 food points the reserve keeps in the Overworld: in the record, under it health fell under 8 with nothing that heals carried within half an hour 3\.9% to 18\.4% of the time, at it or more at most 1\.5%$/);
  assert.equal(foodStays(makeBot({ items: [['cooked_beef', 4]] }), winGoal()), null);
  assert.equal(foodStays(bot, { kind: 'request' }), null);
});

test('the meal in an encounter is said whether or not it is offered', () => {
  const { mealSays } = require('../src/survival');
  assert.match(mealSays(makeBot({ items: [['cooked_mutton', 3]], food: 20, health: 7 })), /^Hunger full \(20\): no meal can be eaten now; health comes back from the saturation and then the hunger it spends\. 18 food points carried that heal for after\.$/);
  assert.match(mealSays(makeBot({ items: [['cooked_mutton', 3]], food: 17, health: 20 })), /^Health full: a meal heals nothing now; 18 food points carried that heal\.$/);
  assert.match(mealSays(makeBot({ items: [['mutton', 9]], food: 16, health: 9 })), /^A meal is on offer \(eat\): 18 food points carried that heal\.$/);
  // Hunger 10, three raw beef: none alone reaches eighteen; three in a row do.
  assert.match(mealSays(makeBot({ items: [['beef', 3]], food: 10, health: 9 })), /^No single meal reaches eighteen, where health comes back: the best carried, the beef, takes hunger 10 to 13\. Eaten in a row, 3 reach it, about 4\.8 seconds standing with the hand busy and the shield down\. 9 food points carried that heal\.$/);
  assert.match(mealSays(makeBot({ items: [['iron_sword', 1]], food: 15, health: 9 })), /^Nothing carried to eat: hunger 15, under eighteen, so health does not come back here\.$/);
});

test('the food stock read from a record\'s pockets: raw against cooked, the last resort apart, what cooking adds', () => {
  const fs = require('../scripts/food-stock');
  assert.deepEqual(fs.stockOf({ beef: 3, cooked_mutton: 2, bread: 1, rotten_flesh: 2, chicken: 1, cobblestone: 64 }), { points: 26, raw: 9, cooked: 12, other: 5, lastResort: 10, cookGain: 19 });
  assert.equal(fs.band(0), '0');
  assert.equal(fs.fine(11), '6-11');
  assert.equal(fs.fine(80), '80+');
});

test('the replay: a spell run down on the surface with no food answer is asked at the floor; one already answered is left as it was', () => {
  const { under796 } = require('../scripts/food-stock');
  const spells = [
    // Ran down from under 12 two minutes before none, no food answer; 10 minutes at none, a low at 3 minutes.
    { place: 'surface', began: 'eaten', ms: 600000, ended: 'food', runDown: { minutes: 2, foodAnswers: 0, place: 'surface' }, lows: [{ min: 3, died: true }] },
    // Already answered with food in the run-down: as it was.
    { place: 'under', began: 'eaten', ms: 300000, ended: 'food', runDown: { minutes: 1, foodAnswers: 1, place: 'under' }, lows: [{ min: 1, died: false }] },
    // In the Nether: apart.
    { place: 'nether', began: 'eaten', ms: 120000, lows: [] },
  ];
  const u = under796({ zeroSpells: spells });
  assert.equal(u.spells, 2);
  assert.equal(u.asked, 1);
  assert.equal(u.before.zeroMinutes, 15);
  assert.equal(u.bound.zeroMinutes, 5, 'the food comes before none: the surface spell gone');
  assert.equal(u.bound.lows, 1);
  assert.equal(u.after.lows, 1.1, 'the surface low gone at the record\'s 90%');
  assert.equal(u.nether.zeroMinutes, 2);
});
