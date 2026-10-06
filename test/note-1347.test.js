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
