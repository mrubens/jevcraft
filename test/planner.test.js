'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

test('a source in another dimension costs the trip: in the Overworld golden boots come from gold ore, not ten nuggets and the Nether', () => {
  const { planCatalog } = require('../src/knowledge');
  const registry = require('minecraft-data')('26.1');
  const inv = { gold_nugget: 10, iron_pickaxe: 1, furnace: 1, coal: 16, crafting_table: 1 };
  const route = (stock, dimension) => planCatalog(registry, 'golden_boots', 1, stock, { dimension }).map(s => `${s.action}:${s.block || s.item}`);
  assert.deepEqual(route(inv, 'overworld').slice(0, 2), ['mine:gold_ore', 'smelt:gold_ingot']);
  assert.equal(route(inv, 'the_nether')[0], 'mine:nether_gold_ore', 'in the Nether the nuggets are local');
  assert(!route({ ...inv, gold_nugget: 40 }, 'overworld').some(s => s.startsWith('mine:')), 'a real supply of nuggets is used');
});

test('three ingots carried, the fourth for golden boots is smelted from gold ore, not crafted from nuggets unpacked from the other three', () => {
  const { planCatalog } = require('../src/knowledge');
  const registry = require('minecraft-data')('26.1');
  const route = (stock, dimension = 'overworld') => planCatalog(registry, 'golden_boots', 1, stock, { dimension }).map(s => `${s.action}:${s.block || s.item}`);
  const plan = route({ gold_ingot: 3, iron_pickaxe: 1, furnace: 1, coal: 10, crafting_table: 1 });
  assert(plan.includes('mine:gold_ore') && plan.includes('smelt:gold_ingot'), plan.join(' '));
  assert(!plan.includes('mine:nether_gold_ore'), plan.join(' '));
  // Unpacking what is carried still works.
  assert.deepEqual(planCatalog(registry, 'gold_nugget', 9, { gold_ingot: 3 }).map(s => `${s.action}:${s.item}`), ['craft:gold_nugget']);
  assert.deepEqual(planCatalog(registry, 'iron_ingot', 9, { iron_block: 1 }).map(s => `${s.action}:${s.item}`), ['craft:iron_ingot']);
});

test('a table from two oak planks and five jungle logs is made of jungle planks, with no log to gather', () => {
  // Trial 45: planned an oak log for the table's last two planks, took that
  // for "no wood", and dug out of a mine by hand.
  const registry = require('minecraft-data')('26.1');
  const { Vec3 } = require('vec3');
  const { catalogPlan, planningInventory } = require('../src/work');
  const stock = { oak_planks: 2, jungle_log: 5, stick: 5, cobblestone: 64, iron_ingot: 6 };
  const items = Object.entries(stock).map(([name, count], i) => ({ name, count, type: registry.itemsByName[name].id, slot: 9 + i, durabilityUsed: 0 }));
  const bot = { registry, version: '26.1', game: { gameMode: 'survival', dimension: 'minecraft:overworld' }, entity: { position: new Vec3(0, 30, 0) }, inventory: { items: () => items, slots: [] }, blockAt: () => null, findBlocks: () => [], entities: {} };
  for (const tool of ['stone_pickaxe', 'iron_pickaxe']) {
    const plan = catalogPlan(bot, tool, 1, planningInventory(bot), {});
    assert(!plan.some(st => st.action === 'mine'), `${tool}: ${JSON.stringify(plan.map(st => [st.action, st.item || st.block]))}`);
    assert(plan.some(st => st.action === 'craft' && st.item === 'jungle_planks'));
  }
});

test('a blaze hunt in the Nether with a stone sword and no armour plans the hunt, not iron ore: the kit is offered, not required', () => {
  // mid-227-r-nether-1 planned iron ore in the Nether for the kit 1,130 times in twenty-five minutes, then died (note 476).
  const { planCatalog, elsewhereOf } = require('../src/knowledge');
  const registry = require('minecraft-data')('26.1');
  const stock = { stone_sword: 1, iron_pickaxe: 1, cooked_beef: 8, netherrack: 64 };
  const plan = planCatalog(registry, 'blaze_rod', 3, stock, { dimension: 'the_nether', equipment: ['stone_sword'] });
  assert.notEqual(plan[0].block, 'iron_ore', `first step: ${JSON.stringify(plan[0])}`);
  assert(!plan.some(s => s.action === 'mine' && /iron_ore$/.test(s.block)), plan.map(s => `${s.action}:${s.block || s.item}`).join(' '));
  assert.equal(plan[0].action, 'hunt_mob');
  assert.deepEqual(plan[0].kit.missing, ['hand', 'head', 'torso', 'legs', 'feet', 'off-hand'], 'a stone sword is not the kit\'s sword, and the pieces missing are said');
  assert.equal(elsewhereOf(plan, 'the_nether'), null, 'nothing in the plan lies in another dimension');
  // A kit piece itself, planned in the Nether, says its iron is in the Overworld.
  const helmet = planCatalog(registry, 'iron_helmet', 1, stock, { dimension: 'the_nether' });
  const away = elsewhereOf(helmet, 'the_nether', [{ item: 'iron_helmet', count: 1 }]);
  assert.equal(away.dimension, 'overworld');
  assert.deepEqual(away.bring, [{ item: 'iron_helmet', count: 1 }], 'the helmet is what comes back, not its ingots');
});
