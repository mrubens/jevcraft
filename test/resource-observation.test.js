'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const registry = require('minecraft-data')('26.1');
const { planCatalog } = require('../src/knowledge');
const { catalogPlan } = require('../src/work');
const { recipeSourceGroups, observeRecipeAlternatives, isSurfaceResource, knownResourceLocations } = require('../src/resource-observation');

test('intermediate dye alternatives come from the recipe catalog', () => {
  const plan = planCatalog(registry, 'purple_concrete', 32, { stone_pickaxe: 1, crafting_table: 1 });
  const groups = recipeSourceGroups(registry, plan);
  for (const flower of ['poppy', 'red_tulip', 'rose_bush']) assert(groups.red_dye.includes(flower));
  assert(groups.blue_dye.includes('cornflower'));
});

test('a nearby recipe alternative is considered even when the general observation is crowded with stone', () => {
  const position = new Vec3(0.5, 64, 0.5), flower = new Vec3(20, 64, 0);
  const bot = { registry, entity: { position }, game: { gameMode: 'survival' }, inventory: { items: () => [] },
    _catalogObservation: { at: Date.now(), position: { ...position }, nearby: Array(48).fill('stone') },
    findBlocks: ({ matching }) => matching.includes(registry.blocksByName.poppy.id) ? [flower] : [],
    blockAt: p => ({ name: p.equals(flower) ? 'poppy' : 'air' }) };
  const stock = { blue_dye: 2, sand: 16, gravel: 16, stone_pickaxe: 1, crafting_table: 1 };
  const original = planCatalog(registry, 'purple_concrete', 32, stock, { nearby: bot._catalogObservation.nearby });
  assert.equal(original[0].drops, 'rose_bush');
  const actual = catalogPlan(bot, 'purple_concrete', 32, stock);
  assert.equal(actual[0].drops, 'poppy');
  assert.equal(actual[0].count, 2);
  assert(!actual.some(s => s.drops === 'rose_bush'));
});

test('recipe observations refresh after travel and do not invent missing ingredients', () => {
  const position = new Vec3(0.5, 64, 0.5);
  let calls = 0;
  const bot = { registry, entity: { position }, findBlocks: () => { calls++; return []; } };
  const plan = planCatalog(registry, 'red_dye', 2);
  assert.deepEqual(observeRecipeAlternatives(bot, plan), []);
  const initial = calls;
  observeRecipeAlternatives(bot, plan); assert.equal(calls, initial);
  bot.entity.position.x += 9;
  observeRecipeAlternatives(bot, plan); assert(calls > initial);
});

test('remembered recipe sources survive travel and serialization but expire when observed gone', () => {
  const flower = new Vec3(20, 64, 0), goal = {}, stock = { blue_dye: 2, sand: 16, gravel: 16, stone_pickaxe: 1, crafting_table: 1 };
  let seen = true, loaded = true;
  const bot = { registry, game: { gameMode: 'survival', dimension: 'overworld' }, entity: { position: new Vec3(0.5, 64, 0.5) },
    inventory: { items: () => [] },
    findBlocks: ({ matching }) => seen && matching.includes(registry.blocksByName.poppy.id) ? [flower] : [],
    blockAt: p => p.equals(flower) ? loaded ? { name: seen ? 'poppy' : 'air' } : null : { name: 'air' } };
  assert.equal(catalogPlan(bot, 'purple_concrete', 32, stock, goal)[0].drops, 'poppy');
  const resumed = JSON.parse(JSON.stringify(goal));
  seen = false; loaded = false; bot.entity.position.x = 120; bot._recipeObservations = {};
  assert.equal(catalogPlan(bot, 'purple_concrete', 32, stock, resumed)[0].drops, 'poppy');
  assert.deepEqual(knownResourceLocations(bot, resumed, ['poppy']), [flower]);
  bot.game.dimension = 'nether';
  assert.deepEqual(knownResourceLocations(bot, resumed, ['poppy']), []);
  bot.game.dimension = 'overworld'; loaded = true; bot._recipeObservations = {};
  assert.equal(catalogPlan(bot, 'purple_concrete', 32, stock, resumed)[0].drops, 'rose_bush');
  assert.deepEqual(resumed.resourceMemory, {});
});

test('surface resource classification comes from vanilla flower and overworld wood tags', () => {
  for (const name of ['poppy', 'rose_bush', 'red_tulip', 'cornflower', 'cherry_log', 'birch_log']) assert(isSurfaceResource(name), name);
  for (const name of ['diamond_ore', 'gravel', 'spore_blossom', 'chorus_flower', 'warped_stem']) assert(!isSurfaceResource(name), name);
});
