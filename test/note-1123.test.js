'use strict';
// Note 1123: the first answer to a creeper, by the record.
const test = require('node:test');
const assert = require('node:assert');
const { says, RECORD } = require('../src/creeper-first');

test('the run from a creeper says the blasts the record took after it, beside the block, the dance, the fight and the shield (note 1123)', () => {
  assert.match(says('retreat'), /a blast that hurt the bot within forty seconds of the first answer to a creeper: a run 20 of 118 times; against the block laid between 25 of 251, the dance in and out of its reach 2 of 42, a fight 8 of 29, the shield held to the blast 2 of 23\./);
  assert.match(says('creeper_dance'), /: the dance in and out of its reach 2 of 42 times; against /);
  assert.equal(says('seal'), '');
  assert(RECORD.block_creeper[0] > 100);
});
