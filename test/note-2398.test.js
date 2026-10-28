'use strict';
// Note 2398. full-19 (25591, 2026-10-28) died in the Nether at 16:41:15Z in full iron and again in the Overworld at
// 16:44:35Z, before a walk back for the first was ever asked; the first death's kit was on no list.
const test = require('node:test');
const assert = require('node:assert/strict');
const { corpseRun } = require('../src/corpse-run');

const deaths = [
  { at: '2026-10-28T16:41:15.523Z', position: { x: -331, y: 53, z: 109 }, dimension: 'the_nether', worn: ['iron_helmet', 'iron_chestplate', 'iron_leggings', 'golden_boots', 'shield'], carried: { iron_pickaxe: 1, blaze_rod: 2 } },
  { at: '2026-10-28T16:44:35.376Z', position: { x: 66, y: 61, z: 675 }, dimension: 'overworld', worn: [] },
];

test('a death that never became a walk back, died again before it was asked, is on the list with its pockets (note 2398)', () => {
  const now = Date.parse('2026-10-28T16:50:00Z');
  const goal = { survival: { deaths, recovery: { at: deaths[1].at, status: 'finished', inventoryBeforeDeath: {}, recovered: {} } },
    corpseRunFor: deaths[1].at, corpseRunsEarlier: [], corpseRun: { deathAt: deaths[1].at, position: deaths[1].position, dimension: 'overworld', items: {}, status: 'nothing' } };
  const bot = { game: { dimension: 'overworld' }, entity: { position: { x: 60, y: 64, z: 670 } } };
  corpseRun(bot, goal, now);
  // Taken up as the run (the last one closed), asked from the Overworld by the kit trip.
  const listed = [goal.corpseRun, ...goal.corpseRunsEarlier].find(r => r?.deathAt === deaths[0].at);
  assert(listed, JSON.stringify(goal.corpseRunsEarlier));
  assert.equal(listed.dimension, 'nether');
  assert.equal(listed.items.blaze_rod, 2);
  assert.equal(listed.items.iron_pickaxe, 1);
  assert.equal(listed.items.iron_chestplate, 1);
  // Scanned once: a run closed and dropped from the list is not taken up again.
  goal.corpseRunsEarlier = []; goal.corpseRun.status = 'left'; goal.corpseRun.told = 7; goal.corpseRun.loadedAt = '2026-10-28T16:49:00Z';
  corpseRun(bot, goal, now + 60000);
  assert(!goal.corpseRunsEarlier.some(r => r.deathAt === deaths[0].at));
});
