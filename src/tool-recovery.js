'use strict';
const { planCatalog } = require('./knowledge');
const { dryStanding, miningReach } = require('./mining-access');
const { safeExcavation } = require('./tunneling');
const { safeFromHostiles } = require('./danger');
const { reservedForConstruction } = require('./build-sites');
const { checkAir } = require('./vitals');

// The ordinary tool reserve must not create a circular dependency when a worn
// pick can gather the last ingredient for its own replacement. Admit that pick
// to this one recipe proof only; never count it as a general expedition tool.
function replacementPlan(bot, available = {}) {
  const stock = {}, worn = new Map();
  for (const item of bot.inventory.items()) {
    stock[item.name] = (stock[item.name] || 0) + item.count;
    const remaining = (bot.registry.itemsByName[item.name]?.maxDurability || 0) - (item.durabilityUsed || 0);
    if (item.name.endsWith('_pickaxe') && remaining > 0 && remaining < 8) {
      worn.set(item.name, Math.max(worn.get(item.name) || 0, remaining));
    }
    if (item.name.endsWith('_pickaxe') && remaining >= 8) return null;
  }
  // Callers may supply a crafting table already checked for reachable access.
  // Other ingredients and tool durability must still come from real inventory.
  stock.crafting_table = Math.max(stock.crafting_table || 0, available.crafting_table || 0);
  // Ask the real catalog for a stronger replacement. Only a complete recipe
  // funded by carried ingredients and the remaining stone swings qualifies.
  let plan;
  try { plan = planCatalog(bot.registry, 'stone_pickaxe', (stock.stone_pickaxe || 0) + 1, stock, { nearby: ['stone'] }); }
  catch (_) { return null; }
  const mining = plan.filter(step => step.action === 'mine');
  if (mining.length > 1 || mining.length && (!['cobblestone', 'cobbled_deepslate', 'blackstone'].includes(mining[0].drops) ||
      !worn.has(mining[0].tool) || mining[0].count > worn.get(mining[0].tool)) ||
      plan.some(step => !['mine', 'craft'].includes(step.action)) ||
      !plan.some(step => step.action === 'craft' && step.item === 'stone_pickaxe')) return null;
  // Carry out one verified dependency at a time, including crafting after the
  // old tool breaks. Recompute the proof after every interruption or restart.
  return { plan, step: plan[0].action === 'mine' ? { ...plan[0], count: 1, minimumToolDurability: 1 } : plan[0] };
}

async function bootstrapPickaxe(bot, task, goal, save, { mine, craft, available, minimumMiningY }) {
  task.check(); checkAir(bot);
  const proof = replacementPlan(bot, available);
  if (!proof || !dryStanding(bot, bot.entity.position)) return false;
  const step = proof.step;
  let target;
  if (step.action === 'mine') {
    const matching = step.sources.map(name => bot.registry.blocksByName[name]?.id).filter(id => id !== undefined);
    const positions = bot.findBlocks({ matching, maxDistance: 4, count: 16 });
    target = positions.find(p => {
      const block = bot.blockAt(p);
      return (minimumMiningY === undefined || p.y >= minimumMiningY) &&
        step.sources.includes(block?.name) && block.diggable && bot.canDigBlock(block) &&
        miningReach(bot, bot.entity.position, p) && safeExcavation(bot, p) &&
        safeFromHostiles(bot, p) && !reservedForConstruction(goal, p);
    });
    if (!target) return false;
  } else if (!craft) return false;
  const movement = bot.pathfinder.movements;
  const previous = { canDig: movement.canDig, scafoldingBlocks: movement.scafoldingBlocks, allow1by1towers: movement.allow1by1towers };
  Object.assign(movement, { canDig: false, scafoldingBlocks: [], allow1by1towers: false });
  const item = step.drops || step.item;
  const count = () => bot.inventory.items().filter(i => i.name === item).reduce((n, i) => n + i.count, 0);
  const before = count();
  try {
    goal.step = { action: 'bootstrap_pickaxe', item: 'stone_pickaxe', phase: step.action, tool: step.tool,
      source: target && { ...target }, recipe: proof.plan };
    save();
    if (target) await mine(bot, task, step, goal, save, target);
    else await craft(bot, task, step, goal);
    task.check();
    if (count() <= before) throw new Error('Replacement-tool ingredient pickup was not confirmed');
    goal.toolRecovery = { at: new Date().toISOString(), tool: step.tool, item, collected: count() - before };
    save();
    return true;
  } finally { Object.assign(movement, previous); }
}

module.exports = { replacementPlan, bootstrapPickaxe };
