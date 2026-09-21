'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { statusMessage } = require('../src/status');

test('a status request during the dream names the rung, the step and the base', () => {
  const goal = { kind: 'win', status: 'running', step: { action: 'tunnel', target: { x: 1, y: 16, z: 1 } }, gameProgress: { phase: 'iron_armour' },
    survival: { home: { origin: { x: -426, y: 62, z: -161 }, bed: { claimedAt: 'now' } } } };
  assert.equal(statusMessage({}, { goal }, null), "Beating the game, on the iron armour rung. I'm digging a staircase toward y=16. Base at -426, -161.");
  goal.step = { action: 'level_site', digs: 45, fills: 0 }; delete goal.survival.home.bed.claimedAt;
  assert.equal(statusMessage({}, { goal }, null), "Beating the game, on the iron armour rung. I'm levelling the ground for the base: 45 to dig, 0 to fill.");
});
