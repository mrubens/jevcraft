'use strict';
// Note 761b: hunger that the food carried meets, said and offered as a meal.
// 25593 (mid-237-cc, 19:47 to 19:50Z) at 20 health, hunger 17 and 35 food
// points carried (4 cooked mutton, 3 mutton, a bread) was told "health does
// not come back until it is eaten back to eighteen", chose go_home_for_food
// six times in two minutes, walked (89, 79, 80) to (66, 71, 56) and turned to
// a hunt at (115, 88, 70). 25598 (19:56Z) at 3 health, hunger 16 and 18
// points carried was offered only walks to herds.
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { Vec3 } = require('vec3');
const registry = require('minecraft-data')('26.1');
const { Task } = require('../src/skills');

const stack = (name, count = 1) => ({ name, count, type: registry.itemsByName[name]?.id ?? 0 });
const PACK = [['cooked_mutton', 4], ['mutton', 3], ['bread', 1], 'iron_sword'];
function surfaceBot({ items = PACK, food = 17, health = 20 } = {}) {
  const inv = items.map(i => Array.isArray(i) ? stack(...i) : stack(i));
  const at = new Vec3(89.5, 79, 80.5);
  return Object.assign(new EventEmitter(), { registry, version: '26.1', health, food, oxygenLevel: 20,
    game: { dimension: 'overworld', gameMode: 'survival', difficulty: 'normal' }, time: { timeOfDay: 3122, age: 200000 },
    entity: { position: at, onGround: true, height: 1.8, width: 0.6, velocity: new Vec3(0, 0, 0) }, entities: {},
    inventory: { items: () => inv, slots: {} }, heldItem: null, pathfinder: { movements: {}, setGoal() {}, getPathTo: () => ({ status: 'noPath', path: [] }) },
    world: { raycast: () => null }, findBlocks: () => [], chat() {},
    blockAt: p => { const y = Math.floor(p.y); const name = y < 79 ? 'grass_block' : 'air'; return { name, position: new Vec3(Math.floor(p.x), y, Math.floor(p.z)), boundingBox: name === 'air' ? 'empty' : 'block' }; } });
}
const netherGoal = () => ({ kind: 'win', request: 'beat the game', preparingNether: true, stockFood: true, gameProgress: { phase: 'nether_food' } });
const supplyOf = bot => require('../src/foraging').foodSupply(bot);

test('covered: under eighteen with food carried that brings it back; not with too little or none', () => {
  const fe = require('../src/food-errand');
  assert.equal(fe.covered({ food: 17 }, 35), true, '25593');
  assert.equal(fe.covered({ food: 16 }, 18), true, '25598 at 19:56Z');
  assert.equal(fe.covered({ food: 12 }, 3), false);
  assert.equal(fe.covered({ food: 17 }, 0), false);
  assert.equal(fe.covered({ food: 18 }, 10), false, 'met, not covered');
});

test('at full health the healing is not said as waiting on the hunger', () => {
  const fe = require('../src/food-errand');
  const says = fe.hungerSays({ food: 17, health: 20 }, 35);
  assert.doesNotMatch(says, /does not come back/);
  assert.equal(says, 'Hunger 17, health full: nothing waits on the hunger now; the 35 food points carried bring it to eighteen or more when eaten, in seconds.');
  // Hurt, it is said as before.
  assert.match(fe.hungerSays({ food: 16, health: 3 }, 18), /^Hunger 16, under eighteen: health does not come back until it is eaten back to eighteen, 2 points short; the 18 food points carried cover that, eaten in seconds\.$/);
});

test('25593 at 19:47:18: the meal is offered beside the trips, and the trip is said as the reserve alone with this bot\'s record', async () => {
  const { Survival } = require('../src/survival');
  const bot = surfaceBot();
  assert.equal(supplyOf(bot), 4 * 6 + 3 * 2 + 5);
  const survival = new Survival(bot, { navigate: async () => {}, dig: async () => {}, place: async () => {}, explore: async () => {} }, { client: { systemOne: async () => ({}) } });
  // Two errands of this bot before: 9 minutes, 0 points kept, 60 blocks climbed.
  const t = Date.now();
  survival.state.foodErrandLog = [{ at: t - 3600000, minutes: 5, start: 20, end: 18, climbed: 40, asks: 9 }, { at: t - 1800000, minutes: 4, start: 18, end: 20, climbed: 20, asks: 6 }];
  let tree = null;
  survival.decide = async (task, goal, save, q) => { tree = q.tree; return { path: ['eat_carried'], action: { run: async () => {} }, stale: false }; };
  await survival.step(new Task('t', 'food'), netherGoal(), () => {});
  assert(tree, 'asked');
  assert.match(tree.eat_carried.description, /^Eat the \w[\w ]* carried now: about two seconds standing still, hunger 17 to (19|20), eighteen or more\. Health is full: nothing waits on it now; eaten, the hunger holds up the healing for later\. No walk; the reserve stays where it is, \d+ points after\.$/);
  const food = tree.obtain_food.description;
  assert.doesNotMatch(food, /does not come back/);
  assert.match(food, /This trip is for the reserve alone \(the hunger is a meal of what is carried\)\. 35 food points carried of the 80 kept for the Nether stay/);
  assert.match(food, /This bot's last 2 food errands \(three hours\): 9 minutes in all, 0 points more carried at their ends than their starts, 60 blocks climbed\./);
  for (const leaf of Object.values(tree.obtain_food.children)) assert.equal(leaf.description?.healing, undefined, 'no "healing: none meanwhile" at full health');
});

test('the survival claim for 25593 is for the reserve, with no healing line at full health', () => {
  const { claim } = require('../src/survival');
  const { claimSays } = require('../src/arbiter');
  const bot = surfaceBot();
  const c = claim(bot, netherGoal(), { state: {} });
  assert.equal(c?.action, 'obtain_food');
  const said = claimSays(c);
  assert.match(said, /^Find food for the reserve \(the hunger is a meal of what is carried, eaten in seconds\): /);
  assert.doesNotMatch(said, /does not come back/);
});

test('a walk home for food chosen is held as a trip, not asked again every ten seconds', async () => {
  const { Survival } = require('../src/survival');
  const bot = surfaceBot({ items: ['iron_sword'], food: 15 });
  const survival = new Survival(bot, { navigate: async () => {}, dig: async () => {}, place: async () => {}, explore: async () => {} }, { client: { systemOne: async () => ({}) } });
  survival.decide = async () => ({ path: ['obtain_food', 'go_home_for_food'], action: { run: async () => {} }, stale: false });
  await survival.step(new Task('t', 'food'), netherGoal(), () => {});
  assert.equal(survival.state.searchFoodHold?.key, 'go_home_for_food');
  assert(survival.state.searchFoodHold.until - Date.now() > 100000);
});
