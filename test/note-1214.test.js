'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { climbToSurface, surfaceReturnComplete } = require('../src/surface');

// Sea to y 62 over a floor at y 50; `roof(y)` puts stone there.
const sea = (roof = () => false) => ({ game: { minY: -64, height: 384 }, blockAt: p => {
  const y = Math.floor(p.y);
  if (roof(y)) return { name: 'stone', boundingBox: 'block' };
  if (y <= 50) return { name: 'stone', boundingBox: 'block' };
  if (y <= 62) return { name: 'water', boundingBox: 'empty', getProperties: () => ({ level: 0 }) };
  return { name: 'air', boundingBox: 'empty' };
} });

test('in water open to the sky the bot is not under anything, however far down the water it swims; under a roof it is (note 1214)', () => {
  assert.equal(climbToSurface(sea(), new Vec3(0.5, 60.2, 0.5)), 0, 'two blocks under the sea\'s top');
  assert.equal(climbToSurface(sea(), new Vec3(0.5, 52, 0.5)), 0, 'at the bottom of the sea');
  assert.equal(climbToSurface(sea(), new Vec3(0.5, 63, 0.5)), 0, 'over the water');
  // A roof of stone over the water: under it.
  assert.equal(climbToSurface(sea(y => y === 70), new Vec3(0.5, 60, 0.5)), 11);
  // In a cave under the sea floor: the sea over it is cover.
  assert.equal(climbToSurface(sea(), new Vec3(0.5, 40, 0.5)) > 20, true);
});

test('swimming in water open to the sky, the return to the surface is done; under a roof over the water it is not (note 1216)', () => {
  const at = (bot, y) => Object.assign(bot, { game: { ...bot.game, dimension: 'overworld' }, entity: { position: new Vec3(0.5, y, 0.5) } });
  assert.equal(surfaceReturnComplete(at(sea(), 61.3), {}), true);
  assert.equal(surfaceReturnComplete(at(sea(y => y === 70), 61.3), {}), false);
});
