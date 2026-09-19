'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const registry = require('minecraft-data')('26.1');
const { batchPlan, remainingOutputs } = require('../src/batch-plan');
const { bundleStep } = require('../src/item-bundle');
const { Task } = require('../src/skills');
const armor = material => ['helmet', 'chestplate', 'leggings', 'boots'].map(piece => ({ item: `${material}_${piece}`, count: 1 }));
const readyTools = { iron_pickaxe: 1, crafting_table: 1, furnace: 1 };
const context = { nearby: ['oak_log', 'stone', 'iron_ore', 'diamond_ore'] };
function verify(outputs, initial = {}, options = context) {
  const plan = batchPlan(registry, outputs, initial, options), stock = { ...initial };
  for (const step of plan.steps) {
    assert(Number.isSafeInteger(step.count) && step.count > 0, `${step.action} count must be a whole number`);
    for (const [name, count] of Object.entries(step.requires || {})) assert((stock[name] || 0) >= count, `${step.action} requires ${name}`);
    for (const [name, count] of Object.entries(step.consumes)) {
      assert(Number.isSafeInteger(count) && count > 0, `${step.action} ${name} consumption must be a whole number`);
      assert((stock[name] || 0) >= count, `${step.action} ${step.item} lacks ${name}`); stock[name] -= count;
    }
    for (const [name, count] of Object.entries(step.produces)) stock[name] = (stock[name] || 0) + count;
  }
  for (const [name, count] of Object.entries(plan.totals)) assert((stock[name] || 0) >= count, `missing final ${name}`);
  return plan.steps;
}

test('full diamond armor collects all24 diamonds before making the first piece', () => {
  const plan = verify(armor('diamond'), readyTools);
  assert.deepEqual(plan.map(step => [step.action, step.item || step.drops, step.count]), [
    ['mine', 'diamond', 24], ...armor('diamond').map(output => ['craft', output.item, 1]),
  ]);
  assert(!plan.some(step => step.action === 'smelt'));
});

test('shared totals account for carried diamonds, finished pieces and already delivered outputs', () => {
  const outputs = remainingOutputs({ tasks: armor('diamond').map((output, i) => ({ ...output, deliver: true, delivered: i === 0 ? 1 : 0 })) });
  const plan = verify(outputs, { ...readyTools, diamond: 4, diamond_boots: 1 });
  assert.equal(plan.find(step => step.drops === 'diamond').count, 11);
  assert(!plan.some(step => step.item === 'diamond_helmet' || step.item === 'diamond_boots'));
});

test('all24 raw iron share one smelt before armor crafting, with one fuel allowance', () => {
  const plan = verify(armor('iron'), { ...readyTools, oak_planks: 24 });
  const smelts = plan.filter(step => step.action === 'smelt');
  assert.equal(smelts.length, 1); assert.equal(smelts[0].count, 24); assert.equal(smelts[0].fuel, 16);
  assert.equal(plan[0].drops, 'raw_iron'); assert.equal(plan[0].count, 24);
  assert(plan.indexOf(smelts[0]) < plan.findIndex(step => step.item === 'iron_helmet'));
});

test('combined smelting retains one local-wood fuel choice and preserves requested planks', () => {
  const plan = verify([...armor('iron'), { item: 'birch_planks', count: 8 }], { ...readyTools, raw_iron: 24, birch_planks: 24 }, { nearby: ['birch_log'] });
  const smelts = plan.filter(step => step.action === 'smelt');
  assert.equal(smelts.length, 1); assert.equal(smelts[0].count, 24);
  assert.equal(smelts[0].fuelItem, 'birch_planks'); assert.equal(smelts[0].consumes.birch_planks, 16);
  assert(!plan.some(step => step.action === 'mine'));
});

test('shared furnace fuel gathers only the logs still needed after merging smelts', () => {
  const outputs = [...armor('iron'), { item: 'birch_planks', count: 8 }];
  const plan = verify(outputs, { ...readyTools, raw_iron: 24 }, { nearby: ['birch_log'] });
  assert.equal(plan.filter(s => s.action === 'mine').length, 1);
  assert.equal(plan.find(s => s.drops === 'birch_log').count, 6);
  assert.equal(plan.find(s => s.item === 'birch_planks').count, 24);
  assert.equal(plan.find(s => s.action === 'smelt').fuel, 16);
});

