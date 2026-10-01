'use strict';
// Note 831: out of the Nether for the Overworld's endermen (the pearl route
// held), the ladder hunts them here; 25593 crossed five times in twelve
// minutes, out for the pearls and straight back in for the rods.
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { Vec3 } = require('vec3');
const { Task } = require('../src/skills');
const { observeProgress, nextGameStage, PEARL_ROUTE_MS } = require('../src/game-progress');

const GEAR = ['white_bed', 'diamond_pickaxe', 'iron_sword', 'diamond_sword', 'shield', 'water_bucket', 'iron_helmet', 'iron_chestplate', 'iron_leggings', 'iron_boots', 'golden_boots', 'bow'].map(name => ({ name, count: 1 }));
function fixture(dimension = 'overworld') {
  const items = [...GEAR], bot = Object.assign(new EventEmitter(), { _client: new EventEmitter(),
    game: { dimension, gameMode: 'survival' }, health: 20, isAlive: true,
    entity: { position: new Vec3(.5, 64, .5) }, inventory: { items: () => items } });
  const goal = { version: 1, kind: 'win', request: 'Jev beat Minecraft' };
  const give = stock => { items.splice(0, items.length, ...GEAR, ...Object.entries(stock).map(([name, count]) => ({ name, count }))); };
  observeProgress(bot, goal);
  return { bot, goal, give, task: new Task('win') };
}


test('25593: with the Overworld pearl route held and rods short, the Overworld stage is the endermen hunt, not the rods; without it, the portal', () => {
  const { bot, goal, give } = fixture('overworld');
  bot.game.dimension = 'minecraft:the_nether'; observeProgress(bot, goal); bot.game.dimension = 'overworld';
  give({ blaze_rod: 1 });
  assert.equal(nextGameStage(bot, goal).phase, 'reach_nether');
  goal.pearlRoute = { pick: 'overworld', at: Date.now(), until: Date.now() + PEARL_ROUTE_MS };
  const s = nextGameStage(bot, goal);
  assert.equal(s.phase, 'obtain_ender_pearls', JSON.stringify(s)); assert.equal(s.action, 'pearl_patrol'); assert.equal(s.via, 'overworld_hunt');
});

const registry = require('minecraft-data')('26.1');
const gp = require('../src/game-progress');
const LADDER_GEAR = ['diamond_pickaxe', 'iron_sword', 'shield', 'water_bucket', 'golden_boots'];
function ladderFixture(names = LADDER_GEAR, extra = {}) {
  const items = [...names.map(name => ({ name, count: 1 })), ...Object.entries(extra).map(([name, count]) => ({ name, count }))];
  const bot = Object.assign(new EventEmitter(), { registry, _client: new EventEmitter(), game: { dimension: 'overworld', gameMode: 'survival', difficulty: 'normal' }, chat() {},
    health: 20, food: 20, isAlive: true, entities: {}, time: { timeOfDay: 1000 }, entity: { position: new Vec3(0.5, 64, 0.5) }, inventory: { items: () => items, slots: [] } });
  return { bot, items, goal: { version: 1, kind: 'win', request: 'beat the game' }, task: new Task('win') };
}


test('25593: out for the Overworld\'s endermen with ladder steps open, win_strategy offers the hunt beside them, said with when it was chosen; chosen, the steps wait and the stage is the hunt', async () => {
  const { strategyOptions } = require('../src/strategy');
  const { bot, goal } = ladderFixture(LADDER_GEAR.filter(n => n !== 'golden_boots'), { cobblestone: 10 });
  let stage = gp.nextGameStage(bot, goal);
  assert.equal(strategyOptions(bot, goal, stage, {})?.pearls_first, undefined, 'no route held: not offered');
  goal.pearlRoute = { pick: 'overworld', at: Date.now() - 3 * 60000, until: Date.now() + 27 * 60000 };
  stage = gp.nextGameStage(bot, goal);
  const options = strategyOptions(bot, goal, stage, {});
  assert(options.pearls_first, Object.keys(options).join(','));
  assert.match(options.pearls_first.description, /^Hunt the Overworld's endermen for the ender pearls first, the route chosen for the pearls 3 minutes ago \(held 27 more\): 0 pearls carried\./);
  await options.pearls_first.run();
  const next = gp.nextGameStage(bot, goal);
  assert.equal(next.phase, 'obtain_ender_pearls', JSON.stringify(next));
});
