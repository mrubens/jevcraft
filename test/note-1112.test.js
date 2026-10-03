'use strict';
// Note 1112: under the rock with the portal far across, the surface first.
// 25597 (2026-10-03 20:10 to 20:18Z): at y -10, its portal some 150 blocks across and 100 up, went at it through the rock, ten blocks every thirty seconds.
const test = require('node:test');
const assert = require('node:assert');
const { Vec3 } = require('vec3');
const { portalSurfaceFirst } = require('../src/work');

const world = y => ({ game: { dimension: 'overworld', minY: -64, height: 384 }, entity: { position: new Vec3(0.5, y, 0.5) },
  blockAt: p => (p.y <= 63 && !(Math.floor(p.x) === 0 && Math.floor(p.z) === 0 && p.y >= y && p.y <= y + 1) ? { name: 'stone', boundingBox: 'block', position: p } : { name: 'air', boundingBox: 'empty', position: p }) });

test('74 blocks under the surface, a portal 150 across and up at the surface: the surface first; near, on the surface, or with the portal deep beside the bot, not (note 1112)', () => {
  const deep = world(-10);
  const first = portalSurfaceFirst(deep, { x: 150, y: 90, z: 0 });
  assert(first && first.up >= 70 && first.rock > first.over, JSON.stringify(first));
  assert.equal(portalSurfaceFirst(deep, { x: 40, y: 90, z: 0 }), null, 'forty blocks across: the rock');
  assert.equal(portalSurfaceFirst(world(64), { x: 150, y: 70, z: 0 }), null, 'on the surface already');
  assert.equal(portalSurfaceFirst(deep, { x: 70, y: -12, z: 0 }), null, 'a portal at its own depth seventy across: straight at it');
});
