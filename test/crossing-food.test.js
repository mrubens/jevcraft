'use strict';
// The crossing's food (note 594). mid-244-ah spent forty minutes of a fresh
// world's run on "reach nether: hunt food for nether": Jev chose top_up_food
// three times (0.65, 0.53, 0.58), told the food known ("a cow in view, 10
// blocks off", "4 sheep seen just now, 77 blocks south") but that "the
// search does not go to it first"; the search looked for "animals", which
// no block is, saw none, and walked some six thousand blocks while the cow
// stayed where it was. What its hunts brought was raw, counted three a
// beef, with 126 coal and two furnaces carried.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { Task } = require('../src/skills');

// The bot at 05:08:49 (the recorded crossing_kit asking): full health,
// hunger 18, nothing to eat, the kit short of food, gold and wood; a cow ten
// blocks off in view on the grass; four sheep remembered 77 blocks south.
function crossingBot(carried = {}) {
  const registry = require('minecraft-data')('26.1');
  const items = Object.entries({ cobblestone: 127, iron_pickaxe: 1, stone_pickaxe: 2, coal: 126, furnace: 2, iron_sword: 1, ...carried }).map(([name, count]) => ({ name, count }));
  const bot = {
    registry, oxygenLevel: 20, health: 20, food: 18,
    game: { gameMode: 'survival', dimension: 'overworld', difficulty: 'normal' },
    time: { timeOfDay: 6000 },
    entity: { position: new Vec3(451.5, 65, -161.5), height: 1.8, width: 0.6, onGround: true },
    entities: { 41: { id: 41, uuid: 'cow-41', name: 'cow', type: 'animal', metadata: [], position: new Vec3(459.5, 65, -155.5), isValid: true } },
    inventory: { items: () => items.filter(i => i.count > 0), slots: [] },
    blockAt: p => { const q = p.floored(); const name = q.y < 65 ? 'grass_block' : 'air'; return { name, position: q, boundingBox: name === 'air' ? 'empty' : 'block', getProperties: () => ({}) }; },
    findBlocks: () => [],
    world: { raycast: () => null },
    pathfinder: { movements: {} },
  };
  return bot;
}
const sheepSouth = () => ({ sheep: [{ x: 449, y: 64, z: -85, count: 4, at: Date.now(), dimension: 'overworld' }] });
const answering = (choice, log) => ({ systemOne: async ({ questions }) => { log.offered = questions.branch_0.criteria; return { answers: { branch_0: { choice, confidence: 0.6 } } }; } });

// foraging.hunt stood in for: the chase is foraging's own and tested there.
function stubHunt(t) {
  const foraging = require('../src/foraging');
  const real = foraging.hunt, hunted = [];
  foraging.hunt = async (bot, task, target) => { hunted.push(target.name); };
  t.after(() => { foraging.hunt = real; });
  return hunted;
}

test('with no frame begun, the known food is offered as its own way, back here, and taken it hunts the cow in view', async t => {
  const { crossingKitReady } = require('../src/work');
  const hunted = stubHunt(t);
  const bot = crossingBot();
  const goal = { sightings: sheepSouth() };
  const log = {};
  assert.equal(await crossingKitReady(bot, new Task('win'), goal, () => {}, answering('top_up_food_near', log)), false);
  assert.match(log.offered.top_up_food_near, /^Gather food at the known food nearest by the trip there and back, then come back here: a cow in view, 10 blocks off: about \d+ seconds in all \(the walk there about 2 seconds, about 15 seconds for 1 cow, and back here about 2 seconds\), for about 6 of the 40 points short as raw meat, about 16 once cooked\./);
  assert.match(log.offered.top_up_food, /it hunts a grown cow, sheep, rabbit or mooshroom within 32 blocks when one is in view, and otherwise searches outward/);
  assert.deepEqual(hunted, ['cow']);
  assert.equal(goal.step.action, 'food_known');
  assert.equal(goal.step.source, 'in_view');
});

test('each way at food says its own minutes: the open search\'s twenty-two are not the known food\'s', async () => {
  // 05:21:06: "22 working minutes have gone to it at this crossing, from 2 to 0", all the open search's.
  const { crossingKitReady } = require('../src/work');
  const bot = crossingBot();
  bot.entities = {};
  const goal = { sightings: sheepSouth(), crossingKit: { workedMs: 22 * 60000, spent: { food: { ms: 22 * 60000, from: 2 } }, lastAt: Date.now() } };
  const log = {};
  await crossingKitReady(bot, new Task('win'), goal, () => {}, answering('cross_now', log));
  assert.match(log.offered.top_up_food, /22 working minutes have gone to it at this crossing, from 2 to 0\.$/);
  assert.match(log.offered.top_up_food_near, /then come back here: 4 sheep seen just now/);
  assert.match(log.offered.top_up_food_near, /Nothing has gone to it yet at this crossing\.$/);
});

test('the open search hunts an animal in view before it walks on', async t => {
  const { crossingKitReady } = require('../src/work');
  const hunted = stubHunt(t);
  const bot = crossingBot();
  const goal = { sightings: sheepSouth() };
  assert.equal(await crossingKitReady(bot, new Task('win'), goal, () => {}, answering('top_up_food', {})), false);
  assert.deepEqual(hunted, ['cow']);
  assert.equal(goal.step.action, 'hunt_food_for_nether');
  assert.equal(goal.step.hunting, 'cow');
});

test('a cow the hunt could not get to is kept two minutes, not offered in view, and not hunted again', async t => {
  const { crossingKitReady } = require('../src/work');
  const foraging = require('../src/foraging');
  const real = foraging.hunt;
  let tries = 0;
  foraging.hunt = async () => { tries++; throw new Error('Food target cow is behind solid cover'); };
  t.after(() => { foraging.hunt = real; });
  const bot = crossingBot();
  const goal = { sightings: sheepSouth() };
  const log = {};
  await crossingKitReady(bot, new Task('win'), goal, () => {}, answering('top_up_food_near', log));
  assert.equal(tries, 1);
  assert(goal.survival.failedPrey['cow-41'] > Date.now() - 1000, 'kept as the survival layer keeps it');
  delete goal.crossingKit;
  await crossingKitReady(bot, new Task('win'), goal, () => {}, answering('cross_now', log));
  assert.match(log.offered.top_up_food_near, /then come back here: 4 sheep seen just now/, 'the sheep are the known food now');
  assert.doesNotMatch(log.offered.top_up_food_near, /cow in view/);
});

test('raw meat carried with a furnace and coal: cooking it first is offered, with the points as carried and once cooked', async () => {
  const { crossingKitReady } = require('../src/work');
  // 05:36:10: nine beef carried, 27 points, the frame five blocks off.
  const bot = crossingBot({ beef: 9 });
  bot.entities = {};
  const goal = {};
  const log = {};
  assert.equal(await crossingKitReady(bot, new Task('win'), goal, () => {}, answering('cross_now', log)), true);
  assert.match(log.offered.top_up_cook, /^Cook the raw food carried first: 9 beef, 27 food points as carried, about 72 once cooked \(a steak or a cooked porkchop is eight, cooked mutton six, raw beef three\)\. The furnace carried is put down here, fuelled with the coal carried: about ten seconds an item, about 92 seconds in all, with no walk\./);
  // No fuel: no cooking on offer.
  const cold = crossingBot({ beef: 9, coal: 0 });
  cold.entities = {};
  await crossingKitReady(cold, new Task('win'), {}, () => {}, answering('cross_now', log));
  assert.equal(log.offered.top_up_cook, undefined);
});
