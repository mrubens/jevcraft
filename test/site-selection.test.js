'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { selectSite } = require('../src/work');

// Flat grass at y 63 with air above, plus whatever logs the case plants.
function flatWorld(logs = []) {
  const trunks = new Set(logs.map(([x, y, z]) => `${x},${y},${z}`));
  return { entity: { position: new Vec3(0.5, 64, 0.5) },
    blockAt: p => trunks.has(`${p.x},${p.y},${p.z}`) ? { name: 'oak_log', boundingBox: 'block' }
      : p.y < 64 ? { name: 'grass_block', boundingBox: 'block' } : { name: 'air', boundingBox: 'empty' } };
}

test('the house site keeps clear of a standing tree when level ground without one is in reach', () => {
  const tree = [[2, 64, 0], [2, 65, 0], [2, 66, 0], [2, 67, 0]];
  const site = selectSite(flatWorld(tree), 'oak_planks');
  assert(site, 'a site is found');
  const { min, max } = site.bounds;
  assert(!(2 >= min.x - 1 && 2 <= max.x + 1 && 0 >= min.z - 1 && 0 <= max.z + 1), `footprint ${JSON.stringify(site.bounds)} touches the tree`);
  const beside = selectSite(flatWorld(tree), 'oak_planks', { avoidTrees: false });
  assert(beside.bounds.max.x + 1 >= 2 && 0 >= beside.bounds.min.z - 1 && 0 <= beside.bounds.max.z + 1, 'without the preference the nearest level ground, beside the tree, wins');
});

test('when every level site has a tree beside it, one is still chosen', () => {
  const forest = [];
  // Trunks six apart across and eight apart along: the footprint fits between
  // them, but never with a clear block to spare on every side.
  for (let x = -18; x <= 18; x += 6) for (let z = -16; z <= 16; z += 8) for (let y = 64; y < 68; y++) forest.push([x, y, z]);
  const site = selectSite(flatWorld(forest), 'oak_planks');
  assert(site, 'a treeless site is preferred, not required');
});
