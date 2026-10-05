'use strict';
// Note 1304: two string carried and no fishing rod: the rod is a rung, said with the fishing's record.
const test = require('node:test');
const assert = require('node:assert/strict');
test('the fishing rod rung is said with what fishing came to beside the food errands', () => {
  const src = require('fs').readFileSync(require.resolve('../src/strategy'), 'utf8');
  assert.match(src, /fishing_rod: 'food from any water, standing still on the bank: in the record of 2026-10-05 the bot\\'s 13 fishing sessions caught 64 cod and salmon in 33 minutes/);
});
