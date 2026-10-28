'use strict';
// The way into the Nether says what the Nether still owes (note 2333).
const test = require('node:test');
const assert = require('node:assert/strict');

test('13 rods carried: the Nether owes pearls alone, and says the fortress is not needed again', () => {
  const { netherOwesSays } = require('../src/strategy');
  const bot = { inventory: { items: () => [{ name: 'blaze_rod', count: 13 }] }, game: { dimension: 'overworld' } };
  const says = netherOwesSays(bot, { kind: 'win', gameProgress: {} });
  assert.match(says, /^ What the Nether still owes: the \d+ blaze rods wanted are in hand; \d+ of \d+ ender pearls still wanted\. The fortress is not needed again/);
  const none = netherOwesSays({ inventory: { items: () => [] }, game: { dimension: 'overworld' } }, { kind: 'win', gameProgress: {} });
  assert.match(none, /\d+ of \d+ blaze rods still wanted/);
});
