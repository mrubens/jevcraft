'use strict';
// Note 1069: the ore tunnelled toward: from well above the ore's depth, one
// far off gives way to the ore's own band, or to the staircase down to it.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { oreToTunnel } = require('../src/work');

const feet = new Vec3(0.5, 66, 0.5), IRON = 16;

test('from the surface, wanting 14: an ore 30 blocks off at y 52 is passed for the staircase down, or for one found at y 28', () => {
  const high = new Vec3(28, 52, 8), deep = new Vec3(20, 28, 30);
  assert.equal(oreToTunnel([high], feet, IRON, 14), null, 'none found in the band: down toward it');
  assert.equal(oreToTunnel([high, deep], feet, IRON, 14), deep);
});

test('the nearest still: where it is within 16 blocks, where the bot is down at the depth, where a few are wanted, or with no depth known', () => {
  const near = new Vec3(8, 60, 4), far = new Vec3(28, 52, 8);
  assert.equal(oreToTunnel([near, far], feet, IRON, 14), near);
  assert.equal(oreToTunnel([far], new Vec3(0.5, 38, 0.5), IRON, 14), far, 'at y 38 the bot is within 24 of the depth');
  assert.equal(oreToTunnel([far], feet, IRON, 3), far, 'three for a pickaxe');
  assert.equal(oreToTunnel([far], feet, null, 14), far);
  assert.equal(oreToTunnel([], feet, IRON, 14), null);
});
