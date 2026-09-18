'use strict';

// ---------------------------------------------------------------------------
// The planner. No model, no network, no game — pure functions over data.
//
// Minecraft progression is a known dependency graph: a diamond needs an iron
// pickaxe, which needs ingots, which need smelting, which needs a furnace and
// fuel. That is an exact lookup, not a judgment, so it belongs in code where it
// is inspectable and cannot be hallucinated. A model asked to "figure out how
// to get a diamond" will sometimes invent a recipe; this will not.
//
// The objective executor replans from observed inventory after every action.
// The older experimental action menu also uses these recipe/tool tables.
// ---------------------------------------------------------------------------

const TOOL_TIERS = ['wooden', 'stone', 'iron', 'diamond', 'netherite'];
const tierOf = (name) => TOOL_TIERS.indexOf(name) + 1; // wooden = 1

/** block -> what it drops and the pickaxe tier needed to get the drop. */
const MINEABLE = {
  oak_log: { drops: 'oak_log', tier: 0 },
  birch_log: { drops: 'birch_log', tier: 0 },
  dirt: { drops: 'dirt', tier: 0 },
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

/** item -> crafting recipe. `table` means it needs a crafting table, not the 2x2 grid. */
const RECIPES = {
  red_dye: { from: { poppy: 1 }, yields: 1, table: false },
  blue_dye: { from: { cornflower: 1 }, yields: 1, table: false },
  purple_dye: { from: { red_dye: 1, blue_dye: 1 }, yields: 2, table: false },
  purple_concrete_powder: { from: { sand: 4, gravel: 4, purple_dye: 1 }, yields: 8, table: true },
  flint_and_steel: { from: { iron_ingot: 1, flint: 1 }, yields: 1, table: false },
  oak_planks: { from: { oak_log: 1 }, yields: 4, table: false },
  stick: { from: { oak_planks: 2 }, yields: 4, table: false },
  crafting_table: { from: { oak_planks: 4 }, yields: 1, table: false },
  furnace: { from: { cobblestone: 8 }, yields: 1, table: true },
  torch: { from: { coal: 1, stick: 1 }, yields: 4, table: false },
  wooden_pickaxe: { from: { oak_planks: 3, stick: 2 }, yields: 1, table: true },
  stone_pickaxe: { from: { cobblestone: 3, stick: 2 }, yields: 1, table: true },
  iron_pickaxe: { from: { iron_ingot: 3, stick: 2 }, yields: 1, table: true },
  diamond_pickaxe: { from: { diamond: 3, stick: 2 }, yields: 1, table: true },
  stone_sword: { from: { cobblestone: 2, stick: 1 }, yields: 1, table: true },
  iron_sword: { from: { iron_ingot: 2, stick: 1 }, yields: 1, table: true },
  shield: { from: { oak_planks: 6, iron_ingot: 1 }, yields: 1, table: true },
  bucket: { from: { iron_ingot: 3 }, yields: 1, table: true },
};

/** item -> what you smelt to get it. */
const SMELTING = {
  iron_ingot: { from: 'raw_iron' },
  gold_ingot: { from: 'raw_gold' },
  copper_ingot: { from: 'raw_copper' },
  glass: { from: 'sand' },
};

/**
 * Where each ore actually generates. These are 1.18+ figures; a pre-1.18 world
 * puts diamonds around y=12 instead; pass `legacyDepths: true` for those.
 */
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

const ORE_DEPTH_LEGACY = {
  diamond_ore: 12,
  redstone_ore: 12,
  lapis_ore: 20,
  gold_ore: 30,
  iron_ore: 40,
  coal_ore: 60,
  emerald_ore: 30,
};

/** One plank smelts roughly 1.5 items; round up and keep a margin. */
const ITEMS_PER_PLANK = 1.5;

class PlanError extends Error {
  constructor(message, item) {
    super(message);
    this.name = 'PlanError';
    this.item = item;
  }
}

function blockYielding(item) {
  for (const [block, meta] of Object.entries(MINEABLE)) {
    if (meta.drops === item) return { block, ...meta };
  }
  return null;
}

/**
 * Build an ordered list of primitive steps that takes `inventory` to `count`
 * of `item`. Steps are: mine, craft, smelt, descend.
 *
 * The virtual inventory is mutated as we go, so quantities accumulate correctly
 * across shared ingredients — the sticks for a wooden pickaxe and the sticks
 * for an iron pickaxe come out of one planned batch of planks.
 */
function planFor(item, count, inventory = {}, options = {}) {
  const depths = options.legacyDepths ? ORE_DEPTH_LEGACY : ORE_DEPTH;
  const inv = { ...inventory };
  const steps = [];
  const visiting = new Set();

  function have(name) {
    return inv[name] || 0;
  }
  function add(name, n) {
    inv[name] = have(name) + n;
  }
  function consume(name, n) {
    inv[name] = have(name) - n;
  }

  /** Ensure a pickaxe of at least `tier` is in the (virtual) inventory. */
  function ensureTool(tier) {
    if (tier <= 0) return;
    for (let t = tier; t <= TOOL_TIERS.length; t++) {
      if (have(`${TOOL_TIERS[t - 1]}_pickaxe`) > 0) return;
    }
    acquire(`${TOOL_TIERS[tier - 1]}_pickaxe`, 1);
  }

  function acquire(name, needed) {
    if (have(name) >= needed) return;
    if (visiting.has(name)) {
      throw new PlanError(`circular requirement while planning ${name}`, name);
    }
    visiting.add(name);
    try {
      const missing = needed - have(name);

      if (name === 'purple_concrete') {
        // Obtain the required tool before travelling for the ingredients.
        ensureTool(1);
        acquire('purple_concrete_powder', missing);
        consume('purple_concrete_powder', missing);
        steps.push({ action: 'harden', item: name, count: missing,
          consumes: { purple_concrete_powder: missing }, produces: { [name]: missing } });
        add(name, missing);
        return;
      }
      if (name === 'flint') {
        steps.push({ action: 'mine', block: 'gravel', drops: 'flint', count: missing,
          tier: 0, depth: null, consumes: {}, produces: { flint: missing } });
        add(name, missing);
        return;
      }

      // 1. Can we mine it?
      const source = blockYielding(name);
      if (source) {
        ensureTool(source.tier);
        // Depth is a property of the mining step, not a separate instruction.
        // Keeping them fused means a reorder can never separate "go to y=-59"
        // from "mine the diamonds you went there for".
        steps.push({
          action: 'mine',
          block: source.block,
          count: missing,
          drops: name,
          depth: depths[source.block] != null ? depths[source.block] : null,
          tier: source.tier,
          consumes: {},
          produces: { [name]: missing },
        });
        add(name, missing);
        return;
      }

      // 2. Can we smelt it?
      if (SMELTING[name]) {
        const input = SMELTING[name].from;
        acquire(input, missing);
        acquire('furnace', 1);
        const fuel = Math.ceil(missing / ITEMS_PER_PLANK);
        acquire('oak_planks', fuel);
        consume(input, missing);
        consume('oak_planks', fuel);
        steps.push({
          action: 'smelt',
          item: name,
          count: missing,
          from: input,
          fuel,
          consumes: { [input]: missing, oak_planks: fuel, furnace: 1 },
          produces: { [name]: missing },
        });
        add(name, missing);
        return;
      }

      // 3. Can we craft it?
      const recipe = RECIPES[name];
      if (recipe) {
        const batches = Math.ceil(missing / recipe.yields);
        if (recipe.table) acquire('crafting_table', 1);
        for (const [ing, per] of Object.entries(recipe.from)) {
          acquire(ing, per * batches);
          // Reserve each ingredient before resolving the next dependency;
          // e.g. sticks must not spend the planks reserved for the pickaxe.
          consume(ing, per * batches);
        }
        const consumes = {};
        for (const [ing, per] of Object.entries(recipe.from)) consumes[ing] = per * batches;
        if (recipe.table) consumes.crafting_table = 1;
        steps.push({
          action: 'craft',
          item: name,
          count: batches * recipe.yields,
          needs_table: recipe.table,
          consumes,
          produces: { [name]: batches * recipe.yields },
        });
        add(name, batches * recipe.yields);
        return;
      }

      throw new PlanError(`I don't know how to obtain ${name}`, name);
    } finally {
      visiting.delete(name);
    }
  }

  acquire(item, count);
  // Preserve dependency order and resource consumption. The old sorter counted
  // all produced ingredients forever, allowing later crafts to spend them twice.
  return steps;
}

/** Human-readable one-liner for a step, used in chat and logs. */
function describeStep(step) {
  switch (step.action) {
    case 'mine':
      return step.depth != null
        ? `go to y=${step.depth} and mine ${step.count} ${step.block}`
        : `mine ${step.count} ${step.block}`;
    case 'craft':
      return `craft ${step.count} ${step.item}`;
    case 'smelt':
      return `smelt ${step.count} ${step.item}`;
    default:
      return step.action;
  }
}

/**
 * Has a step already been achieved? Checked against the *real* inventory before
 * each step runs, so a plan stays correct when the world hands the bot
 * something unexpectedly — a mined block dropping extra, or a chest find.
 */
function stepSatisfied(step, inventory, botY) {
  switch (step.action) {
    case 'mine':
      return (inventory[step.drops] || 0) >= step.count;
    case 'craft':
    case 'smelt':
      return (inventory[step.item] || 0) >= step.count;
    default:
      return false;
  }
}

module.exports = {
  planFor,
  describeStep,
  stepSatisfied,
  PlanError,
  MINEABLE,
  RECIPES,
  SMELTING,
  ORE_DEPTH,
  ORE_DEPTH_LEGACY,
  TOOL_TIERS,
  tierOf,
};
