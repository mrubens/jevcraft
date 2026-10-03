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
  bot.entities = {};
  assert.doesNotMatch(record.optionSays(bot, 'close_in', {}), /Where the rods came from/, 'no blaze about: not said');
});
