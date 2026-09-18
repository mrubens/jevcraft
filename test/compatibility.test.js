'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { fixMiningMaterials } = require('../src/compatibility');

test('26.1 mining uses pickaxe speed while preserving harvest requirements', () => {
  const registry = require('prismarine-registry')('26.1');
  const Block = require('prismarine-block')(registry);
  const originalHarvest = { ...registry.blocksByName.obsidian.harvestTools };
  fixMiningMaterials(registry);
  const obsidian = Block.fromStateId(registry.blocksByName.obsidian.defaultState);
  const diamond = registry.itemsByName.diamond_pickaxe.id;
  const iron = registry.itemsByName.iron_pickaxe.id;
  assert.equal(obsidian.digTime(diamond, false, false, false), 9400);
  assert.equal(obsidian.canHarvest(diamond), true);
  assert.ok(!obsidian.canHarvest(iron));
  assert.deepEqual(obsidian.harvestTools, originalHarvest);
  assert.equal(registry.blocksByName.oak_log.material, 'mineable/axe');
});
