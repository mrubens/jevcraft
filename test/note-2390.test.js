'use strict';
// Note 2390. full-21 (25589, 2026-10-28 15:32:27 and 15:41:50Z) said
// "undefined" in chat on choosing mine_gold_for_barter, and was asked
// pearl_order again "because a way ... is real now: " with nothing after:
// neither the chat line nor the reason had the gold ore way.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { askAgainBecause, KIND } = require('../src/pearl-order');

test('the gold ore way is said by name when it is new, not as nothing (note 2390)', () => {
  const now = Date.parse('2026-10-28T15:41:50Z');
  const goal = { pearlOrder: { pick: 'rods_first', at: now - 60000, until: now + 600000, offered: [] } };
  const why = askAgainBecause({}, goal, ['gold ore'], now);
  assert.match(why, /is real now: nether gold ore within reach to mine and barter$/);
  assert.doesNotMatch(why, /undefined/);
});

test('every pick of KIND has its chat line (note 2390)', () => {
  const src = fs.readFileSync(require.resolve('../src/pearl-order'), 'utf8');
  const line = src.split('\n').find(l => l.includes("if (KIND[pick]) bot.chat"));
  for (const pick of Object.keys(KIND)) assert(line.includes(`${pick}: '`), pick);
});
