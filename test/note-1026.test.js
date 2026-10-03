'use strict';
// Note 1026: with wither skeletons within ten blocks each stance says what
// followed it in the day's trials, one about and two or more.
const test = require('node:test');
const assert = require('node:assert/strict');
const wg = require('../src/wither-guard');

test('shield guard against two or more: 20 of 47 followed by a death; cover none of 7; a row under five answers is not said', () => {
  assert.equal(wg.answerSays('shield_guard', 3), ' In the trials of 2026-10-03 00:00Z to 09:05Z, with two or more wither skeletons within ten blocks, after this stance was chosen (47 answers): 20 were followed by a death within thirty seconds (43%), 7.5 health lost in those thirty seconds on average (what followed, not what the stance caused).');
  assert.match(wg.answerSays('take_cover', 2), /\(7 answers\): none was followed by a death within thirty seconds, 0 health lost/);
  assert.match(wg.answerSays('shield_guard', 1), /with one wither skeleton within ten blocks, after this stance was chosen \(71 answers\): 10 were followed by a death within thirty seconds \(14%\)/);
  assert.equal(wg.answerSays('low_ceiling', 2), '');
  assert.equal(wg.answerSays('none_good', 1), '');
});
