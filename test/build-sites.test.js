'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { reservedForConstruction, portalSiteClear } = require('../src/build-sites');

test('resource gathering preserves house and portal foundations and approaches', () => {
  const goal = { portalFrame: { origin: { x: 29, y: 64, z: -12 } } };
  assert(reservedForConstruction(goal, new Vec3(29, 63, -12)));
  assert(reservedForConstruction(goal, new Vec3(32, 62, -11)));
  assert(!reservedForConstruction(goal, new Vec3(37, 63, -12)));
  assert(reservedForConstruction({ blueprint: { origin: { x: 0, y: 64, z: 0 } } }, new Vec3(-2, 63, 2)));
});

test('portal site requires level support across the entire frame and walking approaches', () => {
  const origin = new Vec3(0, 64, 0);
  const holes = new Set();
  const bot = { blockAt: p => ({ name: p.y === 63 && !holes.has(`${p}`) ? 'dirt' : 'air',
    boundingBox: p.y === 63 && !holes.has(`${p}`) ? 'block' : 'empty' }) };
  assert(portalSiteClear(bot, origin));
  holes.add(`${new Vec3(3, 63, 0)}`);
  assert(!portalSiteClear(bot, origin));
});
