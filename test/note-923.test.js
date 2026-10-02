'use strict';
// Note 923: the steps into a cauldron are held as the body's way out of
// fire while they run, so the shot reflex leaves them their keys.
const test = require('node:test');
const assert = require('node:assert/strict');
const { asWayOut } = require('../src/cauldron');
const { wayOutRunning } = require('../src/vitals');

test('while the steps in run, the body\'s way out of fire is running; after, it is not', async () => {
  const bot = {};
  let during = null;
  const out = await asWayOut(bot, async () => { during = wayOutRunning(bot); await new Promise(r => setTimeout(r, 20)); return 'in'; });
  assert.equal(during, 'out_of_fire');
  assert.equal(out, 'in');
  assert.equal(wayOutRunning(bot), null);
});

test('steps that throw leave no mark behind', async () => {
  const bot = {};
  await assert.rejects(asWayOut(bot, async () => { throw new Error('struck'); }), /struck/);
  assert.equal(wayOutRunning(bot), null);
});

test('the mark is kept fresh past the three seconds a way out is read for', async () => {
  const bot = {};
  let age = null;
  await asWayOut(bot, async () => { await new Promise(r => setTimeout(r, 1200)); age = Date.now() - bot._bodyWayRunning.at; });
  assert.ok(age < 700, `marked ${age} ms ago`);
});
