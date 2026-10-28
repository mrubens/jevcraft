'use strict';
// Note 2411. full-21 (25589, 2026-10-28 18:13 to 18:22Z): an errand to the Overworld with nothing named to bring, met
// there, was kept for its hour and sent the bot back out each time it came into the Nether.
const test = require('node:test');
const assert = require('node:assert/strict');
const { errandStage } = require('../src/game-progress');

test('an errand with nothing to bring ends where it arrives, and does not send the bot back later (note 2411)', () => {
  const now = Date.parse('2026-10-28T18:14:00Z');
  const goal = { errand: { dimension: 'overworld', items: [], for: 'a kit made again', at: now - 60000 } };
  const bot = { inventory: { items: () => [] } };
  assert.equal(errandStage(bot, goal, 'nether', now)?.action, 'return_overworld', 'in the Nether it goes out');
  assert.equal(errandStage(bot, goal, 'overworld', now), null, 'arrived');
  assert.equal(goal.errand, undefined, 'and over');
  assert.equal(errandStage(bot, goal, 'nether', now + 120000), null, 'not sent back out on the next Nether stay');
});
