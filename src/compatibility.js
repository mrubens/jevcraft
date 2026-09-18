'use strict';

// minecraft-data can emit a harvest restriction tag as the mining material.
// This makes diamond-pickaxe obsidian mining take 75 seconds instead of 9.4.
// https://github.com/PrismarineJS/mineflayer/issues/3921
// Keep harvestTools intact; only recover the tool-speed group when every
// permitted harvest tool establishes that this is a pickaxe block.
function fixMiningMaterials(registry) {
  if (!registry.materials['mineable/pickaxe']) return;
  for (const block of registry.blocksArray) {
    if (!/^incorrect_for_.*_tool$/.test(block.material || '')) continue;
    const tools = Object.keys(block.harvestTools || {}).map(id => registry.items[id]?.name);
    if (tools.length && tools.every(name => name?.endsWith('_pickaxe'))) block.material = 'mineable/pickaxe';
  }
}

module.exports = { fixMiningMaterials };
