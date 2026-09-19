'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const registry = require('minecraft-data')('26.1');
const { planCatalog } = require('../src/knowledge'), { batchPlan } = require('../src/batch-plan');
const nearby = ['birch_log', 'oak_log', 'stone', 'iron_ore', 'coal_ore', 'sand'];
function replay(steps, initial, outputs) {
  const stock = { ...initial };
  for (const step of steps) {
    for (const [name, count] of Object.entries(step.requires || {})) assert((stock[name] || 0) >= count, `${step.action} requires ${name}`);
    for (const [name, count] of Object.entries(step.consumes)) {
      assert((stock[name] || 0) >= count, `${step.action} ${step.item} lacks ${count} ${name}; has ${stock[name] || 0}`);
      stock[name] -= count;
    }
    for (const [name, count] of Object.entries(step.produces)) stock[name] = (stock[name] || 0) + count;
  }
  const totals = outputs.reduce((all, { item, count }) => ({ ...all, [item]: (all[item] || 0) + count }), {});
  for (const [item, count] of Object.entries(totals)) assert((stock[item] || 0) >= count, `need ${count} ${item}, got ${stock[item] || 0}`);
  return stock;
}

test('packing and unpacking carried raw iron cannot satisfy a larger request', () => {
  const initial = { raw_iron: 10, iron_pickaxe: 1, crafting_table: 1 };
  const steps = planCatalog(registry, 'raw_iron', 15, initial, { nearby });
  replay(steps, initial, [{ item: 'raw_iron', count: 15 }]);
  assert.deepEqual(steps.map(s => [s.action, s.drops || s.item, s.count]), [['mine', 'raw_iron', 5]]);
});

test('nugget acquisition chooses new ingots instead of recycling existing nuggets', () => {
  const initial = { iron_nugget: 80, raw_iron: 3, furnace: 1, crafting_table: 1, birch_planks: 2 };
  const steps = planCatalog(registry, 'iron_nugget', 100, initial, { nearby });
  const stock = replay(steps, initial, [{ item: 'iron_nugget', count: 100 }]);
  assert.equal(stock.iron_nugget, 107);
  assert.equal(steps.find(s => s.action === 'smelt').count, 3);
  assert(!steps.some(s => s.consumes.iron_nugget));
});

test('unpacking an already carried resource block remains a valid source of new loose items', () => {
  const initial = { raw_iron: 4, raw_iron_block: 2 };
  const steps = planCatalog(registry, 'raw_iron', 13, initial, { nearby });
  const stock = replay(steps, initial, [{ item: 'raw_iron', count: 13 }]);
  assert.equal(steps.length, 1); assert.equal(steps[0].action, 'craft');
  assert.equal(stock.raw_iron, 13); assert.equal(stock.raw_iron_block, 1);
});

test('furnace construction cannot spend the cobblestone budgeted as its first smelting input', () => {
  const initial = { cobblestone: 8, stone_pickaxe: 1, crafting_table: 1, birch_planks: 6 };
  const steps = planCatalog(registry, 'stone', 8, initial, { nearby });
  replay(steps, initial, [{ item: 'stone', count: 8 }]);
  assert.equal(steps.filter(s => s.drops === 'cobblestone').reduce((n, s) => n + s.count, 0), 8);
  assert.equal(steps.filter(s => s.item === 'furnace').length, 1);
});

test('charcoal input logs remain reserved while crafting their furnace fuel', () => {
  const initial = { oak_log: 3, furnace: 1, crafting_table: 1 };
  const steps = planCatalog(registry, 'charcoal', 3, initial, { nearby: ['oak_log'] });
  replay(steps, initial, [{ item: 'charcoal', count: 3 }]);
  assert.equal(steps.filter(s => s.drops === 'oak_log').reduce((n, s) => n + s.count, 0), 1);
});

test('an existing requested tool remains available as a reusable mining prerequisite', () => {
  const initial = { iron_pickaxe: 1, crafting_table: 1, furnace: 1, birch_planks: 2, stick: 2 };
  const steps = planCatalog(registry, 'iron_pickaxe', 2, initial, { nearby });
  replay(steps, initial, [{ item: 'iron_pickaxe', count: 2 }]);
  assert.equal(steps.find(s => s.drops === 'raw_iron').tool, 'iron_pickaxe');
  assert(!steps.some(s => ['wooden_pickaxe', 'stone_pickaxe'].includes(s.item)));
});

test('mixed furnace-building and armor requests keep actual material totals', () => {
  const initial = { raw_iron: 9, cobblestone: 8, stone_pickaxe: 1, crafting_table: 1, birch_planks: 21 };
  const outputs = [{ item: 'stone', count: 8 }, { item: 'iron_chestplate', count: 2 }, { item: 'birch_planks', count: 4 }];
  const { steps } = batchPlan(registry, outputs, initial, { nearby });
  replay(steps, initial, outputs);
  assert.equal(steps.filter(s => s.drops === 'raw_iron').reduce((n, s) => n + s.count, 0), 7);
  assert.equal(steps.filter(s => s.drops === 'cobblestone').reduce((n, s) => n + s.count, 0), 8);
});

test('mixed acquisition stays balanced across 96 seeded partial inventories', () => {
  const choices = ['iron_helmet', 'iron_chestplate', 'iron_boots', 'iron_pickaxe', 'iron_sword', 'glass', 'glass_pane',
    'smooth_stone', 'stone_bricks', 'bucket', 'white_bed', 'chest', 'birch_stairs', 'birch_slab', 'birch_door', 'stick', 'torch'];
  let seed = 7142;
  const random = n => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % n; };
  for (let i = 0; i < 96; i++) {
    const outputs = Array.from({ length: 2 + random(3) }, () => ({ item: choices[random(choices.length)], count: 1 + random(20) }));
    const initial = { raw_iron: random(32), sand: random(24), birch_planks: random(32), birch_log: random(5),
      white_wool: random(12), coal: random(12), cobblestone: random(20), ...(i % 2 ? { iron_pickaxe: 1, crafting_table: 1, furnace: 1 } : {}) };
    replay(batchPlan(registry, outputs, initial, { nearby: ['birch_log', 'iron_ore', 'coal_ore', 'sand', 'stone'] }).steps, initial, outputs);
  }
});
