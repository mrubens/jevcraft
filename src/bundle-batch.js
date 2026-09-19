'use strict';
const { planFitsInventory } = require('./build-batch');

function batchFinished(goal, batch) {
  return batch.targets.every(({ index, target }) => {
    const child = goal.tasks[index];
    return child.deliver ? (child.delivered || 0) >= target : child.status === 'complete';
  });
}

function batchOutputs(goal, batch) {
  return batch.targets.map(({ index, target }) => {
    const child = goal.tasks[index];
    return { item: child.item, count: target - (child.deliver ? child.delivered || 0 : 0) };
  }).filter(output => output.count > 0);
}

function selectBundleBatch(registry, goal, stock, makePlan) {
  if (goal.productionBatch && !batchFinished(goal, goal.productionBatch)) return goal.productionBatch;
  // Keep the whole ordinary request together. Split only when intermediate
  // ingredients or completed items exceed the working inventory capacity.
  const deliveries = goal.tasks.reduce((total, child) => total + (child.deliver ? Math.max(0, child.count - (child.delivered || 0)) : 0), 0);
  let limit = deliveries;
  for (;;) {
    let remaining = limit;
    const targets = [];
    for (const [index, child] of goal.tasks.entries()) {
      if (!child.deliver) { targets.push({ index, target: child.count }); continue; }
      const count = Math.min(remaining, Math.max(0, child.count - (child.delivered || 0)));
      if (count) { targets.push({ index, target: (child.delivered || 0) + count }); remaining -= count; }
    }
    const batch = { targets, createdAt: new Date().toISOString() }, outputs = batchOutputs(goal, batch);
    if (planFitsInventory(registry, makePlan(outputs), stock)) {
      for (const child of goal.tasks) delete child.deliveryTarget;
      for (const { index, target } of targets) if (goal.tasks[index].deliver) goal.tasks[index].deliveryTarget = target;
      goal.productionBatch = batch;
      return batch;
    }
    if (limit <= 1) {
      const error = new Error('Not enough inventory space for this request. Make room or ask me to bring fewer items to keep.');
      error.name = 'Blocked'; throw error;
    }
    limit = Math.max(1, Math.floor(limit / 2));
  }
}

function nextBatchTask(goal) {
  if (!goal.productionBatch) return goal.tasks.findIndex(child => child.status !== 'complete');
  return goal.productionBatch.targets.find(({ index, target }) => {
    const child = goal.tasks[index];
    return child.deliver ? (child.delivered || 0) < target : child.status !== 'complete';
  })?.index ?? -1;
}

module.exports = { selectBundleBatch, batchOutputs, batchFinished, nextBatchTask };
