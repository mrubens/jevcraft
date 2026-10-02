'use strict';
// Note 937: a way out of lava that just failed from about here is passed over.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { escape } = require('../src/lava-escape');

function survivalWith(ran, failedBefore) {
  const bot = { entity: { position: new Vec3(-27.7, 31, 20.6), metadata: {} }, health: 9.8, game: { dimension: 'the_nether' },
    blockAt: p => ({ name: 'lava', position: p, boundingBox: 'empty', getProperties: () => ({}) }), emit() {} };
  const state = { lavaEscapes: failedBefore };
  return { bot, state, lavaWays: () => ({
    back_the_way_came: { description: 'Back.', run: async () => { ran.push('back_the_way_came'); return false; } },
    swim_up: { description: 'Up.', run: async () => { ran.push('swim_up'); return false; } } }) };
}

test('back the way it came failed here a moment ago: swim up is taken instead', async () => {
  const ran = [];
  const failed = [{ at: new Date(Date.now() - 3000).toISOString(), position: { x: -28.6, y: 29.8, z: 21.9 }, took: 'back_the_way_came', out: false }];
  await escape(survivalWith(ran, failed), { check() {} }, {}, () => {}, { log: () => {} });
  assert.deepEqual(ran, ['swim_up']);
});

test('nothing failed here: the order as it was; both failed: the first again', async () => {
  const ran = [];
  await escape(survivalWith(ran, []), { check() {} }, {}, () => {}, { log: () => {} });
  const both = [{ at: new Date().toISOString(), position: { x: -27.7, y: 31, z: 20.6 }, took: 'back_the_way_came', out: false },
    { at: new Date().toISOString(), position: { x: -27.7, y: 31, z: 20.6 }, took: 'swim_up', out: false }];
  await escape(survivalWith(ran, both), { check() {} }, {}, () => {}, { log: () => {} });
  assert.deepEqual(ran, ['back_the_way_came', 'back_the_way_came']);
});
