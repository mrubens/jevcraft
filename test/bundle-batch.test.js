'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const registry = require('minecraft-data')('26.1');
const { selectBundleBatch, batchOutputs } = require('../src/bundle-batch');
const { batchPlan } = require('../src/batch-plan');
const { bundleStep } = require('../src/item-bundle');
const { Task } = require('../src/skills');
const stock = { iron_pickaxe: 1, crafting_table: 1, white_wool: 3, oak_planks: 3 };
const plan = (outputs, inventory) => batchPlan(registry, outputs, inventory, { nearby: ['oak_log', 'stone', 'diamond_ore'] }).steps;

test('ordinary full armor and a bed stay together and gather all 24 diamonds first', () => {
  const goal = { tasks: [...['helmet', 'chestplate', 'leggings', 'boots'].map(part => ({ item: `diamond_${part}`, count: 1, deliver: true })), { item: 'white_bed', count: 1, deliver: true }] };
  const batch = selectBundleBatch(registry, goal, stock, outputs => plan(outputs, stock));
  assert.equal(batch.targets.length, 5);
  const steps = plan(batchOutputs(goal, batch), stock);
  assert.equal(steps.find(s => s.drops === 'diamond').count, 24);
  assert(steps.findIndex(s => s.drops === 'diamond') < steps.findIndex(s => s.action === 'craft'));
});

test('large unstackable deliveries finish in fitting lots with exact totals after resume', async () => {
  let goal = { tasks: [{ item: 'diamond_helmet', count: 40, deliver: true }, { item: 'white_bed', count: 1, deliver: true }] };
  const held = { ...stock }, delivered = {}, mined = {}, batchSizes = [], task = new Task('large bundle');
  const bot = { inventory: { items: () => Object.entries(held).filter(([,count]) => count > 0).map(([name, count]) => ({ name, count })) } };
  let resumed = false, done = false, previousBatch;
  for (let round = 0; !done && round < 20; round++) {
    done = await bundleStep(bot, task, goal, () => {}, async child => {
      const count = child.deliveryTarget - (child.delivered || 0);
      assert(held[child.item] >= count);
      held[child.item] -= count; delivered[child.item] = (delivered[child.item] || 0) + count;
      child.delivered = child.deliveryTarget;
      return child.delivered >= child.count;
    }, { prepare: async () => {
      const batch = selectBundleBatch(registry, goal, held, outputs => plan(outputs, held));
      if (batch !== previousBatch) { batchSizes.push(batch.targets.map(t => t.target)); previousBatch = batch; }
      const steps = plan(batchOutputs(goal, batch), held);
      for (const step of steps) {
        for (const [item, count] of Object.entries(step.consumes || {})) { assert(held[item] >= count); held[item] -= count; }
        for (const [item, count] of Object.entries(step.produces || {})) held[item] = (held[item] || 0) + count;
        if (step.action === 'mine') mined[step.drops] = (mined[step.drops] || 0) + step.count;
        const slots = Object.entries(held).reduce((n, [item, count]) => n + Math.ceil(count / registry.itemsByName[item].stackSize), 0);
        assert(slots <= 30, `production overflowed with ${slots} occupied slots`);
      }
      return !steps.length;
    } });
    if (!resumed && delivered.diamond_helmet) { goal = JSON.parse(JSON.stringify(goal)); resumed = true; }
  }
  assert(done); assert(resumed); assert(batchSizes.length >= 2);
  assert.deepEqual(delivered, { diamond_helmet: 40, white_bed: 1 }); assert.equal(mined.diamond, 200);
});

test('kept outputs remain reserved in later batches', () => {
  const goal = { tasks: [{ item: 'diamond', count: 8, status: 'complete' }, { item: 'diamond_helmet', count: 40, deliver: true }] };
  const inventory = { ...stock, diamond: 8 };
  const batch = selectBundleBatch(registry, goal, inventory, outputs => plan(outputs, inventory));
  assert(batch.targets.some(t => t.index === 0 && t.target === 8));
  assert(plan(batchOutputs(goal, batch), inventory).find(s => s.drops === 'diamond').count > 0);
});

test('a keep request that cannot fit never starts an impossible gathering trip', () => {
  const goal = { tasks: [{ item: 'diamond_helmet', count: 40, deliver: false }] };
  assert.throws(() => selectBundleBatch(registry, goal, stock, outputs => plan(outputs, stock)), { name: 'Blocked' });
});
