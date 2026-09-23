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
