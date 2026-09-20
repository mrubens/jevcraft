'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { suspendPrevious, resumeSaved } = require('../src/suspended-tasks');

test('come here can interrupt a build and resume returns to the exact saved design', () => {
  const build = { version: 1, kind: 'build', request: 'build a tower', status: 'replaced', blueprint: { blocks: [{ x: 1, y: 65, z: 2 }] }, buildOwned: { '1,65,2': 5 } };
  const come = { kind: 'come', status: 'complete', suspendedTasks: suspendPrevious(build) };
  const restored = resumeSaved(JSON.parse(JSON.stringify(come)));
  assert.equal(restored.request, build.request); assert.deepEqual(restored.blueprint, build.blueprint);
  assert.deepEqual(restored.buildOwned, build.buildOwned); assert.deepEqual(restored.suspendedTasks, []);
  assert.equal(come.suspendedTasks.length, 1, 'selection never mutates the previous checkpoint');
});

test('saved batch and uncertain delivery survive replacement and JSON persistence', () => {
  const batch = { kind: 'bundle', status: 'interrupted', productionBatch: { targets: [{ index: 0, target: 21 }] },
    tasks: [{ count: 40, delivered: 12, pendingDelivery: { inventoryBefore: 21, deliveredBefore: 0, target: 21 } }] };
  const replacement = { kind: 'find', status: 'complete', suspendedTasks: suspendPrevious(batch) };
  const restored = resumeSaved(JSON.parse(JSON.stringify(replacement)));
  assert.deepEqual(restored.tasks, batch.tasks); assert.deepEqual(restored.productionBatch, batch.productionBatch);
});

test('resume prioritizes the current unfinished request and never automatically starts old work', () => {
  const current = { kind: 'obtain', status: 'cancelled', suspendedTasks: [{ kind: 'build', status: 'replaced' }] };
  assert.equal(resumeSaved(current), current);
  const complete = { kind: 'obtain', status: 'complete' };
  assert.equal(resumeSaved(complete), complete); assert.deepEqual(suspendPrevious(complete), []);
});

test('maintenance resume keeps a completed current task and preserves older work for an explicit resume', () => {
  const earlier = { kind: 'build', request: 'an earlier pyramid', status: 'replaced' };
  const saved = { kind: 'build', request: 'the finished pyramid', status: 'complete', suspendedTasks: [earlier] };
  assert.equal(resumeSaved(saved, { currentOnly: true }), saved);
  assert.equal(saved.suspendedTasks[0], earlier);
  assert.equal(resumeSaved(saved).request, earlier.request, 'Ordinary user resume can still select older work');
  const interrupted = { ...saved, status: 'cancelled' };
  assert.equal(resumeSaved(interrupted, { currentOnly: true }), interrupted);
});

test('repeated interruptions remain flat and resume the most recent unfinished request first', () => {
  let current;
  for (let i = 0; i < 12; i++) current = { kind: 'build', request: `building ${i}`, status: 'replaced', suspendedTasks: suspendPrevious(current) };
  assert.equal(current.suspendedTasks.length, 8); assert(current.suspendedTasks.every(t => !t.suspendedTasks));
  const restored = resumeSaved({ ...current, status: 'complete' });
  assert.equal(restored.request, 'building 10'); assert.equal(restored.suspendedTasks.length, 7);
});
