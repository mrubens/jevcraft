'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { huntLeft } = require('../src/mob-hunt');

const bot = pearls => ({ inventory: { items: () => pearls ? [{ name: 'ender_pearl', count: pearls }] : [] } });

test('the pearls a hunt says are still needed count those kept in chests (note 1137)', () => {
  // 25591, 2026-10-03 23:37:59Z: one carried, seven in its chests, thirteen wanted.
  const goal = { kind: 'win', gameProgress: { milestones: {} }, mobHunt: { item: 'ender_pearl', entity: 'enderman', targetCount: 14 },
    rodStashes: [{ dimension: 'overworld', position: { x: 0, y: 64, z: 0 }, contents: { ender_pearl: 7, blaze_rod: 9 } }] };
  const kept = require('../src/rod-stash').stashed(goal).ender_pearl;
  assert.equal(huntLeft(bot(1), goal), 13 - 1 - kept);
  assert.equal(huntLeft(bot(1), { ...goal, rodStashes: [] }), 12);
});

test('a hunt a request began keeps its own count', () => {
  const goal = { kind: 'request', mobHunt: { item: 'ender_pearl', entity: 'enderman', targetCount: 4 } };
  assert.equal(huntLeft(bot(1), goal), 3);
});
