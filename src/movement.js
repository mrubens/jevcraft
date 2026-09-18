'use strict';
const { Movements } = require('mineflayer-pathfinder');
const { fixMiningMaterials } = require('./compatibility');

function configureMovements(bot) {
  fixMiningMaterials(bot.registry);
  const movement = new Movements(bot);
  movement.canDig = true;
  movement.allow1by1towers = true;
  movement.allowParkour = false;
  movement.maxDropDown = 3;
  movement.liquidCost = 4;
  // Let navigation clear vegetation and soft terrain. Resource mining stays
  // explicit, and navigation cannot tear down plank houses or stone machines.
  const soft = /^(dirt|grass_block|coarse_dirt|rooted_dirt|podzol|sand|gravel|snow|short_grass|tall_grass|fern|large_fern|leaf_litter|mushroom_stem|red_mushroom_block|brown_mushroom_block)$|_leaves$|_log$/;
  for (const block of bot.registry.blocksArray) {
    if (!soft.test(block.name)) movement.blocksCantBreak.add(block.id);
  }
  bot.pathfinder.setMovements(movement);
  updateDigCapabilities(bot);
  return movement;
}

function updateDigCapabilities(bot) {
  const movement = bot.pathfinder.movements;
  // Natural rock may obstruct an escape or a mountain path. Crafted blocks
  // remain protected, and each active construction area has its own exclusion.
  for (const name of ['stone', 'deepslate', 'granite', 'diorite', 'andesite', 'tuff']) {
    const block = bot.registry.blocksByName[name];
    if (!block) continue;
    const canHarvest = bot.inventory.items().some(item => item.name.endsWith('_pickaxe') && block.harvestTools?.[item.type]);
    if (canHarvest) movement.blocksCantBreak.delete(block.id);
    else movement.blocksCantBreak.add(block.id);
  }
}
module.exports = { configureMovements, updateDigCapabilities };
