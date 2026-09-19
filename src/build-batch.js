'use strict';
const { Vec3 } = require('vec3');
const { buildCellComplete, buildFootprint } = require('./build-blocks');
const { isDoor } = require('./doors');
const Heap = require('mineflayer-pathfinder/lib/heap');
function remainingBuildBatch(bot, batch) {
  return batch.cells.filter(p => !p.companion && !buildCellComplete(bot, p));
}
function materialCounts(cells) {
  return Object.entries(cells.filter(p => !p.companion).reduce((counts, p) => { counts[p.material] = (counts[p.material] || 0) + 1; return counts; }, {}))
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
function orderBuildCells(bot, missing) {
  const sorted = missing.filter(p => !p.companion).sort((a, b) => a.y - b.y || a.x - b.x || a.z - b.z);
  if (!sorted.some(p => p.properties) || !bot.blockAt) return sorted;
  const key = p => `${p.x},${p.y},${p.z}`, pending = new Map(sorted.map(p => [key(p), p])), ordered = [], planned = new Map();
  const rank = new Map(sorted.map((p, i) => [key(p), i])), ready = new Heap(), queued = new Set();
  const faces = [new Vec3(0, -1, 0), new Vec3(0, 1, 0), new Vec3(-1, 0, 0), new Vec3(1, 0, 0), new Vec3(0, 0, -1), new Vec3(0, 0, 1)];
  // Put a usable anchor before its dependent trim even when the anchor is
  // higher. Otherwise shrinking an inventory batch could exclude the beam
  // needed to attach its last upside-down slab, leaving a permanent dead end.
  const enqueue = cell => {
    const k = key(cell);
    if (queued.has(k)) return;
    const half = isDoor(cell.material) ? null : cell.properties?.half || cell.properties?.type;
    const supported = faces.some(face => {
      if (isDoor(cell.material) && face.y !== -1) return false;
      if (half && face.y && face.y !== (half === 'bottom' ? -1 : 1)) return false;
      const p = new Vec3(cell.x, cell.y, cell.z).plus(face), refKey = key(p);
      if (pending.has(refKey)) return false;
      const proposed = planned.get(refKey), observed = proposed ? null : bot.blockAt(p);
      if (!proposed && observed?.boundingBox !== 'block') return false;
      const material = proposed?.material || observed.name, properties = proposed?.properties || observed?.getProperties?.() || {};
      if (material.endsWith('_slab') && properties.type !== 'double') {
        if (face.y && material === cell.material) return false;
        if (!face.y && half && properties.type !== half) return false;
      }
      return true;
    });
    if (supported) { ready.push({ cell, f: rank.get(k) }); queued.add(k); }
  };
  for (const cell of sorted) enqueue(cell);
  while (!ready.isEmpty()) {
    const { cell } = ready.pop(), k = key(cell);
    pending.delete(k); ordered.push(cell);
    for (const part of buildFootprint(cell)) planned.set(key(part), part);
    // Only adjacent dependents can become ready. Repeated full scans can stall
    // network ticks on a long connected roof whose anchors run in reverse order.
    for (const part of buildFootprint(cell)) for (const face of faces) {
      const next = pending.get(key(new Vec3(part.x, part.y, part.z).plus(face)));
      if (next) enqueue(next);
    }
  }
  return [...ordered, ...pending.values()];
}
function createBuildBatch(bot, missing, makePlan, stock) {
  const sorted = orderBuildCells(bot, missing);
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
module.exports = { remainingBuildBatch, materialCounts, createBuildBatch, planFitsInventory, orderBuildCells };
