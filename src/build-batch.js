'use strict';
const { Vec3 } = require('vec3');
function remainingBuildBatch(bot, batch) {
  return batch.cells.filter(p => bot.blockAt(new Vec3(p.x, p.y, p.z))?.name !== p.material);
}
function materialCounts(cells) {
  return Object.entries(cells.reduce((counts, p) => { counts[p.material] = (counts[p.material] || 0) + 1; return counts; }, {}))
    .map(([item, count]) => ({ item, count }));
}
function planFitsInventory(registry, plan, stock, limit = 30) {
  const held = { ...stock };
  const slots = () => Object.entries(held).reduce((total, [name, count]) => total + Math.ceil(Math.max(0, count) / (registry.itemsByName[name]?.stackSize || 64)), 0);
  // Leave slots for drops, food and replacement tools. A large build need not
  // fit at once; its working batch and all recipe inputs do have to fit.
  for (const step of plan) {
    for (const [name, count] of Object.entries(step.consumes || {})) held[name] = (held[name] || 0) - count;
    for (const [name, count] of Object.entries(step.produces || {})) held[name] = (held[name] || 0) + count;
    if (slots() > limit) return false;
  }
  return true;
}
function createBuildBatch(bot, missing, makePlan, stock) {
  const sorted = [...missing].sort((a, b) => a.y - b.y || a.x - b.x || a.z - b.z);
  let count = Math.min(512, sorted.length);
  while (count > 0) {
    const cells = sorted.slice(0, count), outputs = materialCounts(cells);
    const plan = makePlan(outputs);
    if (planFitsInventory(bot.registry, plan, stock, count === 1 ? 36 : 30)) return { cells, outputs, phase: 'gather', createdAt: new Date().toISOString() };
    if (count === 1) { const error = new Error('There is not enough inventory space for the next building recipe'); error.name = 'Blocked'; throw error; }
    count = Math.max(1, Math.floor(count / 2));
  }
  return null;
}
module.exports = { remainingBuildBatch, materialCounts, createBuildBatch, planFitsInventory };
