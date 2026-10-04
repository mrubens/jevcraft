'use strict';
// Note 1071: a trial with all seven rods in its chests plays to twelve
// hours; with some rods or pearls kept, six; else three.
const test = require('node:test');
const assert = require('node:assert/strict');
const { limitFor } = require('../scripts/midgame');

test('the hours a trial plays by what its chests hold', () => {
  const hours = kept => limitFor(kept) / 3600000;
  assert.equal(hours(null), 3);
  assert.equal(hours({ rods: 0, pearls: 0 }), 3);
  assert.equal(hours({ rods: 0, pearls: 2 }), 6);
  assert.equal(hours({ rods: 5, pearls: 0 }), 6);
  assert.equal(hours({ rods: 6, pearls: 0 }), 24);
  assert.equal(hours({ rods: 7, pearls: 0 }), 24);
  assert.equal(hours({ rods: 10, pearls: 2 }), 24);
  // Six pearls kept as the rods are (note 1199).
  assert.equal(hours({ rods: 1, pearls: 8 }), 24);
  assert.equal(hours({ rods: 0, pearls: 5 }), 6);
  assert.equal(hours({ rods: 7, pearls: 12 }), 48);
});
