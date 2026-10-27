'use strict';
// A craft of wood says what it leaves of the wood kept for pickaxes (note 2319).
const test = require('node:test');
const assert = require('node:assert/strict');

test('a shield from the last planks says the pickaxe wood it leaves', () => {
  const { woodLeftSays } = require('../src/work');
  const bot = items => ({ inventory: { items: () => items } });
  assert.match(woodLeftSays(bot([{ name: 'acacia_planks', count: 7 }]), 6),
    /^ It takes 6 planks of the 7 planks' worth of wood carried, leaving 1, under the 24 \(6 logs\) kept for pickaxes and a table; a pickaxe worn out after that waits on a tree\.$/);
  assert.match(woodLeftSays(bot([{ name: 'oak_planks', count: 6 }]), 6), /leaving 0, .*: no sticks are left for a pickaxe/);
  assert.equal(woodLeftSays(bot([{ name: 'oak_log', count: 8 }]), 6), '', 'plenty left: nothing said');
});