test('different furnace inputs retain separate rounded fuel allowances and reserved outputs', () => {
  const plan = verify([{ item: 'glass', count: 1 }, { item: 'iron_ingot', count: 1 }, { item: 'birch_planks', count: 2 }],
    { ...readyTools, sand: 1, raw_iron: 1, birch_planks: 4 }, { nearby: ['birch_log'] });
  const smelts = plan.filter(s => s.action === 'smelt');
  assert.equal(smelts.length, 2); assert.equal(smelts.reduce((n, s) => n + s.fuel, 0), 2);
  assert(!plan.some(s => s.action === 'mine'));
});

test('fuel savings propagate through whole recipe yields across partially stocked inventories', () => {
  for (let planks = 0; planks <= 28; planks++) {
    const plan = verify([...armor('iron'), { item: 'birch_planks', count: 8 }],
      { ...readyTools, raw_iron: 24, birch_planks: planks }, { nearby: ['birch_log'] });
    const logs = plan.filter(s => s.drops === 'birch_log').reduce((sum, s) => sum + s.count, 0);
    assert.equal(logs, Math.ceil(Math.max(0, 24 - planks) / 4), `${planks} carried planks`);
  }
});

test('tools come before their ores even when their ingots are shared with final armor', () => {
  const outputs = [...armor('diamond'), ...armor('iron')];
  const plan = verify(outputs);
  assert(plan.findIndex(s => s.item === 'iron_pickaxe') < plan.findIndex(s => s.drops === 'diamond'));
  assert.equal(plan.filter(s => s.action === 'smelt' && s.item === 'iron_ingot').length, 1);
  assert.equal(plan.find(s => s.action === 'smelt' && s.item === 'iron_ingot').count, 27);
});

test('recipe yields and shared stock leave all requested ingredients and outputs present', () => {
  verify([{ item: 'oak_planks', count: 5 }, { item: 'chest', count: 1 }, { item: 'stick', count: 7 }], { oak_planks: 5 });
  verify([{ item: 'diamond', count: 8 }, ...armor('diamond')], { ...readyTools, diamond: 10 });
  verify([{ item: 'torch', count: 7 }, { item: 'torch', count: 5 }, { item: 'stick', count: 4 }], { coal: 4, oak_log: 3 });
});

test('diamond-tool progression cannot be merged into a circular dependency', () => {
  const plan = verify([{ item: 'obsidian', count: 4 }, ...armor('diamond')]);
  assert(plan.findIndex(s => s.item === 'diamond_pickaxe') < plan.findIndex(s => s.drops === 'obsidian'));
});

test('armor and a bed share supplies but retain every output', () => {
  const plan = verify([...armor('diamond'), { item: 'white_bed', count: 1 }], { ...readyTools, white_wool: 3, oak_planks: 3 });
  assert.equal(plan.find(s => s.drops === 'diamond').count, 24);
  assert(plan.findIndex(s => s.drops === 'diamond') < plan.findIndex(s => s.item === 'white_bed'));
});

test('multi-item preparation finishes before delivery, and pending handovers bypass replanning', async () => {
  const goal = { tasks: armor('diamond').map(output => ({ ...output, deliver: true })) };
  const bot = { inventory: { items: () => [] } }, task = new Task('batch'); let prepared = false, deliveries = 0;
  const execute = async child => { assert(prepared); deliveries++; child.delivered = 1; return true; };
  assert.equal(await bundleStep(bot, task, goal, () => {}, execute, { prepare: async () => false }), false);
  assert.equal(deliveries, 0);
  prepared = true;
  await bundleStep(bot, task, goal, () => {}, execute, { prepare: async () => true });
  goal.tasks[1].pendingDelivery = { inventoryBefore: 1 };
  const resumed = structuredClone(goal);
  await bundleStep(bot, task, resumed, () => {}, execute, { prepare: async () => assert.fail('uncertain handover must be resolved first') });
  assert.equal(deliveries, 2); assert.equal(resumed.tasks[0].delivered, 1);
  task.cancel();
  await assert.rejects(bundleStep(bot, task, resumed, () => {}, execute, { prepare: async () => assert.fail('cancelled plan') }), { name: 'Cancelled' });
});
