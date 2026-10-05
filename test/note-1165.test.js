'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const registry = require('minecraft-data')('26.1');
const { strategyOptions } = require('../src/strategy');

function overworld(food, items) {
  return { registry, game: { dimension: 'overworld', gameMode: 'survival', difficulty: 'normal' }, health: 15, food, time: { timeOfDay: 6000 },
    entity: { position: new Vec3(-32.5, 95, 134.5) }, entities: {}, players: {},
    inventory: { items: () => items.map(([name, count = 1]) => ({ name, count })), slots: [] },
    blockAt: p => ({ name: p.y < 95 ? 'stone' : 'air', position: p, boundingBox: p.y < 95 ? 'block' : 'empty' }), findBlocks: () => [] };
}
const PACK = [['blaze_rod', 9], ['ender_pearl', 11], ['iron_pickaxe'], ['iron_sword'], ['cobblestone', 38], ['oak_log', 8], ['crafting_table']];
const goalOf = () => ({ version: 1, kind: 'win', gameProgress: { version: 1, milestones: { nether_entered: { at: 1 } } }, foodTurnBack: { at: Date.now() - 2 * 60000 } });
const stage = { phase: 'obtain_ender_pearls', action: 'enter_nether', item: 'ender_pearl', count: 13, via: 'warped_forest' };

test('with no food carried at hunger 13 on the way into the Nether, getting food first is a way at the strategy question (note 1165)', () => {
  const options = strategyOptions(overworld(13, PACK), goalOf(), stage);
  assert.ok(options?.take_up_nether_food, Object.keys(options || {}).join(','));
  assert.match(options.take_up_nether_food.description, /^Get food first, before the Nether: nothing to eat is carried and hunger is 13 of 20, where health does not come back under eighteen\. The last crossing turned back through the portal for food 2 minutes ago/);
  assert.equal(options.take_up_nether_food.takeUp, true);
  assert.equal(options.take_up_nether_food.rung.phase, 'nether_food');
});

test('with food carried, or at hunger eighteen, it is not added', () => {
  const fed = strategyOptions(overworld(13, [...PACK, ['cooked_beef', 12]]), goalOf(), stage);
  assert.ok(!fed?.take_up_nether_food);
  const full = strategyOptions(overworld(19, PACK), goalOf(), stage);
  assert.ok(!full?.take_up_nether_food);
});

test('food taken up before the Nether holds while still on offer, not asked at every step (note 1319)', async () => {
  const { strategyStep } = require('../src/strategy');
  const { Task } = require('../src/skills');
  const bot = overworld(6, PACK), goal = goalOf(), asked = [];
  let now = Date.now();
  const decide = async (id, { tree }) => { asked.push(Object.keys(tree)); return { path: ['take_up_nether_food'], stale: false }; };
  await strategyStep(bot, new Task('t'), goal, () => {}, stage, { decide, now: () => now });
  now += 5000;
  await strategyStep(bot, new Task('t'), goal, () => {}, stage, { decide, now: () => now });
  now += 5000;
  await strategyStep(bot, new Task('t'), goal, () => {}, stage, { decide, now: () => now });
  assert.equal(asked.length, 1, 'held');
});

test('a rung that would gather says what the chest at home holds toward it (note 1324)', () => {
  const { rungTakes } = require('../src/strategy');
  const { catalogPlan, planningInventory } = require('../src/work');
  const items = [['stone_pickaxe', 1], ['crafting_table', 1], ['oak_log', 4]].map(([name, count], i) => ({ name, count, type: registry.itemsByName[name].id, slot: 9 + i, durabilityUsed: 0 }));
  const bot = overworld(20, []); bot.inventory.items = () => items;
  const goal = { kind: 'win', survival: { home: { origin: { x: 0, y: 64, z: 0 }, stash: { position: { x: 3, y: 64, z: 40 }, contents: { raw_iron: 50, coal: 64 } } } } };
  const rung = { phase: 'iron_chestplate', action: 'acquire', item: 'iron_chestplate', count: 1 };
  const says = rungTakes(bot, goal, rung, (b, item, count, g) => catalogPlan(b, item, count, planningInventory(b), g));
  assert.match(says, /The chest at home \(3, 64, 40\), \d+ blocks off, holds toward it .*raw iron.*: taken out there, the gathering under it is skipped\./);
});
