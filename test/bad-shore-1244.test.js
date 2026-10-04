'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { noteBadShore, badShore } = require('../src/shore');

test('a bank the swim stood half a minute at is passed over for half an hour, through a death (note 1244)', () => {
  const goal = {}, t0 = 1e12;
  noteBadShore(goal, { x: 70, z: 464 }, t0);
  assert.equal(badShore(goal, { x: 71, y: 65, z: 465 }, t0 + 60000), true, 'the bank over the niche');
  assert.equal(badShore(goal, { x: 90, y: 63, z: 470 }, t0 + 60000), false, 'a bank twenty blocks along is swum for');
  assert.equal(badShore(goal, { x: 71, y: 65, z: 465 }, t0 + 31 * 60000), false, 'after half an hour it is tried again');
  noteBadShore(goal, { x: 70, z: 465 }, t0 + 1000);
  assert.equal(goal.shoreBad.length, 1, 'the same place is one entry');
  assert.deepEqual(JSON.parse(JSON.stringify(goal)).shoreBad[0], { x: 70, z: 465, at: t0 + 1000 }, 'kept in the saved goal');
});
