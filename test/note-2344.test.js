// note 2344: a way set aside at one landing rests only near that landing.
const test = require('node:test');
const assert = require('node:assert');
const { setAside, attemptsFor, keyOf } = require('../src/progress');
const { restsFromHere, LANDING_NEAR } = require('../src/tunneling');

test('a staircase stalled at a far landing is open from here; near it, it rests', () => {
  const goal = { survival: {} };
  const t = { x: -400, y: 0, z: 24 };
  setAside(goal, 'reach', t, 'no safe step toward it from (-396, 25, 30)', 1200000);
  attemptsFor(goal).entries[keyOf('reach', t)].from = { x: -396, y: 25, z: 30 };
  assert.equal(restsFromHere(goal, 'reach', t, { x: -395, y: 25, z: 31 }), true);
  assert.equal(restsFromHere(goal, 'reach', t, { x: -396 + LANDING_NEAR + 4, y: 64, z: 30 }), false);
});

test('a rest with no landing rests from anywhere, and a lapsed one nowhere', () => {
  const goal = { survival: {} };
  const t = { x: 10, y: 10, z: 10 };
  setAside(goal, 'staircase', { x: 8, y: 8, z: 8 }, 'resting', 600000);
  assert.equal(restsFromHere(goal, 'staircase', t, { x: 500, y: 64, z: 500 }), true);
  assert.equal(restsFromHere(goal, 'staircase', t, { x: 500, y: 64, z: 500 }, Date.now() + 700000), false);
});
