'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const registry = require('minecraft-data')('26.1');
const { Vec3 } = require('vec3');
const { createBuildBatch, materialCounts, remainingBuildBatch, planFitsInventory, orderBuildCells } = require('../src/build-batch');
const { batchPlan } = require('../src/batch-plan');
test('a build batches shared sand for glass and sandstone before making either output', () => {
  const cells = ['sandstone', 'glass'].flatMap((material, x) => Array.from({ length: 16 }, (_, z) => ({ x, y: 0, z, material })));
  const stock = { crafting_table: 1, furnace: 1, oak_planks: 16 }, make = outputs => batchPlan(registry, outputs, stock, { nearby: ['sand'] }).steps;
  const batch = createBuildBatch({ registry }, cells, make, stock), plan = make(batch.outputs);
  assert.equal(batch.cells.length, 32);
  const sand = plan.filter(step => step.action === 'mine' && step.drops === 'sand');
  assert.equal(sand.length, 1); assert.equal(sand[0].count, 80);
  assert(plan.indexOf(sand[0]) < plan.findIndex(s => ['craft', 'smelt'].includes(s.action)));
});
test('construction working lots shrink when all recipe inputs would overflow inventory', () => {
  const cells = Array.from({ length: 600 }, (_, x) => ({ x, y: Math.floor(x / 100), z: 0, material: 'sandstone' }));
  const stock = { crafting_table: 1, furnace: 1, iron_pickaxe: 1, dirt: 64, bread: 16 };
  const make = outputs => batchPlan(registry, outputs, stock, { nearby: ['sand'] }).steps;
  const batch = createBuildBatch({ registry }, cells, make, stock);
  assert(batch.cells.length > 64); assert(batch.cells.length < 512);
  assert(planFitsInventory(registry, make(batch.outputs), stock));
  assert(batch.cells.every(p => p.y <= batch.cells.at(-1).y));
});
test('resumed construction batches use actual placed blocks, not remembered output counts', () => {
  const batch = JSON.parse(JSON.stringify({ cells: [{ x: 0, y: 63, z: 0, material: 'sandstone' }, { x: 1, y: 63, z: 0, material: 'glass' }] }));
  const bot = { blockAt: p => { assert(p instanceof Vec3); return { name: p.x ? 'air' : 'sandstone' }; } };
  assert.deepEqual(materialCounts(remainingBuildBatch(bot, batch)), [{ item: 'glass', count: 1 }]);
});

test('a completely full inventory does not produce a batch that cannot fit its next input', () => {
  const stock = { dirt: 2304 }, cells = [{ x: 0, y: 0, z: 0, material: 'glass' }];
  const make = () => [{ action: 'mine', consumes: {}, produces: { sand: 1 } }];
  assert.throws(() => createBuildBatch({ registry }, cells, make, stock), { name: 'Blocked' });
});

test('a capacity-limited batch includes the higher support before its hanging trim', () => {
  const beam = { x: 1, y: 66, z: 0, material: 'oak_planks' };
  const slab = { x: 1, y: 65, z: 0, material: 'oak_slab', properties: { type: 'top', waterlogged: false } };
  const bot = { registry, blockAt: p => p.equals(new Vec3(0, 66, 0)) ? { name: 'oak_planks', boundingBox: 'block' } : { name: 'air', boundingBox: 'empty' } };
  assert.deepEqual(orderBuildCells(bot, [slab, beam]), [beam, slab]);
  // Thirty existing stacks leave room only for one material's recipe input.
  const stock = { dirt: 64 * 30 };
  const plan = outputs => [{ produces: Object.fromEntries(outputs.map(o => [o.item, o.count])) }];
  const batch = createBuildBatch(bot, [slab, beam], plan, stock);
  assert.deepEqual(batch.cells, [beam]);
});

test('a long roof with supports in reverse order does not repeatedly rescan the whole build', () => {
  const cells = Array.from({ length: 6000 }, (_, x) => ({ x, y: 65, z: 0, material: 'oak_slab', properties: { type: 'top' } }));
  let reads = 0;
  const bot = { blockAt: p => { reads++; return p.equals(new Vec3(6000, 65, 0)) ? { name: 'stone', boundingBox: 'block' } : { name: 'air', boundingBox: 'empty' }; } };
  const ordered = orderBuildCells(bot, cells);
  assert.equal(ordered[0].x, 5999); assert.equal(ordered.at(-1).x, 0);
  assert(reads < cells.length * 40, `${reads} world reads should scale with cells and adjacent faces`);
});

test('a plain-block shape is ordered by support too, so a one-cell batch is always placeable', () => {
  // The bottom of a heart: a tip, then three across. Sorted by x alone the
  // left cell came first, with nothing beside or under it yet.
  const tip = { x: 0, y: 65, z: 0, material: 'red_concrete' };
  const row = [-1, 0, 1].map(x => ({ x, y: 66, z: 0, material: 'red_concrete' }));
  const bot = { registry, blockAt: p => p.equals(new Vec3(0, 65, 0)) ? { name: 'red_concrete', boundingBox: 'block' } : { name: 'air', boundingBox: 'empty' } };
  assert.deepEqual(orderBuildCells(bot, row)[0], row[1], 'the cell on the tip goes first');
  const stock = { dirt: 64 * 35 };
  const plan = outputs => [{ produces: Object.fromEntries(outputs.map(o => [o.item, o.count])) }];
  assert.deepEqual(createBuildBatch(bot, row, plan, stock).cells, [row[1]]);
  assert.deepEqual(orderBuildCells({ ...bot, blockAt: () => ({ name: 'air', boundingBox: 'empty' }) }, [tip, ...row])[0], tip);
});
