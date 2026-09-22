'use strict';
const { Movements } = require('mineflayer-pathfinder');
const { fixMiningMaterials, fixPathfinderResults } = require('./compatibility');
const { hostileEntities, safeFromHostiles } = require('./danger');
const { Vec3 } = require('vec3');
const Move = require('mineflayer-pathfinder/lib/move');
const { damagingTerrain, swimmingBlocks, swimmableWater } = require('./terrain');
const { isDoor, doorAt, doorAllowsDirection } = require('./doors');

class SurvivalMovements extends Movements {
  getMoveForward(node, direction, neighbors) {
    const target = new Vec3(node.x + direction.x, node.y, node.z + direction.z);
    const here = this.getBlock(node, 0, 0, 0), there = this.getBlock(node, direction.x, 0, direction.z);
    if (!isDoor(here.name) && !isDoor(there.name)) return super.getMoveForward(node, direction, neighbors);
    const doors = [];
    for (const [block, p] of [[here, node], [there, target]]) {
      if (!isDoor(block.name)) continue;
      const door = doorAt(this.bot, p);
      if (!door || !doorAllowsDirection(door, direction)) return;
      doors.push(door);
    }
    const floor = this.getBlock(node, direction.x, -1, direction.z), head = this.getBlock(node, direction.x, 1, direction.z);
    // Ordinary level thresholds only. Do not open a door onto a drop or use
    // its thin panel as a walking support or a substitute for headroom.
    if (!floor.physical || Math.abs(floor.height - node.y) > .01 || !isDoor(there.name) && (!there.safe || !head.safe)) return;
    const cost = 1 + this.exclusionStep(there) + this.getNumEntitiesAt(there.position, 0, 0, 0) * this.entityCost;
    if (cost > 100) return;
    const interactions = doors.filter(d => !d.getProperties().open).map(d => ({ ...d.position, dx: 0, dy: 0, dz: 0, useOne: true }));
    const move = new Move(target.x, target.y, target.z, node.remainingBlocks, cost + interactions.length, [], interactions);
    if (isDoor(there.name)) move.doorway = { ...target };
    neighbors.push(move);
  }

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
    // Upstream starts two blocks down. At a deep riverbank that skips the
    // upper water cell and proposes an underwater landing, which our surface
    // policy correctly rejects. Enter the actual surface instead.
    const edge = this.getBlock(node, direction.x, -1, direction.z);
    if (swimmableWater(edge) && edge.safe && this.getBlock(node, direction.x, 0, direction.z).safe &&
      !this.getBlock(node, direction.x, 0, direction.z).liquid) return edge;
    // Upstream compares against the floor block, one below the eventual
    // feet position. Convert that bound so a three-block allowance really
    // permits a three-block drop, then validate the returned landing height.
    const limit = this.maxDropDown;
    try {
      this.maxDropDown = limit + 1;
      const landing = super.getLandingBlock(node, direction);
      return landing && node.y - landing.position.y <= limit ? landing : null;
    } finally { this.maxDropDown = limit; }
  }

  getMoveJumpUp(node, direction, neighbors) {
    if (!swimmableWater(this.getBlock(node, 0, 0, 0))) return super.getMoveJumpUp(node, direction, neighbors);
    const bank = this.getBlock(node, direction.x, 0, direction.z);
    const head = this.getBlock(node, 0, 1, 0);
    const above = this.getBlock(node, direction.x, 1, direction.z);
    const clearance = this.getBlock(node, direction.x, 2, direction.z);
    // Buoyancy supplies the starting height. Comparing a bank against the
    // water block *below* the swimmer made every deep-water exit too tall.
    if (!bank.physical || bank.height - node.y > 1.2 || !head.safe || head.liquid ||
      !above.safe || above.liquid || !clearance.safe || clearance.liquid) return;
    const cost = 2 + this.liquidCost + this.exclusionStep(above) +
      this.getNumEntitiesAt(above.position, 0, 0, 0) * this.entityCost;
    if (cost <= 100) neighbors.push(new Move(above.position.x, above.position.y, above.position.z, node.remainingBlocks, cost, [], []));
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

// The pathfinder digs its way through terrain with whatever tool digs
// fastest, which is the iron pickaxe, on every block of every tunnel. That
// is how the dream run lost three iron pickaxes to stone. It digs with the
// cheapest tool that harvests the block, the same policy as the bot's own digs.
function installToolPolicy(bot) {
  if (!bot.pathfinder) return;
  const { cheapestTool } = require('./skills');
  bot.pathfinder.bestHarvestTool = block => cheapestTool(bot, block);
}

function configureMovements(bot) {
  fixMiningMaterials(bot.registry);
  fixPathfinderResults();
  installToolPolicy(bot);
  const movement = new SurvivalMovements(bot);
  for (const name of swimmingBlocks) if (bot.registry.blocksByName[name]) movement.liquids.add(bot.registry.blocksByName[name].id);
  for (const block of bot.registry.blocksArray) if (isDoor(block.name)) movement.fences.add(block.id);
  for (const name of damagingTerrain) {
    const block = bot.registry.blocksByName[name];
    if (block) movement.blocksToAvoid.add(block.id);
  }
  // Farmland is walked around, not over: a landing on it turns it back to
  // dirt, and the base's plot was retilled after every visit. Tilling and
  // planting stand beside the cell, so nothing needs to step on it.
  if (bot.registry.blocksByName.farmland) movement.blocksToAvoid.add(bot.registry.blocksByName.farmland.id);
  movement.canDig = true;
  movement.allow1by1towers = true;
  movement.allowParkour = false;
  movement.allowSprinting = false;
  movement.maxDropDown = 3;
  // The defaults, kept for the main loop to restore each tick: a policy a
  // step applies and never restores on an error path otherwise cripples
  // every later path search with someone else's restrictions.
  bot._movementDefaults = { canDig: true, allow1by1towers: true, allowParkour: false, allowSprinting: false, maxDropDown: 3,
    scafoldingBlocks: [...movement.scafoldingBlocks], allowedPosition: undefined };
  // Pathfinder otherwise treats water as a safe landing at ANY depth,
  // even when a cliff has ledges between the bot and that water.
  movement.infiniteLiquidDropdownDistance = false;
  // Crossing ordinary water should be cheaper than constructing a road.
  // The old liquid cost (4) plus default place cost (1) made a block bridge
  // win even across a small pond. Keep bridging available for actual gaps.
  movement.liquidCost = 1;
  movement.placeCost = 6;
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
module.exports = { configureMovements, updateDigCapabilities, installToolPolicy };
