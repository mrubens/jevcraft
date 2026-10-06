'use strict';
// Notes 1345 and 1347: the End portal near with its eyes carried is said
// with the frames, the eyes and the seconds the placing takes.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { endPortalNearSays } = require('../src/end-portal');

const goal = { endPortal: { center: { x: 604, y: -37, z: 1540 }, frames: Array.from({ length: 12 }, () => ({ eye: false })) } };
const bot = (at, eyes) => ({ entity: { position: new Vec3(...at) }, inventory: { items: () => eyes ? [{ name: 'ender_eye', count: eyes }] : [] } });

test('six blocks from its frames with twelve eyes: said; far, or no eyes: nothing', () => {
  assert.match(endPortalNearSays(bot([611, -33, 1539], 12), goal), /^ The End portal's frames are 8 blocks off, 12 of them empty and 12 eyes of ender carried: placing them is about 18 seconds and opens the portal; the End has no night/);
  assert.match(endPortalNearSays(bot([611, -33, 1539], 9), goal), /9 eyes of ender carried, 3 short;/);
  assert.equal(endPortalNearSays(bot([700, -33, 1539], 12), goal), '');
  assert.equal(endPortalNearSays(bot([611, -33, 1539], 0), goal), '');
});

test('note 1369: keep_here chosen and broken off is carried out again on the next pass, not asked', async () => {
  const eb = require('../src/eye-bank');
  const rs = require('../src/rod-stash');
  const orig = rs.stashRods; let stashCalls = 0;
  rs.stashRods = async () => { stashCalls++; return true; };
  try {
    const items = [{ name: 'ender_eye', count: 11 }];
    const bot = { entity: { position: new Vec3(0, 64, 0) }, game: { dimension: 'overworld' }, inventory: { items: () => items }, health: 20, food: 20, blockAt: p => ({ name: 'chest', position: p, boundingBox: 'block' }), findBlocks: () => [] };
    const goal = { kind: 'win', eyesNow: { count: 11, at: Date.now() - 60000, pick: 'keep_here' }, rodStashes: [{ position: { x: 3, y: 64, z: 0 }, dimension: 'overworld', contents: {} }] };
    let asked = 0; const client = { systemOne: async () => { asked++; return { answers: {} }; } };
    const r = await eb.eyesNow(bot, { check() {} }, goal, () => {}, {}, client, { errand: 'test' });
    assert.equal(asked, 0); assert.equal(stashCalls, 1); assert.equal(r, 'kept'); assert.equal(goal.eyesNow.done, true);
  } finally { rs.stashRods = orig; }
});
