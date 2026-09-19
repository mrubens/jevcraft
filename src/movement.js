'use strict';
const { Movements } = require('mineflayer-pathfinder');
const { fixMiningMaterials, fixPathfinderResults } = require('./compatibility');
const { hostileEntities, safeFromHostiles } = require('./danger');
const { Vec3 } = require('vec3');
const { damagingTerrain } = require('./terrain');

class SurvivalMovements extends Movements {
  getNeighbors(node) {
    const neighbors = super.getNeighbors(node);
    if (!this._hostileObservation || Date.now() - this._hostileObservation.at > 250) {
      this._hostileObservation = { at: Date.now(), entities: hostileEntities(this.bot, 64) };
    }
    // Upstream checks body space but accepts a damaging solid as the floor.
    // A ruined portal's magma must not become an ordinary walking surface.
    return neighbors.filter(next => ![-1, 0, 1].some(dy => damagingTerrain.has(this.getBlock(next, 0, dy, 0).name)) &&
      (!this.allowedPosition || this.allowedPosition(next)) &&
      safeFromHostiles(this.bot, new Vec3(next.x + 0.5, next.y, next.z + 0.5), this._hostileObservation.entities));
  }

  getLandingBlock(node, direction) {
    const landing = super.getLandingBlock(node, direction);
    return landing && node.y - landing.position.y <= this.maxDropDown ? landing : null;
  }

  getMoveDiagonal(node, direction, neighbors) {
    // Diagonal jumps and swimming corners can look traversable to the graph
    // while the full player body catches the adjacent wall. Route those moves
    // through cardinal cells so the executor can align before stepping up/out.
    if (this.getBlock(node, 0, 0, 0).liquid || this.getBlock(node, direction.x, 0, direction.z).liquid) return;
    // A diagonal crosses both corner cells with the player's full width.
    // The upstream graph accepts it when just one corner is traversable,
    // which can skim the other corner's lava even with a dry destination.
    for (const [dx, dz] of [[direction.x, 0], [0, direction.z]]) {
      if ([-1, 0, 1].some(dy => {
        const block = this.getBlock(node, dx, dy, dz);
        return damagingTerrain.has(block.name) || dy <= 0 && block.liquid;
      })) return;
    }
    const candidates = [];
    super.getMoveDiagonal(node, direction, candidates);
    neighbors.push(...candidates.filter(next => next.y <= node.y));
  }

  getMoveDown(node, neighbors) {
    // General navigation must not excavate a shaft beneath the bot's feet.
    // Underground work uses explicit, inspected staircase actions.
    if (this.getBlock(node, 0, -1, 0).climbable) super.getMoveDown(node, neighbors);
  }
}

function configureMovements(bot) {
  fixMiningMaterials(bot.registry);
  fixPathfinderResults();
  const movement = new SurvivalMovements(bot);
  for (const name of damagingTerrain) {
    const block = bot.registry.blocksByName[name];
    if (block) movement.blocksToAvoid.add(block.id);
  }
  movement.canDig = true;
  movement.allow1by1towers = true;
  movement.allowParkour = false;
  movement.allowSprinting = false;
  movement.maxDropDown = 3;
  // Pathfinder otherwise treats water as a safe landing at ANY depth,
  // even when a cliff has ledges between the bot and that water.
  movement.infiniteLiquidDropdownDistance = false;
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
