'use strict';
// Note 1023: among blazes each stance says where the rods came from: the
// step the bot was in as each was picked up, its minutes and its deaths.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const record = require('../src/blaze-record');

test('the rods by step: closing in brought 77 of 105; a corner none; said on each beside closing in', () => {
  assert.equal(record.rodsBySays('close_in'), ' Where the rods came from, 2026-10-03 03:00Z to 08:56Z (the step the bot was in as each of 105 rods was picked up): in closing in, 36 minutes in all, 77 rods and 7 deaths.');
  assert.match(record.rodsBySays('corner_ambush'), /in a corner ambush, 5 minutes in all, no rod and 3 deaths; closing in, 36 minutes, 77 rods and 7 deaths\.$/);
  assert.match(record.rodsBySays('box_here'), /in a box \(building it and holding it\), 44 minutes in all, 1 rod and 2 deaths; closing in/);
  assert.equal(record.rodsBySays('retreat'), '');
  const bot = { game: { dimension: 'the_nether' }, health: 20, food: 20, entity: { position: new Vec3(0, 64, 0) }, inventory: { items: () => [], slots: {} }, blockAt: () => null,
    entities: { 1: { name: 'blaze', position: new Vec3(5, 64, 0), isValid: true } } };
  assert.match(record.optionSays(bot, 'close_in', {}), /Where the rods came from/);
  // Note 1027: by the health it is chosen at; the rods by step only over 14 health.
  assert.match(record.optionSays(bot, 'close_in', {}), /Among blazes at over 14 health in the trials of 2026-10-03 00:00Z to 09:10Z, what followed within 45 seconds of an answer of this kind, closing in or a charge \(210 answers\): 5% a death, 10% a rod; of the other kinds at that health, a corner, a wall at the back or the shield held where it stands \(144 answers\): 7% a death, 5% a rod; leaving, cover or a hole \(272 answers\): 2% a death, 4% a rod/);
  bot.health = 5.5;
  const low = record.optionSays(bot, 'charge_nearest', {});
  assert.match(low, /Among blazes at 8 health or under .*closing in or a charge \(7 answers\): 29% a death, 0% a rod; .*shield held where it stands \(12 answers\): 67% a death, 0% a rod; leaving, cover or a hole \(26 answers\): 31% a death, 4% a rod/);
  assert.doesNotMatch(low, /Where the rods came from/, 'at 5.5 health the rods by step are not said');
  bot.health = 20;
  bot.entities = {};
  assert.doesNotMatch(record.optionSays(bot, 'close_in', {}), /Where the rods came from/, 'no blaze about: not said');
});
