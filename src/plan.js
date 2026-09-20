'use strict';

// ---------------------------------------------------------------------------
// Progression constants shared by the planner and the executor.
//
// The planner itself lives in knowledge.js, which builds its recipe, smelting
// and drop graph from data/vanilla-26.1.json — the actual extracted game data,
// versioned with its own checksum. What is left here is the handful of facts
// that data does not carry: tool tiers, the depths ores generate at, and a
// small hand-written block table the executor uses to widen a resource search.
//
// There was once a second, hand-maintained recipe table in this file with its
// own planner. It only knew oak and a dozen recipes, and nothing executed it,
// so it drifted away from what the bot really did. Add new knowledge to the
// extracted data, not here.
// ---------------------------------------------------------------------------

const TOOL_TIERS = ['wooden', 'stone', 'iron', 'diamond', 'netherite'];

/**
 * block -> what it drops and the pickaxe tier needed to get the drop.
 *
 * knowledge.js derives the authoritative drop graph from the game's own loot
 * tables. This table is a search aid on top of it: work.js uses it to widen
 * "find me more of this resource" to the blocks that yield it, and to answer
 * the tier question without a full plan. It is deliberately partial — an
 * absent block just means the drop graph answers alone.
 */
const MINEABLE = {
  oak_log: { drops: 'oak_log', tier: 0 },
  birch_log: { drops: 'birch_log', tier: 0 },
  dirt: { drops: 'dirt', tier: 0 },
  grass_block: { drops: 'dirt', tier: 0 },
  sand: { drops: 'sand', tier: 0 },
  gravel: { drops: 'gravel', tier: 0 },
  poppy: { drops: 'poppy', tier: 0 },
  cornflower: { drops: 'cornflower', tier: 0 },
  stone: { drops: 'cobblestone', tier: 1 },
  cobblestone: { drops: 'cobblestone', tier: 1 },
  coal_ore: { drops: 'coal', tier: 1 },
  deepslate_coal_ore: { drops: 'coal', tier: 1 },
  iron_ore: { drops: 'raw_iron', tier: 2 },
  deepslate_iron_ore: { drops: 'raw_iron', tier: 2 },
  copper_ore: { drops: 'raw_copper', tier: 2 },
  lapis_ore: { drops: 'lapis_lazuli', tier: 2 },
  gold_ore: { drops: 'raw_gold', tier: 3 },
  redstone_ore: { drops: 'redstone', tier: 3 },
  diamond_ore: { drops: 'diamond', tier: 3 },
  deepslate_diamond_ore: { drops: 'diamond', tier: 3 },
  emerald_ore: { drops: 'emerald', tier: 3 },
  obsidian: { drops: 'obsidian', tier: 4 },
};

/** Where each ore actually generates, as a 1.18+ search depth hint. */
const ORE_DEPTH = {
  diamond_ore: -59,
  deepslate_diamond_ore: -59,
  redstone_ore: -59,
  lapis_ore: -1,
  gold_ore: -16,
  iron_ore: 16,
  deepslate_iron_ore: 16,
  copper_ore: 48,
  coal_ore: 96,
  emerald_ore: 232,
};

class PlanError extends Error {
  constructor(message, item) {
    super(message);
    this.name = 'PlanError';
    this.item = item;
  }
}

module.exports = {
  PlanError,
  MINEABLE,
  ORE_DEPTH,
  TOOL_TIERS,
};
