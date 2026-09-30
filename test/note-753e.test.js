'use strict';
// Note 753e: after note 753d went live (17:56Z, 2026-09-30), the live
// critic's report of 18:00Z, items 1-3.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');

test('water with no dry shore is waded into where it is shallow, not climbed away from (25595 mid-243-md 17:56:15Z, note 753e)', () => {
  const { wadeable } = require('../src/water');
  const pond = (floorY, airFrom) => ({ blockAt: p => p.y <= floorY ? { name: 'stone', boundingBox: 'block', position: p } : p.y >= airFrom ? { name: 'air', boundingBox: 'empty', position: p } : { name: 'water', boundingBox: 'empty', position: p } });
  assert.equal(wadeable(pond(62, 64), new Vec3(5, 63, 0)), true, 'a block deep, air over it');
  assert.equal(wadeable(pond(55, 64), new Vec3(5, 63, 0)), false, 'no floor within two');
  assert.equal(wadeable(pond(62, 70), new Vec3(5, 63, 0)), false, 'water over the head');
  const src = require('fs').readFileSync(require.resolve('../src/water'), 'utf8');
  const wade = src.indexOf('const wade = sources.filter(p => wadeable(bot, p))'), climb = src.indexOf("await explore(bot, task, goal, save, 'water', { surfaceOnly: true });");
  assert(wade > 0 && climb > wade, 'waded before the search up top');
  const cast = require('fs').readFileSync(require.resolve('../src/portal-cast'), 'utf8');
  assert.match(cast, /if \(!stand && require\('\.\/water'\)\.wadeable\(bot, target\)\)/, 'the cast\'s own source too, when no dry place is in reach');
});

test('the cast\'s wall blocks are made up in what the ground here gives, not the kind carried most (25598 mid-241-db 17:55-17:57Z, note 753e)', () => {
  const { supportMaterialHere } = require('../src/work');
  const at = (y, dimension = 'overworld') => ({ entity: { position: new Vec3(0, y, 0) }, game: { dimension } });
  assert.equal(supportMaterialHere(at(37)), 'cobblestone', 'up at y 37, where it had climbed to');
  assert.equal(supportMaterialHere(at(-15)), 'cobbled_deepslate');
  assert.equal(supportMaterialHere(at(70, 'the_nether')), 'netherrack');
  const src = require('fs').readFileSync(require.resolve('../src/work'), 'utf8');
  assert.match(src, /const carried = portalSupports\(bot\);\n\s+if \(carried\.count >= needed\) return true;\n\s+const material = supportMaterialHere\(bot\);/);
});

test('a staircase whose steps the survival layer broke into is not set aside for pacing (25593 mid-237-bh 17:54:30-17:55:55Z, note 753e)', () => {
  const src = require('fs').readFileSync(require.resolve('../src/tunneling'), 'utf8');
  assert.match(src, /const survivalSince = Date\.parse\(goal\.survivalAction\?\.at \|\| ''\) > \(tunnel\.lastStepAt \|\| 0\);/);
});
