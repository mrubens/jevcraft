'use strict';
// Note 728: the crossing's food rung's own search (work.js kitFoodStep) must
// judge itself by its own measure, food points carried, not by motion. Before
// this it committed no intention at all (src/intention.js TIMED had no entry
// for kit_food), so note 699's three-minute no-yield rule and note 702's
// errand rest, both keyed to other questions, never saw it, and note 724's
// answer-memo never held it either (its position changes every lap). 25597
// (mid-242-tf, 2026-09-30 06:12 to 06:28Z) walked laps over a 40x70 patch for
// fifteen minutes at "25 of 80" on top_up_food_near, win_strategy asking
// about it every ten seconds.
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { Vec3 } = require('vec3');
const registry = require('minecraft-data')('26.1');

function lapBot(at) {
  const foodItem = { name: 'cooked_beef', count: 3, type: registry.itemsByName.cooked_beef.id, durabilityUsed: 0 };
  return Object.assign(new EventEmitter(), {
    registry, version: '26.1', health: 20, food: 18, game: { dimension: 'overworld', gameMode: 'survival', difficulty: 'normal' }, said: [],
    entity: { position: at.clone(), onGround: true, height: 1.8, width: 0.6, velocity: new Vec3(0, 0, 0) }, entities: {},
    inventory: { items: () => [foodItem], slots: [] }, chat(m) { this.said.push(m); }, blockAt: () => null,
  });
}

test('a food search that gains no points for three minutes ends by that measure, not by the ground it covers, and its question is asked again with why (25597, note 728)', async t => {
  const T0 = Date.parse('2026-09-30T06:19:00Z');
  t.mock.timers.enable({ apis: ['Date'], now: T0 });
  const { decide } = require('../src/decisions');
  const intention = require('../src/intention');
  const { takeStall } = require('../src/stillness');
  const client = { systemOne: async () => ({ answers: { branch_0: { choice: 'top_up_food_near', confidence: 0.6, probabilities: { top_up_food_near: 0.6 } } } }) };
  const bot = lapBot(new Vec3(-44, 95, 134));
  // The rung open now is the food kit's, as work.js kitFoodStep leaves it
  // (game-progress.js timeRung) while Jev's kit_food is asked.
  const goal = { kind: 'win', rungTime: { phase: 'nether_food' }, survival: {} };
  const tree = { top_up_food_near: { description: 'Gather food at the known food nearest by the trip there and back.' }, go_without: { description: 'Go on without more food for now.' } };
  await decide('kit_food', { client, bot, goal, tree, state: { health: 20, food: 18 } });
  assert.equal(goal.intention?.choice, 'top_up_food_near');
  // Laps over the same patch, back and forth (mid-242-tf's -44,95,134 and
  // -37,103,164): position changes every time, as it did for fifteen
  // minutes, but the food carried does not move from its 24 points.
  const laps = [new Vec3(-44, 95, 134), new Vec3(-37, 103, 164)];
  for (let i = 0; i < 18; i++) { t.mock.timers.tick(10000); bot.entity.position = laps[i % 2].clone(); intention.holding(bot, goal, Date.now()); if (!goal.intention) break; }
  assert.equal(goal.intention, undefined, 'walking laps alone does not hold it up: it ends for want of yield');
  assert.match(goal.intentionEnded.why, /^no yield: 3 minutes with nothing gained on the rung: no food gained/);
  // The watch's look ends it and throws the stall to kit_food, with the
  // answer marked come to nothing there, exactly as fortress_leg's walks are
  // (note 699): the fix is the same rule, not a new counter for this rung.
  const walk = await decide('kit_food', { client, bot, goal, tree, state: { health: 20, food: 18 } });
  assert.deepEqual(walk.path, ['top_up_food_near']);
  const began = Date.now();
  for (let i = 0; i < 20 && goal.intention; i++) { t.mock.timers.tick(10000); bot.entity.position = laps[i % 2].clone(); intention.yieldWatch(bot, goal, Date.now()); }
  const stall = takeStall(bot);
  assert.match(stall?.why || '', /^top up food near \(kit food\) ended, no yield: 3 minutes with nothing gained on the rung: no food gained/);
  assert.deepEqual({ from: stall.escalated.from, to: stall.escalated.to }, { from: 'intention', to: 'kit_food' });
  const own = goal.tried.entries.filter(e => e.q === 'kit_food' && e.at >= began - 1000).at(-1);
  assert.equal(own.outcome, 'blocked');
  assert.match(own.why, /no yield/);
});

test('a food search that gains points keeps its hold; two points or more in a look is a real gain', async t => {
  const T0 = Date.parse('2026-09-30T06:19:00Z');
  t.mock.timers.enable({ apis: ['Date'], now: T0 });
  const { decide } = require('../src/decisions');
  const intention = require('../src/intention');
  const client = { systemOne: async () => ({ answers: { branch_0: { choice: 'top_up_food_near', confidence: 0.6 } } }) };
  const bot = lapBot(new Vec3(-44, 95, 134));
  const goal = { kind: 'win', rungTime: { phase: 'nether_food' }, survival: {} };
  const tree = { top_up_food_near: { description: 'Gather food at the known food nearest by the trip there and back.' }, go_without: { description: 'Go on without more food for now.' } };
  await decide('kit_food', { client, bot, goal, tree, state: { health: 20, food: 18 } });
  t.mock.timers.tick(150000);
  bot.inventory.items = () => [{ name: 'cooked_beef', count: 6, type: registry.itemsByName.cooked_beef.id, durabilityUsed: 0 }];
  assert(intention.holding(bot, goal, Date.now()), 'more food carried: a gain, and it holds');
});
