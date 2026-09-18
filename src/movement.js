'use strict';
const { Movements } = require('mineflayer-pathfinder');

function configureMovements(bot) {
  const movement = new Movements(bot);
  movement.canDig = true;
  movement.allow1by1towers = false;
  movement.allowParkour = false;
  movement.maxDropDown = 3;
  movement.liquidCost = 4;
  // Let navigation clear vegetation and soft terrain. Resource mining stays
  // explicit, and navigation cannot tear down plank houses or stone machines.
  const soft = /^(dirt|grass_block|coarse_dirt|rooted_dirt|podzol|sand|gravel|snow|short_grass|tall_grass|fern|large_fern)$|_leaves$|_log$/;
  for (const block of bot.registry.blocksArray) {
    if (!soft.test(block.name)) movement.blocksCantBreak.add(block.id);
  }
  bot.pathfinder.setMovements(movement);
  return movement;
}
module.exports = { configureMovements };
